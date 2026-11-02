// Package proxy passes browser calls to agent-pi and business modules with the
// user's token. It adds no business rules: those services verify every token and own
// every access check.
package proxy

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"t10-workbench/internal/config"
	"t10-workbench/internal/telemetry"
)

const (
	sessionHeader = "Agent-Session-Id"
	methodHeader  = "Agent-Method"
	turnHeader    = "X-Turn-ID"
	traceHeader   = "traceparent"
	// maxBody matches the agent's maxBodyBytes, because images travel as base64.
	maxBody = 16 << 20
	// manifestTimeout keeps a slow module from holding up the app's first load.
	manifestTimeout = 3 * time.Second
)

// forwarded lists what a browser may pass on. Cookies and Origin stay here:
// agent-pi refuses a browser Origin, and the cookie is this service's own.
var forwarded = []string{"Accept", "Content-Type", "Last-Event-ID", sessionHeader, methodHeader, turnHeader}

// Proxy forwards to one kind of upstream.
type Proxy struct {
	agents  map[string]*url.URL
	modules []config.Agent
	rp      *httputil.ReverseProxy
	client  *http.Client
}

// New builds a Proxy for these agents and business modules.
func New(agents, modules []config.Agent) *Proxy {
	p := &Proxy{agents: map[string]*url.URL{}, modules: modules, client: &http.Client{Timeout: manifestTimeout}}
	for _, agent := range agents {
		p.agents[agent.Name] = agent.URL
	}
	p.rp = &httputil.ReverseProxy{
		Rewrite: func(*httputil.ProxyRequest) {},
		// A negative interval flushes after every write. The event stream
		// depends on it.
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Warn("upstream failed", "path", r.URL.Path, "error", err)
			WriteError(w, http.StatusBadGateway, "upstream_unavailable", "that service can't be reached")
		},
	}
	return p
}

// Agent passes one call to an agent's /agent endpoint, which is ai-gateway-agent
// once more than one agent-pi replica runs. Session IDs are
// <agent>.<replica>.<n>: everything before the last dot picks the replica, which
// is the sticky routing agent-pi asks for. An ID no entry names goes to the
// agent's own entry, so a single gateway entry serves every replica.
func (p *Proxy) Agent(w http.ResponseWriter, r *http.Request, agent, token string) {
	target, ok := p.route(agent, r.Header.Get(sessionHeader))
	if !ok {
		WriteError(w, http.StatusNotFound, "unknown_agent", "no such agent")
		return
	}
	headers := pick(r.Header)
	ctx := r.Context()
	if r.Method == http.MethodPost {
		turnCtx, traceparent, end := telemetry.StartTurn(ctx, r.Header.Get(turnHeader))
		defer end()
		ctx = turnCtx
		if traceparent != "" {
			headers.Set(traceHeader, traceparent)
		}
	}
	p.forward(w, r.WithContext(ctx), target.JoinPath("agent"), headers, token)
}

// Module passes one call to a business module, mapping
// /api/modules/<id>/x to /v1/x.
func (p *Proxy) Module(w http.ResponseWriter, r *http.Request, id, path, token string) {
	i := slices.IndexFunc(p.modules, func(m config.Agent) bool { return m.Name == id })
	if i < 0 {
		WriteError(w, http.StatusNotFound, "unknown_module", "that module isn't available here")
		return
	}
	headers := pick(r.Header)
	telemetry.Inject(r.Context(), headers)
	p.forward(w, r, p.modules[i].URL.JoinPath("v1", path), headers, token)
}

// Manifest is what a module says about itself to this person.
type Manifest struct {
	ID         string   `json:"id"`
	APIVersion int      `json:"api_version"`
	Features   []string `json:"features"`
	Enabled    bool     `json:"enabled"`
}

// Manifests asks every module about itself, and returns those that answer and
// are on for this person's tenant, in configured order. A module that can't
// answer is left out, so that it can't stop the app from loading.
func (p *Proxy) Manifests(ctx context.Context, token string) []Manifest {
	found := make([]*Manifest, len(p.modules))
	var wg sync.WaitGroup
	for i, module := range p.modules {
		wg.Go(func() { found[i] = p.manifest(ctx, module, token) })
	}
	wg.Wait()
	out := []Manifest{}
	for _, m := range found {
		if m != nil && m.Enabled {
			out = append(out, *m)
		}
	}
	return out
}

func (p *Proxy) manifest(ctx context.Context, module config.Agent, token string) *Manifest {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, module.URL.JoinPath("v1", "module").String(), nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+token)
	telemetry.Inject(ctx, req.Header)
	resp, err := p.client.Do(req)
	if err != nil {
		slog.Warn("module unavailable", "module", module.Name, "error", err)
		return nil
	}
	defer resp.Body.Close()
	var body Manifest
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&body) != nil || body.ID != module.Name {
		slog.Warn("module unavailable", "module", module.Name, "status", resp.StatusCode)
		return nil
	}
	return &body
}

func (p *Proxy) route(agent, sessionID string) (*url.URL, bool) {
	if at := strings.LastIndex(sessionID, "."); at > 0 {
		if target, ok := p.agents[sessionID[:at]]; ok {
			return target, true
		}
	}
	target, ok := p.agents[agent]
	return target, ok
}

func (p *Proxy) forward(w http.ResponseWriter, r *http.Request, target *url.URL, headers http.Header, token string) {
	out := r.Clone(r.Context())
	// JoinPath on a base with no path gives a relative one.
	out.URL = &url.URL{Scheme: target.Scheme, Host: target.Host, Path: "/" + strings.TrimPrefix(target.Path, "/"), RawQuery: r.URL.RawQuery}
	out.Host = target.Host
	out.Header = headers
	out.Header.Set("Authorization", "Bearer "+token)
	out.Body = http.MaxBytesReader(w, r.Body, maxBody)
	p.rp.ServeHTTP(w, out)
}

func pick(in http.Header) http.Header {
	out := http.Header{}
	for _, name := range forwarded {
		if value := in.Get(name); value != "" {
			out.Set(name, value)
		}
	}
	return out
}

// WriteError answers with the error shape the sibling services use.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code, "message": message})
}
