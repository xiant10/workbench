package proxy

import (
	"net/http"
	"net/url"
	"slices"
	"strings"

	"t10-workbench/internal/config"
	"t10-workbench/internal/telemetry"
)

// External agent teammates' runners work outside t10 and call in, so they reach
// t10 here, at the one address people use, rather than at services that are
// only inside the cluster. A runner has no session: its runner key, or a
// firing's token, passes through unchanged, and the service behind checks it.
// See t10-agent-control's docs/external-teammates.md.

// runnerRoutes are the first parts of t10-automations' runner routes.
var runnerRoutes = []string{"lease", "firings", "disconnect"}

// runnerForwarded is what a runner may pass on: an MCP client's headers too.
var runnerForwarded = []string{"Accept", "Content-Type", "Last-Event-ID", "Mcp-Session-Id", "Mcp-Protocol-Version"}

// Runner passes a runner's call to t10-automations, mapping /runner/v1/x to
// /v1/runner/x.
func (p *Proxy) Runner(w http.ResponseWriter, r *http.Request, path string) {
	first, _, _ := strings.Cut(path, "/")
	modules := p.moduleList()
	i := slices.IndexFunc(modules, func(m config.Agent) bool { return m.Name == "automations" })
	if i < 0 || !slices.Contains(runnerRoutes, first) || slices.Contains(strings.Split(path, "/"), "..") {
		WriteError(w, http.StatusNotFound, "not_found", "no such route")
		return
	}
	p.forwardRunner(w, r, modules[i].URL.JoinPath("v1", "runner", path))
}

// RunnerMCP passes a runner's MCP call, with its firing's token, to the tool
// gateway's collab tools.
func (p *Proxy) RunnerMCP(w http.ResponseWriter, r *http.Request) {
	if p.Tools == nil {
		WriteError(w, http.StatusNotFound, "not_found", "external teammates' tools aren't set up here")
		return
	}
	p.forwardRunner(w, r, p.Tools.JoinPath("mcp", "collab"))
}

func (p *Proxy) forwardRunner(w http.ResponseWriter, r *http.Request, target *url.URL) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || strings.TrimSpace(token) == "" {
		w.Header().Set("WWW-Authenticate", "Bearer")
		WriteError(w, http.StatusUnauthorized, "unauthorized", "a runner key or a firing's token is required")
		return
	}
	headers := http.Header{}
	for _, name := range runnerForwarded {
		if value := r.Header.Get(name); value != "" {
			headers.Set(name, value)
		}
	}
	headers.Set(clientHeader, "t10-runner")
	telemetry.Inject(r.Context(), headers)
	p.forward(w, r, target, headers, token)
}
