package main

import (
	"log/slog"
	"os"

	"github.com/xiant10/t10-modkit/docsmcp"

	repodocs "t10-workbench/docs"
)

// version is the commit the image was built from, set by the Dockerfile's VERSION.
var version = "dev"

// ownDocs serves this repo's docs to coding agents at /docs/mcp, in front of
// everything else, as the workspace's contracts/docs describes.
var ownDocs *docsmcp.Handler

// loadDocs reads the docs, and serves only them when the command runs as
// "<command> docs <addr>", for the docs contract's suite.
func loadDocs() {
	var err error
	ownDocs, err = docsmcp.New(docsmcp.Options{
		Component: "workbench",
		Summary:   "The web app people work in: conversations with agents, modules such as tasks and knowledge, and tenant administration. Its server is the backend for its own pages.",
		Version:   version,
		Docs:      repodocs.FS,
	})
	if err != nil {
		slog.Error("read docs", "error", err)
		os.Exit(1)
	}
	if served, err := docsmcp.DocsOnly(os.Args, ownDocs); served {
		slog.Error("docs only stopped", "error", err)
		os.Exit(1)
	}
}
