package session

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"t10-workbench/internal/db"
)

func TestSealRoundTripAndPurpose(t *testing.T) {
	s, err := newSealer(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	sealed := s.seal([]byte("secret"), purposeRefresh)
	if strings.Contains(string(sealed), "secret") {
		t.Error("value is stored in the clear")
	}
	plain, err := s.open(sealed, purposeRefresh)
	if err != nil || string(plain) != "secret" {
		t.Fatalf("open = %q, %v", plain, err)
	}
	if _, err := s.open(sealed, purposeAccess); err == nil {
		t.Error("a value opened under another purpose")
	}
}

func TestSafeNext(t *testing.T) {
	for next, want := range map[string]string{
		"/t/ten_a/c/1":         "/t/ten_a/c/1",
		"":                     "/",
		"https://evil.example": "/",
		"//evil.example":       "/",
		"/\\evil.example":      "/",
		"/x\r\nSet-Cookie: a":  "/",
	} {
		if got := SafeNext(next); got != want {
			t.Errorf("SafeNext(%q) = %q, want %q", next, got, want)
		}
	}
}

func TestTokenErrors(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   string
		want   error
	}{
		"revoked":    {400, `{"error":"invalid_grant"}`, ErrSignedOut},
		"several":    {400, `{"error":"invalid_request","error_description":"name a tenant: this user belongs to several"}`, ErrTenantRequired},
		"mfa":        {403, `{"error":"mfa_required"}`, ErrMFARequired},
		"not member": {403, `{"error":"forbidden"}`, ErrTenantDenied},
		"outage":     {500, `{"error":"internal_error"}`, ErrUnavailable},
	} {
		if err := tokenError(tc.status, []byte(tc.body)); !strings.Contains(err.Error(), tc.want.Error()) {
			t.Errorf("%s: got %v, want %v", name, err, tc.want)
		}
	}
}

// fakeAuth is a token endpoint with a rotating refresh secret. It refuses a
// secret it already spent, as the real one does.
type fakeAuth struct {
	mu       sync.Mutex
	current  string
	spent    int
	expires  int
	tenants  []string
	reject   string
	refuse   atomic.Bool
	replayed atomic.Bool
}

func accessToken(sub string) string {
	payload, _ := json.Marshal(map[string]string{"sub": sub})
	return "h." + base64.RawURLEncoding.EncodeToString(payload) + ".s"
}

func (f *fakeAuth) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_ = r.ParseForm()
	if r.URL.Path == "/v1/revoke" {
		f.current = ""
		w.WriteHeader(http.StatusOK)
		return
	}
	if f.refuse.Load() {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	if r.PostForm.Get("grant_type") == "refresh_token" {
		if r.PostForm.Get("refresh_token") != f.current {
			f.replayed.Store(true)
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		f.spent++
		f.tenants = append(f.tenants, r.PostForm.Get("tenant"))
	} else if f.reject != "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = fmt.Fprint(w, f.reject)
		return
	}
	f.current = fmt.Sprintf("refresh-%d", f.spent)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": accessToken("usr_1") + fmt.Sprint(f.spent), "refresh_token": f.current, "expires_in": f.expires,
	})
}

func newManager(t *testing.T, auth *fakeAuth) *Manager {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL isn't set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS workbench CASCADE"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(auth)
	t.Cleanup(server.Close)
	m, err := NewManager(Options{
		Pool: pool, Key: make([]byte, 32), PublicURL: "http://127.0.0.1:8083", AuthPublicURL: "http://auth",
		Auth: &AuthClient{URL: server.URL, ClientID: "t10-workbench", ClientSecret: "s", HTTP: server.Client()},
	})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// signIn runs the code flow and returns the session cookie.
func signIn(t *testing.T, m *Manager) *http.Cookie {
	t.Helper()
	w := httptest.NewRecorder()
	location := m.Begin(w, "/t/ten_a/", "")
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/auth/callback?code=c&state="+parsed.Query().Get("state"), nil)
	r.AddCookie(w.Result().Cookies()[0])
	done := httptest.NewRecorder()
	next, err := m.Complete(context.Background(), done, r)
	if err != nil {
		t.Fatal(err)
	}
	if next != "/t/ten_a/" {
		t.Errorf("next = %q", next)
	}
	for _, c := range done.Result().Cookies() {
		if c.Name == "wb_session" {
			return c
		}
	}
	t.Fatal("no session cookie")
	return nil
}

func request(c *http.Cookie) *http.Request {
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(c)
	return r
}

func TestSignInStoresNothingInTheClear(t *testing.T) {
	auth := &fakeAuth{expires: 300}
	m := newManager(t, auth)
	cookie := signIn(t, m)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Errorf("cookie flags: %+v", cookie)
	}
	var id string
	var refresh []byte
	err := m.opts.Pool.QueryRow(context.Background(), "SELECT id, refresh_token FROM workbench.web_sessions").Scan(&id, &refresh)
	if err != nil {
		t.Fatal(err)
	}
	if id == cookie.Value || strings.Contains(string(refresh), "refresh-") {
		t.Error("the cookie or refresh credential is stored in the clear")
	}
	identity, err := m.Identify(context.Background(), request(cookie))
	if err != nil || identity.UserID != "usr_1" {
		t.Fatalf("Identify = %+v, %v", identity, err)
	}
	if auth.spent != 0 {
		t.Error("a fresh token was refreshed")
	}
}

func TestWrongStateIsRefused(t *testing.T) {
	m := newManager(t, &fakeAuth{expires: 300})
	w := httptest.NewRecorder()
	m.Begin(w, "/", "")
	r := httptest.NewRequest("GET", "/auth/callback?code=c&state=forged", nil)
	r.AddCookie(w.Result().Cookies()[0])
	if _, err := m.Complete(context.Background(), httptest.NewRecorder(), r); err == nil {
		t.Fatal("a forged state signed in")
	}
}

func TestATenantInTheLinkGoesToTheAuthService(t *testing.T) {
	m := newManager(t, &fakeAuth{expires: 300})
	parsed, _ := url.Parse(m.Begin(httptest.NewRecorder(), "/t/ten_a/tasks", "ten_a"))
	if got := parsed.Query().Get("tenant"); got != "ten_a" {
		t.Errorf("tenant = %q", got)
	}
	parsed, _ = url.Parse(m.Begin(httptest.NewRecorder(), "/", ""))
	if parsed.Query().Has("tenant") {
		t.Errorf("named a tenant with none to name: %s", parsed)
	}
}

// Parallel requests must spend one secret, or the auth service sees a replay
// and revokes the session.
func TestParallelRefreshSpendsOneSecret(t *testing.T) {
	auth := &fakeAuth{expires: 30}
	m := newManager(t, auth)
	cookie := signIn(t, m)
	auth.mu.Lock()
	auth.expires = 300
	auth.mu.Unlock()

	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() {
			if _, err := m.Identify(context.Background(), request(cookie)); err != nil {
				errs <- err
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if auth.spent != 1 || auth.replayed.Load() {
		t.Errorf("spent %d secrets, replayed %v", auth.spent, auth.replayed.Load())
	}
}

func TestRevokedSessionSignsOut(t *testing.T) {
	auth := &fakeAuth{expires: 30}
	m := newManager(t, auth)
	cookie := signIn(t, m)
	auth.refuse.Store(true)
	if _, err := m.Identify(context.Background(), request(cookie)); err != ErrSignedOut {
		t.Fatalf("err = %v", err)
	}
	var rows int
	_ = m.opts.Pool.QueryRow(context.Background(), "SELECT count(*) FROM workbench.web_sessions").Scan(&rows)
	if rows != 0 {
		t.Error("a dead session stayed in the table")
	}
}

func TestSwitchTenantRefreshesEvenWithAFreshToken(t *testing.T) {
	auth := &fakeAuth{expires: 300}
	m := newManager(t, auth)
	cookie := signIn(t, m)
	before, _ := m.Identify(context.Background(), request(cookie))
	if err := m.SwitchTenant(context.Background(), request(cookie), "ten_b"); err != nil {
		t.Fatal(err)
	}
	after, _ := m.Identify(context.Background(), request(cookie))
	if before.Access == after.Access {
		t.Error("the old tenant's token is still in use")
	}
	if len(auth.tenants) != 1 || auth.tenants[0] != "ten_b" {
		t.Errorf("tenants = %v", auth.tenants)
	}
}

func TestLogoutRevokes(t *testing.T) {
	auth := &fakeAuth{expires: 300}
	m := newManager(t, auth)
	cookie := signIn(t, m)
	if err := m.Logout(context.Background(), httptest.NewRecorder(), request(cookie)); err != nil {
		t.Fatal(err)
	}
	if auth.current != "" {
		t.Error("the client session wasn't revoked")
	}
	if _, err := m.Identify(context.Background(), request(cookie)); err != ErrSignedOut {
		t.Errorf("err = %v", err)
	}
}

func TestPrune(t *testing.T) {
	m := newManager(t, &fakeAuth{expires: 300})
	signIn(t, m)
	ctx := context.Background()
	if _, err := m.opts.Pool.Exec(ctx, "UPDATE workbench.web_sessions SET expires_at = $1", time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := m.Prune(ctx); err != nil {
		t.Fatal(err)
	}
	var rows int
	_ = m.opts.Pool.QueryRow(ctx, "SELECT count(*) FROM workbench.web_sessions").Scan(&rows)
	if rows != 0 {
		t.Error("an expired session stayed")
	}
}
