// Package config loads the service configuration from environment variables.
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// Agent is one agent-pi deployment the proxy can reach.
type Agent struct {
	Name string
	URL  *url.URL
}

// moduleID is what a module ID may be, because it appears in routes.
var moduleID = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

// Config is the validated service configuration.
type Config struct {
	ListenAddr  string
	DatabaseURL string
	// PublicURL is the address browsers use, with no trailing slash.
	PublicURL string
	// AuthPublicURL is where browsers reach the auth service.
	AuthPublicURL string
	// AuthURL is where this service reaches it. It defaults to AuthPublicURL.
	AuthURL      string
	ClientID     string
	ClientSecret string
	// SessionKey encrypts stored tokens and the sign-in cookie.
	SessionKey []byte
	// Agents lists agent names and replicas. The first is the default.
	Agents []Agent
	// Profiles are what a person can pick at a new conversation, because
	// agent-pi has no method for it.
	Profiles []string
	// Modules lists deployed business modules, with Name as the module ID.
	Modules []Agent
	// LiveKitURL is empty when calls are off. It goes in the content security
	// policy, because the browser connects to it directly.
	LiveKitURL string
	// OTLPEndpoint is an OTLP/gRPC host:port. Empty turns telemetry off.
	OTLPEndpoint string
}

// Load reads and validates the configuration through getenv.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		ListenAddr:    getenv("WORKBENCH_LISTEN_ADDR"),
		DatabaseURL:   getenv("DATABASE_URL"),
		PublicURL:     strings.TrimRight(getenv("WORKBENCH_PUBLIC_URL"), "/"),
		AuthPublicURL: strings.TrimRight(getenv("AUTH_PUBLIC_URL"), "/"),
		AuthURL:       strings.TrimRight(getenv("AUTH_URL"), "/"),
		ClientID:      getenv("AUTH_CLIENT_ID"),
		ClientSecret:  getenv("AUTH_CLIENT_SECRET"),
		LiveKitURL:    strings.TrimRight(getenv("LIVEKIT_URL"), "/"),
		OTLPEndpoint:  getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
	}
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = ":8083"
	}
	if cfg.AuthURL == "" {
		cfg.AuthURL = cfg.AuthPublicURL
	}
	if cfg.ClientID == "" {
		cfg.ClientID = "t10-workbench"
	}
	switch {
	case cfg.DatabaseURL == "":
		return Config{}, errors.New("DATABASE_URL is required")
	case cfg.PublicURL == "":
		return Config{}, errors.New("WORKBENCH_PUBLIC_URL is required")
	case cfg.AuthPublicURL == "":
		return Config{}, errors.New("AUTH_PUBLIC_URL is required")
	case cfg.ClientSecret == "":
		return Config{}, errors.New("AUTH_CLIENT_SECRET is required")
	}

	key, err := base64.StdEncoding.DecodeString(getenv("WORKBENCH_SESSION_KEY"))
	if err != nil || len(key) != 32 {
		return Config{}, errors.New("WORKBENCH_SESSION_KEY must be 32 bytes of base64")
	}
	cfg.SessionKey = key

	if cfg.Agents, err = parseNamed("AGENT_URLS", getenv("AGENT_URLS")); err != nil {
		return Config{}, err
	}
	cfg.Profiles = strings.Split(getenv("AGENT_PROFILES"), ",")
	if getenv("AGENT_PROFILES") == "" {
		cfg.Profiles = []string{"chat"}
	}
	if raw := getenv("MODULE_URLS"); raw != "" {
		if cfg.Modules, err = parseNamed("MODULE_URLS", raw); err != nil {
			return Config{}, err
		}
		for _, module := range cfg.Modules {
			if !moduleID.MatchString(module.Name) {
				return Config{}, fmt.Errorf("MODULE_URLS: %q is not a module ID", module.Name)
			}
		}
	}
	return cfg, nil
}

// Secure reports whether the public address is https, which decides the
// cookie's prefix and flags. Browsers refuse a Secure cookie on plain http.
func (c Config) Secure() bool { return strings.HasPrefix(c.PublicURL, "https://") }

// parseNamed reads name=url pairs from one variable.
func parseNamed(variable, raw string) ([]Agent, error) {
	var agents []Agent
	for pair := range strings.SplitSeq(raw, ",") {
		name, address, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if !ok || name == "" {
			return nil, fmt.Errorf("%s: %q is not name=url", variable, pair)
		}
		parsed, err := baseURL(address)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", variable, err)
		}
		agents = append(agents, Agent{Name: name, URL: parsed})
	}
	return agents, nil
}

func baseURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("%q is not an absolute URL", raw)
	}
	return parsed, nil
}
