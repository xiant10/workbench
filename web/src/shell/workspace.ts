import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { request, rpc } from "../lib/api.ts";
import { usePaged } from "../lib/paged.tsx";
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
	/** Modules listed for this deployment that gave no clear answer: down, as opposed to not deployed. */
	unavailable_modules: string[];
	/** What the auth service says this person's business roles reach, for what to show. Absent when it didn't say. */
	access?: { modules: string[]; module_admin: string[] };
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

/** Deployments and roles change under an open tab, so this refreshes. A failed refresh keeps what it had. */
export const configQuery = { queryKey: ["config"], queryFn: () => request<AppConfig>("/api/config"), retry: false, staleTime: 60_000, refetchInterval: 300_000 };

export const WorkspaceContext = createContext<Workspace | undefined>(undefined);

export function useWorkspace(): Workspace {
	const workspace = useContext(WorkspaceContext);
	if (workspace === undefined) throw new Error("useWorkspace needs the shell");
	return workspace;
}

/** Conversations come newest first, so one page covers the sidebar; older ones load on request. */
const LIST_PAGE = 50;
const BUSY_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;

/** The sidebar polls instead of holding a stream per conversation. */
export function useSessions(archived = false) {
	const { agent, tenant } = useWorkspace();
	const sessions = usePaged<SessionInfo>(["sessions", tenant, agent, archived], async (cursor) => {
		const page: { sessions: SessionInfo[]; nextCursor?: string } = await rpc(agent, "session.list", { limit: LIST_PAGE, archived, ...(cursor === "" ? {} : { cursor }) });
		// A skill editor's test conversations stay out of the sidebar and search.
		return { items: page.sessions.filter((session) => session.metadata?.skillDraft === undefined), ...(page.nextCursor === undefined ? {} : { next: String(page.nextCursor) }) };
	}, { refetchInterval: (items) => (items?.some((session) => session.busy) ? BUSY_POLL_MS : IDLE_POLL_MS) });
	return sessions;
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
