/** The browser's only way out: same-origin calls with a cookie, never a t10 token. */

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();

/** Called on any 401. The app shows "Sign in again" and keeps what was typed. */
export function onSignedOut(listener: Listener): () => void {
	signedOutListeners.add(listener);
	return () => signedOutListeners.delete(listener);
}

export function announceSignedOut(): void {
	for (const listener of signedOutListeners) listener();
}

const moduleGoneListeners = new Set<Listener>();

/** Called when the backend no longer lists a module this page thinks it has. */
export function onModuleGone(listener: Listener): () => void {
	moduleGoneListeners.add(listener);
	return () => moduleGoneListeners.delete(listener);
}

async function failure(response: Response): Promise<ApiError> {
	if (response.status === 401) announceSignedOut();
	const body = (await response.json().catch(() => undefined)) as { error?: unknown; message?: string } | undefined;
	const error = body?.error;
	if (response.status === 404 && error === "unknown_module") for (const listener of moduleGoneListeners) listener();
	// JSON-RPC errors nest; the sibling services' are flat.
	if (typeof error === "object" && error !== null) {
		const nested = error as { message?: string; data?: { code?: string } };
		return new ApiError(response.status, nested.data?.code ?? "rpc_error", nested.message ?? response.statusText);
	}
	return new ApiError(response.status, typeof error === "string" ? error : "http_error", body?.message ?? response.statusText);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(path, { credentials: "same-origin", ...init });
	if (!response.ok) throw await failure(response);
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export function postJSON<T>(path: string, body: unknown): Promise<T> {
	return request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

let nextRpcId = 1;

/** One JSON-RPC call to an agent. `turnId` also goes in a header, which is what the backend traces. `ai-gateway-agent` routes on `agent-method`. */
export async function rpc<T>(agent: string, method: string, params: Record<string, unknown> = {}, sessionId?: string, turnId?: string): Promise<T> {
	const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", "agent-method": method };
	if (sessionId !== undefined) headers["agent-session-id"] = sessionId;
	if (turnId !== undefined) headers["x-turn-id"] = turnId;
	const body = await request<{ result?: T; error?: { code: number; message: string } }>(`/api/agents/${encodeURIComponent(agent)}/agent`, {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: nextRpcId++, method, params }),
	});
	if (body.error !== undefined) throw new ApiError(200, "rpc_error", body.error.message);
	return body.result as T;
}

/** A trace ID, which is also the turn ID, as the Mac client's turns do. */
export function newTurnId(): string {
	return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
