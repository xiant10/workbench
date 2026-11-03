import { request } from "../../lib/api.ts";

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

export const putAgentSettings = (settings: { default_agent: string; disabled_agents: string[] }) =>
	request<AgentSettings>("/api/modules/agents/admin/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
