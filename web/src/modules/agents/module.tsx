import type { QueryClient } from "@tanstack/react-query";
import { KeyRound, Plug, ShieldCheck, Wand2 } from "lucide-react";
import { ConnectorPage } from "../../connectors/ConnectorPage.tsx";
import { ConnectorsPage } from "../../connectors/ConnectorsPage.tsx";
import { ModelKeysSettings } from "../../modelkeys/ModelKeys.tsx";
import { SkillPage } from "../../skills/SkillPage.tsx";
import { AdminSkills, SkillsPage } from "../../skills/SkillsPage.tsx";
import type { WorkbenchModule } from "../types.ts";
import { AgentPage } from "./AgentPage.tsx";
import { AgentSettings } from "./AgentSettings.tsx";
import { ApprovalsPage } from "./ApprovalsPage.tsx";
import { HomeRows } from "./HomeRows.tsx";
import { TeammatePage } from "./TeammatePage.tsx";

/** Which agents a tenant uses and how it customized them, its skills and connectors, and the approvals its policy asks people for, from `t10-agent-control`. */
export const agents: WorkbenchModule = {
	id: "agents",
	apiVersion: 1,
	routes: [
		{ path: "approvals", element: <ApprovalsPage /> },
		{ path: "agents/:agent", element: <AgentPage /> },
		{ path: "teammates/:id", element: <TeammatePage /> },
		{ path: "skills", element: <SkillsPage /> },
		{ path: "skills/:agent/:name", element: <SkillPage /> },
		{ path: "connectors", element: <ConnectorsPage /> },
		{ path: "connectors/:id", element: <ConnectorPage /> },
		{ path: "connections", element: <ConnectorsPage /> },
	],
	nav: [
		{ key: "approvals", label: "Approvals", to: "approvals", icon: ShieldCheck, unread: true },
		{ key: "skills", label: "Skills", to: "skills", icon: Wand2, adminOnly: true },
		{ key: "connectors", label: "Connectors", to: "connectors", icon: Plug },
	],
	eventLabel: (kind) => (kind === "approval.requested" ? "An agent's call needs your approval" : kind),
	onNotifications: (client: QueryClient) => void client.invalidateQueries({ queryKey: ["approvals"] }),
	HomeRows,
	admin: [
		{ joins: "agents", Settings: AgentSettings },
		{ id: "skills", label: "Skills", icon: Wand2, Settings: AdminSkills },
		{ id: "model-keys", label: "Model keys", icon: KeyRound, Settings: ModelKeysSettings },
	],
};
