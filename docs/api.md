# workbench API

The reference for the routes `workbench`'s server answers. It's a backend for its own web app: the browser holds a session cookie and never a token, and the server adds the signed-in person's token as it forwards to agents, modules and `auth-server`. Any other client should call those services directly. [`design.md`](design.md) explains the app, and [`module-visibility.md`](module-visibility.md) how modules join it.

## Reaching it

The app's own origin, `http://127.0.0.1:8083` in Compose. Use `127.0.0.1`, not `localhost`, because the sign-in redirect in `auth-server`'s `clients.yaml` matches exactly.

## Conventions

- **The session** is a cookie set by `/auth/callback`. Every `/api/` route needs it, and answers `401 signed_out` without a live one.
- **Same origin.** Every write must carry `Origin` equal to the app's public URL, or it answers `403 origin_not_allowed`.
- **Errors** from this server look like `{"error": "<code>", "message": "<words>"}`. A forwarded request answers whatever the service behind it answered.
- **Bodies** to an agent are at most 16 MiB.

## Sign-in

| Method and path | Does |
| --- | --- |
| `GET /auth/login?next=&reason=&lang=` | Start signing in at `auth-server`. A `next` under `/t/<tenant>/` names the tenant |
| `GET /auth/callback` | Where `auth-server` sends the browser back. Sets the session and goes to `next`, or to `/signed-out?reason=` (`mfa`, `no_access`, `failed`) |
| `POST /auth/logout` | End this session, answering `{redirect}`: the address that ends the person's other web sessions |
| `GET /auth/session` | `204` while the session lives. Open tabs poll it to notice a sign-out elsewhere |
| `POST /auth/tenant` | Switch the session's tenant: `{tenant}`, answering `204` |
| `GET /auth/leave`, `GET /auth/account` | Redirects to `auth-server`'s sign-out and account pages |
| `GET /signed-out` | Where a finished sign-out lands |

## The app's own routes

| Method and path | Does |
| --- | --- |
| `GET /api/config` | What to show: `agents`, `profiles`, `modules` (each manifest with `id`, `api_version`, `features`, `enabled`, and `app`, `attention` and `events` when it has them), `unavailable_modules`, `voice`, `account_url`, `console_url` for a platform admin, and `access` (`modules`, `module_admin`) when known |
| `GET /api/me` | `user_id`, `display_name`, `active_tenant`, `tenants` and `sign_in_name` |
| `GET`, `PUT /api/preferences` | The person's `language` and `theme`, saved at `auth-server` so every web app shares them |
| `POST /api/voice/admission` | Join a call: `{room, client?}`, answering `auth-server`'s room admission |

`access` and `console_url` decide only what to show. Each module and the console check again themselves.

## Forwarding

| Path | Goes to |
| --- | --- |
| `GET /api/agents/{agent}/voice?session=…&lang=…` | A voice message's WebSocket, relayed to `ai-gateway-agent`'s `/agent/voice` with the person's token and the session as `Agent-Session-Id`. The origin must be this site's. Frames are in ai-gateway's [`docs/voice-messages.md`](../../ai-gateway/docs/voice-messages.md). Offered unless `VOICE_MESSAGES=false` (`voice_messages` in `/api/config`) |
| `GET`, `POST`, `DELETE /api/agents/{agent}/agent` | The agent route, `ai-gateway-agent` where it runs, or the agent's own `/agent`. The `/agent` contract in [`contracts/agent/`](../../contracts/agent/README.md) passes through, with `Agent-Session-Id`, `Agent-Method` and `Last-Event-ID`. A new session gets `Agent-Name`. Token usage in `session.get` is removed for anyone but a tenant admin |
| `/api/modules/{module}/{path…}` | The module named in `MODULE_URLS` or `MODULES_DIR`, at `/{path…}`. So `/api/modules/collab/v1/work-items` is `t10-collab`'s `/v1/work-items`. An unknown module answers `404 unknown_module` |
| `/api/org/{tenant}/{path…}` | `auth-server`'s `/v1/tenants/{tenant}/{path…}`, for `members`, `placements`, `invitations`, `units`, `grants`, `audit`, `roles`, `permission-catalog` and `agent-accounts`. `auth-server` checks that the caller administers that tenant |
| `POST /runner/v1/{path…}` | `t10-automations`' runner routes, `/v1/runner/{path…}`, for external teammates' runners. No session or origin check: the runner key or firing token passes through, and `t10-automations` checks it |
| `/runner/mcp` | The tool gateway's collab tools, when `TOOLS_URL` is set, for a runner holding a firing's token |

Each forward carries the trace headers, `X-Turn-ID` and `X-Session-ID`. A typed turn starts its trace here when the browser sends none.

Every other path under `/api/` answers `404 not_found`, and any other path serves the web app.

## Health

`GET /healthz` answers `{"ok": true}`, and `GET /readyz` `{"ready": true}` while Postgres answers, else `503`.

## Error codes

| Status | `error` | Means |
| --- | --- | --- |
| 400 | `invalid_request` | A malformed body |
| 401 | `signed_out` | No live session: sign in again |
| 401 | `unauthorized` | A runner route without a bearer token |
| 403 | `origin_not_allowed` | A write from another site |
| 403 | `tenant_denied`, `mfa_required` | Not a member of that tenant, or it requires a second factor |
| 404 | `not_found`, `unknown_agent`, `unknown_module` | No such route, agent or module |
| 413 | `too_large` | A request to an agent over 16 MiB |
| 502 | `account_unavailable` | `auth-server`'s answer couldn't be read |
| 503 | `auth_unavailable` | The session can't be checked right now |
