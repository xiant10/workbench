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
};

export type Firing = { id: string; state: string; scheduled_for: string; problem?: string; session_id?: string; finished_at?: string | null };

/** The events that fire an intake automation, as t10-collab posts them. */
export const INTAKE_EVENTS = ["work.offered", "work.assigned", "work.accepted", "work.declined", "work.commented", "list.item_added"];

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

const automations = "/api/modules/automations/admin/automations";
export const listIntakeAutomations = (account: string) =>
	request<{ automations: IntakeAutomation[] }>(`${automations}?principal=${encodeURIComponent(account)}`).then((body) => body.automations);
export const getIntakeAutomation = (id: string) => request<{ automation: IntakeAutomation; firings: Firing[] }>(`${automations}/${encodeURIComponent(id)}`);
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
};

/** Which parts a teammate has: a missing one means it doesn't receive work, and finishing adds it. */
export type Parts = { intake: Intake | undefined; automation: IntakeAutomation | undefined };

/** Reads which of a teammate's parts outside control exist. */
export async function partsOf(account: string): Promise<Parts> {
	const [intake, list] = await Promise.all([getIntake(account).catch(() => undefined), listIntakeAutomations(account).catch(() => [])]);
	const set = intake !== undefined && (intake.everyone || intake.units.length > 0 || intake.lists.length > 0) ? intake : undefined;
	return { intake: set, automation: list[0] };
}

/** Adds what a teammate is missing: who may send it work (only when asked to open it to everyone) and its intake automation. */
export async function finishTeammate(t: Teammate, options: { everyone: boolean; notify: string }) {
	const parts = await partsOf(t.account);
	if (parts.intake === undefined && options.everyone) await putIntake({ user_id: t.account, everyone: true, units: [], lists: [] });
	if (parts.automation === undefined) {
		await postJSON<IntakeAutomation>(automations, {
			principal: t.account,
			name: `${t.title} intake`,
			agent: t.agent,
			trigger: "event",
			event_kinds: INTAKE_EVENTS,
			target: "session_per_ref",
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
	await finishTeammate(teammate, { everyone: n.everyone, notify: n.manager });
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
