// Package session is Workbench's sign-in: the one every t10 web app shares, from
// t10-modkit's websession, with Workbench's cookie and table. See docs/design.md,
// "Browser sessions".
package session

import (
	shared "github.com/xiant10/t10-modkit/websession"
)

// AuthClient calls the auth service as Workbench's own confidential client.
type AuthClient = shared.AuthClient

type (
	Manager  = shared.Manager
	Options  = shared.Options
	Identity = shared.Identity
	Tokens   = shared.Tokens
)

var (
	ErrSignedOut      = shared.ErrSignedOut
	ErrTenantRequired = shared.ErrTenantRequired
	ErrTenantDenied   = shared.ErrTenantDenied
	ErrMFARequired    = shared.ErrMFARequired
	ErrUnavailable    = shared.ErrUnavailable
	SafeNext          = shared.SafeNext
	SignInHints       = shared.SignInHints
	IsSecure          = shared.IsSecure
)

// NewManager is the shared sign-in, kept in workbench.web_sessions under wb_ cookies.
func NewManager(opts Options) (*Manager, error) {
	opts.Name, opts.Table = "wb", "workbench.web_sessions"
	return shared.NewManager(opts)
}
