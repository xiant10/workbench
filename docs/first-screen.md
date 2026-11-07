# The first screen after sign-in

Nov 6, 2026 · Status: steps 1, 2 and 4 built and deployed locally, uncommitted. The rest is proposed. Decided Nov 6: everyone lands on Home, including people who work mainly in one module. How a person reaches this screen is in [`sign-in-and-landing.md`](../../auth-server/docs/sign-in-and-landing.md). Which modules a person can see is in [`module-visibility.md`](module-visibility.md).

Property's Home rows now come from its manifest, because it has its own app, and its setup step is one of those rows. Someone with a role in an app also sees a landing page first if they arrive at `auth-server`. Opening `workbench` still lands on Home.

## Summary

Everyone who signs in to `workbench` lands on the same Home: a greeting, the agent box, four fixed suggestions, and a list called "Needs you". It knows little about the person. Most modules add nothing to it, a new admin gets no help setting up, and "Needs you" is mostly things that don't need anyone.

Keep one Home, with the agent box first, and let its contents come from what this person has:

1. **"Needs you" holds only what's waiting on a person,** from every module.
2. **Finished conversations move** to "Pick up where you left off".
3. **A new tenant admin gets a setup list,** worked out from real data, which goes away when it's done.
4. **Suggestions come from the modules** this person can use.
5. **Modules can add a small card** showing where their work stands.

The console keeps Fleet as its first screen, with what's wrong moved to the top.

## What each person sees today

Signed in on the local cluster on Nov 6, at 1280×800.

| Who | First screen | Problem |
| --- | --- | --- |
| Member, returning: `sample-member` | Agent box, four suggestions, "Needs you", recent conversations | "Needs you" showed three "Your agent finished" rows and "Show 27 more". Automations had a badge of 3, though this person has no automations |
| New tenant admin: `sample-globex-admin` | The same, plus "What can I do?" | Nothing mentions inviting people or setting anything up. "What can I do?" shows text written for the model: "Use when the user asks about…" |
| Someone whose job is one module, such as Property | The same as any member | Property's own rows in "Needs you", and its sidebar entry |
| Platform admin: `sample-platform` | Console Fleet | Works. Two unreachable replicas showed partway down the pools list, and a long Evidence table full of load-test rows followed |

Two things to read into those results:

- **"Show 27 more" is partly from my test.** "Finished" means not yet opened in this browser, and I used a fresh browser. So someone on a new computer sees it this way, and someone on their usual computer sees fewer.
- **The code has drifted from `design.md`.** That doc says suggestions come from `skills.list`, and that "Needs you" replaces the greeting and suggestions once there's something to act on. The built page has four fixed suggestions and always shows the greeting.

Reading the code explains the rest. `HomeRows` is the way a module adds to "Needs you", and only `collab` uses it, so pending approvals and automation failures reach only the sidebar.

## Design

### One Home, not one for each role

Business roles are defined by each tenant, so the app can't know in advance what a "finance" or "steward" Home should hold. Modules know their own work, and [module visibility](module-visibility.md) already decides which modules a person gets. So each module contributes to Home, and a person's Home is whatever their modules add.

The agent box stays first, because working with an agent is what `workbench` is for.

```text
+------------------+------------------------------------------------------+
| Workbench        | Good morning, Wei                                    |
| New conversation | +--------------------------------------------------+ |
| Search           | | Ask your agent                                   | |
|                  | | Agent: Assistant                               ^ | |
| Home             | +--------------------------------------------------+ |
| Tasks          2 | [Draft an arrears notice] [Summarize a document] ... |
| Approvals      1 |                                                      |
| Automations      | Needs you                                            |
| Property         |   Dana sent you "Review Q3 charges"   Accept  Decline|
|                  |   A tool call needs your approval             Review |
| Recent           |   Automation "Daily report" failed              Open |
|   ...            |                                                      |
|                  | Your work                                            |
|                  |   +-------------------+  +-------------------+       |
|                  |   | Property          |  | Tasks             |       |
|                  |   | 12 unpaid bills   |  | 2 due today       |       |
|                  |   +-------------------+  +-------------------+       |
|                  |                                                      |
|                  | Pick up where you left off                           |
|                  |   * Quarterly review   Finished 10m ago  Send as task|
|                  |     Customer brief     yesterday                     |
+------------------+------------------------------------------------------+
```

A returning member with sample content.

### 1. "Needs you" holds only what's waiting on a person

Each module with work for people adds `HomeRows`. Rows that come after every module's, such as `collab`'s "Waiting on others", use `WaitingRows`, so they keep their heading at the end.

The list and the sidebar badges won't always agree. A badge counts unread notifications, including news such as a finished run and notices about automations since deleted, while the list shows only what's waiting on someone.

| Module | Rows | State |
| --- | --- | --- |
| `collab` | Offers, assignments, declines, items due | Built |
| `agents` | Pending approvals, linking to Approvals | Built |
| `automations` | Automations that stopped, lost consent or failed their last run. Approvals on them show under `agents` | Built |
| `property` | Whatever its pages say a person must act on, such as adjustments awaiting approval. It decides, by the same permission checks its pages use | When Property chooses |

A module's rows are its own query, so one slow or failing module only affects its own rows. `collab`'s rows already show loading and retry states, and other modules should follow them.

A person with no role in a module doesn't get its rows, because `useModules()` leaves it out.

### 2. Finished conversations move out

A finished conversation is news, and nobody is blocked by it. It now sits in "Pick up where you left off", first and with a mark until it's opened, and keeps **Send as task** on its row.

The recent list stays capped, so a new computer shows four rows rather than thirty. The sidebar still lists the rest. The mark stays per browser, as it is now.

### 3. Setup for a new tenant admin

Tenant admins see this while any step is open. Members never see it, and nothing is asked on their behalf. It's `shell/Setup.tsx`.

```text
Set up Sample Globex                          1 of 4 done  [x]
+-----------------------------------------------------------+
|  ✓ Invite your team                                       |
|  ○ Add your first document                                |
|  ○ Create your property project                           |
|  ○ Create roles for your team                             |
+-----------------------------------------------------------+
```

| Step | Done when | Shown when | Link |
| --- | --- | --- | --- |
| Invite your team | The tenant has a second active member | Always | Administration, People |
| Add your first document | Knowledge lists an active document | `knowledge` is available | Knowledge |
| Create your property project | Property's settings hold a project | `property` is available | Administration, Property |
| Create roles for your team | The tenant has a role | A module available here is in the permission catalog | Administration, Roles |

- **Steps come from real data,** not a stored checklist. If an admin removes the thing later, the step opens again.
- **Modules add their own steps.** `setup?: SetupStep[]` on `WorkbenchModule`, each with a key, a label, a link and a `check(tenant)`. The shell owns the invite and roles steps. Roles only checks that a role exists, because `auth-server` has no cheap read of whether anyone holds one.
- **A check that fails hides its step,** so nobody is told to do something they may have done.
- **The list appears once every check has answered,** so rows don't pop in one by one.
- **It can be hidden,** per tenant, in this browser. Hiding covers the steps open at that moment, so a module deployed later brings the list back with its new step.

It sits above "Needs you", because a new admin has nothing there yet.

### 4. Suggestions come from modules

Add `starters?` to `WorkbenchModule`, each with an icon, a label and a prompt. Home shows up to four, taking modules' first, then fills from today's generic four. A module should offer one only if the agent can act on it, so one with no agent tools offers none.

**Remove "What can I do?"** Skill descriptions are written to help the model pick a skill, so they read badly to people. If that section comes back, it needs a short summary for people on each skill, which would be a change to the skill format and `skills.list`.

### 5. A module's card

Add an optional `HomeCard` to `WorkbenchModule`: a name, one or two facts from the module's own API, and a link. For example, Property shows unpaid bills for someone with billing access. It's the module's own component, so it applies its own access checks and shows nothing if the person has no relevant scope.

"Your work" appears only if a module renders a card. Cards should be light, because Home loads them on every visit: use a count the module already returns. No module has one yet, so this is the last step, and it should start with Property.

### Who sees what

| Person | First screen |
| --- | --- |
| Member of one tenant | Home |
| Member with a role in a module | Home, with that module's rows, suggestions and card |
| New tenant admin | Home, with setup at the top |
| Established tenant admin | Home, with approvals and other admin work in "Needs you" |
| Member of several tenants | The tenant picker, then Home for that tenant |
| Both roles | Whichever app they opened, or the chooser if they went to `auth-server` directly |
| Platform admin only | Console Fleet |
| In no tenant, not a platform admin | "You're not in a tenant yet", with Account and Sign out |
| Someone who just accepted an invitation | Home in the new tenant, with a suggestion to try |

### The console's first screen

Fleet is the right first screen for someone who runs the platform. Two small changes in `t10-console`:

- **"Needs attention" at the top.** Replicas with a problem, active pools short of ready replicas, routers behind the current revision and evidence with missing records, using data Fleet already loads. With nothing wrong, the section doesn't appear.
- **Evidence's table folds unless records are missing.** Its rows take up most of the page otherwise. Losses already on record stay visible, but don't count as needing attention, because they never clear.

## Alternatives considered

| Option | Why not |
| --- | --- |
| A separate Home for each role | Roles are tenant-defined, so there's no fixed list to design for. It would also need updating for each new module |
| A dashboard of widgets that people arrange | A large feature for an unproven need. It also moves attention away from the agent box |
| Land people who mostly use one module directly on it | Keeps Home the same for everyone and the agent within reach, and the module is one click away. A per-person "Start on" setting could come later if Property staff rarely use the agent |
| Remove the agent box for people who mostly use a module | The agent is how they'd use a module's tools. Having two kinds of Home makes both harder to explain |
| A stored setup checklist | It would drift from what's actually true, and need a table and an API |

## Order of work

| Step | Change | Repos |
| --- | --- | --- |
| 1 | Built: move finished conversations, add `HomeRows` for `agents` and `automations`, remove "What can I do?" | `workbench` |
| 2 | Built: setup for tenant admins | `workbench` |
| 3 | Suggestions from modules | `workbench` |
| 4 | Built: console "Needs attention", Evidence folded | `t10-console` |
| 5 | Module cards, starting with Property | `workbench`, and `t10-property` if it needs a count route |

Rows and suggestions for role-gated modules need [module visibility](module-visibility.md) to hide them from people with no role.

When built, update "Screens" in [`design.md`](design.md), and the `WorkbenchModule` row in the [module contract](../../contracts/module/README.md).

## Testing

- **Browser:** `web/e2e/home.spec.ts` mocks `/api`, and covers steps 1 and 2. Later steps add a role holder and their module's rows.
- **Local cluster:** sign in as `sample-member` and `sample-globex-admin`, and compare with the table above. `sample-acme-admin` also holds the platform role there, so it doesn't test a tenant-only admin.
