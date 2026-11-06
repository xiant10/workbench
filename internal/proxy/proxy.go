// Package proxy passes browser calls to agent-pi, business modules and the auth
// service's tenant routes with the user's token. Those services verify every token and own every access check. The one
// rule added here is that only admins see token usage, which a harness returns to any conversation's owner.
package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"t10-workbench/internal/config"
	"t10-workbench/internal/telemetry"
)

const (
	sessionHeader = "Agent-Session-Id"
	// agentHeader names the agent for a call with no session.
	agentHeader  = "Agent-Name"
	methodHeader = "Agent-Method"
	turnHeader   = "X-Turn-ID"
	traceHeader  = "traceparent"
	// maxBody matches the agent's maxBodyBytes, because images travel as base64.
	maxBody = 16 << 20
	// manifestTimeout keeps a slow module from holding up the app's first load.
	manifestTimeout = 3 * time.Second
)

// forwarded lists what a browser may pass on. Cookies and Origin stay here:
// agent-pi refuses a browser Origin, and the cookie is this service's own.
var forwarded = []string{"Accept", "Content-Type", "Idempotency-Key", "Last-Event-ID", sessionHeader, methodHeader, turnHeader}

// orgRoutes are the auth service's tenant routes that the admin pages use. Any
// other path stays here, though the auth service would refuse it anyway.
var orgRoutes = []string{"", "members", "invitations", "units", "grants", "audit", "roles", "permission-catalog"}

// Proxy forwards to one kind of upstream.
type Proxy struct {
	agents  map[string]*url.URL
	modules []config.Agent
	auth    *url.URL
	rp      *httputil.ReverseProxy
	client  *http.Client
}

// New builds a Proxy for these agents and business modules, and the auth
// service at auth.
func New(agents, modules []config.Agent, auth *url.URL) *Proxy {
	p := &Proxy{agents: map[string]*url.URL{}, modules: modules, auth: auth, client: &http.Client{Timeout: manifestTimeout}}
	for _, agent := range agents {
		p.agents[agent.Name] = agent.URL
	}
	p.rp = &httputil.ReverseProxy{
		Rewrite: func(*httputil.ProxyRequest) {},
		// A negative interval flushes after every write. The event stream
		// depends on it.
		FlushInterval:  -1,
		ModifyResponse: hideUsage,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Warn("upstream failed", "path", r.URL.Path, "error", err)
			WriteError(w, http.StatusBadGateway, "upstream_unavailable", "that service can't be reached")
		},
	}
	return p
}

// Agent passes one call to an agent's /agent endpoint, which is ai-gateway-agent
// once more than one replica runs. Session IDs are <pool>.<replica>.<n>: the ID
// picks the entry for that replica or pool. An ID no entry names goes to the
// agent's own entry, and a lone entry is a gateway that serves every agent.
// showUsage says whether this person may see token usage, and is asked only when
// an answer holds some.
func (p *Proxy) Agent(w http.ResponseWriter, r *http.Request, agent, token string, showUsage func() bool) {
	target, ok := p.route(agent, r.Header.Get(sessionHeader))
	if !ok {
		WriteError(w, http.StatusNotFound, "unknown_agent", "no such agent")
		return
	}
	headers := pick(r.Header)
	// A session names its own home. The agent picked in the browser may be another
	// one by now, and a harness refuses a name it doesn't serve.
	if r.Header.Get(sessionHeader) == "" {
		headers.Set(agentHeader, agent)
	}
	ctx := r.Context()
	if r.Method == http.MethodPost {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			WriteError(w, http.StatusRequestEntityTooLarge, "too_large", "that request is too large")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		if rpcMethod(body) == "session.get" {
			// A harness may answer as a stream if asked, and that couldn't be filtered.
			headers.Set("Accept", "application/json")
			ctx = context.WithValue(ctx, usageGate{}, showUsage)
		}
		turnCtx, traceparent, end := telemetry.StartTurn(ctx, r.Header.Get(turnHeader))
		defer end()
		ctx = turnCtx
		if traceparent != "" {
			headers.Set(traceHeader, traceparent)
		}
	}
	p.forward(w, r.WithContext(ctx), target.JoinPath("agent"), headers, token)
}

// usageGate is the context key for the check on a session.get answer.
type usageGate struct{}

// rpcMethod reads a JSON-RPC call's method by its exact key, as a harness does.
func rpcMethod(body []byte) string {
	var call map[string]json.RawMessage
	var method string
	if json.Unmarshal(body, &call) != nil || json.Unmarshal(call["method"], &method) != nil {
		return ""
	}
	return method
}

// hideUsage removes token usage from a session.get answer unless the caller may
// see it. An answer it can't read fails, rather than pass usage on.
func hideUsage(resp *http.Response) error {
	showUsage, _ := resp.Request.Context().Value(usageGate{}).(func() bool)
	if showUsage == nil || resp.StatusCode != http.StatusOK {
		return nil
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return err
	}
	stripped, found, err := withoutUsage(body)
	if err != nil {
		return err
	}
	if found && !showUsage() {
		body = stripped
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
	return nil
}

// withoutUsage empties `usage` and drops `taskUsage` and each task's `usage`, and
// says whether there was any. An error answer has no result, and passes unchanged.
func withoutUsage(body []byte) (stripped []byte, found bool, err error) {
	var answer map[string]json.RawMessage
	if err := json.Unmarshal(body, &answer); err != nil {
		return nil, false, err
	}
	var result map[string]json.RawMessage
	if raw, ok := answer["result"]; !ok || json.Unmarshal(raw, &result) != nil || result == nil {
		return body, false, nil
	}
	if _, ok := result["usage"]; ok {
		found = true
		result["usage"] = json.RawMessage(`{}`)
	}
	if _, ok := result["taskUsage"]; ok {
		found = true
		delete(result, "taskUsage")
	}
	var tasks []map[string]json.RawMessage
	if raw, ok := result["tasks"]; ok && json.Unmarshal(raw, &tasks) == nil {
		for _, task := range tasks {
			if _, ok := task["usage"]; ok {
				found = true
				delete(task, "usage")
			}
		}
		if result["tasks"], err = json.Marshal(tasks); err != nil {
			return nil, false, err
		}
	}
	if answer["result"], err = json.Marshal(result); err != nil {
		return nil, false, err
	}
	stripped, err = json.Marshal(answer)
	return stripped, found, err
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

// Org passes one call from the admin pages to the auth service, mapping
// /api/org/<tenant>/x to /v1/tenants/<tenant>/x. The auth service checks that the
// token's tenant is the one named, and that its holder administers it.
func (p *Proxy) Org(w http.ResponseWriter, r *http.Request, tenant, path, token string) {
	first, _, _ := strings.Cut(path, "/")
	if p.auth == nil || tenant == "" || !slices.Contains(orgRoutes, first) || slices.Contains(strings.Split(path, "/"), "..") {
		WriteError(w, http.StatusNotFound, "not_found", "no such route")
		return
	}
	headers := pick(r.Header)
	telemetry.Inject(r.Context(), headers)
	target := p.auth.JoinPath("v1", "tenants", tenant)
	if path != "" {
		target = target.JoinPath(path)
	}
	p.forward(w, r, target, headers, token)
}

// Manifest is what a module says about itself to this person.
type Manifest struct {
	ID         string   `json:"id"`
	APIVersion int      `json:"api_version"`
	Features   []string `json:"features"`
	Enabled    bool     `json:"enabled"`
}

// Manifests asks every module about itself, in configured order. on holds those
// that answered and are on for this person's tenant. unavailable holds the listed
// IDs that gave no clear answer: they're deployed but down, which differs from
// answering that they're off, so a client keeps their place. A module that can't
// answer can't stop the app from loading.
func (p *Proxy) Manifests(ctx context.Context, token string) (on []Manifest, unavailable []string) {
	found := make([]*Manifest, len(p.modules))
	var wg sync.WaitGroup
	for i, module := range p.modules {
		wg.Go(func() { found[i] = p.manifest(ctx, module, token) })
	}
	wg.Wait()
	on, unavailable = []Manifest{}, []string{}
	for i, m := range found {
		switch {
		case m == nil:
			unavailable = append(unavailable, p.modules[i].Name)
		case m.Enabled:
			on = append(on, *m)
		}
	}
	return on, unavailable
}

// manifest returns nil for anything but a clear answer from the module it asked.
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
		pool, _, _ := strings.Cut(sessionID, ".")
		if target, ok := p.agents[pool]; ok {
			return target, true
		}
	}
	if target, ok := p.agents[agent]; ok {
		return target, true
	}
	if len(p.agents) == 1 {
		for _, target := range p.agents {
			return target, true
		}
	}
	return nil, false
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
