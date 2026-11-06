package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"

	"t10-workbench/internal/config"
	"t10-workbench/internal/proxy"
	"t10-workbench/internal/session"
)

type fakeSessions struct {
	identify error
	complete error
	next     string
	switched string
	loggedIn bool
}

func (f *fakeSessions) Begin(http.ResponseWriter, string, string) string {
	return "http://auth/authorize"
}
func (f *fakeSessions) Complete(context.Context, http.ResponseWriter, *http.Request) (string, error) {
	return f.next, f.complete
}
func (f *fakeSessions) Identify(context.Context, *http.Request) (session.Identity, error) {
	return session.Identity{UserID: "usr_1", Access: "token"}, f.identify
}
func (f *fakeSessions) SwitchTenant(_ context.Context, _ *http.Request, tenant string) error {
	f.switched = tenant
	return f.identify
}
func (f *fakeSessions) Logout(context.Context, http.ResponseWriter, *http.Request) error { return nil }

func newServer(t *testing.T, sessions *fakeSessions, upstream string) http.Handler {
	t.Helper()
	return newServerWithAuth(t, sessions, upstream, http.StatusServiceUnavailable, "", "")
}

// newServerWithAuth has /v1/me/access and /v1/me/homes answer with the given status and bodies.
func newServerWithAuth(t *testing.T, sessions *fakeSessions, upstream string, status int, access, homes string) http.Handler {
	t.Helper()
	auth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		if r.URL.Path == "/v1/me/homes" {
			_, _ = w.Write([]byte(homes))
			return
		}
		_, _ = w.Write([]byte(access))
	}))
	t.Cleanup(auth.Close)
	cfg := config.Config{
		PublicURL: "http://127.0.0.1:8083", AuthPublicURL: "http://localhost:8081",
		LiveKitURL: "ws://localhost:8890", Profiles: []string{"chat"},
		Agents: []config.Agent{{Name: "assistant"}, {Name: "assistant.r1"}},
	}
	var agents []config.Agent
	if upstream != "" {
		parsed, err := url.Parse(upstream)
		if err != nil {
			t.Fatal(err)
		}
		agents = []config.Agent{{Name: "assistant", URL: parsed}}
	}
	return New(Deps{
		Config: cfg, Sessions: sessions, Proxy: proxy.New(agents, nil, nil), Auth: &session.AuthClient{URL: auth.URL, HTTP: auth.Client()},
		Web: fstest.MapFS{
			"index.html":    {Data: []byte("<html>app</html>")},
			"assets/app.js": {Data: []byte("console.log(1)")},
		},
	}).Handler()
}

func TestWritesNeedSameOrigin(t *testing.T) {
	var reached bool
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	defer upstream.Close()
	h := newServer(t, &fakeSessions{}, upstream.URL)

	for origin, want := range map[string]int{"": 403, "https://evil.example": 403, "http://127.0.0.1:8083": 200} {
		reached = false
		r := httptest.NewRequest("POST", "/api/agents/assistant/agent", strings.NewReader("{}"))
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want || reached != (want == 200) {
			t.Errorf("origin %q: status %d, reached %v: %s", origin, w.Code, reached, w.Body)
		}
	}
}

func TestSignedOutGets401NotARedirect(t *testing.T) {
	h := newServer(t, &fakeSessions{identify: session.ErrSignedOut}, "")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/me", nil))
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "signed_out") {
		t.Errorf("got %d %s", w.Code, w.Body)
	}
}

func TestAuthOutageIs503(t *testing.T) {
	h := newServer(t, &fakeSessions{identify: errors.Join(session.ErrUnavailable)}, "")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/me", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d", w.Code)
	}
}

func TestContentPolicyBlocksRemoteImages(t *testing.T) {
	h := newServer(t, &fakeSessions{}, "")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	policy := w.Header().Get("Content-Security-Policy")
	for _, want := range []string{"img-src 'self' data: blob:;", "script-src 'self';", "frame-ancestors 'none'", "connect-src 'self' ws://localhost:8890 http://localhost:8890"} {
		if !strings.Contains(policy, want) {
			t.Errorf("policy lacks %q: %s", want, policy)
		}
	}
}

func TestAppRoutes(t *testing.T) {
	h := newServer(t, &fakeSessions{}, "")
	for path, want := range map[string]string{
		"/":              "app",
		"/t/ten_a/c/x":   "app",
		"/assets/app.js": "console.log",
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), want) {
			t.Errorf("%s: %d %q", path, w.Code, w.Body)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/assets/missing.js", nil))
	if w.Code != 404 {
		t.Errorf("missing asset answered %d, not 404", w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/nothing", nil))
	if w.Code != 404 {
		t.Errorf("unknown API route answered %d, not the app", w.Code)
	}
}

func TestCallbackOutcomes(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		want string
	}{
		"ok":       {nil, "/t/ten_a/"},
		"mfa":      {session.ErrMFARequired, "/signed-out?reason=mfa"},
		"denied":   {session.ErrTenantDenied, "/signed-out?reason=no_access"},
		"anything": {errors.New("boom"), "/signed-out?reason=failed"},
	} {
		h := newServer(t, &fakeSessions{complete: tc.err, next: "/t/ten_a/"}, "")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/auth/callback?code=c&state=s", nil))
		if got := w.Header().Get("Location"); got != tc.want {
			t.Errorf("%s: Location = %q, want %q", name, got, tc.want)
		}
	}
}

func TestConfigPassesOnAccess(t *testing.T) {
	get := func(status int, access, homes string) string {
		h := newServerWithAuth(t, &fakeSessions{}, "", status, access, homes)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/api/config", nil))
		return w.Body.String()
	}
	member := get(http.StatusOK, `{"modules":[],"module_admin":[]}`, `{"account":{"url":"x"}}`)
	if !strings.Contains(member, `"access":{"module_admin":[],"modules":[]}`) || strings.Contains(member, "console_url") {
		t.Errorf("member = %s", member)
	}
	holder := get(http.StatusOK, `{"modules":["property"],"module_admin":["property"]}`, `{"console":{"url":"http://console.test"}}`)
	if !strings.Contains(holder, `"modules":["property"]`) || !strings.Contains(holder, `"console_url":"http://console.test"`) {
		t.Errorf("holder = %s", holder)
	}
	// No answer, or one from before business roles, isn't the same as holding no role.
	for name, body := range map[string]string{"down": get(http.StatusServiceUnavailable, "", ""), "older": get(http.StatusOK, `{"platform_admin":false}`, `{}`)} {
		if strings.Contains(body, `"access"`) || strings.Contains(body, "console_url") {
			t.Errorf("%s = %s", name, body)
		}
	}
}

func TestConfigHidesReplicas(t *testing.T) {
	h := newServer(t, &fakeSessions{}, "")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/config", nil))
	body := w.Body.String()
	if !strings.Contains(body, `"agents":["assistant"]`) || !strings.Contains(body, `"voice":true`) || !strings.Contains(body, `"modules":[]`) {
		t.Errorf("config = %s", body)
	}
}

func TestTenantIn(t *testing.T) {
	for path, want := range map[string]string{"/t/ten_a/tasks": "ten_a", "/t/ten_a": "ten_a", "/": "", "": "", "/admin": "", "/t/": ""} {
		if got := tenantIn(path); got != want {
			t.Errorf("tenantIn(%q) = %q, want %q", path, got, want)
		}
	}
}
