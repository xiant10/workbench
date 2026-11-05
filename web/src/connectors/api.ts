import { postJSON, request } from "../lib/api.ts";

/**
 * A tenant's own MCP servers, kept at t10-agent-control through the agents module proxy. Credentials are written here
 * and never read back. See t10-agent-control's docs/tenant-connectors.md.
 */

export type AuthKind = "none" | "api_key" | "oauth_client" | "oauth_user";

export type Auth = {
	kind: AuthKind;
	header?: string;
	token_url?: string;
	authorize_url?: string;
	client_id?: string;
	scopes?: string;
};

export type ConnectorConfig = { url: string; auth: Auth; tools: string[]; agents: string[] };

export type DiscoveredTool = { name: string; title?: string; description?: string; input_schema: unknown; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };

export type Discovered = { at: string; server?: string; tools: DiscoveredTool[]; skipped?: number; problem?: string; sign_in?: boolean };

export type Connector = {
	id: string;
	name: string;
	title: string;
	state: "draft" | "published" | "disabled";
	version: number;
	draft: ConnectorConfig;
	discovered: Discovered | null;
	generation: number;
	live: (ConnectorConfig & { tool_defs: DiscoveredTool[] }) | null;
	credential: boolean;
	updated_by: string;
	updated_at: string;
	sealing?: boolean;
	connected?: boolean;
};

export type ConnectorChange = { actor: string; action: string; outcome: string; reason: string; at: string };

export type ConnectorDetail = {
	connector: Connector;
	versions: { version: number; actor: string; reason: string; at: string }[];
	changes: ConnectorChange[];
	agents: string[];
	callback_url: string;
};

const base = "/api/modules/agents/admin/connectors";
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const listConnectors = () => request<{ connectors: Connector[]; sealing: boolean; agents: string[] }>(base);

export const createConnector = (body: { name: string; title: string; url: string; auth: Auth }) => postJSON<ConnectorDetail>(base, body);

export const getConnector = (id: string) => request<ConnectorDetail>(`${base}/${encodeURIComponent(id)}`);

export const saveConnector = (id: string, body: ConnectorConfig & { title: string }) => request<ConnectorDetail>(`${base}/${encodeURIComponent(id)}`, json("PUT", body));

export const putCredential = (id: string, body: { key?: string; client_secret?: string }) =>
	request<ConnectorDetail>(`${base}/${encodeURIComponent(id)}/credential`, json("PUT", body));

export const discover = (id: string) => postJSON<ConnectorDetail>(`${base}/${encodeURIComponent(id)}/discover`, {});

export const publishConnector = (id: string, version: number, reason: string) => postJSON<ConnectorDetail>(`${base}/${encodeURIComponent(id)}/publish`, { version, reason });

export const disableConnector = (id: string, version: number) => postJSON<ConnectorDetail>(`${base}/${encodeURIComponent(id)}/disable`, { version });

export const removeConnector = (id: string, version: number) => postJSON<{ deleted: boolean }>(`${base}/${encodeURIComponent(id)}/remove`, { version });

/** A connector each person signs in to themselves. */
export type Connection = { id: string; name: string; title: string; connected: boolean; connected_at?: string };

export const listConnections = () => request<{ connections: Connection[] }>("/api/modules/agents/connections").then((body) => body.connections);

/** Where to send the browser to sign in. It comes back to Connections. */
export const startConnection = (id: string) => postJSON<{ url: string }>(`/api/modules/agents/connections/${encodeURIComponent(id)}/start`, {}).then((body) => body.url);

export const disconnect = (id: string) => request<{ disconnected: boolean }>(`/api/modules/agents/connections/${encodeURIComponent(id)}`, { method: "DELETE" });

export const AUTH_LABELS: Record<AuthKind, string> = {
	none: "No sign-in",
	api_key: "API key",
	oauth_client: "OAuth client credentials",
	oauth_user: "Each person signs in (OAuth)",
};
