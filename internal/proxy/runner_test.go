package proxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"workbench/internal/config"
)

// A runner's key or token passes through as it came, to automations' runner
// routes and the tool gateway's collab tools, with nothing a browser sends.
func TestRunnerPassesItsKeyThrough(t *testing.T) {
	var got *http.Request
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		w.Header().Set("Mcp-Session-Id", "mcp-1")
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	p := New(nil, []config.Agent{{Name: "automations", URL: mustURL(t, upstream.URL)}}, nil)
	p.Tools = mustURL(t, upstream.URL)

	r := httptest.NewRequest("POST", "/runner/v1/firings/fi_1/heartbeat", strings.NewReader("{}"))
	r.Header.Set("Authorization", "Bearer t10r_key")
	r.Header.Set("Cookie", "wb_session=secret")
	w := httptest.NewRecorder()
	p.Runner(w, r, "firings/fi_1/heartbeat")
	if w.Code != http.StatusOK || got.URL.Path != "/v1/runner/firings/fi_1/heartbeat" || got.Header.Get("Authorization") != "Bearer t10r_key" || got.Header.Get("Cookie") != "" {
		t.Errorf("runner route: %d %q %q %q", w.Code, got.URL.Path, got.Header.Get("Authorization"), got.Header.Get("Cookie"))
	}

	r = httptest.NewRequest("POST", "/runner/mcp", strings.NewReader("{}"))
	r.Header.Set("Authorization", "Bearer firing-token")
	r.Header.Set("Mcp-Session-Id", "mcp-1")
	w = httptest.NewRecorder()
	p.RunnerMCP(w, r)
	if w.Code != http.StatusOK || got.URL.Path != "/mcp/collab" || got.Header.Get("Authorization") != "Bearer firing-token" ||
		got.Header.Get("Mcp-Session-Id") != "mcp-1" || w.Header().Get("Mcp-Session-Id") != "mcp-1" {
		t.Errorf("mcp: %d %q %q", w.Code, got.URL.Path, got.Header.Get("Authorization"))
	}
}

func TestRunnerRefusesWhatIsntARunnerCall(t *testing.T) {
	p := New(nil, []config.Agent{{Name: "automations", URL: mustURL(t, "http://automations:18030")}}, nil)
	for name, c := range map[string]struct {
		path, auth string
		want       int
	}{
		"no key":        {"lease", "", http.StatusUnauthorized},
		"another route": {"admin/automations", "Bearer k", http.StatusNotFound},
		"climbing out":  {"firings/../../admin", "Bearer k", http.StatusNotFound},
	} {
		r := httptest.NewRequest("POST", "/runner/v1/"+c.path, nil)
		if c.auth != "" {
			r.Header.Set("Authorization", c.auth)
		}
		r.Header.Set("Cookie", "wb_session=secret")
		w := httptest.NewRecorder()
		p.Runner(w, r, c.path)
		if w.Code != c.want {
			t.Errorf("%s: %d", name, w.Code)
		}
	}
	w := httptest.NewRecorder()
	p.RunnerMCP(w, httptest.NewRequest("POST", "/runner/mcp", nil))
	if w.Code != http.StatusNotFound {
		t.Errorf("mcp with no tool gateway: %d", w.Code)
	}
}
