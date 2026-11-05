import type { SkillEntry, SkillFlow } from "../lib/agent.ts";
import { rpc } from "../lib/api.ts";
import { getPolicy, getTenantSkills, type PolicyRule, type TenantSkill, type TenantSkillContent } from "../modules/agents/api.ts";

/** One skill as the agent shows it to this tenant, for the editor: built-in, customized or the tenant's own. */
export type AgentSkill = {
	name: string;
	description: string;
	tools: string[];
	keywords: string[];
	body: string;
	/** Names of the files `load_skill` can read. */
	files: string[];
	flow?: SkillFlow;
	source?: SkillEntry["source"];
};

/** A tool the agent offers this tenant. `tool` is its name on its server, which policy rules use. */
export type CatalogTool = { name: string; server: string; tool: string; description: string };

/** skills.list's answer as it is: Home and the trace view cache it under the same key, `["skills", agent]`. */
export const listSkills = (agent: string) => rpc<{ skills: SkillEntry[] }>(agent, "skills.list");
export const getSkill = (agent: string, name: string) => rpc<{ skill: AgentSkill }>(agent, "skills.get", { skill: name }).then((body) => body.skill);
export const listTools = (agent: string) => rpc<{ tools: CatalogTool[] }>(agent, "skills.tools").then((body) => body.tools);
export const checkFlow = (agent: string, name: string, flow: SkillFlow, tools?: string[]) =>
	rpc<{ flow: SkillFlow; tools: string[] }>(agent, "skills.checkFlow", { skill: name, flow, ...(tools === undefined ? {} : { tools }) });

export { getPolicy, getTenantSkills, type TenantSkill, type TenantSkillContent };

/** What kind a skill is to this tenant. */
export type SkillKind = "builtin" | "override" | "custom";

export function kindOf(listed: SkillEntry | undefined, record: TenantSkill | undefined): SkillKind {
	if (record !== undefined) return record.kind;
	if (listed?.source !== undefined) return listed.source.kind;
	return "builtin";
}

const glob = (pattern: string, value: string) =>
	new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value);

/** How the tenant's policy treats a tool on this agent: the first rule that could match wins, as the gateway does. */
export function policyFor(rules: readonly PolicyRule[], agent: string, tool: CatalogTool): { effect: "allow" | "deny" | "approve"; partial: boolean } {
	for (const rule of rules) {
		if (rule.agent !== undefined && rule.agent !== "" && rule.agent !== agent) continue;
		if (!glob(rule.server, tool.server) || !glob(rule.tool, tool.tool)) continue;
		// A rule for some triggers or principals applies to some runs only.
		return { effect: rule.effect, partial: (rule.trigger?.length ?? 0) > 0 || (rule.principal ?? "") !== "" };
	}
	return { effect: "allow", partial: false };
}

/** Whether a skill's tool patterns (`server:tool`, `server:*`) cover a catalog tool. */
export function covers(patterns: readonly string[], tool: CatalogTool): boolean {
	return patterns.some((pattern) => {
		const [server, name] = pattern.includes(":") ? pattern.split(":", 2) : [undefined, pattern];
		if (server !== undefined) return server === tool.server && glob(name!, tool.tool);
		return glob(name!, tool.name) || glob(name!, tool.tool);
	});
}
