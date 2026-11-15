import { postJSON, request } from "../../lib/api.ts";
import type { AgentConfig, AgentConfigContent, AgentConfigVersion } from "./api.ts";

/**
 * Agent teammates: an agent account in the org, its configuration of a platform agent, who may send it work, and the
 * automation that takes that work. Each part stays with its owner, and this page calls each with the admin's own token:
 * `auth-server` for the account, `t10-agent-control` for the teammate, `t10-collab` for who may send it work, and
 * `t10-automations` for when it runs. See t10-agent-control's docs/tenant-agents.md, Part 2.
 */

export type TeammateState = "active" | "paused" | "removed";

export type Teammate = {
	id: string;
	account: string;
	agent: string;
	title: string;
	state: TeammateState;
	bundle_major: number;
	created_by: string;
	created_at: string;
	updated_at: string;
	/** Its published configuration's version, 0 for none. */
	version: number;
};

export type TeammateView = { teammate: Teammate; config: AgentConfig; models: string[]; keep_tools: string[] };

/** Who may offer it work, besides its reporting line, which can always assign it work. */
export type Intake = { user_id: string; everyone: boolean; units: string[]; lists: string[] };

/** The automation that runs it when work reaches it. */
export type IntakeAutomation = {
	id: string;
	name: string;
	agent: string;
	instruction: string;
	state: "active" | "paused" | "failing" | "revoked";
	trigger: "event" | "schedule";
	event_kinds: string[];
	principal: string;
	notify_user?: string;
	runs_per_day: number;
	/** external: a runner outside t10 leases its firings with a runner key. */
	target?: "new_session" | "session_per_ref" | "external";
};

/** An external teammate's runner key, as an admin sees it: never its secret. */
export type RunnerKey = {
	id: string;
	created_by: string;
	created_at: string;
	last_used_at: string | null;
	/** A runner called with it in the last 3 minutes. */
	connected: boolean;
};

export type Firing = { id: string; state: string; scheduled_for: string; problem?: string; session_id?: string; finished_at?: string | null };

/** The events that fire an intake automation, as t10-collab posts them. */
export const INTAKE_EVENTS = ["work.offered", "work.assigned", "work.accepted", "work.declined", "work.commented", "list.item_added"];
/**
 * An external teammate's: each run is a coding agent's, in time and model cost, so it works on what's sent to it. It
 * isn't woken because someone accepted what it sent them, or because an item was added to a list it's on, such as its
 * team's, which would start every agent on the list.
 */
export const EXTERNAL_INTAKE_EVENTS = INTAKE_EVENTS.filter((kind) => kind !== "work.accepted" && kind !== "list.item_added");

/**
 * What every intake run is told, before the event. The teammate's own instructions, in its configuration, say what work
 * it takes; this says how to answer it on the record.
 */
export const INTAKE_INSTRUCTION = [
	"Something happened on a work item that concerns you. The event below names it.",
	"Read the item with work_get and its comments with work_comments, then act by your instructions:",
	"- Offered work: accept it with work_accept if your instructions say you take it, or decline it with work_decline and a reason.",
	"- Your work: do it with your tools, comment what you did with work_comment, and send it back or onward with work_send when you're done.",
	"- A comment: answer it with work_comment if it's for you.",
	"If you can't finish, send the item to your manager with work_send and a note saying why.",
].join("\n");

/**
 * Starting instructions for an external teammate's role. Its runner says how to work in a worktree; the role says what
 * to do with an item and to whom to send it, by teammate name, which a team changes to its own.
 */
export const EXTERNAL_ROLES = {
	builder: [
		"You build. Make the change the item asks for, with tests, and run them.",
		"Open a pull request, add it to the item with work_link, and comment what you changed and how you checked it.",
		"When it's ready, pass your stage if the item is on a workflow; otherwise send the item to Reviewer.",
		"When it comes back with changes, fix what was found on the same branch.",
		"If the item is unclear, ask in a comment and send it back to whoever sent it to you.",
	].join("\n"),
	reviewer: [
		"You review. Read the item, then the pull request on its branch with gh pr diff and git log.",
		"Comment on the pull request with gh pr review --comment. Don't approve or merge: people do.",
		"Write one comment on the item with what you found.",
		"If it needs changes, send it back with what to fix: changes on a workflow, or else send the item to Builder. If it's ready, pass your stage, or else send it to Tester.",
	].join("\n"),
	tester: [
		"You test. Run the full and end-to-end tests on the item's branch.",
		"Add tests that are missing, commit them and push.",
		"Comment on the item what you ran and what passed or failed.",
		"If something fails that the code must fix, send it back with what failed: changes on a workflow, or else send the item to Builder. If it all passes, pass your stage, or else send it to the person who leads the work.",
	].join("\n"),
} as const;

export type ExternalRole = keyof typeof EXTERNAL_ROLES;

const control = "/api/modules/agents/admin/teammates";
const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const listTeammates = () => request<{ teammates: Teammate[] }>(control).then((body) => body.teammates);
export const getTeammate = (id: string) => request<TeammateView>(`${control}/${encodeURIComponent(id)}`);
export const updateTeammate = (id: string, change: { title?: string; state?: TeammateState }) => request<Teammate>(`${control}/${encodeURIComponent(id)}`, json("PATCH", change));
export const publishTeammateConfig = (id: string, body: { content: AgentConfigContent; version: number; reason: string }) =>
	request<TeammateView>(`${control}/${encodeURIComponent(id)}/config`, json("PUT", body));
export const getTeammateHistory = (id: string) => request<{ versions: AgentConfigVersion[] }>(`${control}/${encodeURIComponent(id)}/config/history`).then((body) => body.versions);

const intakePath = (account: string) => `/api/modules/collab/admin/agents/${encodeURIComponent(account)}/intake`;
export const getIntake = (account: string) => request<Intake>(intakePath(account));
export const putIntake = (intake: Intake) => request<Intake>(intakePath(intake.user_id), json("PUT", intake));
/** Every shared list an intake can name, by name, including lists the admin isn't on. */
export const intakeLists = () =>
	request<{ lists: { id: string; name: string; archived: boolean }[] }>("/api/modules/collab/admin/intake-lists").then((body) => body.lists);

const automations = "/api/modules/automations/admin/automations";
export const listIntakeAutomations = (account: string) =>
	request<{ automations: IntakeAutomation[] }>(`${automations}?principal=${encodeURIComponent(account)}`).then((body) => body.automations);
export const getIntakeAutomation = (id: string) =>
	request<{ automation: IntakeAutomation; firings: Firing[]; runner_key?: RunnerKey | null }>(`${automations}/${encodeURIComponent(id)}`);
/** Makes the runner key, revoking the last one. The key comes back this once. */
export const newRunnerKey = (id: string) => postJSON<{ key: string; runner_key: RunnerKey }>(`${automations}/${encodeURIComponent(id)}/runner-key`, {});
export const revokeRunnerKey = (id: string) => request<unknown>(`${automations}/${encodeURIComponent(id)}/runner-key`, { method: "DELETE" });
export const updateIntakeAutomation = (id: string, change: { state?: "active" | "paused"; notify_user?: string }) =>
	request<IntakeAutomation>(`${automations}/${encodeURIComponent(id)}`, json("PATCH", change));
export const deleteIntakeAutomation = (id: string) => request<unknown>(`${automations}/${encodeURIComponent(id)}`, { method: "DELETE" });

/** An agent account as auth-server answers. */
type Account = { user_id: string; display_name: string; manager_user_id?: string };
const org = (tenant: string, rest: string) => `/api/org/${encodeURIComponent(tenant)}/${rest}`;

export type NewTeammate = {
	tenant: string;
	agent: string;
	title: string;
	manager: string;
	unit: string;
	instructions: string;
	everyone: boolean;
	/** Its agent runs outside t10, so a runner leases its work. */
	external?: boolean;
};

/** Which parts a teammate has: a missing one means it doesn't receive work, and finishing adds it. */
export type Parts = { intake: Intake | undefined; automation: IntakeAutomation | undefined };

/** Reads which of a teammate's parts outside control exist. */
export async function partsOf(account: string): Promise<Parts> {
	const [intake, list] = await Promise.all([getIntake(account).catch(() => undefined), listIntakeAutomations(account).catch(() => [])]);
	const set = intake !== undefined && (intake.everyone || intake.units.length > 0 || intake.lists.length > 0) ? intake : undefined;
	return { intake: set, automation: list[0] };
}

/**
 * Adds what a teammate is missing: who may send it work (only when asked to open it to everyone) and its intake
 * automation. An external teammate's automation has target external: its runner leases the work, with one session per
 * item kept on the runner.
 */
export async function finishTeammate(t: Teammate, options: { everyone: boolean; notify: string; external?: boolean }) {
	const parts = await partsOf(t.account);
	if (parts.intake === undefined && options.everyone) await putIntake({ user_id: t.account, everyone: true, units: [], lists: [] });
	if (parts.automation === undefined) {
		await postJSON<IntakeAutomation>(automations, {
			principal: t.account,
			name: `${t.title} intake`,
			agent: t.agent,
			trigger: "event",
			event_kinds: options.external === true ? EXTERNAL_INTAKE_EVENTS : INTAKE_EVENTS,
			target: options.external === true ? "external" : "session_per_ref",
			instruction: INTAKE_INSTRUCTION,
			...(options.notify === "" ? {} : { notify_user: options.notify }),
		});
	}
}

/**
 * Creates a teammate in the order the design sets: the account, then the teammate and its first configuration, then
 * who may send it work and its intake automation. A failure part way leaves a teammate its page shows as not receiving
 * work, with a button that finishes the missing steps. No service writes to another's records.
 */
export async function createTeammate(n: NewTeammate): Promise<Teammate> {
	const account = await postJSON<Account>(org(n.tenant, "agent-accounts"), { display_name: n.title, manager_user_id: n.manager, org_unit_id: n.unit });
	const content: AgentConfigContent = n.instructions.trim() === "" ? {} : { instructions: n.instructions };
	const teammate = await postJSON<Teammate>(control, { account: account.user_id, agent: n.agent, title: n.title, content });
	await finishTeammate(teammate, { everyone: n.everyone, notify: n.manager, external: n.external });
	return teammate;
}

/** Removes a teammate: its automation and consent first, so nothing runs as it, then the teammate, then its account, whose departure moves its items. */
export async function removeTeammate(tenant: string, t: Teammate) {
	const parts = await partsOf(t.account);
	if (parts.automation !== undefined) await deleteIntakeAutomation(parts.automation.id);
	await updateTeammate(t.id, { state: "removed" });
	await request<unknown>(org(tenant, `members/${encodeURIComponent(t.account)}`), json("PATCH", { status: "inactive" }));
}

/** Pauses or resumes a teammate and its automation together. Work sent to a paused one waits as offers, and its events run on resume. */
export async function setTeammatePaused(t: Teammate, paused: boolean) {
	const parts = await partsOf(t.account);
	if (parts.automation !== undefined) await updateIntakeAutomation(parts.automation.id, { state: paused ? "paused" : "active" });
	return updateTeammate(t.id, { state: paused ? "paused" : "active" });
}
