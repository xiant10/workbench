package config

import (
	"encoding/base64"
	"os"
	"path/filepath"
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

// mountedModules lays files out as a mounted ConfigMap does: each key a link into
// a dated folder, through ..data.
func mountedModules(t *testing.T, keys map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	dated := filepath.Join(dir, "..2026_11_07")
	if err := os.Mkdir(dated, 0o755); err != nil {
		t.Fatal(err)
	}
	for key, value := range keys {
		if err := os.WriteFile(filepath.Join(dated, key), []byte(value), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join("..data", key), filepath.Join(dir, key)); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink("..2026_11_07", filepath.Join(dir, "..data")); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestModulesDirAddsToModuleURLs(t *testing.T) {
	dir := mountedModules(t, map[string]string{"property": "http://property:18075\n", "facilities": "http://facilities:18077", "collab": "http://elsewhere:1"})
	cfg, err := Load(env(map[string]string{"MODULE_URLS": "collab=http://collab:18040", "MODULES_DIR": dir}))
	if err != nil {
		t.Fatal(err)
	}
	modules, err := cfg.AllModules()
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, m := range modules {
		got = append(got, m.Name+"="+m.URL.String())
	}
	want := "collab=http://collab:18040 facilities=http://facilities:18077 property=http://property:18075"
	if strings.Join(got, " ") != want {
		t.Errorf("modules = %v, want %s", got, want)
	}
}

func TestModulesDirKeepsGoodEntriesWhenOneIsWrong(t *testing.T) {
	dir := mountedModules(t, map[string]string{"property": "http://property:18075"})
	cfg, err := Load(env(map[string]string{"MODULES_DIR": dir}))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "broken"), []byte("nowhere"), 0o644); err != nil {
		t.Fatal(err)
	}
	modules, err := cfg.AllModules()
	if err == nil || len(modules) != 1 || modules[0].Name != "property" {
		t.Errorf("modules = %v, err = %v", modules, err)
	}
	if _, err := Load(env(map[string]string{"MODULES_DIR": dir})); err == nil {
		t.Error("started with a bad entry")
	}
}
