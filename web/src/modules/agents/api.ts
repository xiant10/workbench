import { postJSON, request } from "../../lib/api.ts";

/** One agent the platform lets this tenant use. Agents it doesn't are never listed. */
export type AgentChoice = { name: string; title?: string; enabled: boolean };

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
export type PolicyRule = { id: string; agent?: string; trigger?: string[]; principal?: string; server: string; tool: string; effect: "deny"; note?: string };

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
