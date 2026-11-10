# Workbench and business apps as one system

Nov 7, 2026 · Status: steps 1 and 2 built and merged to `main` on Nov 8 (workbench, workspace, t10-property, t10-modkit), with one sign-out (`feat/one-sign-out`) merged in each app first. Steps 3 to 5 built on Nov 8. All of it runs on the local cluster's t10 namespace. Reviews the move between `workbench` and business apps such as `t10-property`, and proposes one frame that every t10 web app draws from shared data, with no business module named in `workbench`'s code.

## Summary

The menus are already data: `workbench` lists Property from its manifest, and an app joins the menu through the `MODULES_DIR` folder (branch `feat/module-dir`, unmerged). What still splits the system is everything around the menu. Choosing Property in the sidebar loads a different-looking app on another address, and the sidebar, conversations, search, account menu and assistant all disappear. Coming back takes a small "Workbench" link in the top bar.

The proposal: every app draws the same frame from `t10-modkit`, and fills it from the same reads. Only the content area changes when a person moves between apps. Each app supplies its own sections as data, so `workbench` never names one. Apps keep their own hosts, services and releases, as decided.

## What a person sees today

Screens from the local cluster, signed in as `sample-acme-admin`, at 1440 by 900 and 390 by 844.

| | Workbench | Property |
| --- | --- | --- |
| Frame | Left sidebar: brand, New conversation, Search, Home, modules, conversations, account at the foot | Top bar: logo, "Property", user name, language switch, "Workbench" link, tenant menu. Then a strip of up to 14 tabs |
| Navigating within | Sidebar | Tab strip. On a phone it scrolls sideways with no hint that more tabs exist |
| Getting back | – | "Workbench" in the top bar, or the tenant menu's "Places" |
| Search (⌘K) | Conversations and actions | None |
| Assistant | "Ask your agent" composer, conversations kept in the sidebar | "Tell the assistant" box on My day, another path, nothing kept where Workbench shows it |
| Updates | Badge on Property (8), and "Property notices and tasks: 8" on Home | An "Updates" list on My day, made of identical lines |
| Account | One menu: tenants, agent, language, theme, settings, profile, sign out | Language switch in the bar, name as plain text, a second menu for places and sign-out. No theme |
| Phone | Sidebar becomes a drawer | Top bar wraps onto three lines before any content |

### Problems, most serious first

1. **Leaving, not switching.** The whole frame changes, so a person reads the move as going to a different product. Nothing on the Property side says it's part of the same place, apart from the logo.
2. **Two assistants.** Each app asks for free text in its own box, with its own history. A conversation started in Property doesn't show in Workbench's list, and Property has nowhere to find it again.
3. **Two ways round the same work.** Updates show as a count in Workbench and a list in Property, with no shared read state the person can see, and the tab strip is the only map of Property.
4. **The tab strip doesn't scale.** It holds 14 entries for an admin, mixes daily work (My day, Work orders) with one-off setup (Registry imports, Opening balances), and hides most of itself on a phone.
5. **Settings disagree.** Theme exists only in Workbench. Language is a menu field in one app and a button pair in the other. Sign-out wording differs ("Sign out" and "Sign out of this app") though both now end every app.
6. **What's still compiled in.** `fromManifest.tsx` maps `icon: "building"` to a compiled `Building2`, so a new app either gets the generic icon or a workbench change. `feat/module-dir`'s `icon_svg` fixes this and needs merging.

## The design: one frame, many apps

```text
+------------------+---------------------------------------------+
| [t10] Sample Acme v|                                             |
|------------------|                                             |
| [Q] Search    ⌘K |                                             |
| [+] Ask          |        the current app's page               |
|------------------|                                             |
| ◉ Workbench      |                                             |
| ▾ Property    8  |                                             |
|     My day       |                                             |
|     Work orders 3|                                             |
|     Notices & tasks                                            |
|     Registry     |                                             |
|     More…        |                                             |
| ○ Facilities     |                                             |
|------------------|                                             |
| (S) sample-acme ⌄|                                             |
+------------------+---------------------------------------------+
```

The same rail, drawn by the same component, in every app:

- **Top: the tenant.** One switcher, the same in every app. Switching tenant keeps the person in the same app when they have it in the new tenant, and goes to Workbench Home when they don't.
- **Search and Ask.** ⌘K and the assistant work everywhere (see below).
- **Apps, each with its sections.** Every app this person has in this tenant, from the same read as the landing page. The current app is expanded and shows its sections; others are one line with their attention count. Opening a section of another app is a plain link to that app's address.
- **Foot: the account.** One menu: language, theme, profile, settings, platform console where allowed, sign out. The same wording everywhere.

Workbench's own sections are its Home, its capability modules (Tasks, Shared lists, Automations, Knowledge, Approvals, Skills, Connectors) and Administration. Its conversation list stays in Workbench, under its sections, because the rail only shows the current app's detail.

On a phone the rail is a drawer behind one button, as Workbench's sidebar is today. Property's top bar and tab strip go.

### Where each piece of data comes from

Nothing in the frame is written into an app's code, including Workbench's.

| Frame part | Source | New? |
| --- | --- | --- |
| Tenants | Each app's `/api/me` | No |
| Apps per tenant, with label and address | `auth-server`'s `GET /v1/me/homes`, as the landing page uses | No |
| An app's icon | Manifest `app.icon_svg`, as a CSS mask | On `feat/module-dir` |
| An app's sections | New manifest field `app.nav`, filtered for this person by the module | Yes |
| Counts per app and per section | The module's existing attention read; a section names its keys | Small |
| Account settings | Each app's own, from the shared kit | Moves into the kit |

`app.nav` sits in the manifest beside `attention`:

```json
"nav": [
  { "key": "my-day", "to": "", "label": "My day", "label_zh": "我的一天", "group": "daily" },
  { "key": "work-orders", "to": "work-orders", "label": "Work orders", "label_zh": "工单", "group": "daily", "keys": ["work_orders"] },
  { "key": "setup", "to": "setup", "label": "Project setup", "label_zh": "项目设置", "group": "setup" }
]
```

Only the module knows which sections a person may use, so a manifest lists them all and a person-scoped read narrows them: `GET /v1/me/nav` on the module, answered through `workbench`'s proxy as attention is, and from the app's own `/api` when the person is in it. A section the person can't use isn't returned. Groups are fixed words (`daily`, `records`, `setup`) so every app sorts the same way: `daily` shows, `records` and `setup` fold under "More…" until opened. This replaces Property's hand-written `tabs` list in `pages/Layout.tsx`, whose permission tests move into the service.

Workbench's capability modules keep their compiled screens, by the Nov 6 decision, and describe their sections in the same `nav` shape, so the rail draws one kind of entry.

### One assistant

"Ask" opens a side panel in any app, backed by the same agent sessions as Workbench's conversations. The page the person is on goes with their first message as a record reference, so "draft a reply to this" works from a work order. Conversations started in any app appear in Workbench's list, and the panel lists recent ones.

Property's "Tell the assistant" box on My day becomes this panel opened in place, and Ask & draft keeps its typed jobs (collection scripts, summaries, drafts), which are forms with a validated result rather than chat.

Session t10-94 owns free-text assistant turns in Property (`POST /v1/assistant/turns`, the `property` agent). This panel would replace that box's front end, so agree it with them before building: the panel can call that endpoint in Property and the agent plane in Workbench, as long as both land in one conversation list.

### Search

⌘K in every app searches the same things: the person's apps and their sections, conversation titles, and the current app's own records when it offers a search read (`GET /v1/search?q=` on the module, optional). Choosing something in another app is a link there.

### Updates

The bell lives in the frame, not on a page. It lists notifications from every app the person has, with each module's `events` labels, as Workbench's pollers already read them, and marks them read in the module that sent them. Property's "Updates" card on My day goes, and My day keeps work that needs doing.

### Moving between apps

A move between apps stays a page load on another host. To make it feel like a page change:

- The frame paints first from the last read this app saved, then refreshes, so the rail doesn't flash empty.
- The OAuth hop happens once per browser session and asks for nothing during a live sign-in.
- The rail's scroll position and folded groups are kept per browser, so it looks the same after the move.
- The theme follows one cookie set on the parent domain where apps share one (`*.t10.example`), and each app's own setting where they don't.

## What stays the same

- Each business app keeps its host, service, OAuth client, cookie and releases. Its code never runs on Workbench's address, so a fault in one app can't read another's session.
- Workbench's code names no business module. A new app appears by deploying it and adding its folder key.
- Home stays Workbench's first screen, with "Needs you" built from every app's attention rows.
- Property's watermark stays over its pages, as the PRD requires.

## Alternatives considered

- **Embed the apps in Workbench with iframes.** One shell for real, but the app's cookies become third-party and browsers block them, deep links and the back button need a bridge, and phones get two scrolling areas. Rejected.
- **Load each app's screens into Workbench at run time (module federation).** Seamless, but every app's code runs on Workbench's origin with its session, releases couple again, and it undoes the decision that business apps are their own. Rejected.
- **One host, apps under paths (`/t/acme/property/...` routed to the property service).** No address change, shared theme and storage. It costs the isolation above, because path-scoped cookies aren't a security boundary. Worth reconsidering only if the move between hosts still feels like leaving after the shared frame is in.
- **Keep the current frames and polish them.** Cheapest, and Property's bar could get a better back link, but it stays two products.

## Order of work

| Step | Repos | Gives |
| --- | --- | --- |
| 1 | `workbench` | Merge `feat/module-dir`: folder-driven apps and `icon_svg`; drop the compiled `ICONS` map |
| 2 | `t10-modkit`, `workbench`, `t10-property` | The frame in the kit: rail, tenant switcher, account menu, apps from `/v1/me/homes`. Workbench's sidebar and Property's top bar both become it |
| 3 | `t10-property`, `workbench`, contract | `app.nav` and `GET /v1/me/nav`; Property's tabs come from it; Workbench expands any app's sections |
| 4 | `t10-modkit`, apps | ⌘K and the bell in the frame |
| 5 | `t10-modkit`, `t10-property`, agent plane | The Ask panel, agreed with t10-94 first |

Steps 1 to 3 give the "one system" feel on their own.

Built so far:

- Step 1. `feat/module-dir` is merged. Workbench's code names no business module: the compiled `building` icon is gone, an app without `icon_svg` gets a generic icon, and the tests use made-up apps. Property sends its own `icon_svg`. In deploy, a business app reaches Workbench through a key its own component adds to `workbench-modules` (`deploy/k8s/catalog/property`), not through Workbench's `MODULE_URLS`. Leave the component out and Property is gone from Workbench, with no Workbench change.
- Step 2. `t10-modkit/web/frame.tsx` holds `Frame`, `Rail` and `AccountMenu`, and `theme.ts` moved into the kit. Workbench's sidebar and Property's top bar and tab strip both became the rail. Property's sections sit in three groups (daily, Records, Setup) and are still listed in its own code until step 3. Its Apps list comes from `/v1/me/homes`, and Workbench's from manifests. Tenant switching in Property stays in Property when the person has it in the other tenant, and goes to that tenant's Workbench otherwise. Property gains the theme setting.
- Step 3. Property's manifest lists its sections as `app.nav`, and `GET /v1/me/nav` answers with this person's, tested on the server with the same permissions the pages had. Property's rail draws from that read, with a badge from the attention counts each section names; Property keeps only an icon per section key. In Workbench, an app whose manifest has `nav` gets an arrow beside its Apps entry. Opening it reads the app's `/v1/me/nav` through the module proxy and shows daily sections, with records and setup behind More. Which apps are open is kept per browser. Workbench names no section of any app.
- Step 4. Search and the bell are in the kit (`command.tsx`), so every app has them in the same place. ⌘K in Workbench reaches conversations, actions and, once something is typed, other apps' sections from their `/v1/me/nav`. In Property it reaches Property's sections, the other apps and the settings. Neither searches another app's records yet; that waits for an optional `GET /v1/search`. The bell sits beside the app's name. In Workbench it lists every module's unread notifications, each linking where it happened: into the sending app at the notification's `to`, or to the module's page in Workbench. In Property it lists Property's own, since one app can't read another's notifications; Workbench is the place for all of them. Property's Updates card on My day is gone.
- Step 5, agreed with t10-94. The kit's `AskPanel` is the assistant in every app: inline in a page, or a panel beside any page from Ask the assistant in the rail. It reaches an agent only through the app's own `AskTransport`. In Property that's `/v1/assistant/turns`, which still checks consent and removes identifiers, and a household page offers itself as context (`account_id`), which the person can take off. My day's box is the same panel, inline. A turn can continue a chosen conversation (`session_id`, the person's own only), and Property answers `GET /v1/me/conversations` with times and a link, no titles or text. Workbench lists those beside its own conversations, opening each in Property with `?ask=<id>`, and never reads the property agent's sessions itself.

## Testing

- A browser test that opens Workbench, chooses a Property section in the rail, and finds the same rail, tenant and account menu there, then comes back the same way.
- A test that a made-up app in `MODULES_DIR` gets its icon and sections in Workbench's rail with no workbench change, and loses them when its key goes.
- A person with no Property role sees no Property entry in either app's rail, and a property steward sees only their sections.
- At 390 px wide, no app's frame takes more than one line above its content.

## Part 2: one account, no dead ends

Nov 9, 2026 · Status: steps 6 to 11 built on branch `feat/no-dead-ends` (uncommitted) and running on the local cluster. A second review, on the local cluster as `sample-acme-admin`, `sample-member`, `sample-multi`, `sample-platform`, `property-steward` and `property-manager`, at 1360 px and 390 px, in English and Chinese. Steps 1 to 5 hold up: the frame, search, bell and Ask panel are the same in both apps, the move between them asks for nothing (about 0.4 s), and one sign-out ends every app. What's left splits the system at its edges: who you are, where you can go, and pages that aren't apps.

Everything here must hold for any business app, including ones not yet written, each with its own rules and agents. No step names one.

### What a person still meets

| Where | What happens |
| --- | --- |
| An app you have no role in | The rail shows its sections and badges, the page says "You don't have access", and there's no way back: the kit draws the Apps list only when it holds more than one app |
| Workspace picker, from an app | "Choose a workspace" lists every tenant alike. `sample-multi` picks Acme from Property and lands on "no access", though only Globex has Property for them. A remembered workspace makes the same choice silently |
| An app opened at another host name | `localhost:18060` fails with "Sign-in didn't finish": the sign-in starts on the typed host and returns to the public one. In production, `www` against the bare domain does the same |
| "You" | Four places: auth-server's account page, Workbench's Profile (a read-only copy whose buttons open the account page), Workbench's Settings, and each app's menu, which differ (Settings and Profile in Workbench, Account in Property) |
| Language and theme | Kept per app in browser storage, so 中文 chosen in one app isn't in another, and the account page and console have no theme |
| Account page | Leaves the frame: its own top bar, workspaces as underlined links, no way back to the app it was opened from, sessions only as "Sign out everywhere" |
| Platform console | Copies the rail's look in templates, with no Apps list, search, bell or account menu. A platform admin who is also a tenant admin can't move to Workbench from it. Workbench finds it through its own config, other apps through `/v1/me/homes` |
| Another tab after sign-out | Keeps working until the person comes back to it; its API calls still succeed meanwhile |
| Words | The assistant has five names ("New conversation", "Ask your agent", "Ask the assistant", "Tell the assistant", "Ask & draft"; 智能体 and 助手), Chinese mixes 你 and 您, and one failure reads "Sign-in didn't finish" in one app and "didn't work" in another |
| Phone | The only header control is the rail toggle, so nothing says which app this is |

### The design

**Never a dead end.** Every app's rail always offers the Apps list, and Workbench is always in it. An app that refuses someone says so and offers the places they do have. An app's `GET /v1/me/nav` answers no sections to someone with no role, so the rail shows none. The workspace picker, opened from an app, lists first the workspaces that have that app and marks the rest "Opens in Workbench". A remembered workspace without the app isn't used for that app. auth-server knows the app from the redirect address's origin, matched against `AUTH_APP_URLS`, so no app is named. Each app's `/auth/login` first moves the browser to its public address, so sign-in starts and ends on one host.

**One account, one menu.** The account page in auth-server is the only place for name, sign-in names, password, second factor, devices and sessions. The kit's account menu is the same in every app, in this order: workspaces, language, theme, Account, Platform console (only from `/v1/me/homes`), the app's own settings when it has any, and Sign out. Workbench's Profile page goes, and old links open the account page. Settings becomes "Workbench settings" and keeps only Workbench's own preferences (default agent, browser notifications, shortcuts).

**Preferences belong to the person.** auth-server stores language and theme with the account (`GET` and `PUT /v1/me/preferences`). Every app reads them with its `/api/me` and applies them, the account page and sign-in pages honour them, and a change anywhere is saved there. Browser storage stays as a cache so the first paint is right.

**Pages that aren't apps still wear the frame.** The console and the account page render a server-side rail from a Go package in `t10-modkit`, with the kit's CSS: brand, the Apps list from `/v1/me/homes`, the same account menu, theme. The account page takes a `return_to` that must be a registered app address, and shows "Back to <app>". Platform admins see "Platform console" as the last entry in every Apps list, only where `/v1/me/homes` offers it, so the console stays off the public ingress.

**One sign-in package.** `workbench/internal/session`, `t10-property/internal/websession` and the console's copy become one Go package in `t10-modkit`, with Workbench's tests. Then the host fix, the session check and any later sign-in change are made once. A page in use also checks `/auth/session` on each in-app navigation, at most every few seconds, so a tab signed out elsewhere goes to sign-in on its next click.

**One vocabulary.** "Ask" (问) opens the assistant everywhere, a conversation is a conversation (对话), typed jobs keep their task names, and Chinese uses 您 in system text. The kit holds the shared strings, and `make check` refuses an app string that redefines one. The kit draws a one-line top bar on phones: rail toggle, app name, bell.

### Order of work

| Step | Repos | Gives |
| --- | --- | --- |
| 6 | `t10-modkit`, `t10-property`, `auth-server`, `workbench`, `t10-console` | No dead ends: Apps list always, refusal offers other places, nav empty without a role, app-aware picker and remembered workspace, sign-in on the public host |
| 7 | `t10-modkit`, `workbench`, `t10-property` | One account menu; Profile goes; Workbench settings narrowed; console link from homes only |
| 8 | `auth-server`, `t10-modkit`, apps | Language and theme saved with the account |
| 9 | `t10-modkit`, `auth-server`, `t10-console` | Server-side frame; account page and console in it; sessions listed; console in Apps |
| 10 | `t10-modkit`, apps | One sign-in package; session check on navigation |
| 11 | `t10-modkit`, apps | One vocabulary with a check; phone top bar |

Built so far:

- Step 6. The kit's rail shows the Apps list whenever it holds a place other than the current app, and `OtherPlaces` gives a refusal page an "Open <app>" button for each. Property's no-access pages use it, and its `GET /v1/me/nav` answers no sections to someone with no role. auth-server's picker and remembered workspace prefer the workspaces that have the app being signed in to, as described in `auth-server/docs/sign-in-and-landing.md` section 2. Workbench, Property and the console each move `/auth/login` to their public host name first, so `localhost` and `127.0.0.1`, or `www` and the bare domain, both sign in. Ports aren't compared, so the Vite dev proxy is unaffected. Still open: someone with no role in an app still sees its bell and Ask button there.
- Step 7. The kit's `AccountMenu` draws Account and Platform console itself, from `accountUrl` and `consoleUrl`, which each app takes from `/v1/me/homes` (Workbench through its `/api/config`, which reads the same). An app adds only its own settings, so the order is the same everywhere: workspaces, language, theme, Account, Platform console, the app's settings, Sign out. Workbench's menu lost the agent picker and Profile, and its one item is "Workbench settings": default agent, browser notifications and shortcuts. Language, theme, the console link and account security left that page, since the menu has them. Profile is gone, and `/t/<tenant>/profile` and search's Account open the account page. Property's menu has no items of its own. Someone with no role in Property no longer sees its bell or Ask button there; search stays, since it reaches the other apps.
- Step 8. auth-server keeps `language` (`en`, `zh-Hans`) and `theme` (`system`, `light`, `dark`) on the account (migration 0012), read and changed with `GET` and `PUT /v1/me/preferences`. Each app passes them through at `/api/preferences`. The kit's `useSavedPreferences` applies them when a signed-in page opens and whenever the person comes back to it, and saves each change made in the menu; nothing is saved before the first read, so a browser's guess never overwrites a choice. `/v1/authorize` gives an app the saved language. A language picked on a hosted page is saved at once when signed in, and when signed out, as on the sign-in page, it's saved by the sign-in that follows. The console saves its language switch the same way and opens in the saved language. Theme reaches the console and the auth pages with step 9, since neither has a dark style yet.
- Step 9. `t10-modkit/frame` is the frame of pages drawn on the server: `Places` (the Apps list's rule: Workbench, the tenant's apps, then the platform console; on a page with no tenant, each tenant's Workbench when there are several), the templates `frame-apps` and `frame-account` (a disclosure, so no script is needed) and `frame.css`, in the web kit's tokens and class names. The console and auth-server carry it as a checked snapshot under `third_party/t10-modkit`, which the workspace's `sync-modkit.sh` and `check-modkit.sh` cover. The console's rail ends with that Apps list and account menu; its own tenant links, Account link and language switch are gone. auth-server's account page now has the same rail, "Back to <app>" when an app opened it with `return_to` (only Workbench's, the console's or an `AUTH_APP_URLS` address; kept in a cookie while its forms post back), and a Sessions list of browser sign-ins with the apps open through each, any other of which can be signed out. Both pages take the saved theme as `data-theme`, and the account menu saves a new one (`POST /theme`, `POST /v1/theme`). In every React app, the platform console moved from the account menu to the end of the Apps list (`CONSOLE_APP`), and Account carries `return_to`. Pages before sign-in still follow the system theme, since they don't know who's there.
- Step 10. `t10-modkit/websession` is the one sign-in: Workbench's code, with the cookie name (`Name`), table (`Table`), session limit (`MaxAge`), step-up (`BeginStepUp`) and replacing the session a sign-in came from (`ReplaceOnSignIn`) as options, plus `Key`, `IsSecure`, `OnPublicHost` and a trace hook on the auth client. Its tests are Workbench's, with a step-up test added. Workbench's `internal/session`, Property's `internal/websession` and the console's `internal/session` are now a page of aliases each that set their own cookie and table; the console keeps its own auth reads on a client that wraps the shared one. Every Go consumer of t10-modkit carries the same snapshot (`people`, `ids`, `page`, `frame`, `websession`), which `sync-modkit.sh` copies and `check-modkit.sh` checks; t10-collab and t10-knowledge got the new snapshot and nothing else. A page in use asks whether its sign-in still stands on the next click or key, at most every 5 seconds, in the kit and in the console's script, so a tab signed out from another app leaves on its next use rather than within 30 seconds. The console's pages are drawn on its server, so a click loads the next page before a script could answer; there, every page first asks auth-server whether the browser sign-in stands, and one that doesn't goes to sign-in without being drawn.
- Step 11. What a person asks is "the assistant" (助手) in every app: the inline box and the rail button both say "Ask the assistant" (问助手), and Workbench's composer does too; "agent" (智能体) stays where agents are chosen or set up. All system text says 您 (Workbench had 你 throughout). `scripts/check-words.py`, part of `make check`, refuses 你, a retired name for the assistant, and a shared frame word that two catalogs translate differently (it found "Nothing found." did). On a phone, the kit's `Frame` draws one bar across the top with the menu button, the app's name and its bell; each app passes `title` and `bell`.
