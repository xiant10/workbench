// Command workbench serves the t10 web client and its same-origin API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"t10-workbench/internal/config"
	"t10-workbench/internal/db"
	"t10-workbench/internal/proxy"
	"t10-workbench/internal/server"
	"t10-workbench/internal/session"
	"t10-workbench/internal/telemetry"
	"t10-workbench/web"
)

const (
	authTimeout   = 10 * time.Second
	pruneInterval = time.Hour
)

func main() {
	if err := run(); err != nil {
		slog.Error("workbench stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	shutdownTelemetry, err := telemetry.Setup(ctx, cfg.OTLPEndpoint)
	if err != nil {
		return err
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTelemetry(ctx); err != nil {
			slog.Warn("flush telemetry", "error", err)
		}
	}()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	auth := &session.AuthClient{
		URL: cfg.AuthURL, ClientID: cfg.ClientID, ClientSecret: cfg.ClientSecret,
		HTTP: &http.Client{Timeout: authTimeout},
	}
	sessions, err := session.NewManager(session.Options{
		Pool: pool, Key: cfg.SessionKey, Auth: auth, AuthPublicURL: cfg.AuthPublicURL,
		PublicURL: cfg.PublicURL, Secure: cfg.Secure(),
	})
	if err != nil {
		return err
	}
	go prune(ctx, sessions)

	authURL, err := url.Parse(cfg.AuthURL)
	if err != nil {
		return err
	}
	api := server.New(server.Deps{
		Config: cfg, Pool: pool, Sessions: sessions, Auth: auth,
		Proxy: proxy.New(cfg.Agents, cfg.Modules, authURL), Web: web.Dist(),
	})
	// No write timeout: the event stream stays open for as long as a tab does.
	srv := &http.Server{Addr: cfg.ListenAddr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second}
	errs := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.ListenAddr)
		errs <- srv.ListenAndServe()
	}()
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func prune(ctx context.Context, sessions *session.Manager) {
	ticker := time.NewTicker(pruneInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := sessions.Prune(ctx); err != nil {
				slog.Warn("prune sessions", "error", err)
			}
		}
	}
}
