import type { QueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import type { WorkbenchModule } from "../types.ts";
import { AgentSettings } from "./AgentSettings.tsx";
import { ApprovalsPage } from "./ApprovalsPage.tsx";

/** Which agents a tenant uses, and the approvals its policy asks people for, from `t10-agent-control`. */
export const agents: WorkbenchModule = {
	id: "agents",
	apiVersion: 1,
	routes: [{ path: "approvals", element: <ApprovalsPage /> }],
	nav: [{ key: "approvals", label: "Approvals", to: "approvals", icon: ShieldCheck, unread: true }],
	eventLabel: (kind) => (kind === "approval.requested" ? "An agent's call needs your approval" : kind),
	onNotifications: (client: QueryClient) => void client.invalidateQueries({ queryKey: ["approvals"] }),
	admin: { joins: "agents", Settings: AgentSettings },
};
