import { announceSignedOut } from "../lib/api.ts";
import type { BackgroundTask, FlowRunTrace } from "../lib/agent.ts";

export type ProgressEvent = { type: "progress"; submissionIds: number[]; phase: "working" | "waiting" | "retrying" | "finished"; text: string };

export type AgentEvent =
	| ProgressEvent
	| { type: "snapshot"; busy: boolean; inbox: { id: number; mode: string }[]; tasks: BackgroundTask[]; flow?: FlowRunTrace; progress?: ProgressEvent; partial?: { turnId?: string; messageId: string; text: string } }
	| { type: "run.started" | "run.finished"; submissionIds: number[]; turnId?: string }
	| { type: "text.delta"; text: string; offset?: number; messageId?: string; turnId?: string }
	| { type: "thinking.delta"; text: string }
	| { type: "message.end"; text: string; stopReason: string; error?: string; source?: string; messageId?: string; turnId?: string }
	| { type: "tool.started"; callId: string; name: string }
	| { type: "tool.finished"; callId: string; name: string; isError: boolean }
	| ({ type: "task.updated" } & BackgroundTask)
	| { type: "flow.updated"; trace: FlowRunTrace }
	| { type: "inbox"; items: { id: number; mode: string }[] }
	| { type: "submission"; submissionId: number; status: string; reason?: string; detail?: string }
	| { type: "retry"; attempt: number; error: string }
	| { type: "compaction"; phase: "start" | "end" }
	| { type: "error"; message: string }
	| { type: "speech" | "tools.active" };

export type StreamStatus = "connecting" | "open" | "reconnecting" | "signed-out" | "gone";

export type SseFrame = { id?: string; data: string };

/** Splits an SSE byte stream into frames. Keep-alive comments carry no data and yield nothing. */
export class SseParser {
	#buffer = "";

	push(chunk: string): SseFrame[] {
		this.#buffer += chunk;
		const frames: SseFrame[] = [];
		for (;;) {
			const end = this.#buffer.indexOf("\n\n");
			if (end === -1) return frames;
			const block = this.#buffer.slice(0, end);
			this.#buffer = this.#buffer.slice(end + 2);
			let id: string | undefined;
			const data: string[] = [];
			for (const line of block.split("\n")) {
				if (line.startsWith("id: ")) id = line.slice(4);
				else if (line.startsWith("data: ")) data.push(line.slice(6));
			}
			if (data.length > 0) frames.push({ ...(id === undefined ? {} : { id }), data: data.join("\n") });
		}
	}
}

const MAX_BACKOFF_MS = 10_000;
/** A stream that ended cleanly after this long ended with its token. A shorter one is a server turning us away. */
const MIN_CLEAN_STREAM_MS = 1000;

/**
 * The conversation's one live stream. It reconnects with `Last-Event-ID` until aborted: the run goes on in agent-pi
 * either way, so a drop costs nothing, and a clean end reconnects at once. `fetch` rather than `EventSource`, which can't send `Agent-Session-Id`.
 */
export async function openStream(
	agent: string,
	sessionId: string,
	onEvent: (event: AgentEvent) => void,
	onStatus: (status: StreamStatus) => void,
	signal: AbortSignal,
): Promise<void> {
	let lastEventId: string | undefined;
	let attempt = 0;
	const decoder = new TextDecoder();
	while (!signal.aborted) {
		let ended = false;
		try {
			const response = await fetch(`/api/agents/${encodeURIComponent(agent)}/agent`, {
				headers: {
					accept: "text/event-stream",
					"agent-session-id": sessionId,
					...(lastEventId === undefined ? {} : { "last-event-id": lastEventId }),
				},
				signal,
			});
			if (response.status === 401) {
				announceSignedOut();
				onStatus("signed-out");
				return;
			}
			if (response.status === 404) {
				onStatus("gone");
				return;
			}
			if (!response.ok || response.body === null) throw new Error(`stream answered ${response.status}`);
			attempt = 0;
			onStatus("open");
			const opened = Date.now();
			const parser = new SseParser();
			const reader = response.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					ended = Date.now() - opened >= MIN_CLEAN_STREAM_MS;
					break;
				}
				for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
					if (frame.id !== undefined) lastEventId = frame.id;
					const message = JSON.parse(frame.data) as { params?: AgentEvent };
					if (message.params !== undefined) onEvent(message.params);
				}
			}
		} catch (error) {
			if (signal.aborted) return;
			console.warn("event stream dropped", error);
		}
		if (signal.aborted) return;
		// agent-pi ends a stream when its token expires. The next request carries a fresh one, so nothing was lost.
		if (ended) continue;
		onStatus("reconnecting");
		attempt += 1;
		await new Promise((resolve) => setTimeout(resolve, Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt)));
	}
}
