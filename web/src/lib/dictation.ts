// Dictation for a voice message: the microphone goes to the agent's voice socket,
// which sends back the text as it's heard. The socket is the gateway's
// /agent/voice, relayed by the backend; see ai-gateway's docs/voice-messages.md.

/** The clients' limit. The gateway allows a little more. */
export const MAX_SECONDS = 60;

export type DictationEvents = {
	/** Everything heard so far. Each replaces the last. */
	onText(text: string): void;
	/** The microphone or the socket failed before the end. */
	onError(reason: DictationError): void;
	/** The limit was reached, so the caller should finish. */
	onLimit(): void;
};

export type DictationError = "microphone" | "unavailable" | "failed" | "too_long" | "idle";

export type Dictation = {
	/** Stops recording and resolves with the final text, empty when nothing was heard. */
	finish(): Promise<string>;
	/** Stops and throws everything away. */
	cancel(): void;
};

type Frame = { type: "ready" } | { type: "interim"; text: string } | { type: "final"; text: string } | { type: "error"; code: string; text?: string };

export function voiceURL(agent: string, sessionId: string, lang: string): string {
	const scheme = location.protocol === "https:" ? "wss" : "ws";
	const query = new URLSearchParams({ session: sessionId });
	if (lang !== "") query.set("lang", lang);
	return `${scheme}://${location.host}/api/agents/${encodeURIComponent(agent)}/voice?${query}`;
}

/**
 * Starts recording at once and opens the socket alongside, so nothing said
 * while it connects is lost: audio waits here until the socket is open.
 */
export async function startDictation(agent: string, sessionId: string, lang: string, events: DictationEvents): Promise<Dictation> {
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
	} catch {
		throw new Error("microphone");
	}
	const context = new AudioContext();
	try {
		await context.audioWorklet.addModule("/dictation-worklet.js");
	} catch {
		stream.getTracks().forEach((track) => track.stop());
		void context.close();
		throw new Error("microphone");
	}
	const source = context.createMediaStreamSource(stream);
	const node = new AudioWorkletNode(context, "dictation");
	source.connect(node);

	const socket = new WebSocket(voiceURL(agent, sessionId, lang));
	socket.binaryType = "arraybuffer";
	const waiting: ArrayBuffer[] = [];
	let samples = 0;
	let recording = true;
	let settled = false;
	let finished: { resolve(text: string): void; reject(error: Error): void } | undefined;

	const stopRecording = () => {
		if (!recording) return;
		recording = false;
		node.port.onmessage = null;
		source.disconnect();
		node.disconnect();
		stream.getTracks().forEach((track) => track.stop());
		void context.close();
	};
	const end = (error?: DictationError, text = "") => {
		if (settled) return;
		settled = true;
		stopRecording();
		if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
		if (finished !== undefined) {
			if (error === undefined) finished.resolve(text);
			else finished.reject(Object.assign(new Error(error), { text }));
		} else if (error !== undefined) {
			events.onError(error);
		}
	};
	const send = (data: ArrayBuffer | string) => {
		if (socket.readyState === WebSocket.OPEN) socket.send(data);
		else if (typeof data !== "string") waiting.push(data);
	};

	node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
		samples += event.data.byteLength / 2;
		send(event.data);
		if (samples >= MAX_SECONDS * 16000) events.onLimit();
	};
	socket.onopen = () => {
		for (const chunk of waiting.splice(0)) socket.send(chunk);
		if (!recording && finished !== undefined) socket.send(JSON.stringify({ type: "commit" }));
	};
	socket.onmessage = (event: MessageEvent<string>) => {
		let frame: Frame;
		try {
			frame = JSON.parse(event.data) as Frame;
		} catch {
			return;
		}
		if (frame.type === "interim") events.onText(frame.text);
		else if (frame.type === "final") end(undefined, frame.text);
		else if (frame.type === "error") end(frame.code === "too_long" || frame.code === "idle" ? frame.code : "failed", frame.text ?? "");
	};
	// A refused handshake (no speech configured, signed out) is only an error event.
	socket.onerror = () => end("unavailable");
	socket.onclose = () => end("failed");

	return {
		finish() {
			return new Promise<string>((resolve, reject) => {
				if (settled) {
					reject(new Error("failed"));
					return;
				}
				finished = { resolve, reject };
				stopRecording();
				if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "commit" }));
			});
		},
		cancel() {
			if (settled) return;
			if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
			settled = true;
			stopRecording();
			socket.close();
		},
	};
}
