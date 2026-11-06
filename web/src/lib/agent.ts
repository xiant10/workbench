import { newTurnId, rpc } from "./api.ts";
import type { Pending } from "../conversation/reducer.ts";

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
	/** `skillDraft` marks a skill editor's private test conversation. */
	metadata?: { title?: string; pinned?: boolean; ref?: string; workItemId?: string; skillDraft?: string };
};

export type TranscriptMessage =
	| { id: number; role: "user"; text: string; images?: number; turnId?: string; requestId?: string }
	| { id: number; role: "assistant"; text: string; stopReason: string; error?: string; source?: string }
	| { id: number; role: "tool"; callId: string; name: string; isError: boolean }
	/** What a background task told its parent. Sent as a user message so the model reads it, but nobody said it. */
	| { id: number; role: "task"; kind: "report" | "note"; taskId: string; name: string; status?: string; text: string }
	| { id: number; role: "compaction" };

export type BackgroundTask = { taskId: string; name: string; status: string };

export type FlowNodeKind = "start" | "extract" | "tool" | "parallel" | "switch" | "ask_user" | "llm_reply";

export type FlowExtractField = {
	pattern?: string;
	keywords?: Record<string, string | boolean>;
	fallbackInput?: boolean;
	default?: string | boolean;
};

export type FlowParallelCall = {
	id: string;
	label: string;
	labelZh?: string;
	tool: string;
	args?: Record<string, unknown>;
	when?: string;
	storeAs?: string;
};

export type FlowSwitchBranch = {
	id: string;
	label: string;
	labelZh?: string;
	when: string;
	target: string;
};

export type FlowNode = {
	id: string;
	kind: FlowNodeKind;
	label: string;
	labelZh?: string;
	description?: string;
	descriptionZh?: string;
	tools?: string[];
	extract?: Record<string, FlowExtractField>;
	call?: {
		tool: string;
		args?: Record<string, unknown>;
		storeAs?: string;
	};
	parallel?: FlowParallelCall[];
	branches?: FlowSwitchBranch[];
	defaultTarget?: string;
	promptTemplate?: string;
	promptTemplateZh?: string;
};

export type FlowEdge = {
	id: string;
	source: string;
	target: string;
	label?: string;
	labelZh?: string;
	branch?: string;
};

export type SkillFlow = {
	id: string;
	title: string;
	titleZh?: string;
	/** Set on a workflow made here; it becomes a new skill's description. */
	description?: string;
	mode: "deterministic" | "guided";
	triggerKeywords?: string[];
	nodes: FlowNode[];
	edges: FlowEdge[];
};

export type FlowStepStatus = "pending" | "running" | "completed" | "skipped" | "needs_input" | "failed";

export type FlowStepToolCall = {
	name?: string;
	tool?: string;
	label?: string;
	labelZh?: string;
	status: "running" | "done" | "completed" | "skipped" | "failed";
	durationMs?: number;
	summary?: string;
	isError?: boolean;
};

export type FlowStepTrace = {
	stepId?: string;
	nodeId?: string;
	status: FlowStepStatus;
	startedAt?: number;
	finishedAt?: number;
	durationMs?: number;
	branchId?: string;
	branchChosen?: string;
	toolCalls?: FlowStepToolCall[];
	summary?: string;
	outputSummary?: string;
	error?: string;
};

export type FlowRunTrace = {
	runId?: string;
	flowId?: string;
	skill?: string;
	skillName?: string;
	title?: string;
	titleZh?: string;
	mode: "deterministic" | "guided";
	status: "running" | "completed" | "needs_input" | "failed";
	startedAt: number;
	finishedAt?: number;
	totalDurationMs?: number;
	durationMs?: number;
	llmCallsSaved?: number;
	parallelToolsRun?: number;
	flow?: SkillFlow;
	steps: FlowStepTrace[] | Record<string, FlowStepTrace>;
	variables?: Record<string, unknown>;
};

export type SkillEntry = {
	name: string;
	description: string;
	tools?: string[];
	flow?: SkillFlow;
	/** Set when this tenant's published version changed or added the skill. */
	source?: { kind: "override" | "custom"; version: number; digest: string };
};

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
	flow?: FlowRunTrace;
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
	text?: string,
): Promise<string> {
	const { sessionId } = await rpc<{ sessionId: string }>(agent, "session.create", { profile, metadata: { ...metadata, title } });
	const turnId = newTurnId();
	const requestId = crypto.randomUUID();
	await rpc(agent, "session.prompt", { input, requestId, turnId, wait: false }, sessionId, turnId);
	if (text !== undefined) firstPrompts.set(sessionId, { requestId, turnId, text, images: 0, input, state: "sending", sentAt: Date.now() });
	return sessionId;
}

/**
 * The prompt a conversation was started with, for the page that opens it. An agent may not have written the message to
 * the transcript yet, and the page would show nothing until the reply began.
 */
const firstPrompts = new Map<string, Pending>();

export function takeFirstPrompt(sessionId: string): Pending | undefined {
	const pending = firstPrompts.get(sessionId);
	firstPrompts.delete(sessionId);
	return pending;
}
