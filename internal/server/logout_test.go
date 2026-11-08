package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"t10-workbench/internal/session"
)

func TestLogoutEndsTheSessionAndPassesTheBrowserOn(t *testing.T) {
	sessions := &fakeSessions{signOutTarget: "http://localhost:8081/v1/signout/complete?ticket=signed.ticket"}
	request := httptest.NewRequest(http.MethodPost, "/auth/logout", strings.NewReader("{}"))
	request.Header.Set("Origin", "http://127.0.0.1:8083")
	response := httptest.NewRecorder()
	newServer(t, sessions, "").ServeHTTP(response, request)
	var body map[string]string
	_ = json.Unmarshal(response.Body.Bytes(), &body)
	if response.Code != http.StatusOK || !sessions.loggedOut || body["redirect"] != sessions.signOutTarget {
		t.Fatalf("logout: %d %s local=%v", response.Code, response.Body, sessions.loggedOut)
	}
}

func TestLogoutFromElsewhereIsRefused(t *testing.T) {
	sessions := &fakeSessions{}
	request := httptest.NewRequest(http.MethodPost, "/auth/logout", strings.NewReader("{}"))
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	newServer(t, sessions, "").ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || sessions.loggedOut {
		t.Fatalf("got %d local=%v", response.Code, sessions.loggedOut)
	}
}

func TestSignedOutLandsOnSignIn(t *testing.T) {
	handler := newServer(t, &fakeSessions{}, "")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/signed-out", nil))
	if response.Code != http.StatusFound || response.Header().Get("Location") != "/auth/login?reason=signedout" {
		t.Fatalf("got %d %s", response.Code, response.Header().Get("Location"))
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/signed-out?reason=mfa", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("a refused sign-in needs the page: %d", response.Code)
	}
}

func TestSessionCheckAnswersAnOpenTab(t *testing.T) {
	sessions := &fakeSessions{}
	handler := newServer(t, sessions, "")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/auth/session", nil))
	if response.Code != http.StatusNoContent {
		t.Fatalf("alive: %d", response.Code)
	}
	sessions.ended = session.ErrSignedOut
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/auth/session", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("ended: %d", response.Code)
	}
}
