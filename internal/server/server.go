// Package server is the same-origin web app and API. The browser talks only to
// this service, so no t10 service needs CORS.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"t10-workbench/internal/config"
	"t10-workbench/internal/proxy"
	"t10-workbench/internal/session"
	"t10-workbench/internal/telemetry"
	"t10-workbench/internal/voice"
)

const maxJSONBody = 1 << 16

// Sessions is what routes need from the session manager.
type Sessions interface {
	Begin(w http.ResponseWriter, next, tenant string) string
	Complete(ctx context.Context, w http.ResponseWriter, r *http.Request) (string, error)
	Identify(ctx context.Context, r *http.Request) (session.Identity, error)
	SwitchTenant(ctx context.Context, r *http.Request, tenant string) error
	SignOut(ctx context.Context, w http.ResponseWriter, r *http.Request) string
	Alive(ctx context.Context, r *http.Request) error
}

// Deps is what the server needs.
type Deps struct {
	Config   config.Config
	Pool     *pgxpool.Pool
	Sessions Sessions
	Auth     *session.AuthClient
	Proxy    *proxy.Proxy
	// Web is the built app.
	Web fs.FS
}

// Server handles every request.
type Server struct {
	Deps
	csp string
}

// New builds a Server.
func New(d Deps) *Server { return &Server{Deps: d, csp: contentPolicy(d.Config)} }

type handler func(w http.ResponseWriter, r *http.Request, id session.Identity)

// Handler returns the routed handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	handle := func(pattern string, h http.Handler) { mux.Handle(pattern, telemetry.Wrap(pattern, h)) }

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /readyz", s.handleReady)

	handle("GET /auth/login", http.HandlerFunc(s.handleLogin))
	handle("GET /auth/callback", http.HandlerFunc(s.handleCallback))
	handle("POST /auth/logout", s.sameOrigin(http.HandlerFunc(s.handleLogout)))
	handle("GET /auth/session", http.HandlerFunc(s.handleSessionAlive))
	handle("GET /auth/leave", http.HandlerFunc(s.handleLeave))
	handle("GET /auth/account", http.HandlerFunc(s.handleAccount))
	handle("GET /signed-out", http.HandlerFunc(s.handleSignedOut))
	handle("POST /auth/tenant", s.sameOrigin(http.HandlerFunc(s.handleTenant)))

	handle("GET /api/config", s.user(s.handleConfig))
	handle("GET /api/me", s.user(s.handleMe))
	handle("POST /api/voice/admission", s.sameOrigin(s.user(s.handleAdmission)))
	agent := s.sameOrigin(s.user(func(w http.ResponseWriter, r *http.Request, id session.Identity) {
		s.Proxy.Agent(w, r, r.PathValue("agent"), id.Access, func() bool { return s.isTenantAdmin(r, id) })
	}))
	for _, method := range []string{"GET", "POST", "DELETE"} {
		pattern := method + " /api/agents/{agent}/agent"
		mux.Handle(pattern, telemetry.WrapTurn(pattern, agent))
	}
	handle("/api/modules/{module}/{path...}", s.sameOrigin(s.user(func(w http.ResponseWriter, r *http.Request, id session.Identity) {
		s.Proxy.Module(w, r, r.PathValue("module"), r.PathValue("path"), id.Access)
	})))
	org := s.sameOrigin(s.user(func(w http.ResponseWriter, r *http.Request, id session.Identity) {
		s.Proxy.Org(w, r, r.PathValue("tenant"), r.PathValue("path"), id.Access)
	}))
	handle("/api/org/{tenant}", org)
	handle("/api/org/{tenant}/{path...}", org)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		proxy.WriteError(w, http.StatusNotFound, "not_found", "no such route")
	})
	mux.HandleFunc("/", s.handleApp)
	return s.secure(logRequests(mux))
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if err := s.Pool.Ping(r.Context()); err != nil {
		slog.Warn("not ready", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]bool{"ready": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ready": true})
}

// user resolves the session before a handler runs.
func (s *Server) user(next handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := s.Sessions.Identify(r.Context(), r)
		if err != nil {
			writeSessionError(w, err)
			return
		}
		next(w, r, id)
	})
}

// sameOrigin refuses a write that doesn't come from this site. SameSite=Lax
// already keeps the cookie off cross-site posts, and this is the second lock.
func (s *Server) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("Origin") != s.Config.PublicURL {
			proxy.WriteError(w, http.StatusForbidden, "origin_not_allowed", "this request didn't come from the workbench")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	next := q.Get("next")
	http.Redirect(w, r, session.SignInHints(s.Sessions.Begin(w, next, tenantIn(next)), q.Get("reason"), q.Get("lang")), http.StatusFound)
}

// tenantIn reads the tenant from a path under /t/, so a link to one doesn't ask
// which. The auth service checks it, and asks anyway if it isn't one of theirs.
func tenantIn(path string) string {
	rest, ok := strings.CutPrefix(path, "/t/")
	if !ok {
		return ""
	}
	tenant, _, _ := strings.Cut(rest, "/")
	return tenant
}

func (s *Server) handleCallback(w http.ResponseWriter, r *http.Request) {
	next, err := s.Sessions.Complete(r.Context(), w, r)
	// The page reads this once, so a language chosen at sign-in carries over.
	if lang := r.URL.Query().Get("lang"); lang == "en" || lang == "zh-Hans" {
		http.SetCookie(w, &http.Cookie{Name: "t10_lang", Value: lang, Path: "/", MaxAge: 60, Secure: strings.HasPrefix(s.Config.PublicURL, "https://"), SameSite: http.SameSiteLaxMode})
	}
	switch {
	case errors.Is(err, session.ErrMFARequired):
		http.Redirect(w, r, "/signed-out?reason=mfa", http.StatusFound)
	case errors.Is(err, session.ErrTenantDenied):
		http.Redirect(w, r, "/signed-out?reason=no_access", http.StatusFound)
	case err != nil:
		slog.Warn("sign-in failed", "error", err)
		http.Redirect(w, r, "/signed-out?reason=failed", http.StatusFound)
	default:
		http.Redirect(w, r, next, http.StatusFound)
	}
}

// handleLogout ends this session, then hands the browser on to end the rest. A
// failure further on never leaves anyone signed in to this app.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	target := s.Sessions.SignOut(r.Context(), w, r)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"redirect": target})
}

// handleSessionAlive lets an open tab find out that someone signed out elsewhere.
func (s *Server) handleSessionAlive(w http.ResponseWriter, r *http.Request) {
	if err := s.Sessions.Alive(r.Context(), r); err != nil {
		writeSessionError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleSignedOut is where a finished sign-out lands: the sign-in page, saying what
// happened. The app's own page is for sign-ins that were refused.
func (s *Server) handleSignedOut(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("reason") != "" {
		s.handleApp(w, r)
		return
	}
	http.Redirect(w, r, "/auth/login?reason=signedout", http.StatusFound)
}

// handleLeave and handleAccount are the app's links to auth-server's pages, for
// pages with no signed-in session to read the address from.
func (s *Server) handleLeave(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, s.Config.AuthPublicURL+"/v1/signout", http.StatusFound)
}

func (s *Server) handleAccount(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, s.Config.AuthPublicURL+"/v1/account", http.StatusFound)
}

func (s *Server) handleTenant(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Tenant string `json:"tenant"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody)).Decode(&body); err != nil || body.Tenant == "" {
		proxy.WriteError(w, http.StatusBadRequest, "invalid_request", "name a tenant")
		return
	}
	if err := s.Sessions.SwitchTenant(r.Context(), r, body.Tenant); err != nil {
		writeSessionError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request, id session.Identity) {
	agents := []string{}
	for _, agent := range s.Config.Agents {
		if !strings.Contains(agent.Name, ".") {
			agents = append(agents, agent.Name)
		}
	}
	modules, unavailable := s.Proxy.Manifests(r.Context(), id.Access)
	body := map[string]any{
		"agents":              agents,
		"profiles":            s.Config.Profiles,
		"modules":             modules,
		"unavailable_modules": unavailable,
		"voice":               s.Config.LiveKitURL != "",
		"account_url":         s.Config.AuthPublicURL + "/v1/account",
	}
	if console := s.consoleURL(r, id); console != "" {
		body["console_url"] = console
	}
	access := s.meAccess(r, id)
	// Left out when unknown, so a client shows modules and lets each refuse.
	if access.Modules != nil {
		body["access"] = map[string]any{"modules": access.Modules, "module_admin": access.ModuleAdmin}
	}
	writeJSON(w, http.StatusOK, body)
}

// meAccess is what /v1/me/access says, for deciding only what to show: the console
// and each module ask the auth service again themselves. Any failure returns nothing.
type meAccess struct {
	Modules     []string `json:"modules"`
	ModuleAdmin []string `json:"module_admin"`
}

// consoleURL is the console's address, which the auth service gives only to a
// platform admin. Any failure leaves the link out.
func (s *Server) consoleURL(r *http.Request, id session.Identity) string {
	status, body, err := s.Auth.Call(r.Context(), http.MethodGet, "/v1/me/homes", id.Access, nil)
	if err != nil || status != http.StatusOK {
		return ""
	}
	var homes struct {
		Console struct {
			URL string `json:"url"`
		} `json:"console"`
	}
	if json.Unmarshal(body, &homes) != nil {
		return ""
	}
	return homes.Console.URL
}

func (s *Server) meAccess(r *http.Request, id session.Identity) meAccess {
	var access meAccess
	status, body, err := s.Auth.Call(r.Context(), http.MethodGet, "/v1/me/access", id.Access, nil)
	if err != nil || status != http.StatusOK || json.Unmarshal(body, &access) != nil {
		return meAccess{}
	}
	return access
}

// isTenantAdmin decides whether token usage is shown, so any failure hides it.
func (s *Server) isTenantAdmin(r *http.Request, id session.Identity) bool {
	status, body, err := s.Auth.Call(r.Context(), http.MethodGet, "/v1/me", id.Access, nil)
	if err != nil || status != http.StatusOK {
		return false
	}
	var me struct {
		ActiveTenant string `json:"active_tenant"`
		Tenants      []struct {
			ID   string `json:"id"`
			Role string `json:"role"`
		} `json:"tenants"`
	}
	if json.Unmarshal(body, &me) != nil {
		return false
	}
	for _, tenant := range me.Tenants {
		if tenant.ID == me.ActiveTenant {
			return tenant.Role == "admin"
		}
	}
	return false
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, id session.Identity) {
	status, body, err := s.Auth.Call(r.Context(), http.MethodGet, "/v1/me", id.Access, nil)
	if err != nil {
		writeSessionError(w, err)
		return
	}
	if status != http.StatusOK {
		proxy.WriteError(w, status, "account_unavailable", "your account can't be read")
		return
	}
	var me struct {
		UserID       string            `json:"user_id"`
		DisplayName  string            `json:"display_name"`
		ActiveTenant string            `json:"active_tenant"`
		Tenants      []json.RawMessage `json:"tenants"`
		Names        []struct {
			Value string `json:"value"`
		} `json:"names"`
	}
	if err := json.Unmarshal(body, &me); err != nil {
		slog.Warn("parse account", "error", err)
		proxy.WriteError(w, http.StatusBadGateway, "account_unavailable", "your account can't be read")
		return
	}
	name := ""
	if len(me.Names) > 0 {
		name = me.Names[0].Value
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id": me.UserID, "display_name": me.DisplayName, "active_tenant": me.ActiveTenant,
		"tenants": me.Tenants, "sign_in_name": name,
	})
}

func (s *Server) handleAdmission(w http.ResponseWriter, r *http.Request, id session.Identity) {
	var body struct {
		Room string `json:"room"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody)).Decode(&body); err != nil {
		proxy.WriteError(w, http.StatusBadRequest, "invalid_request", "malformed request")
		return
	}
	admission, err := voice.Admit(r.Context(), s.Auth, id.Access, body.Room)
	var refused voice.Refused
	switch {
	case errors.As(err, &refused):
		proxy.WriteError(w, refused.Status, refused.Code, "this call can't start")
	case err != nil:
		writeSessionError(w, err)
	default:
		writeJSON(w, http.StatusOK, admission)
	}
}

// handleApp serves the built app, and index.html for any route it owns.
func (s *Server) handleApp(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name != "" && name != "index.html" {
		if file, err := s.Web.Open(name); err == nil {
			info, err := file.Stat()
			_ = file.Close()
			if err == nil && !info.IsDir() {
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				http.ServeFileFS(w, r, s.Web, name)
				return
			}
		}
		if strings.HasPrefix(name, "assets/") {
			http.NotFound(w, r)
			return
		}
	}
	data, err := fs.ReadFile(s.Web, "index.html")
	if err != nil {
		http.Error(w, "the web app isn't built", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(data)
}

// secure sets the headers every response carries. The policy blocks remote
// images, which is what stops an injected reply leaking a conversation through
// an image URL.
func (s *Server) secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", s.csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func contentPolicy(cfg config.Config) string {
	connect := "'self'"
	if cfg.LiveKitURL != "" {
		// The SDK also makes plain HTTP calls to the same host.
		https := strings.Replace(strings.Replace(cfg.LiveKitURL, "wss://", "https://", 1), "ws://", "http://", 1)
		connect += " " + cfg.LiveKitURL + " " + https
	}
	return strings.Join([]string{
		"default-src 'none'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		"media-src 'self' blob:",
		"worker-src 'self' blob:",
		"connect-src " + connect,
		"form-action 'self'",
		"base-uri 'none'",
		"frame-ancestors 'none'",
	}, "; ")
}

func writeSessionError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, session.ErrSignedOut):
		proxy.WriteError(w, http.StatusUnauthorized, "signed_out", "sign in again")
	case errors.Is(err, session.ErrTenantDenied):
		proxy.WriteError(w, http.StatusForbidden, "tenant_denied", "you aren't a member of that tenant")
	case errors.Is(err, session.ErrMFARequired):
		proxy.WriteError(w, http.StatusForbidden, "mfa_required", "that tenant requires a second factor")
	default:
		slog.Warn("session failed", "error", err)
		proxy.WriteError(w, http.StatusServiceUnavailable, "auth_unavailable", "sign-in can't be checked right now")
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// statusRecorder notes the status for the request log. Unwrap keeps Flush
// reaching the real writer, which the event stream depends on.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status, "ms", time.Since(started).Milliseconds())
	})
}
