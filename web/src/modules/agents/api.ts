import type { SkillFlow } from "../../lib/agent.ts";
import { postJSON, request } from "../../lib/api.ts";

/**
 * One agent the platform lets this tenant use. Agents it doesn't are never listed. `picker` is false for an agent reached
 * only through its own app, which people never pick; `customizable` says whether this tenant may customize it, and
 * `teammates` whether its admins may build agent teammates on it.
 */
export type AgentChoice = { name: string; title?: string; enabled: boolean; picker?: boolean; customizable?: boolean; teammates?: boolean };

export type AgentSettings = {
	/** Empty keeps the platform's default. */
	default_agent: string;
	disabled_agents: string[];
	platform_default?: string;
	agents: AgentChoice[];
};

export const getAgentSettings = () => request<AgentSettings>("/api/modules/agents/settings");

export const putAgentSettings = (settings: { default_agent: string; disabled_agents: string[]; reason?: string }) =>
	request<AgentSettings>("/api/modules/agents/admin/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });

/** One change to this tenant's agent settings, or an attempt that was refused. */
export type SettingChange = { actor: string; disabled_agents: string[]; default_agent?: string; reason: string; outcome: "saved" | "refused"; problem: string; at: string };

export const getSettingHistory = () => request<{ entries: SettingChange[] }>("/api/modules/agents/admin/settings/history").then((body) => body.entries);

/** What a platform change did to one of this tenant's agents. Pools and harnesses are never named. */
export type AgentImpact = { agent: string; title?: string; changes: ("access" | "default" | "placement" | "capabilities")[] };

/** A platform publish that changed where this tenant's people go, or what they can do there. */
export type PlatformChange = { revision: number; actor: string; reason: string; at: string; agents: AgentImpact[] };

export const getPlatformChanges = () => request<{ changes: PlatformChange[] }>("/api/modules/agents/admin/platform-changes").then((body) => body.changes);

/** One rule of a tenant's policy. An empty field matches anything; the first rule that matches decides. */
export type PolicyRule = {
	id: string;
	agent?: string;
	trigger?: string[];
	principal?: string;
	server: string;
	tool: string;
	effect: "deny" | "approve";
	approvers?: string[];
	self_approval?: boolean;
	note?: string;
};

export type Policy = { harnesses?: string[]; rules: PolicyRule[] };

export type Findings = { problems: { text: string }[] | null; warnings: { text: string }[] | null };

/** The tenant's live policy, whether its plan lets admins change it, and its history. */
export type PolicyView = {
	version: number;
	policy: Policy;
	entitled: boolean;
	findings: Findings;
	agents: string[];
	history: { version: number; actor: string; reason: string; at: string; policy: Policy }[];
};

export const getPolicy = () => request<PolicyView>("/api/modules/agents/admin/policy");

export const reviewPolicy = (policy: Policy) => postJSON<{ findings: Findings }>("/api/modules/agents/admin/policy/review", policy);

export const putPolicy = (policy: Policy, reason: string, version: number) =>
	request<PolicyView>("/api/modules/agents/admin/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ policy, reason, version }) });

/** One decision or result the tool gateway recorded for this tenant. No arguments or results, only who, why and what was decided. */
export type EvidenceRecord = {
	id: string;
	at: string;
	kind: "decision" | "result";
	grant: string;
	principal: string;
	trigger: string;
	automation?: string;
	agent?: string;
	server: string;
	tool: string;
	effect?: string;
	rule?: string;
	version?: number;
	outcome?: string;
};

export type Verification = { ok: boolean; records: number; from: number; break_at?: number; problem?: string; gaps: { writer: string; from: number; to: number; kind: string }[] };

export const listEvidence = (filter: Record<string, string>) => {
	const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v !== ""));
	return request<{ records: { seq: number; record: EvidenceRecord }[] }>(`/api/modules/agents/admin/evidence?${query}`).then((body) => body.records);
};

export const verifyEvidence = () => request<Verification>("/api/modules/agents/admin/evidence/verify");

export const exportURL = "/api/modules/agents/admin/evidence/export";

/** A held tool call waiting for this person to decide. The summary is the call's plain values, kept only until it's decided. */
export type Approval = {
	id: string;
	principal: string;
	agent: string;
	automation?: string;
	server: string;
	tool: string;
	rule: string;
	summary: Record<string, string | number | boolean>;
	created_at: string;
	expires_at: string;
};

export const listApprovals = () => request<{ approvals: Approval[] }>("/api/modules/agents/approvals").then((body) => body.approvals);

export const decideApproval = (id: string, grant: boolean) => postJSON<Approval>(`/api/modules/agents/approvals/${encodeURIComponent(id)}`, { grant });

/** What a tenant skill version holds: an override has only its flow. */
export type TenantSkillContent = {
	description?: string;
	body?: string;
	tools?: string[];
	keywords?: string[];
	flow?: SkillFlow;
	/** A custom skill's reference files by relative path, read by the agent with load_skill. */
	files?: Record<string, string>;
};

/** A tenant's skill for one agent, at its current version. Agents read the published ones on their next turn. */
export type TenantSkill = {
	agent: string;
	name: string;
	kind: "override" | "custom";
	state: "published" | "disabled";
	version: number;
	digest: string;
	content: TenantSkillContent;
	updated_by: string;
	updated_at: string;
};

/** One published version of a tenant skill, never changed. */
export type SkillVersion = { version: number; digest: string; content: TenantSkillContent; actor: string; reason: string; at: string };

const skillPath = (agent: string, name: string) => `/api/modules/agents/admin/skills/${encodeURIComponent(agent)}/${encodeURIComponent(name)}`;

export const getTenantSkills = (agent: string) =>
	request<{ skills: TenantSkill[] }>(`/api/modules/agents/admin/skills?agent=${encodeURIComponent(agent)}`).then((body) => body.skills);

/** Publish a version. `version` is the one the edit started from, 0 for a new skill; someone else's publish since is a 409. */
export const putTenantSkill = (agent: string, name: string, body: { kind: TenantSkill["kind"]; content: TenantSkillContent; version: number; reason?: string }) =>
	request<{ skill: TenantSkill }>(skillPath(agent, name), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Turn a skill off: an override's built-in workflow comes back. */
export const disableTenantSkill = (agent: string, name: string, version: number) =>
	request<{ skill: TenantSkill }>(`${skillPath(agent, name)}?version=${version}`, { method: "DELETE" });

/** Delete a skill: gone from lists and agents, its name free again, its versions kept. */
export const removeTenantSkill = (agent: string, name: string, version: number) =>
	request<{ deleted: boolean }>(`${skillPath(agent, name)}/remove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }) });

/** Your unpublished edit of a skill, which only you see and only your test conversations use. */
export type SkillDraft = {
	kind: TenantSkill["kind"];
	content: TenantSkillContent;
	/** The version the edit started from, 0 for a new skill. */
	base_version: number;
	updated_at: string;
	/** What publishing it would refuse; a draft saves anyway. */
	problems?: { text: string }[];
};

export const putSkillDraft = (agent: string, name: string, draft: Pick<SkillDraft, "kind" | "content" | "base_version">) =>
	request<SkillDraft>(`${skillPath(agent, name)}/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });

export const discardSkillDraft = (agent: string, name: string) => request<unknown>(`${skillPath(agent, name)}/draft`, { method: "DELETE" });

/** Your drafts for an agent, including skills that are only a draft so far. */
export const listSkillDrafts = (agent: string) =>
	request<{ drafts: (SkillDraft & { name: string })[] }>(`/api/modules/agents/admin/skills/drafts?agent=${encodeURIComponent(agent)}`).then((body) => body.drafts);

/** What a tenant's customization of an agent holds. Everything is optional; empty is the agent as the platform ships it. */
export type AgentConfigContent = {
	instructions?: string;
	/** Replaces `instructions` during a call. */
	callInstructions?: string;
	/** Tools named `owner:tool`, as the tool gateway names them; `on` wins over `off`. */
	tools?: { off?: string[]; on?: string[] };
	skills?: { off?: string[] };
	/** One of the model entries the platform allows. Empty keeps the agent's own. */
	model?: string;
};

/** The published customization, version 0 when there's none. */
export type AgentConfig = { agent: string; version: number; digest: string; content: AgentConfigContent; updated_by: string; updated_at: string };

/** Your unpublished edit, which only you see and only your test conversations use. */
export type AgentConfigDraft = { content: AgentConfigContent; base_version: number; updated_at: string; problems: { text: string }[] };

/** One agent's customization, your draft, and what the platform allows. */
export type AgentConfigView = { config: AgentConfig; draft: AgentConfigDraft | null; models: string[]; keep_tools: string[] };

/** One published version, never changed. */
export type AgentConfigVersion = { version: number; digest: string; content: AgentConfigContent; actor: string; reason: string; at: string };

const configPath = (agent: string) => `/api/modules/agents/admin/agents/${encodeURIComponent(agent)}/config`;

export const getAgentConfig = (agent: string) => request<AgentConfigView>(configPath(agent));

/** Publish. `version` is the one the edit started from; someone else's publish since is a 409. */
export const publishAgentConfig = (agent: string, body: { content: AgentConfigContent; version: number; reason: string }) =>
	request<AgentConfigView>(configPath(agent), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const saveAgentConfigDraft = (agent: string, draft: { content: AgentConfigContent; base_version: number }) =>
	request<AgentConfigView>(`${configPath(agent)}/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });

export const discardAgentConfigDraft = (agent: string) => request<unknown>(`${configPath(agent)}/draft`, { method: "DELETE" });

export const getAgentConfigHistory = (agent: string) => request<{ versions: AgentConfigVersion[] }>(`${configPath(agent)}/history`).then((body) => body.versions);
