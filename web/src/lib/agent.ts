import { newTurnId, rpc } from "./api.ts";

export type SessionInfo = {
	sessionId: string;
	profile: string;
	createdAt: number;
	lastActiveAt: number;
	busy: boolean;
	archived?: boolean;
	/** `ref` is `<module>:<type>:<id>`. `workItemId` is what older sessions hold. */
	/** What this session's harness supports. Older harnesses don't say, and support everything. */
	capabilities?: string[];
	metadata?: { title?: string; pinned?: boolean; ref?: string; workItemId?: string };
};

export type TranscriptMessage =
	| { id: number; role: "user"; text: string; images?: number; turnId?: string; requestId?: string }
	| { id: number; role: "assistant"; text: string; stopReason: string; error?: string; source?: string }
	| { id: number; role: "tool"; callId: string; name: string; isError: boolean }
	/** What a background task told its parent. Sent as a user message so the model reads it, but nobody said it. */
	| { id: number; role: "task"; kind: "report" | "note"; taskId: string; name: string; status?: string; text: string }
	| { id: number; role: "compaction" };

export type BackgroundTask = { taskId: string; name: string; status: string };

/** Whether a session can do something. Unknown counts as yes, so the page doesn't lose controls before a session loads. */
export function supports(session: Pick<SessionInfo, "capabilities"> | undefined, capability: string): boolean {
	return session?.capabilities === undefined || session.capabilities.includes(capability);
}

export type AgentEntry = { name: string; title?: string };

/**
 * Who this tenant can talk to. A gateway answers for every agent. Separate harnesses each answer for themselves, and
 * one that can't answer yet still counts as its configured name.
 */
export async function listAgents(configured: string[]): Promise<{ agents: AgentEntry[]; defaultAgent?: string }> {
	const answers = await Promise.allSettled(configured.map((agent) => rpc<{ agents: AgentEntry[]; defaultAgent?: string }>(agent, "agents.list")));
	const agents = new Map<string, AgentEntry>();
	let defaultAgent: string | undefined;
	answers.forEach((answer, index) => {
		if (answer.status === "rejected") {
			agents.set(configured[index] ?? "", { name: configured[index] ?? "" });
			return;
		}
		for (const agent of answer.value.agents) agents.set(agent.name, agent);
		if (answer.value.defaultAgent !== "") defaultAgent ??= answer.value.defaultAgent;
	});
	return { agents: [...agents.values()], ...(defaultAgent === undefined ? {} : { defaultAgent }) };
}

export type SessionDetails = SessionInfo & {
	parked: number;
	usage: { models?: Record<string, unknown> };
	taskUsage?: unknown;
	tasks: (BackgroundTask & { startedAt: number; activeAt: number })[];
};

export type PromptInput = string | ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];

export type Admission = { turnId: string; submissionId?: number; placement?: "queued" | "placed" | "answered" };

const TITLE_CHARS = 60;

/** The first line of the first message, until a plugin writes something better. */
export function titleOf(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}

export async function startConversation(
	agent: string,
	profile: string,
	input: PromptInput,
	title: string,
	metadata: Record<string, string> = {},
): Promise<string> {
	const { sessionId } = await rpc<{ sessionId: string }>(agent, "session.create", { profile, metadata: { ...metadata, title } });
	const turnId = newTurnId();
	await rpc(agent, "session.prompt", { input, requestId: crypto.randomUUID(), turnId, wait: false }, sessionId, turnId);
	return sessionId;
}
