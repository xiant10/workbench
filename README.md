# workbench

The web client where people work with their t10 agent: conversations, their results, voice calls, and teammates' tasks. It's a React app served by one Go binary, which holds tokens and proxies `/agent` (to `ai-gateway-agent`, or straight to a harness such as `agent-pi`), the auth service, business modules such as `t10-collab`, and room admission. The browser holds a cookie, never a t10 token. [docs/design.md](docs/design.md) explains why.

## Status

| Milestone | State |
| --- | --- |
| M1 Core conversations | Built and tested against a real auth service and `agent-pi` with a scripted model. Needs the uncommitted `agent-pi` and `auth-server` changes listed below |
| M2 Working results | Built, except tool argument and result summaries, which need `agent-pi` changes. Activity lines show tool names only |
| M3 Voice | Live calls work inside a conversation, tested with a browser's fake microphone, real speech services and a scripted model. Spoken turns land in the transcript. A real model's spoken style and a person on a microphone are untested. Voice messages aren't built |
| M4 People's work | Tasks, offers, sending, comments, shared lists, claiming, notifications and the manager visibility setting are built on `t10-collab` as it stands. The departure queue and daily digest aren't built, because `t10-collab` has neither |
| M5 Desktop and projects | Not started. Not committed |

### Changes in sibling repos

Both are in the working trees, uncommitted, alongside other work there.

| Repo | Change |
| --- | --- |
| `agent-pi` | `session.messages`, `session.update`, archiving, `session.list` paging with `lastActiveAt` and `busy`, a limit of 200 open sessions and a 16 MB body in `assistant`, and the `<work_item>` rule in its prompt |
| `auth-server` | The `t10-workbench` client in `clients.yaml`. A running server needs a restart to read it |

### Waiting on other repos

| Gap | Effect here | Repo |
| --- | --- | --- |
| `/v1/people` has no `relation` | The send form can't say which of offer or assignment will happen, so it states both. The result shown is the service's | `t10-collab` |
| A redeemed code can't name the tenant for someone in several, and the list needs a token | They type a tenant ID once. `sample-multi` shows it | `auth-server` |
| `/v1/signout` takes same-origin posts only | Sign-out ends the workbench session. The signed-out page says the hosted session stays, and links to where it can end. Until then, Sign in won't ask for a password | `auth-server` |
| Tool payload inspection | Activity details require `agent-pi` with the `session.tool` method; older agents show a recoverable error | `agent-pi` |
| `session.messages` leaves out image data | A reloaded conversation shows how many images a message had, not the images | `agent-pi` |

## Run it

Start the auth and `agent-pi` stacks, then restart `auth-server` once so it reads the new client:

```sh
echo "WORKBENCH_SESSION_KEY=$(openssl rand -base64 32)" > .env
docker compose up -d --build      # the app is on http://127.0.0.1:8083
```

Compose has working defaults, and `.env.example` is for running the binary on the host: its `localhost` addresses would point the container at itself.

Set `MODULE_URLS`, as `id=url,id=url`, to show business modules such as tasks (`collab`) and agent settings (`agents`, served by `t10-agent-control`), and `LIVEKIT_URL` to show calls. Use `127.0.0.1`, not `localhost`: the redirect in `clients.yaml` matches exactly.

For the frontend alone, run the backend and then `npm run dev` in `web/`.

## Test

```sh
TEST_DATABASE_URL='postgres://…' go test ./...   # needs a throwaway Postgres, because it drops the workbench schema
(cd web && npm run test:ux)                      # isolated browser UX checks, mocked APIs
(cd web && npm test)                             # the stream reducer, output extraction and Chinese coverage

scripts/e2e-stack.sh up                          # its own Postgres, LiveKit, auth-server, t10-collab and scripted agent
(cd web && npx playwright install chromium && npm run e2e)
scripts/e2e-stack.sh down
```

The stack builds the sibling repos from their working trees and shares nothing with the local Compose stacks. It uses ports 8083, 18081, 18082, 18890, 19800, 7881 and 55433.

Browser tests use a fake microphone, and run no voice agent, so they cover the "no agent" path. A full call needs `t10-livekit-agent` running against the stack's LiveKit, and `agent-pi` with `AUTH_KIND=jwt` and `JWT_AUDIENCE=t10,agent-pi`. Voice still needs a person on a real microphone.

The auth service allows 20 sign-ins per account in 15 minutes, and `--repeat-each` signs in once per repeat. Past that, tests fail at sign-in with "Too many attempts". Running `scripts/e2e-stack.sh up` again resets the limit.

A new interface string needs its Chinese in `web/src/lib/zh.ts`, or `npm test` fails.

## Layout

| Path | Owns |
| --- | --- |
| `internal/session` | Cookie, code flow, token refresh under a row lock, tenant switch |
| `internal/proxy` | Passing calls to `/agent` and business modules. Routes by session ID only when `AGENT_URLS` names harnesses directly. No business rules |
| `internal/voice` | Room admission |
| `internal/server` | Routes, same-origin checks, content security policy, the built app |
| `web/src/conversation` | Stream client, reducer, transcript, composer |
| `web/src/results` | Results panel, and finding outputs in replies |
| `web/src/call` | LiveKit room and call bar. `useCall.ts` holds a third copy of the room contract's names |
| `web/src/tasks` | People's work |
| `web/src/shell` | Sidebar, routing, Home, settings |
| `web/src/admin` | Administration, for tenant admins: people, organization, running agents, security and activity, from the auth service's tenant routes through `/api/org/<tenant>/`. Modules add their settings with `admin` in their `WorkbenchModule`, on a built-in tab or one of their own. The auth service and each module check every call |
| `web/src/modules/agents` | Which of the platform's agents this tenant uses, and its default, from `t10-agent-control` |

`web/web.go` embeds `web/dist`, because Go can't embed a parent directory from `cmd/workbench`.

## Activity payloads

In a conversation, open **Results → Activity** and expand a tool call to inspect and copy its recorded request and response as JSON. Details load on demand and remain available after reload, including archived conversations. Running calls refresh while expanded. These are the recorded model tool-call block and tool-result message, not HTTP transport headers; tool middleware may have transformed arguments before execution. The sibling `agent-pi` must include `session.tool`, which checks session ownership before reading history.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Knowledge documents

When `knowledge=http://t10-knowledge:18050` is present in `MODULE_URLS` and its
manifest responds, the sidebar shows Knowledge and tenant admins get the
Administration → Knowledge tab. Admins create a base, upload files or paste text,
review drafts and processing failures, publish/replace/roll back versions, rename,
unpublish, and use trash/restore. Sources are limited to 10 MiB TXT/Markdown, PDF
with text and DOCX. Members browse/search only published content. Original
sources download as attachments; previews render extracted text as plain text.
Publication is tenant-wide. Semantic search and agent knowledge tools are not
part of this release. Browser lifecycle coverage is in `web/e2e/knowledge.spec.ts`.

Knowledge also supports reusable **document sets**: admins group documents from
multiple bases and members choose a set to browse/search. Documents can belong to
several sets. Base and set selectors intersect; deleting a set never deletes files.
Sets control retrieval scope, not who is allowed to read published content.
