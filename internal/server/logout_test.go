package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogoutReturnsAuthorizedBrowserRedirect(t *testing.T) {
	sessions := &fakeSessions{}
	handler := newServerWithAuth(t, sessions, "", http.StatusOK, `{"ticket":"signed.ticket"}`, "")
	request := httptest.NewRequest(http.MethodPost, "/auth/logout", strings.NewReader("{}"))
	request.Header.Set("Origin", "http://127.0.0.1:8083")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var body map[string]string
	_ = json.Unmarshal(response.Body.Bytes(), &body)
	if response.Code != http.StatusOK || !sessions.loggedOut || body["redirect"] != "http://localhost:8081/v1/signout/complete?ticket=signed.ticket" {
		t.Fatalf("logout: %d %s local=%v", response.Code, response.Body, sessions.loggedOut)
	}
}

func TestLogoutAuthFailureIsRetryableAndCrossOriginIsRefused(t *testing.T) {
	for _, origin := range []string{"http://127.0.0.1:8083", "https://evil.example"} {
		sessions := &fakeSessions{}
		handler := newServer(t, sessions, "")
		request := httptest.NewRequest(http.MethodPost, "/auth/logout", strings.NewReader("{}"))
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		want := http.StatusServiceUnavailable
		if origin == "https://evil.example" {
			want = http.StatusForbidden
		}
		if response.Code != want || sessions.loggedOut {
			t.Fatalf("origin %s: %d local=%v", origin, response.Code, sessions.loggedOut)
		}
	}
}
