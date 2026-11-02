import { useCallback, useEffect, useReducer, useRef } from "react";
import { newTurnId, rpc } from "../lib/api.ts";
import type { Admission, PromptInput, SessionDetails, TranscriptMessage } from "../lib/agent.ts";
import { ApiError } from "../lib/api.ts";
import { initialState, type Pending, reducer } from "./reducer.ts";
import { openStream } from "./stream.ts";

const PAGE = 100;

type Page = { messages: TranscriptMessage[]; nextCursor?: string };

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * One open conversation: one stream, one reducer. Start the stream, then read the transcript, so nothing falls between
 * the two. Every path back from a problem, a dropped network, a second tab or a restarted agent, ends in the same read.
 *
 * `voice` says what a call on this conversation is doing. While the agent is speaking, reads wait, because a finished
 * reply would otherwise reach the screen before it reached the caller.
 */
export function useConversation(agent: string, sessionId: string, archived: boolean, voice: { inCall: boolean; speaking: boolean }) {
	const [state, dispatch] = useReducer(reducer, initialState);
	const seq = useRef(0);
	seq.current = state.seq;

	const read = useCallback(async () => {
		const since = seq.current;
		const page = await rpc<Page>(agent, "session.messages", { limit: PAGE }, sessionId);
		dispatch({ type: "transcript", messages: page.messages, ...(page.nextCursor === undefined ? {} : { earlier: page.nextCursor }), since });
	}, [agent, sessionId]);

	useEffect(() => {
		const controller = new AbortController();
		// An archived conversation can take no input, so nothing will happen on a stream.
		if (archived) {
			dispatch({ type: "status", status: "open" });
			void read();
			return () => controller.abort();
		}
		void openStream(
			agent,
			sessionId,
			(event) => dispatch({ type: "event", event, at: Date.now() }),
			(status) => dispatch({ type: "status", status }),
			controller.signal,
		);
		return () => controller.abort();
	}, [agent, sessionId, archived, read]);

	useEffect(() => dispatch({ type: "call", inCall: voice.inCall }), [voice.inCall]);

	useEffect(() => {
		if (state.reload > 0 && !voice.speaking) read().catch((error: unknown) => console.warn("transcript read failed", error));
	}, [state.reload, read, voice.speaking]);

	const submit = useCallback(
		async (pending: Pending, method: "session.prompt" | "session.steer" | "session.interrupt", extra: Record<string, unknown> = {}) => {
			dispatch({ type: "sending", pending: { ...pending, state: "sending", sentAt: Date.now() } });
			try {
				const params = { input: pending.input, requestId: pending.requestId, turnId: pending.turnId, wait: false, ...extra };
				const admitted = await rpc<Admission>(agent, method, params, sessionId, pending.turnId);
				dispatch({ type: "admitted", requestId: pending.requestId, ...(admitted.submissionId === undefined ? {} : { submissionId: admitted.submissionId }), ...(admitted.placement === undefined ? {} : { placement: admitted.placement }) });
			} catch (error) {
				dispatch({ type: "send-failed", requestId: pending.requestId, reason: error instanceof ApiError ? error.message : reasonOf(error) });
			}
		},
		[agent, sessionId],
	);

	const compose = (input: PromptInput, text: string, images: number): Pending => ({
		requestId: crypto.randomUUID(),
		turnId: newTurnId(),
		text,
		images,
		input,
		state: "sending",
		sentAt: Date.now(),
	});

	/** Idle starts a run. Running work takes the message at its next boundary. In a call it waits its turn, so it can't cut off speech. */
	const send = useCallback(
		(input: PromptInput, text: string, images: number, busy: boolean) => {
			if (voice.inCall) return submit(compose(input, text, images), "session.prompt", { whenBusy: "followUp" });
			return submit(compose(input, text, images), busy ? "session.steer" : "session.prompt");
		},
		[submit, voice.inCall],
	);

	/** Running tools finish, so the model hears the truth about what they did. */
	const stopAndSend = useCallback(
		(input: PromptInput, text: string, images: number) => submit(compose(input, text, images), "session.interrupt", { duringTools: "steer" }),
		[submit],
	);

	const retry = useCallback((pending: Pending) => submit(pending, "session.prompt"), [submit]);

	const stop = useCallback((tasks = false) => rpc(agent, "session.cancel", { tasks }, sessionId), [agent, sessionId]);
	const resume = useCallback(() => rpc(agent, "session.retry", {}, sessionId), [agent, sessionId]);

	const loadEarlier = useCallback(async () => {
		if (state.earlier === undefined) return;
		const page = await rpc<Page>(agent, "session.messages", { limit: PAGE, cursor: state.earlier }, sessionId);
		dispatch({ type: "older", messages: page.messages, ...(page.nextCursor === undefined ? {} : { earlier: page.nextCursor }) });
	}, [agent, sessionId, state.earlier]);

	const details = useCallback(() => rpc<SessionDetails>(agent, "session.get", {}, sessionId), [agent, sessionId]);
	const discard = useCallback((requestId: string) => dispatch({ type: "discard", requestId }), []);

	return { state, send, stopAndSend, retry, stop, resume, loadEarlier, details, discard };
}
