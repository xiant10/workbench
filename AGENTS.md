# AGENTS.md

For coding agents working in this repo. The web app people work in: conversations, modules, administration. Its Go server is the backend for its own pages.

## Build and test

```bash
go build ./... && go vet ./... && go test ./...
cd web && npm ci && npm run check && npm test
```

## Read first

- `docs/design.md`
- `docs/api.md`
- `docs/module-visibility.md`
- `docs/one-system.md`

## Rules

- This image serves its consumer docs at `/docs/mcp` with no token (the workspace's `contracts/docs/`). Anything marked `audience: consumer` is public to whoever reaches the service, so keep secrets and internal notes out, or mark the doc `contributor`.
- `third_party/t10-modkit` is a snapshot of `t10-modkit`: change it there, then run the workspace's `scripts/sync-modkit.sh` (its web-kit loop overwrites `web/src/kit` in workbench and t10-property, so check that diff). `make check` fails when a copy drifts.
- `web/src/kit` is a copy of `t10-modkit/web`: change it there.
- Its shell, proxy and Administration name no module: a module joins through its folder in `web/src/modules/` and its manifest.
- A route change updates `docs/api.md` (and `docs/openapi.yaml` where there is one) in the same change.
- Every doc under `docs/` starts with front matter: `title`, `audience` (consumer, contributor or operator), `kind` (guide, reference, design or record), `status` and `summary`. Plans, reviews and validation logs go in `docs/records/`. The workspace's `make check` (`scripts/check-docs.py`) holds this and checks relative links.
- This repo is its own project inside the t10 workspace: it builds with nothing from the workspace. The workspace's `ARCHITECTURE.md` is the high-level design, and wins where they disagree.
- This repo is public: check what you add before it's pushed.
