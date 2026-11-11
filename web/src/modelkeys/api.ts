import { postJSON, request } from "../lib/api.ts";

/**
 * A tenant's own model keys and endpoints, kept at t10-agent-control through the agents module proxy. Keys are written
 * here and never read back. ai-gateway-llm chooses which key each call uses. See t10-agent-control's docs/model-keys.md.
 */

export type Capability = "llm" | "embedding" | "stt" | "tts";
export type Mode = "strict" | "own_then_assigned" | "own_then_platform" | "platform_then_own" | "platform";
export type Reason = "unavailable" | "rejected" | "limit";

export const CAPABILITIES: Capability[] = ["llm", "embedding", "stt", "tts"];
export const MODES: Mode[] = ["strict", "own_then_assigned", "own_then_platform", "platform_then_own", "platform"];
export const REASONS: Reason[] = ["unavailable", "rejected", "limit"];
export const KINDS = ["openai_chat", "openai_responses", "openai_embeddings", "anthropic", "dashscope_realtime"] as const;
export type Kind = (typeof KINDS)[number];

export type Credential = {
	id: string;
	provider?: string;
	endpoint?: string;
	label: string;
	hint: string;
	generation: number;
	status: "active" | "rejected" | "disabled";
	status_reason?: string;
	weight: number;
	agents: string[];
	monthly_token_cap?: number;
	updated_by: string;
	updated_at: string;
};

export type ModelCheck = { name: string; streaming?: boolean; tools?: boolean; images?: boolean; responses?: boolean };

export type Endpoint = {
	id: string;
	name: string;
	kind: Kind;
	base_url: string;
	region?: string;
	region_confirmed_by?: string;
	auth_kind: "none" | "bearer" | "header";
	auth_header?: string;
	models: ModelCheck[];
	checked_at?: string;
	status: "active" | "disabled";
	status_reason?: string;
};

export type Link = { provider?: string; endpoint?: string; model: string };
export type Mapping = { agent: string; alias: string; chain: Link[]; updated_by: string; updated_at: string };
export type TenantPolicy = { capability: Capability; agent: string; mode: Mode; fallback_on: Reason[] };
export type PlatformPolicy = {
	capability: Capability;
	allowed_modes: Mode[];
	byok_providers: string[];
	endpoints_allowed: boolean;
	own_counts_in_quota: boolean;
	regions: string[];
};
export type Provider = { name: string; region?: string; capabilities: string[] };
export type Alias = { alias: string; capability: string; providers: string[]; mappable: boolean; requires?: string[] };
export type Change = { object: string; object_id: string; actor: string; platform: boolean; action: string; outcome: string; reason?: string; at: string };

export type ModelKeys = {
	sealing: boolean;
	credentials: Credential[];
	endpoints: Endpoint[];
	assigned: { id: string; label: string; provider?: string; endpoint?: string; status: string }[];
	assigned_endpoints: { id: string; name: string; kind: Kind; region?: string; models: string[] }[];
	mappings: Mapping[];
	policies: TenantPolicy[];
	platform: Record<Capability, PlatformPolicy>;
	providers: Provider[];
	aliases: Alias[];
	changes: Change[];
	gateway?: "unreachable";
};

const base = "/api/modules/agents/admin";
const send = <T = void>(method: string, path: string, body?: unknown) =>
	request<T>(path, body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const agentQuery = (agent: string) => (agent === "*" ? "" : `?agent=${encodeURIComponent(agent)}`);

export const getModelKeys = () => request<ModelKeys>(`${base}/model-keys`);

export type NewKey = { provider?: string; endpoint?: string; label: string; secret: string; agents?: string[]; monthly_token_cap?: number; save_unreachable?: boolean };
export const addKey = (body: NewKey) => postJSON<{ credential: Credential }>(`${base}/model-keys`, body);
export const replaceKey = (id: string, secret: string, saveUnreachable = false) =>
	send<{ generation: number }>("PUT", `${base}/model-keys/${encodeURIComponent(id)}/secret`, { secret, save_unreachable: saveUnreachable });
export const patchKey = (id: string, body: { label?: string; weight?: number; agents?: string[]; monthly_token_cap?: number; disabled?: boolean }) =>
	send("PATCH", `${base}/model-keys/${encodeURIComponent(id)}`, body);
export const deleteKey = (id: string) => send("DELETE", `${base}/model-keys/${encodeURIComponent(id)}`);

export type NewEndpoint = {
	name: string;
	kind: Kind;
	base_url: string;
	region?: string;
	auth_kind: Endpoint["auth_kind"];
	auth_header?: string;
	secret?: string;
	models: string[];
	save_unreachable?: boolean;
};
export const addEndpoint = (body: NewEndpoint) => postJSON<{ endpoint: Endpoint }>(`${base}/model-endpoints`, body);
export const checkEndpoint = (id: string) => postJSON<{ endpoint: Endpoint }>(`${base}/model-endpoints/${encodeURIComponent(id)}/check`, {});
export const patchEndpoint = (id: string, body: { name?: string; base_url?: string; region?: string; disabled?: boolean }) =>
	send("PATCH", `${base}/model-endpoints/${encodeURIComponent(id)}`, body);
export const deleteEndpoint = (id: string) => send("DELETE", `${base}/model-endpoints/${encodeURIComponent(id)}`);

export const putMapping = (alias: string, agent: string, chain: Link[]) => send("PUT", `${base}/model-mappings/${encodeURIComponent(alias)}${agentQuery(agent)}`, { chain });
export const deleteMapping = (alias: string, agent: string) => send("DELETE", `${base}/model-mappings/${encodeURIComponent(alias)}${agentQuery(agent)}`);

export const putPolicy = (capability: Capability, agent: string, mode: Mode, fallbackOn: Reason[]) =>
	send("PUT", `${base}/model-key-policy/${capability}${agentQuery(agent)}`, { mode, fallback_on: fallbackOn });
export const deletePolicy = (capability: Capability, agent: string) => send("DELETE", `${base}/model-key-policy/${capability}${agentQuery(agent)}`);

/** Whether the tenant has a key or endpoint of its own for a capability, which makes strict its default. */
export function bringsOwn(keys: ModelKeys, capability: Capability): boolean {
	const serves = (kind: Kind) => (kind === "openai_embeddings" ? ["embedding"] : kind === "dashscope_realtime" ? ["stt", "tts"] : ["llm"]);
	const provider = (name: string) => keys.providers.find((p) => p.name === name)?.capabilities ?? ["llm", "embedding", "stt", "tts"];
	return (
		keys.credentials.some((c) => c.status !== "disabled" && (c.provider !== undefined ? provider(c.provider).includes(capability) : false)) ||
		keys.endpoints.some((e) => e.status === "active" && serves(e.kind).includes(capability))
	);
}

/** The mode a capability runs in for an agent: its own, the tenant's, or the default. */
export function effectiveMode(keys: ModelKeys, capability: Capability, agent = "*"): { mode: Mode; set: boolean } {
	const own = keys.policies.find((p) => p.capability === capability && p.agent === agent);
	if (own !== undefined) return { mode: own.mode, set: true };
	const tenant = keys.policies.find((p) => p.capability === capability && p.agent === "*");
	if (tenant !== undefined) return { mode: tenant.mode, set: agent === "*" };
	return { mode: bringsOwn(keys, capability) ? "strict" : "platform", set: false };
}
