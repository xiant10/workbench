package proxy

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"t10-workbench/internal/config"
)

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestAgentAddsTokenAndDropsBrowserHeaders(t *testing.T) {
	var got *http.Request
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		w.WriteHeader(http.StatusAccepted)
	}))
	defer upstream.Close()
	p := New([]config.Agent{{Name: "assistant", URL: mustURL(t, upstream.URL)}}, nil)

	r := httptest.NewRequest("POST", "/api/agents/assistant/agent", strings.NewReader("{}"))
	r.Header.Set("Cookie", "wb_session=secret")
	r.Header.Set("Origin", "http://127.0.0.1:8083")
	r.Header.Set("Authorization", "Bearer forged")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Turn-ID", "4bf92f3577b34da6a3ce929d0e0e4736")
	r.Header.Set("Agent-Method", "session.prompt")
	r.Header.Set("X-Unknown", "value")
	w := httptest.NewRecorder()
	p.Agent(w, r, "assistant", "user-token")

	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d", w.Code)
	}
	if got.URL.Path != "/agent" {
		t.Errorf("path = %q", got.URL.Path)
	}
	if got.Header.Get("Authorization") != "Bearer user-token" {
		t.Errorf("Authorization = %q", got.Header.Get("Authorization"))
	}
	if got.Header.Get("Agent-Method") != "session.prompt" {
		t.Errorf("Agent-Method = %q", got.Header.Get("Agent-Method"))
	}
	for _, name := range []string{"Cookie", "Origin", "X-Unknown"} {
		if got.Header.Get(name) != "" {
			t.Errorf("%s passed through", name)
		}
	}
	if !strings.HasPrefix(got.Header.Get("traceparent"), "00-4bf92f3577b34da6a3ce929d0e0e4736-") {
		t.Errorf("traceparent = %q, want the turn's trace", got.Header.Get("traceparent"))
	}
}

func TestAgentRoutesOnSessionReplica(t *testing.T) {
	hit := ""
	server := func(name string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = name }))
	}
	first, second := server("first"), server("second")
	defer first.Close()
	defer second.Close()
	p := New([]config.Agent{
		{Name: "assistant", URL: mustURL(t, first.URL)},
		{Name: "assistant.r2", URL: mustURL(t, second.URL)},
	}, nil)

	for session, want := range map[string]string{"assistant.r2.7": "second", "assistant.r1.7": "first", "": "first"} {
		r := httptest.NewRequest("GET", "/api/agents/assistant/agent", nil)
		r.Header.Set(sessionHeader, session)
		p.Agent(httptest.NewRecorder(), r, "assistant", "token")
		if hit != want {
			t.Errorf("session %q went to %q, want %q", session, hit, want)
		}
	}
}

func TestUnknownAgent(t *testing.T) {
	p := New(nil, nil)
	w := httptest.NewRecorder()
	p.Agent(w, httptest.NewRequest("GET", "/x", nil), "ghost", "token")
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d", w.Code)
	}
}

func module(t *testing.T, id, address string) []config.Agent {
	t.Helper()
	return []config.Agent{{Name: id, URL: mustURL(t, address)}}
}

func TestModuleMapsPathAndKeepsQuery(t *testing.T) {
	var got string
	upstream := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = r.URL.RequestURI() }))
	defer upstream.Close()
	p := New(nil, module(t, "collab", upstream.URL))
	p.Module(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/modules/collab/offers?box=inbox", nil), "collab", "offers", "token")
	if got != "/v1/offers?box=inbox" {
		t.Errorf("upstream got %q", got)
	}
}

func TestUnknownModule(t *testing.T) {
	w := httptest.NewRecorder()
	New(nil, nil).Module(w, httptest.NewRequest("GET", "/api/modules/collab/offers", nil), "collab", "offers", "token")
	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "unknown_module") {
		t.Errorf("got %d %s", w.Code, w.Body)
	}
}

func TestManifestsKeepOnlyModulesThatAnswerAndAreOn(t *testing.T) {
	serve := func(id, body string, status int) *httptest.Server {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/v1/module" || r.Header.Get("Authorization") != "Bearer token" {
				t.Errorf("%s got %s %q", id, r.URL.Path, r.Header.Get("Authorization"))
			}
			w.WriteHeader(status)
			_, _ = io.WriteString(w, body)
		}))
		t.Cleanup(s.Close)
		return s
	}
	modules := []config.Agent{
		{Name: "collab", URL: mustURL(t, serve("collab", `{"id":"collab","api_version":1,"enabled":true,"features":["attention"]}`, 200).URL)},
		{Name: "off", URL: mustURL(t, serve("off", `{"id":"off","api_version":1,"enabled":false}`, 200).URL)},
		{Name: "down", URL: mustURL(t, serve("down", ``, 503).URL)},
		{Name: "wrong", URL: mustURL(t, serve("wrong", `{"id":"other","api_version":1,"enabled":true}`, 200).URL)},
	}
	got := New(nil, modules).Manifests(context.Background(), "token")
	if len(got) != 1 || got[0].ID != "collab" || got[0].APIVersion != 1 {
		t.Errorf("manifests = %+v", got)
	}
}

func TestUpstreamDownAnswersJSON(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	address := upstream.URL
	upstream.Close()
	p := New([]config.Agent{{Name: "assistant", URL: mustURL(t, address)}}, nil)
	w := httptest.NewRecorder()
	p.Agent(w, httptest.NewRequest("GET", "/x", nil), "assistant", "token")
	if w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "upstream_unavailable") {
		t.Errorf("got %d %s", w.Code, w.Body)
	}
}

// An event must reach the browser as it happens, not when the stream closes.
func TestEventStreamFlushesEachEvent(t *testing.T) {
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Last-Event-ID") != "abc-1" {
			t.Errorf("Last-Event-ID = %q", r.Header.Get("Last-Event-ID"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: one\n\n")
		w.(http.Flusher).Flush()
		<-release
	}))
	defer upstream.Close()
	defer close(release)
	p := New([]config.Agent{{Name: "assistant", URL: mustURL(t, upstream.URL)}}, nil)
	front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.Agent(w, r, "assistant", "token")
	}))
	defer front.Close()

	req, _ := http.NewRequest("GET", front.URL, nil)
	req.Header.Set("Last-Event-ID", "abc-1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	line := make(chan string, 1)
	go func() {
		text, _ := bufio.NewReader(resp.Body).ReadString('\n')
		line <- text
	}()
	select {
	case text := <-line:
		if text != "data: one\n" {
			t.Errorf("read %q", text)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the event stayed buffered")
	}
}

func TestLoneEntryIsAGatewayThatServesEveryAgent(t *testing.T) {
	var gotAgent atomic.Value
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAgent.Store(r.Header.Get("Agent-Name"))
	}))
	defer gateway.Close()
	p := New([]config.Agent{{Name: "assistant", URL: mustURL(t, gateway.URL)}}, nil)
	p.Agent(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{}")), "sales", "tok")
	if gotAgent.Load() != "sales" {
		t.Fatalf("the gateway was told agent %v", gotAgent.Load())
	}
}

func TestSessionRoutesByPoolAndSendsNoAgentName(t *testing.T) {
	var gotAgent atomic.Value
	sales := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAgent.Store(r.Header.Get("Agent-Name"))
	}))
	defer sales.Close()
	assistant := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("the session's own harness wasn't used")
	}))
	defer assistant.Close()
	p := New([]config.Agent{{Name: "assistant", URL: mustURL(t, assistant.URL)}, {Name: "sales", URL: mustURL(t, sales.URL)}}, nil)
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{}"))
	r.Header.Set("Agent-Session-Id", "sales.agent-1.7")
	p.Agent(httptest.NewRecorder(), r, "assistant", "tok")
	if gotAgent.Load() != "" {
		t.Fatalf("a call with a session named agent %v", gotAgent.Load())
	}
}
