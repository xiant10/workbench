// Package web embeds the built React app. Go can't embed a parent directory, so
// this file sits beside dist instead of in cmd/workbench.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist is the built app. Before a build it holds only .gitkeep.
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
