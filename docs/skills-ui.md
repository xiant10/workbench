# Skills: the tenant admin's editor

Status: steps 1 and 2 built, November 4, 2026; step 3 proposed. How tenant skills are stored, read by agents and kept per tenant is [`t10-agent-control/docs/tenant-skills.md`](../../t10-agent-control/docs/tenant-skills.md). This doc covers only the screens.

## Who it's for

Tenant admins: usually sales-ops or team leads, not engineers. Most of their changes are "change what it says or does", not "rewire the graph". The first editor opened on a graph of `extract`, `switch` and `parallel` nodes with regex fields and a JSON drawer, and **Publish** put a change live for the whole tenant with no way to try it first.

So the experience is built around one loop: **edit, try it privately, publish, see how it's used, undo in one click.** The workflow graph is one part of a skill, behind its own tab, not the front door.

Decisions taken, both easy to widen later:

- **Only tenant admins edit**, as for every other tenant setting. A separate "skill editor" role would be an `auth-server` role and a new access level in `t10-agent-control`.
- **A skill belongs to one agent.** Sharing one skill across agents would need a record that several agents read, and a check against each agent's built-in skills and tools.

## Screens

### Skills library: `/t/<tenant>/skills`

```text
Skills                                         [Agent: Assistant | Sales]
Instructions and workflows the agent uses. Changes apply to everyone in this tenant on their next turn.

[+ New skill]  [Import folder]                              [search    ]

Name               Kind          State            Version   Changed
account-review     Ours          Live             v4        Ada · 2h ago
weather            Customized    Live             v2        Ada · 1d ago
company-knowledge  Built-in      —                —         —
vip-intake         Ours          Off              v3        Bob · 3d ago
```

- **Kind**: *Built-in* (from the agent's image), *Customized* (a tenant override of a built-in skill), or *Ours* (the tenant's own).
- **State**: *Live*, *Off*, *Built-in in use* for a customization that's turned off, and *Your draft* when you have unpublished edits, including a new skill that so far is only a draft.
- Members don't see this page. Administration → Workflows opens the same library, and `/workflows` redirects here.

### A skill: `/t/<tenant>/skills/<agent>/<name>`

```text
← Skills   account-review   [Ours · v4 live]                   [Turn off] [Publish]
┌ Overview ┬ Instructions ┬ Files (3) ┬ Tools (4) ┬ Workflow ┬ History ┐
```

| Tab | Ours | Built-in or Customized |
| --- | --- | --- |
| **Overview** | When the agent should use it (the description it chooses by) and trigger words | Read only |
| **Instructions** | Markdown editor. *Insert file reference* puts a file's path in the text, so instructions name files correctly | Read only, the platform's |
| **Files** | List with sizes and limits; open one in a text editor, create one, upload files or a folder, rename, remove. Files the instructions never mention are flagged | Names of the built-in files, read only |
| **Tools** | Picker over the agent's real tool catalog, grouped by server, each marked *allowed*, *needs approval* or *blocked* by the tenant's policy | Read only |
| **Workflow** | Off by default: "the agent decides the steps". *Add a workflow* starts from a template; the existing builder edits it | The existing builder. *Customize workflow* makes an override, *Restore built-in* removes it |
| **History** | Every version with who, when and what changed; *Restore this version* publishes it again | The override's versions |

All tabs edit one draft of the whole skill, and **Publish** sends it as one version, so instructions and the files they name can't go live apart. **Delete** (the tenant's own skills) removes it from the list and the agent; its versions stay as a record and the name can be used again. History shows people's names from the tenant's members, as the other admin histories now do.

**Publish** checks the workflow with the agent (`skills.checkFlow`), then publishes to `t10-agent-control`, and says when it applies: on the next turn, within seconds.

### New skill

A dialog asks for a name and a one-line description, then opens the skill page on an unpublished draft. *Import folder* reads a skill folder: its `SKILL.md` becomes the instructions and description, the rest become files.

## Step 2, built: drafts and a private test

Edits save as a server-side draft 0.8 seconds after typing pauses, one per author, which only its author sees; undoing every edit discards it, and a reload or another device brings it back. The header says *Draft saved, only you see it*, lists what publishing would refuse, and warns when someone published a newer version after the draft began. **Discard changes** deletes the draft; **Publish** clears it.

**Test** opens a side chat (full screen on a phone). Its conversation is created with `metadata.skillDraft` naming the skill, and the agent pins that turn's skills with the author's draft in place of the published version. The author is always the conversation's owner, so nobody can test someone else's draft, and nobody else's turns change. The chat shows tool calls and the last workflow run; its conversations stay out of the sidebar and are closed when the panel closes.

`t10-agent-control` keeps `agent_skills.drafts` (migration `0010`), with `GET`/`PUT`/`DELETE /v1/admin/skills/{agent}/{name}/draft`, `GET /v1/admin/skills/drafts?agent=` for your drafts, and `GET /v1/runtime/skills/draft?tenant=&name=&author=` for the harness. Not built: a diff view on Publish; History lists which fields changed.

## Step 3, proposed

- **Override a built-in skill's instructions and files**, as *replace* or *add tenant notes*, not only its workflow.
- **Built-in changed** notices: an override records the built-in version it was based on, and the library flags "the platform updated this skill; review your changes", with a three-way diff.
- **Usage**: times loaded, how workflow runs ended, recent conversations, per skill, from the agents' traces.
- **Describe it**: an agent drafts the overview, instructions, tools and workflow from a sentence, as a draft to test.

## What steps 1 and 2 needed from other services

- `agent-pi`: `skills.get` (one skill as this tenant sees it, with its instructions and file names) and `skills.tools` (the tool catalog this tenant can use, for the picker).
- `t10-agent-control`: drafts and delete (`POST /v1/admin/skills/{agent}/{name}/remove`, a `deleted` state). Versions and restore use `GET` and `PUT /v1/admin/skills/...`; policy marks use `GET /v1/admin/policy`.
- `agent-pi`: `metadata.skillDraft` on a session, read when each turn is pinned.
