import { describe, expect, it } from "vitest";
import { type Action, composerMode, type ConversationState, initialState, type Pending, reducer } from "./reducer.ts";
import { SseParser } from "./stream.ts";

const run = (actions: Action[], from: ConversationState = initialState) => actions.reduce(reducer, from);
const event = (e: object, at = 1): Action => ({ type: "event", event: e as never, at });
const pending = (requestId: string, over: Partial<Pending> = {}): Pending => ({ requestId, turnId: "t", text: "hi", images: 0, input: "hi", state: "sending", sentAt: 0, ...over });

describe("streaming", () => {
	it("builds a reply from deltas, then takes message.end's text as final", () => {
		const state = run([event({ type: "text.delta", text: "Hel" }), event({ type: "text.delta", text: "lo" })]);
		expect(state.live).toBe("Hello");
		const done = reducer(state, event({ type: "message.end", text: "Hello!", stopReason: "stop" }));
		expect(done.live).toBe("");
		expect(done.lines).toMatchObject([{ role: "assistant", text: "Hello!" }]);
	});

	it("tracks a tool through to failure", () => {
		const state = run([event({ type: "tool.started", callId: "c1", name: "crm" }), event({ type: "tool.finished", callId: "c1", name: "crm", isError: true })]);
		expect(state.lines).toMatchObject([{ role: "tool", state: "failed" }]);
	});

	it("asks for the transcript on a snapshot and when a run ends", () => {
		expect(reducer(initialState, event({ type: "snapshot", busy: false, inbox: [], tasks: [] })).reload).toBe(1);
		expect(reducer(initialState, event({ type: "run.finished", submissionIds: [] })).reload).toBe(1);
	});

	it("takes the reply in progress from a snapshot, then carries on from it", () => {
		const state = run([event({ type: "snapshot", busy: true, inbox: [], tasks: [], partial: { turnId: "t1", messageId: "m1", text: "Hel" } }), event({ type: "text.delta", messageId: "m1", offset: 3, text: "lo" })]);
		expect(state.live).toBe("Hello");
	});

	it("drops a repeated delta and keeps the new part of an overlapping one", () => {
		const delta = (offset: number, text: string) => event({ type: "text.delta", messageId: "m1", offset, text });
		expect(run([delta(0, "Hel"), delta(0, "Hel")]).live).toBe("Hel");
		expect(run([delta(0, "Hel"), delta(1, "ello")]).live).toBe("Hello");
	});

	it("starts clean on a new message", () => {
		const state = run([event({ type: "text.delta", messageId: "m1", offset: 0, text: "old" }), event({ type: "text.delta", messageId: "m2", offset: 0, text: "new" })]);
		expect(state.live).toBe("new");
	});

	it("clears a partial reply on a snapshot, because message.end will correct it", () => {
		const state = run([event({ type: "text.delta", text: "partial" }), event({ type: "snapshot", busy: true, inbox: [], tasks: [] })]);
		expect(state.live).toBe("");
		expect(state.busy).toBe(true);
	});
});

describe("during a call", () => {
	const call: Action = { type: "call", inCall: true };
	const typed: Action = { type: "sending", pending: pending("r1", { turnId: "mine" }) };

	it("hides a spoken reply, however far ahead of the audio it runs", () => {
		const state = run([call, event({ type: "text.delta", turnId: "voice", messageId: "m1", offset: 0, text: "Hi" }), event({ type: "message.end", turnId: "voice", messageId: "m1", text: "Hi", stopReason: "stop" })]);
		expect(state.live).toBe("");
		expect(state.lines).toEqual([]);
	});

	it("hides a spoken reply a snapshot carries", () => {
		const state = run([call, event({ type: "snapshot", busy: true, inbox: [], tasks: [], partial: { turnId: "voice", messageId: "m1", text: "Hi" } })]);
		expect(state.live).toBe("");
	});

	it("shows a typed reply", () => {
		const state = run([call, typed, event({ type: "text.delta", turnId: "mine", messageId: "m1", offset: 0, text: "Hi" })]);
		expect(state.live).toBe("Hi");
	});

	it("shows text with no turn", () => {
		expect(run([call, event({ type: "text.delta", text: "Hi" })]).live).toBe("Hi");
	});

	it("shows every turn outside a call", () => {
		expect(run([event({ type: "text.delta", turnId: "voice", messageId: "m1", offset: 0, text: "Hi" })]).live).toBe("Hi");
	});

	it("reads the transcript when the call ends, for what it hid", () => {
		const during = run([call]);
		expect(reducer(during, { type: "call", inCall: false }).reload).toBe(during.reload + 1);
	});
});

describe("transcript reads", () => {
	it("shows what a background task reported", () => {
		const state = run([{ type: "transcript", messages: [{ id: 7, role: "task", kind: "report", taskId: "t1", name: "research", status: "done", text: "Found it" }], since: 0 }]);
		expect(state.lines).toMatchObject([{ key: "e7", role: "task", name: "research", text: "Found it" }]);
	});

	const user = { id: 3, role: "user" as const, text: "hi", requestId: "r1" };
	const reply = { id: 4, role: "assistant" as const, text: "Hello", stopReason: "stop" };

	it("replaces what events showed", () => {
		const state = run([event({ type: "message.end", text: "Hello", stopReason: "stop" }), { type: "transcript", messages: [user, reply], since: 1 }]);
		expect(state.lines.map((line) => line.key)).toEqual(["e3", "e4"]);
	});

	it("keeps when a reply was written and which model wrote it", () => {
		const live = reducer(initialState, event({ type: "message.end", text: "Hello", stopReason: "stop" }, 1_800_000_000_000));
		expect(live.lines).toMatchObject([{ role: "assistant", at: 1_800_000_000_000 }]);
		const read = run([{ type: "transcript", messages: [{ ...user, at: 5 }, { ...reply, at: 6, model: "qwen3.5-flash" }], since: 0 }]);
		expect(read.lines).toMatchObject([{ role: "user", at: 5 }, { role: "assistant", at: 6, model: "qwen3.5-flash" }]);
	});

	it("keeps an event that landed after the read began", () => {
		const state = run([event({ type: "tool.started", callId: "c9", name: "crm" }), { type: "transcript", messages: [user], since: 0 }]);
		expect(state.lines.map((line) => line.key)).toEqual(["e3", "tc9"]);
	});

	it("doesn't repeat a message the read already holds, however late it arrives", () => {
		const state = run([event({ type: "message.end", text: "Hello", stopReason: "stop" }), { type: "transcript", messages: [user, reply], since: 0 }]);
		expect(state.lines.map((line) => line.key)).toEqual(["e3", "e4"]);
	});

	it("places a queued message when its own turn starts, ahead of the reply", () => {
		const state = run([
			{ type: "sending", pending: pending("r1", { turnId: "t7", state: "queued", submissionId: 3 }) },
			event({ type: "run.started", turnId: "t7", submissionIds: [3] }),
			event({ type: "message.end", text: "Hi", stopReason: "stop", turnId: "t7" }),
		]);
		expect(state.pending).toEqual([]);
		expect(state.lines).toMatchObject([{ role: "user", text: "hi" }, { role: "assistant", text: "Hi" }]);
	});

	it("drops a pending message once the transcript has it, by request ID", () => {
		const state = run([{ type: "sending", pending: pending("r1") }, { type: "transcript", messages: [user], since: 0 }]);
		expect(state.pending).toEqual([]);
		expect(state.lines).toHaveLength(1);
	});

	it("keeps older pages across a reread of the newest", () => {
		const older = { id: 1, role: "user" as const, text: "first" };
		const state = run([
			{ type: "transcript", messages: [user, reply], earlier: "3", since: 0 },
			{ type: "older", messages: [older] },
			{ type: "transcript", messages: [user, reply, { id: 6, role: "assistant", text: "More", stopReason: "stop" }], earlier: "3", since: 0 },
		]);
		expect(state.lines.map((line) => line.key)).toEqual(["e1", "e3", "e4", "e6"]);
		expect(state.earlier).toBeUndefined();
	});
});

describe("sending", () => {
	it("moves an admitted message into the transcript", () => {
		const state = run([{ type: "sending", pending: pending("r1") }, { type: "admitted", requestId: "r1", submissionId: 7, placement: "placed" }]);
		expect(state.pending).toEqual([]);
		expect(state.lines).toMatchObject([{ role: "user", requestId: "r1" }]);
	});

	it("shows a queued steer as a chip until it leaves the inbox", () => {
		const queued = run([{ type: "sending", pending: pending("r1") }, { type: "admitted", requestId: "r1", submissionId: 7, placement: "queued" }, event({ type: "inbox", items: [{ id: 7, mode: "steer" }] })]);
		expect(queued.pending).toMatchObject([{ state: "queued" }]);
		const placed = reducer(queued, event({ type: "inbox", items: [] }));
		expect(placed.pending).toEqual([]);
		expect(placed.lines).toMatchObject([{ role: "user", text: "hi" }]);
	});

	it("reports a refusal, but not a stop the person asked for", () => {
		const queued = run([{ type: "sending", pending: pending("r1") }, { type: "admitted", requestId: "r1", submissionId: 7, placement: "queued" }]);
		expect(reducer(queued, event({ type: "submission", submissionId: 7, status: "unanswered", reason: "aborted" })).pending[0]!.state).toBe("queued");
		expect(reducer(queued, event({ type: "submission", submissionId: 7, status: "unanswered", reason: "limit" })).pending[0]).toMatchObject({ state: "failed", reason: "limit" });
	});
});

describe("composer", () => {
	const open = { ...initialState, status: "open" as const };

	it("follows the design's states", () => {
		expect(composerMode(initialState, 0)).toBe("reconnecting");
		expect(composerMode({ ...open, status: "signed-out" }, 0)).toBe("signed-out");
		expect(composerMode(open, 0)).toBe("idle");
		expect(composerMode({ ...open, busy: true, lastEventAt: 1000 }, 2000)).toBe("running");
	});

	it("calls a run stalled after a minute of silence, and any event revives it", () => {
		const quiet = { ...open, busy: true, lastEventAt: 1000 };
		expect(composerMode(quiet, 62_000)).toBe("stalled");
		expect(composerMode({ ...quiet, lastEventAt: 61_000 }, 62_000)).toBe("running");
	});
});

describe("SseParser", () => {
	it("joins frames split across chunks and ignores keep-alives", () => {
		const parser = new SseParser();
		expect(parser.push(": keep-alive\n\nid: a-1\nevent: mess")).toEqual([]);
		expect(parser.push('age\ndata: {"x":1}\n\nid: a-2\ndata: 2\n\n')).toEqual([{ id: "a-1", data: '{"x":1}' }, { id: "a-2", data: "2" }]);
	});
});

describe("temporary progress", () => {
	const ack = { type: "progress", submissionIds: [1, 2], phase: "working", text: "Working on it." };
	it("replaces and deduplicates status without adding chat history", () => {
		const state = run([event(ack), event(ack), event({ ...ack, phase: "waiting", text: "Still working." })]);
		expect(state.progress).toEqual({ 1: "Still working.", 2: "Still working." });
		expect(state.lines).toEqual([]);
		expect(state.live).toBe("");
		const done = run([event({ type: "submission", submissionId: 1, status: "done" })], state);
		expect(done.progress).toEqual({ 2: "Still working." });
		expect(run([event({ type: "progress", submissionIds: [2], phase: "finished", text: "" })], done).progress).toEqual({});
	});
	it("restores snapshots and clears on idle, cancellation, and run completion", () => {
		const state = run([event({ type: "snapshot", busy: true, inbox: [], tasks: [], progress: ack })]);
		expect(state.progress).toEqual({ 1: "Working on it.", 2: "Working on it." });
		expect(run([event({ type: "snapshot", busy: false, inbox: [], tasks: [] })], state).progress).toEqual({});
		expect(run([event({ type: "run.finished", submissionIds: [1, 2] })], state).progress).toEqual({});
		expect(run([event({ type: "submission", submissionId: 1, status: "unanswered", reason: "aborted" })], state).progress).toEqual({ 2: "Working on it." });
	});

	it("tracks live flow execution traces from snapshot and flow.updated events", () => {
		const trace = {
			runId: "r1",
			skillName: "customer-visit-preparation",
			mode: "deterministic" as const,
			status: "completed" as const,
			startedAt: 1000,
			finishedAt: 1020,
			durationMs: 20,
			llmCallsSaved: 3,
			parallelToolsRun: 6,
			flow: {
				id: "customer-visit-preparation",
				title: "Visit Prep",
				mode: "deterministic" as const,
				nodes: [{ id: "start", kind: "start" as const, label: "Start" }],
				edges: [],
			},
			steps: { start: { nodeId: "start", status: "completed" as const, durationMs: 1 } },
		};
		const fromEvent = run([event({ type: "flow.updated", trace })]);
		expect(fromEvent.flow?.skillName).toBe("customer-visit-preparation");
		expect(fromEvent.flow?.parallelToolsRun).toBe(6);

		const fromSnapshot = run([event({ type: "snapshot", busy: false, inbox: [], tasks: [], flow: trace })]);
		expect(fromSnapshot.flow?.llmCallsSaved).toBe(3);
	});
});
