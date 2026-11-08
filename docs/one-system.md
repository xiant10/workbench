# Workbench and business apps as one system

Nov 7, 2026 · Status: steps 1 and 2 built and merged to `main` on Nov 8 (workbench, workspace, t10-property, t10-modkit), with one sign-out (`feat/one-sign-out`) merged in each app first. Step 3 built on Nov 8. All of it runs on the local cluster's t10 namespace. Reviews the move between `workbench` and business apps such as `t10-property`, and proposes one frame that every t10 web app draws from shared data, with no business module named in `workbench`'s code.

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

Steps 4 and 5 make it work like one.

## Testing

- A browser test that opens Workbench, chooses a Property section in the rail, and finds the same rail, tenant and account menu there, then comes back the same way.
- A test that a made-up app in `MODULES_DIR` gets its icon and sections in Workbench's rail with no workbench change, and loses them when its key goes.
- A person with no Property role sees no Property entry in either app's rail, and a property steward sees only their sections.
- At 390 px wide, no app's frame takes more than one line above its content.
