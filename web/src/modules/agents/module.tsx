import type { WorkbenchModule } from "../types.ts";
import { AgentSettings } from "./AgentSettings.tsx";

/** Which agents a tenant uses, from `t10-agent-control`. It owns no records, so it has no pages or notifications. */
export const agents: WorkbenchModule = {
	id: "agents",
	apiVersion: 1,
	routes: [],
	nav: [],
	eventLabel: () => "",
	admin: { joins: "agents", Settings: AgentSettings },
};
