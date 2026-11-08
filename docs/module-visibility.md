# Showing only the modules a person can use

Nov 6, 2026 · Status: steps 1 to 3 built and deployed locally, uncommitted. The rest is proposed. Decided Nov 6: a listed module that's down keeps its menu, and business roles decide who sees a role-gated module. Companion to [`design.md`](design.md) and the [module contract](../../contracts/module/README.md).

Property has since moved out: a module with its own web app has no folder here, and this build knows it only from its manifest. See [`proposals/business-module-apps.md`](../../proposals/business-module-apps.md). What follows is the design as written, when Property was compiled in.

Nov 7: section 6 changed. A module is now added by a key in a mounted folder that the workbench rereads while running, and a module with its own app also brings its icon and who may see it in its manifest. So adding a business app needs no workbench change, setting or restart. Built on branch `feat/module-dir` and tried on a test namespace, not yet in any overlay.

## Summary

Yes, a module's menu can disappear when the module isn't deployed, and for the five registered modules it already does. The mechanism needs no redesign: `/api/config` asks each module in `MODULE_URLS` for its manifest, and every shell surface builds from the answers through `useModules()`.

Three gaps stop that from being true in practice:

1. **Skills and Connectors bypass the mechanism.** They always show, though they need `t10-agent-control`. On a deployment without it they open and look empty, and Skills offers **New skill**.
2. **"Down" looks the same as "not deployed".** A module that misses one 3-second check loses its menu, and a person on its page is sent to Home.
3. **An open tab never updates.** The config is fetched once, so a removed module stays in the menu until a reload, and a module that was down at load stays missing.

This design closes those three, makes "not deployed" one line in an overlay, and handles what each new module costs the UI. It also hides a module from people with no business role in it, using what `auth-server` already returns.

## What happens today

Checked in a browser against the production build on Nov 6, with `/api/config` and the module routes mocked. The backend rules come from `internal/proxy/proxy.go` and its test. Nothing here was run against a real module going down.

| Case | Result | OK? |
| --- | --- | --- |
| Remove `property` from the config | Sidebar entry gone, palette built from the same list | Yes |
| Bookmark to `/t/<tenant>/property` with it removed | Redirects to Home | Yes |
| `admin?tab=property` with it removed | Tab gone, falls back to People | Yes |
| Calling a removed module's API | The proxy answers `404 unknown_module` | Yes |
| Module's Home rows and notification polling, with it removed | Not rendered, no calls | Yes |
| No `agents` module: Skills, Connectors, Administration's Skills tab | All still show. Their calls get 404. Skills says "This agent has no skills yet" and offers **New skill** | **No** |
| Module answers 503 or times out | Left out of the config, so treated as removed. A person there is sent to Home | **No** |
| Module removed while a tab is open | Menu unchanged, because `staleTime: Infinity` means one config fetch | **No** |

## What a new module costs the UI

A module is a folder plus one line in `modules/index.tsx`, and the shell needs no other change. These costs still grow with each module:

| Surface | Today, with all five modules | Effect of one more |
| --- | --- | --- |
| Sidebar | 10 entries take 366px. At 1280×720 that leaves 123px for conversations, about three rows | Each entry takes another 36px. Two or three more entries and the list is gone on that screen |
| Administration tabs | 9 tabs. At 1280 wide they already overflow, 958px in 931px, and scroll sideways | A settings-heavy module adds a tab |
| JavaScript | One bundle, 1.19 MB (348 KB gzipped), with no code splitting. Module folders plus Skills and Connectors are 44% of the frontend source | Every person downloads it, deployed or not |
| Translations | All strings live in the shared `lib/zh.ts`. Property's pages all use `t()`, and its own `i18n.test.ts` fails on a string that doesn't | A module's text stays English in Chinese, or edits a shell file |
| Result action | `useResultAction()` takes the first module that offers one | A second module's action never shows |
| Deploy config | Module resources sit in `base`, while `MODULE_URLS` and the catalog are per overlay. The base `MODULE_URLS` lists three modules and the local overlay replaces it with five | "Not deployed" means editing several places, and they can disagree |

## Decisions

### 1. "Deployed" means listed in `MODULE_URLS`

The workbench can't see Kubernetes and shouldn't. The contract already rejects a central registry. So `MODULE_URLS` states what this environment is meant to have, and the manifest confirms it at runtime.

That gives three states:

| State | When | Menu and route |
| --- | --- | --- |
| **Absent** | Not in `MODULE_URLS`, or `200` with `enabled: false`, or a major version this build doesn't know | No menu entry, no tab. A direct link goes to Home |
| **Available** | `200`, `enabled: true`, a known version | Normal |
| **Unavailable** | Listed, but anything else: timeout, refused connection, 5xx, 401, 403, 404, a bad body or the wrong `id` | Entry stays, with no badge. Its page says it's unavailable, with Retry |

Only a clear answer or a config change removes a menu. A listed module that never answers shows as unavailable, which makes a broken deployment visible, and the backend logs it as it does now.

`TestManifestsKeepOnlyModulesThatAnswerAndAreOn` changes: `down` and `wrong` become unavailable rather than dropped.

Hiding on failure was the alternative. It looks tidier, but people would see menus vanish during every rolling restart, and links in notifications would land on Home with no explanation.

### 2. Backend: report who didn't answer

`Manifests` also returns the listed modules that failed. `/api/config` keeps `modules` as it is and adds one field:

```json
{
  "modules": [{ "id": "collab", "api_version": 1, "features": [] }],
  "unavailable_modules": ["property"],
  "access": { "modules": ["property"], "module_admin": [] }
}
```

Everything using `useModules()` keeps meaning "answered". Home rows, chips, result actions, notification polling and joined settings then skip an unavailable module with no change. `access` is explained in section 9.

### 3. Client: menus and routes use a wider view

Add `useModuleMenu()` to `modules/index.tsx`, returning available and unavailable modules with their state. The sidebar, palette and Administration's own-tab list use it. An unavailable module's menu needs nothing from the server, because its entries are compiled in.

`ModuleGate` handles the three states. It must never replace a page already open, or a blip would destroy a half-filled form:

```tsx
function ModuleGate({ id, children }: { id: string; children: ReactNode }) {
	const { tenant } = useWorkspace();
	const state = useModuleState(id);
	const opened = useRef(false);
	if (state === "available") opened.current = true;
	if (state === "absent") return <Navigate to={`/t/${tenant}`} replace />;
	if (state === "no_role") return <ModuleNoAccess id={id} />;
	if (state === "unavailable" && !opened.current) return <ModuleUnavailable id={id} />;
	return children;
}
```

An open page that loses its module shows its own request errors, as it does for any failed call.

### 4. Client: keep the config fresh

- Share one query definition between `Root` and `Shell`: `staleTime` 60 seconds, refetch every 5 minutes and on window focus.
- Change `if (config.isError)` in `App.tsx` to also require `config.data === undefined`. Otherwise a failed background refresh would replace the whole app with the error page.
- Add `onModuleGone()` to `lib/api.ts`, following `onSignedOut()`. A `404` with `{"error":"unknown_module"}` refreshes the config at once, so a removed module corrects itself on first use.

This adds about one manifest call per module, per open tab, every 5 minutes, which is small next to the 30-second notification polls. Query results keep their identity when nothing changed, so an unchanged config causes no re-render.

During a workbench rollout, old and new pods can disagree for a minute, so a menu entry could come and go briefly. That's acceptable.

### 5. Skills and Connectors belong to the `agents` module

Both are served by `t10-agent-control`, so they should follow the same rule as everything else:

- `agents/module.tsx` owns their routes and sidebar entries, which came out of `App.tsx` and `Sidebar.tsx`. Their folders stay at `web/src/skills/` and `web/src/connectors/` for now, because moving them is cleanup and changes no behaviour.
- Add `adminOnly?: boolean` to `ModuleNav`, because Skills is for admins. Add it to the palette's filter too, which doesn't check this today.
- Let `admin` hold several entries, each with an optional tab `id`, so Administration's Skills tab comes from the module and `?tab=skills` keeps working. It now comes after the built-in tabs.
- Render `data-testid={`nav-${entry.key}`}` in the sidebar, so existing tests keep their selectors.
- List `agents` last in `compiled`, so Skills and Connectors stay near the bottom. This moves Approvals down beside them, which is a visible change.

People, Organization, Roles, Agents, Security and Activity stay built in, because they read `auth-server`, which every profile has.

### 6. One line per module in an overlay

Revised Nov 7, and the workbench half built: see "A module's own folder key" below. The original proposal follows it.

#### A module's own folder key

`MODULES_DIR` names a folder with one file per module, named by the module's ID and holding its address. It's meant to be a mounted ConfigMap, `workbench-modules`, with no hash suffix, so a change reaches the running pod instead of restarting it. The workbench rereads the folder every 10 seconds and logs `modules changed added=[...] removed=[...]`. `MODULE_URLS` still works, and its entries come first. Folder entries follow, in ID order, and an ID in both keeps its `MODULE_URLS` address. A bad entry stops the service at startup, as a bad `MODULE_URLS` does, but while it runs the bad entry is logged and left out, so one module's typo can't take the others' menus down.

A module with its own app then needs nothing from this repo. Its manifest's `app` block carries what the menu shows:

| Field | Meaning |
| --- | --- |
| `url`, `label`, `label_zh` | Where the app is, and its name |
| `icon_svg` | Its menu icon, a 24 by 24 SVG of at most 8 KB. The client uses it only as a CSS mask over the text colour, never as markup, so it follows the theme and can't run anything. Without one the menu shows a generic icon: this build names no module's icon |
| `access` | `member` when every member has some use for the app. Leave it out, or say `role`, to show it only to people holding a role in it and to tenant admins |

A module with screens compiled here still needs its folder and a line in `modules/index.tsx`, because its screens are code. That's the capability modules, which stay compiled in by the Nov 6 decision.

Tried on Nov 7 in a test namespace with a made-up `facilities` app, a small Node server that isn't in any repo: adding its key put Facilities in the menu of an open Workbench, with its own icon and a Home row from its counts, for a member with no role, since it says `access: member`. Removing the key took it out again. The ConfigMap took about 80 seconds to reach the pod, and the workbench noticed within its 10-second check. The pod never restarted.

What's still separate for a business app, outside this repo: auth-server's catalog entry and `AUTH_APP_URLS` for the landing page, its OAuth client in `clients.yaml`, and `ai-gateway`'s settings for agent tools. See the module contract's "Adding a module".

#### As first proposed

Give each module one kustomize component, `deploy/k8s/modules/<id>/`, holding its Deployment and Service, its route, its permission catalog and its workbench entry. An overlay lists what it deploys:

```yaml
components:
  - ../../modules/collab
  - ../../modules/agents
  - ../../modules/property
```

The workbench entry can't merge into one `MODULE_URLS` string, so follow the pattern `auth-server-permissions` already uses. A generated `workbench-modules` ConfigMap holds one key per module, each component merges in its own, and the workbench reads them through `envFrom`:

```yaml
configMapGenerator:
  - name: workbench-modules
    behavior: merge
    literals:
      - MODULE_URL_property=http://t10-property.t10.svc.cluster.local:18075
```

`config.Load` takes only `getenv`, so it also needs the environment list to find these keys. `MODULE_URLS` stays for Compose. Order comes from the code's `compiled` list, not the config. The generator's hash suffix restarts the workbench when the set changes, so removing a module takes one line and one apply.

Roles and assignments survive removal, as "Module lifecycle" in [`auth-custom-roles.md`](../../proposals/auth-custom-roles.md) already requires. A `make check` confirms that each module's permission copy matches its source.

### 7. Load each module's pages on demand

Keep each `module.tsx` eager, for its nav, icons and labels. Load its pages, Home rows, chips and dialogs with `lazy()`, under one `Suspense` in the shell. Code and CSS for an absent module are then never downloaded, and `property.css` loads with its page.

Two limits to state plainly:

- Menu labels still ship in the main bundle. This saves bytes and isn't a security boundary. The boundary is the proxy's 404 and each module's own checks.
- After a workbench upgrade, an open tab can ask for a chunk that no longer exists. Add an error boundary that offers a reload, and measure the result, because the saving is unproven until then.

Separate builds per deployment were the alternative. They'd need one image for each combination of modules, and the module's presence would no longer be a runtime fact.

### 8. Make room in the sidebar

- Split the links into **Work**, for module pages, and **Manage**, for Skills, Connectors and Administration. **Manage** starts collapsed and remembers its state per browser. For an admin today that hides three rows, 107px, less the height of the new group headers. Add `section?: "work" | "manage"` to `ModuleNav`.
- Cap the links at `max-height: 40vh` with their own scroll, so conversations always keep space however many modules a tenant has.

Unread badges sit on module pages in **Work**, so collapsing **Manage** hides none of today's. A future **Manage** entry with a badge should show its count on the group header.

### 9. Business roles decide who sees a role-gated module

Being deployed doesn't mean a person may use the module. Today every member of a tenant sees Property, and someone with no role opens it to a "no access" state. Business roles can drive this with no `auth-server` change.

**What already exists.** `GET /v1/me/access` returns `modules`, the deployed modules where the caller holds a usable permission, plus `module_admin`. A tenant admin gets every module in the catalog. The query counts only active assignments, enabled roles, and active members, accounts and tenants, and it skips retired and undeployed permissions. `auth-server`'s role and access tests pass on a throwaway Postgres. The workbench backend already calls this route, but only to read `platform_admin`.

**A module's client folder declares that it needs a role:**

```ts
export const property: WorkbenchModule = { id: "property", access: "role", /* ... */ };
```

```ts
function hasAccess(module: WorkbenchModule, { config, isAdmin }: Workspace): boolean {
	if (module.access !== "role" || isAdmin || config.access === undefined) return true;
	return config.access.modules.includes(module.id);
}
```

The rule isn't "any module in the catalog needs a role", for two reasons:

- **Having roles doesn't always mean needing one.** Knowledge plans `knowledge:*` for managers, but ordinary members still read documents. A catalog-based rule would remove Knowledge from their menu the day it adopts roles.
- **It would fail during an outage.** An unavailable module sends no manifest, so a manifest-based rule couldn't tell whether it was role-gated. The declaration is compiled in, so it still applies.

Collab, agents, automations and knowledge don't declare it, and stay visible to every member.

**The module states become four.** Deployment is checked first, then the role:

| State | Menu, Home rows, polling | Direct link |
| --- | --- | --- |
| Absent | None | Home |
| Unavailable, with access | Menu entry only | Unavailable page, with Retry |
| Available, with access | All | The page |
| **No role** | None | "You don't have access to Property. Ask a tenant admin for a role." |

A direct link explains itself rather than going to Home, because the module exists and a colleague may have sent the link. `useModules()` leaves out no-role modules, so nothing polls a module that would refuse the person.

**Backend.** `/api/config` always reads `/v1/me/access` and passes on `modules` and `module_admin` as `access`. This replaces `isPlatformAdmin`'s separate call. If the read fails, `access` is left out and the menu shows the module, as the code above does.

**Three behaviours to expect:**

- **The menu is only a hint.** The module still refuses a person with no role, and `web/e2e/property.spec.ts` already checks a `403`. Hiding the menu adds no protection.
- **Role changes can lag in the menu.** A change reaches an open tab on window focus or within 5 minutes, while the module enforces it on the next request. Saving in the Roles tab also refreshes the config for that admin's own tab.
- **New role-gated modules start hidden from members.** Tenant admins see the module at once. Members see it once they're assigned a role, which matches "a new permission is never added to existing roles automatically".

Any permission in the module shows the entry, so a role holding only `property:export` sees Property. A role with permissions but no building scope also sees it, and the page explains the empty result, because `auth-server` doesn't know about buildings.

**Tenant admins always see it.** The `isAdmin` check keeps a catalog left out of an overlay from hiding a module from everyone, including whoever would fix it. `make check` should catch that mismatch too.

**Finer levels:**

| Level | Source | When |
| --- | --- | --- |
| One module, several sidebar entries | Add `requires` to `ModuleNav`, read from `GET /v1/me/permissions?module=<id>`. Tenant admins must be exempt, because they hold no grants | When a module needs it. Knowledge's manager screens are the likely first. Property has one entry today |
| Tabs inside a module's page | The module's own access read. Property's `/v1/access` combines permissions with building scope, which `auth-server` can't see | Property's choice, with no shell change. Its browser test expects the "not assigned" heading, so it would change too |

**Administration for module admins is a later step.** The proposal says someone holding `<prefix>:admin` sees Administration with only that module's tab. `module_admin` already provides the data, but it wouldn't work yet:

- No Go code in `t10-property` reads `property:admin`, though its catalog declares it.
- `modules/property/Admin.tsx` calls `auth-server`'s tenant-admin routes for members, roles and assignments, so a module admin who isn't a tenant admin would be refused.

So Administration stays tenant-admin only until Property adopts `property:admin`. The menu and tab changes should ship in that same step.

## Order of work

| Step | Change | Repos | Fixes |
| --- | --- | --- | --- |
| 1 | Built: move Skills and Connectors into `agents` (5) | `workbench` | Menus on any deployment without `t10-agent-control`, such as this repo's Compose default, which lists only `collab` |
| 2 | Built: three states and fresh config (1 to 4) | `workbench` | Menus vanishing on a blip, stale tabs |
| 3 | Built: menus by business role (9) | `workbench` | Members seeing modules they can't use |
| 4 | Module components (6). The workbench half, `MODULES_DIR` and manifest icons and access, is built on `feat/module-dir` | workspace `deploy/`, `workbench` config | "Not deployed" becomes one line |
| 5 | Sidebar room (8) | `workbench` | Conversations squeezed out |
| 6 | Pages on demand (7) | `workbench` | Bundle size |
| Later | Administration for module admins (9), with Property adopting `property:admin` | `t10-property`, `workbench` | Module admins who aren't tenant admins |
| Later | Sidebar entries by permission (9), module-owned translations | `workbench` | When a module needs them |

Steps 1 to 3 deliver what was asked. Each step ships on its own, though step 3 depends on the three-state gate from step 2.

Each step should also update the [module contract](../../contracts/module/README.md): "Availability" under Clients for step 2, and "Adding a module" for steps 3, 4 and 6.

## Testing

- **Go:** the changed `Manifests` test, and a `/api/config` test with `unavailable_modules`.
- **Browser:** `web/e2e/modules.spec.ts` mocks `/api`, covering each state on the sidebar, palette, direct link and admin tab. Include a deployment with no `agents`, a module going unavailable with a form open and its draft kept, a failed background refresh keeping the app up, and a module removed from an open tab. For roles: a member with no role sees no entry and gets the no-access page from a direct link, a role holder and a tenant admin see the entry, a failed access read shows it, and an unlisted module stays hidden even from a role holder.
- **Cluster:** on the local cluster, take `property` out of the local overlay, apply, and confirm that its menu goes while its tenants' roles remain. Then scale `t10-property` to zero while it's still listed, and confirm that it shows as unavailable. Sign in as `sample-member` with no property role and confirm there's no entry, then as a tenant admin and confirm that it's there. Roles have no delete route, so create any test role in a tenant where it can stay.

## Smaller leaks found

These don't affect menus, and can be fixed along the way:

- `modules/agents/PolicySettings.tsx` pre-fills its server field with `collab`.
- `shell/Settings.tsx` says "Tell me about new tasks" whenever any module is present, even without `collab`.
- `workbench/deploy/k8s/workbench.yaml` lists three modules, and the local overlay replaces that with five. Step 3 removes the duplicate.
