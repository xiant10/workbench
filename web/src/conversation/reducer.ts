import type { BackgroundTask, FlowRunTrace, TranscriptMessage, TurnUsage } from "../lib/agent.ts";
import type { AgentEvent, StreamStatus } from "./stream.ts";

/**
 * What the transcript shows. `seq` marks a line an event added, until a transcript read replaces it. `at` is when a
 * message was written, in Unix milliseconds, as the agent or the arriving event says; older transcripts may have none.
 */
export type Line =
	| { key: string; id?: number; seq?: number; role: "user"; text: string; images?: number; turnId?: string; requestId?: string; at?: number; usage?: TurnUsage }
	| { key: string; id?: number; seq?: number; role: "assistant"; text: string; error?: string; source?: string; aborted?: boolean; at?: number; model?: string }
	| { key: string; id?: number; seq?: number; role: "tool"; callId: string; name: string; state: "running" | "done" | "failed" }
	| { key: string; id?: number; seq?: number; role: "task"; name: string; text: string }
	| { key: string; id?: number; seq?: number; role: "compaction" }
	| { key: string; seq?: number; role: "error"; text: string };

/** A message the transcript doesn't hold yet. */
export type Pending = {
	requestId: string;
	turnId: string;
	text: string;
	images: number;
	input: unknown;
	submissionId?: number;
	state: "sending" | "queued" | "failed";
	reason?: string;
	sentAt: number;
};

export type ConversationState = {
	lines: Line[];
	/** Ephemeral status only; never part of transcript lines or results. */
	progress: Record<number, string>;
	pending: Pending[];
	/** Reply text as it streams. */
	live: string;
	/** Which message `live` holds. */
	liveMessage?: string;
	/** In a call, a spoken reply shows through the room, in step with the audio. */
	inCall: boolean;
	/** Turns this client started, newest last. In a call, these are the typed ones. */
	ownTurns: string[];
	thinking: string;
	busy: boolean;
	status: StreamStatus;
	inbox: number[];
	tasks: BackgroundTask[];
	flow?: FlowRunTrace;
	retry?: { attempt: number; error: string };
	/** Turns up on each event, so a transcript read knows which lines it can't have seen. */
	seq: number;
	lastEventAt: number;
	/** Set once a transcript has been read, so an empty one isn't taken for a loading one. */
	loaded: boolean;
	/** Where an older page starts; undefined once the start is on screen. */
	earlier?: string;
	/** Bumped when the transcript must be read again. */
	reload: number;
	/** Bumped when the conversation list and usage may have changed. */
	settled: number;
};

export const initialState: ConversationState = {
	lines: [],
	progress: {},
	pending: [],
	live: "",
	inCall: false,
	ownTurns: [],
	thinking: "",
	busy: false,
	status: "connecting",
	inbox: [],
	tasks: [],
	seq: 0,
	lastEventAt: 0,
	loaded: false,
	reload: 0,
	settled: 0,
};

export type Action =
	| { type: "event"; event: AgentEvent; at: number }
	| { type: "status"; status: StreamStatus }
	| { type: "call"; inCall: boolean }
	/** What the caller said on a call, final but not yet in the transcript. */
	| { type: "heard"; id: number; text: string }
	| { type: "transcript"; messages: TranscriptMessage[]; earlier?: string; since: number }
	| { type: "older"; messages: TranscriptMessage[]; earlier?: string }
	| { type: "sending"; pending: Pending }
	| { type: "admitted"; requestId: string; submissionId?: number; placement?: string }
	| { type: "send-failed"; requestId: string; reason: string }
	| { type: "discard"; requestId: string };

function toLine(message: TranscriptMessage): Line {
	const key = `e${message.id}`;
	switch (message.role) {
		case "user":
			return { ...message, key };
		case "assistant":
			return {
				key,
				id: message.id,
				role: "assistant",
				text: message.text,
				...(message.error === undefined ? {} : { error: message.error }),
				...(message.source === undefined ? {} : { source: message.source }),
				...(message.stopReason === "aborted" ? { aborted: true } : {}),
				...(message.at === undefined ? {} : { at: message.at }),
				...(message.model === undefined ? {} : { model: message.model }),
			};
		case "tool":
			return { key, id: message.id, role: "tool", callId: message.callId, name: message.name ?? "", state: message.isError ? "failed" : "done" };
		case "task":
			return { key, id: message.id, role: "task", name: message.name, text: message.text };
		case "compaction":
			return { key, id: message.id, role: "compaction" };
	}
}

/** Whether a line an event added is one the read already holds. A read can land just after the event it covers. */
function held(line: Line, read: readonly Line[]): boolean {
	const tail = read.slice(-20);
	if (line.role === "assistant") return tail.some((other) => other.role === "assistant" && other.text === line.text);
	if (line.role === "tool") return tail.some((other) => other.role === "tool" && other.callId === line.callId);
	// The agent may join utterances the caller paused between into one message.
	if (line.role === "user" && line.key.startsWith("h")) return tail.some((other) => other.role === "user" && other.text.includes(line.text));
	return line.role === "compaction";
}

/** A transcript read replaces what events showed, and keeps only what happened after the read began. */
function mergeTranscript(state: ConversationState, messages: TranscriptMessage[], since: number): Line[] {
	const read = messages.map(toLine);
	const first = read[0]?.key;
	const firstId = messages[0]?.id;
	const older = state.lines.filter((line) => "id" in line && line.id !== undefined && (firstId === undefined || line.id < firstId) && line.key !== first);
	const newer = state.lines.filter((line) => line.seq !== undefined && line.seq > since && !held(line, read));
	return [...older, ...read, ...newer];
}

function eventLine(state: ConversationState, seq: number, event: AgentEvent, at: number): Line | undefined {
	switch (event.type) {
		case "message.end":
			if (event.text === "" && event.error === undefined) return undefined;
			return {
				key: `m${seq}`,
				seq,
				role: "assistant",
				text: event.text,
				at,
				...(event.error === undefined ? {} : { error: event.error }),
				...(event.source === undefined ? {} : { source: event.source }),
				...(event.stopReason === "aborted" ? { aborted: true } : {}),
			};
		case "tool.started":
			return { key: `t${event.callId}`, seq, role: "tool", callId: event.callId, name: event.name, state: "running" };
		case "compaction":
			return event.phase === "end" && !state.lines.some((line) => line.seq === seq) ? { key: `c${seq}`, seq, role: "compaction" } : undefined;
		case "error":
			return { key: `x${seq}`, seq, role: "error", text: event.message };
		default:
			return undefined;
	}
}

const MAX_OWN_TURNS = 50;

/**
 * Whether this text is a reply being spoken, which must not run ahead of the audio. It asks whose turn it is, not
 * whether the room named it: deltas beat the room's stream to the client, so a room's turn IDs would arrive too late.
 * Text with no turn isn't a spoken reply.
 */
function spoken(state: ConversationState, turnId: string | undefined): boolean {
	return state.inCall && turnId !== undefined && !state.ownTurns.includes(turnId);
}

/** `live` with a delta applied: a repeat of what's held is dropped, and a new message starts clean. */
function withDelta(state: ConversationState, event: Extract<AgentEvent, { type: "text.delta" }>): Pick<ConversationState, "live" | "liveMessage"> {
	const held = event.messageId === state.liveMessage ? state.live : "";
	const overlap = event.offset === undefined ? 0 : Math.max(0, held.length - event.offset);
	return { live: held + event.text.slice(overlap), ...(event.messageId === undefined ? {} : { liveMessage: event.messageId }) };
}

/**
 * A message the agent took up is in the conversation, even before the transcript says so. An agent that never reports its
 * inbox shows it by the first event of the turn the message started.
 */
function startedTurn(state: ConversationState, event: AgentEvent): ConversationState {
	if (event.type !== "run.started" && event.type !== "text.delta" && event.type !== "message.end") return state;
	const turnId = event.turnId;
	if (turnId === undefined || !state.pending.some((item) => item.state !== "failed" && item.turnId === turnId)) return state;
	const started = state.pending.filter((item) => item.state !== "failed" && item.turnId === turnId);
	const seq = state.seq + 1;
	return { ...state, seq, pending: state.pending.filter((item) => !started.includes(item)), lines: [...state.lines, ...started.map((item) => placedLine(item, seq))] };
}

function applyEvent(state: ConversationState, event: AgentEvent, at: number): ConversationState {
	if ((event.type === "text.delta" || event.type === "message.end") && spoken(state, event.turnId)) {
		return { ...state, seq: state.seq + 1, lastEventAt: at, retry: undefined };
	}
	const seq = state.seq + 1;
	const next: ConversationState = { ...state, seq, lastEventAt: at };
	const line = eventLine(state, seq, event, at);
	if (line !== undefined) next.lines = [...state.lines, line];
	switch (event.type) {
		case "snapshot": {
			// The stream started fresh, or fell too far behind: only the transcript can say what was missed.
			const partial = spoken(state, event.partial?.turnId) ? undefined : event.partial;
			const { liveMessage: _, ...rest } = next;
			return {
				...rest,
				busy: event.busy,
				progress: event.busy && event.progress?.phase !== "finished" && event.progress ? Object.fromEntries(event.progress.submissionIds.map(id => [id, event.progress!.text])) : {},
				inbox: event.inbox.map((item) => item.id),
				tasks: event.tasks,
				...(event.flow === undefined ? {} : { flow: event.flow }),
				live: partial?.text ?? "",
				...(partial === undefined ? {} : { liveMessage: partial.messageId }),
				thinking: "",
				retry: undefined,
				lines: state.lines.filter((other) => other.role !== "tool" || other.state !== "running" || event.busy),
				reload: state.reload + 1,
			};
		}
		case "progress": {
			const progress = { ...state.progress };
			for (const id of event.submissionIds) {
				if (event.phase === "finished") delete progress[id];
				else progress[id] = event.text;
			}
			return { ...next, progress };
		}
		case "run.started":
			return { ...next, busy: true };
		case "run.finished":
			return { ...next, busy: false, progress: {}, live: "", thinking: "", retry: undefined, reload: state.reload + 1, settled: state.settled + 1 };
		case "text.delta":
			return { ...next, ...withDelta(state, event), retry: undefined };
		case "thinking.delta":
			return { ...next, thinking: state.thinking + event.text };
		case "message.end":
			return { ...next, live: "", thinking: "" };
		case "tool.finished":
			return {
				...next,
				lines: state.lines.map((other) =>
					other.role === "tool" && other.callId === event.callId && other.state === "running" ? { ...other, state: event.isError ? "failed" : "done" } : other,
				),
			};
		case "task.updated": {
			const task = { taskId: event.taskId, name: event.name, status: event.status };
			const known = state.tasks.some((other) => other.taskId === task.taskId);
			return { ...next, tasks: known ? state.tasks.map((other) => (other.taskId === task.taskId ? task : other)) : [...state.tasks, task] };
		}
		case "flow.updated":
			return { ...next, flow: event.trace };
		case "inbox": {
			const inbox = event.items.map((item) => item.id);
			// Off the inbox means it's in the transcript now, or it was refused, which `submission` reports.
			const placed = state.pending.filter((item) => item.state === "queued" && item.submissionId !== undefined && !inbox.includes(item.submissionId));
			return {
				...next,
				inbox,
				pending: state.pending.filter((item) => !placed.includes(item)),
				lines: [...next.lines, ...placed.map((item) => placedLine(item, seq))],
			};
		}
		case "submission": {
			if (event.status === "done" || event.status === "unanswered") {
				next.progress = { ...state.progress };
				delete next.progress[event.submissionId];
			}
			if (event.status !== "unanswered" || event.reason === "aborted") return next;
			return {
				...next,
				pending: state.pending.map((item) => (item.submissionId === event.submissionId ? { ...item, state: "failed", reason: event.reason ?? "unanswered" } : item)),
			};
		}
		case "retry":
			return { ...next, retry: { attempt: event.attempt, error: event.error } };
		default:
			return next;
	}
}

function placedLine(item: Pending, seq: number): Line {
	return { key: `r${item.requestId}`, seq, role: "user", text: item.text, ...(item.images === 0 ? {} : { images: item.images }), turnId: item.turnId, requestId: item.requestId };
}

export function reducer(state: ConversationState, action: Action): ConversationState {
	switch (action.type) {
		case "event":
			return applyEvent(startedTurn(state, action.event), action.event, action.at);
		case "status":
			return { ...state, status: action.status };
		case "call":
			if (action.inCall === state.inCall) return state;
			// What a call hid comes back from the transcript.
			return { ...state, inCall: action.inCall, live: "", reload: action.inCall ? state.reload : state.reload + 1 };
		case "heard": {
			// It starts the turn the agent is about to take, so what that turn does shows under it.
			if (state.lines.some((line) => line.key === `h${action.id}`)) return state;
			const seq = state.seq + 1;
			return { ...state, seq, lines: [...state.lines, { key: `h${action.id}`, seq, role: "user", text: action.text }] };
		}
		case "transcript": {
			const lines = mergeTranscript(state, action.messages, action.since);
			const inTranscript = new Set(action.messages.flatMap((message) => (message.role === "user" && message.requestId !== undefined ? [message.requestId] : [])));
			return {
				...state,
				lines: lines.filter((line) => !(line.seq !== undefined && line.role === "user" && line.requestId !== undefined && inTranscript.has(line.requestId))),
				pending: state.pending.filter((item) => !inTranscript.has(item.requestId)),
				loaded: true,
				...(state.lines.some((line) => "id" in line && line.id !== undefined) ? {} : { earlier: action.earlier }),
			};
		}
		case "older":
			return { ...state, lines: [...action.messages.map(toLine), ...state.lines], earlier: action.earlier };
		case "sending":
			return {
				...state,
				pending: [...state.pending.filter((item) => item.requestId !== action.pending.requestId), action.pending],
				ownTurns: [...state.ownTurns, action.pending.turnId].slice(-MAX_OWN_TURNS),
			};
		case "admitted": {
			const item = state.pending.find((other) => other.requestId === action.requestId);
			if (item === undefined) return state;
			const id = action.submissionId;
			if (action.placement === "queued" && id !== undefined) {
				return { ...state, pending: state.pending.map((other) => (other === item ? { ...other, state: "queued", submissionId: id } : other)) };
			}
			const seq = state.seq + 1;
			return { ...state, seq, pending: state.pending.filter((other) => other !== item), lines: [...state.lines, placedLine(item, seq)] };
		}
		case "send-failed":
			return { ...state, pending: state.pending.map((item) => (item.requestId === action.requestId ? { ...item, state: "failed", reason: action.reason } : item)) };
		case "discard":
			return { ...state, pending: state.pending.filter((item) => item.requestId !== action.requestId) };
	}
}

export type ComposerMode = "idle" | "running" | "stalled" | "reconnecting" | "signed-out";

const STALL_MS = 60_000;

/** The composer's state, from the table in the design. A call on top of this is the conversation's own concern. */
export function composerMode(state: ConversationState, now: number): ComposerMode {
	if (state.status === "signed-out") return "signed-out";
	if (state.status !== "open") return "reconnecting";
	const waiting = state.busy || state.pending.some((item) => item.state === "sending");
	if (!waiting) return "idle";
	const since = Math.max(state.lastEventAt, ...state.pending.map((item) => item.sentAt));
	return now - since > STALL_MS ? "stalled" : "running";
}
