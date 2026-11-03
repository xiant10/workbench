import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { rpc } from "../lib/api.ts";
import type { AgentEntry, SessionInfo } from "../lib/agent.ts";

export type Me = {
	user_id: string;
	display_name: string;
	active_tenant: string;
	sign_in_name: string;
	tenants: { id: string; name: string; role: "member" | "admin" }[];
};

export type AppConfig = {
	agents: string[];
	profiles: string[];
	modules: { id: string; api_version: number; features: string[] | null }[];
	voice: boolean;
	account_url: string;
	/** The platform console, sent only to a platform admin. */
	console_url?: string;
};

export type Workspace = {
	me: Me;
	config: AppConfig;
	tenant: string;
	/** The agent new conversations go to, and whose conversations the sidebar lists. */
	agent: string;
	agents: AgentEntry[];
	setAgent(agent: string): void;
	profile: string;
	isAdmin: boolean;
	signedOut: boolean;
	/** Paths in this tenant. */
	path(rest?: string): string;
};

export const WorkspaceContext = createContext<Workspace | undefined>(undefined);

export function useWorkspace(): Workspace {
	const workspace = useContext(WorkspaceContext);
	if (workspace === undefined) throw new Error("useWorkspace needs the shell");
	return workspace;
}

const LIST_PAGE = 200;
const BUSY_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;

/** The sidebar polls instead of holding a stream per conversation. */
export function useSessions(archived = false) {
	const { agent, tenant } = useWorkspace();
	return useQuery({
		queryKey: ["sessions", tenant, agent, archived],
		queryFn: async () => {
			const sessions: SessionInfo[] = [];
			let cursor: string | undefined;
			do {
				const page: { sessions: SessionInfo[]; nextCursor?: string } = await rpc(agent, "session.list", { limit: LIST_PAGE, archived, ...(cursor === undefined ? {} : { cursor }) });
				sessions.push(...page.sessions);
				cursor = page.nextCursor;
			} while (cursor !== undefined);
			return sessions;
		},
		refetchInterval: (query) => (query.state.data?.some((session) => session.busy) ? BUSY_POLL_MS : IDLE_POLL_MS),
	});
}

export function useRefreshSessions(): () => void {
	const client = useQueryClient();
	const { tenant } = useWorkspace();
	return () => void client.invalidateQueries({ queryKey: ["sessions", tenant] });
}

/** A person's name: never the raw ID, and empty display names are common. */
export function displayName(me: Me): string {
	return me.display_name || me.sign_in_name || me.user_id;
}
