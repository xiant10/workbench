package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func env(overrides map[string]string) func(string) string {
	values := map[string]string{
		"DATABASE_URL":          "postgres://x",
		"WORKBENCH_PUBLIC_URL":  "http://127.0.0.1:8083/",
		"AUTH_PUBLIC_URL":       "http://localhost:8081",
		"AUTH_CLIENT_SECRET":    "secret",
		"WORKBENCH_SESSION_KEY": base64.StdEncoding.EncodeToString(make([]byte, 32)),
		"AGENT_URLS":            "assistant=http://a:9800,assistant.r1=http://b:9800",
	}
	for key, value := range overrides {
		values[key] = value
	}
	return func(key string) string { return values[key] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ListenAddr != ":8083" || cfg.ClientID != "t10-workbench" || cfg.AuthURL != "http://localhost:8081" {
		t.Errorf("defaults = %+v", cfg)
	}
	if cfg.PublicURL != "http://127.0.0.1:8083" {
		t.Errorf("PublicURL = %q, want no trailing slash", cfg.PublicURL)
	}
	if len(cfg.Agents) != 2 || cfg.Agents[1].Name != "assistant.r1" {
		t.Errorf("Agents = %+v", cfg.Agents)
	}
	if cfg.Secure() {
		t.Error("plain http reported as secure")
	}
	if len(cfg.Profiles) != 1 || cfg.Profiles[0] != "chat" {
		t.Errorf("Profiles = %v", cfg.Profiles)
	}
}

func TestLoadRefuses(t *testing.T) {
	for name, overrides := range map[string]map[string]string{
		"short session key": {"WORKBENCH_SESSION_KEY": base64.StdEncoding.EncodeToString(make([]byte, 16))},
		"no agents":         {"AGENT_URLS": ""},
		"relative agent":    {"AGENT_URLS": "assistant=/agent"},
		"bad module":        {"MODULE_URLS": "collab=nowhere"},
		"bad module ID":     {"MODULE_URLS": "../admin=http://collab:8082"},
		"no secret":         {"AUTH_CLIENT_SECRET": ""},
	} {
		if _, err := Load(env(overrides)); err == nil {
			t.Errorf("%s: loaded", name)
		} else if strings.Contains(err.Error(), "secret-value") {
			t.Errorf("%s: error repeats a secret", name)
		}
	}
}
