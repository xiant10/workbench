import { ConnectionState, type Participant, type RemoteTrack, Room, RoomEvent, type TextStreamReader, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, postJSON } from "../lib/api.ts";

/** Topic and attribute names copied from `internal/roomprotocol` in t10-livekit-agent and t10-mac-client. */
const TOPIC = { transcript: "agent.transcript", interim: "agent.transcript.interim", chat: "agent.chat", state: "agent.state" } as const;
const ATTR_AGENT_STATE = "lk.agent.state";

/** Silence is the failure mode: an empty room says so instead of looking like a quiet agent. */
const AGENT_WAIT_MS = 15_000;

export type CallPhase = "off" | "joining" | "listening" | "thinking" | "speaking" | "interrupted" | "idle" | "no-agent" | "failed" | "no-microphone";

type Admission = { room_token: string; server_url: string };

/** One update per JSONL line. Each replaces the one before it. */
function lastSnapshot(text: string): string | undefined {
	const lines = text.trim().split("\n");
	try {
		return (JSON.parse(lines.at(-1) ?? "") as { text?: string }).text;
	} catch {
		return undefined;
	}
}

/**
 * What the call tells the agent about itself, for its greeting: the caller's language and time zone, and the screen the
 * call starts from. The auth service puts them in the room token as t10.client.* attributes.
 */
function callClient(language: string): Record<string, string> {
	const client: Record<string, string> = { locale: language === "zh" ? "zh-Hans" : "en", screen: document.title.slice(0, 200) };
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (timeZone) client.timeZone = timeZone;
	return client;
}

export function useCall(language = "en") {
	const [phase, setPhase] = useState<CallPhase>("off");
	/** The caller's words so far in the utterance being spoken, which the agent revises until it is final. */
	const [interim, setInterim] = useState("");
	/** The agent's reply as the room delivers it, in step with the audio. `id` moves on at each new reply. */
	/** What the agent heard the caller say, one entry per utterance, as soon as it was final. */
	const [heard, setHeard] = useState<{ id: number; text: string }[]>([]);
	const [reply, setReply] = useState({ id: 0, text: "" });
	const [muted, setMuted] = useState(false);
	const current = useRef<Room | undefined>(undefined);
	const audio = useRef<HTMLElement[]>([]);
	/** Moves on at each start and each end, so a start still running can tell it no longer counts. */
	const attempt = useRef(0);
	const replies = useRef(0);
	const heards = useRef(0);

	const end = useCallback(() => {
		attempt.current++;
		const active = current.current;
		current.current = undefined;
		void active?.disconnect();
		for (const element of audio.current.splice(0)) element.remove();
		setPhase("off");
		setInterim("");
		setReply({ id: replies.current, text: "" });
		setHeard([]);
		setMuted(false);
	}, []);

	useEffect(() => end, [end]);

	const start = useCallback(async (room: string) => {
		const mine = ++attempt.current;
		const abandoned = () => attempt.current !== mine;
		setPhase("joining");
		try {
			const admission = await postJSON<Admission>("/api/voice/admission", { room, client: callClient(language) });
			if (abandoned()) return;
			const lk = new Room({ adaptiveStream: false, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
			current.current = lk;

			const showPhase = (next: CallPhase) => {
				if (current.current === lk) setPhase(next);
			};
			const showInterim = (text: string) => {
				if (current.current === lk) setInterim(text);
			};
			const setAgentState = (state: string | undefined) => {
				if (state === "listening" || state === "thinking" || state === "speaking" || state === "idle") showPhase(state);
			};
			lk.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
				if (track.kind !== Track.Kind.Audio) return;
				const element = track.attach();
				document.body.append(element);
				audio.current.push(element);
			});
			lk.on(RoomEvent.ParticipantAttributesChanged, (changed: Record<string, string>) => setAgentState(changed[ATTR_AGENT_STATE]));
			lk.on(RoomEvent.Disconnected, () => {
				if (current.current === lk) end();
			});

			const readAll = (reader: TextStreamReader, onChunk: (text: string) => void) => {
				void (async () => {
					let text = "";
					for await (const chunk of reader) {
						text += chunk.current;
						onChunk(text);
					}
				})();
			};
			lk.registerTextStreamHandler(TOPIC.interim, (reader) =>
				readAll(reader, (text) => {
					const snapshot = lastSnapshot(text);
					if (snapshot !== undefined) showInterim(snapshot);
				}),
			);
			lk.registerTextStreamHandler(TOPIC.transcript, (reader) => {
				void (async () => {
					let text = "";
					for await (const chunk of reader) {
						text += chunk.current;
					}
					const final = text.trim();
					showInterim("");
					if (final !== "" && current.current === lk) setHeard((held) => [...held, { id: ++heards.current, text: final }]);
				})();
			});
			lk.registerTextStreamHandler(TOPIC.chat, (reader) => {
				const id = ++replies.current;
				if (current.current === lk) setReply({ id, text: "" });
				readAll(reader, (text) => {
					if (current.current === lk) setReply({ id, text });
				});
			});
			lk.registerTextStreamHandler(TOPIC.state, (reader) =>
				readAll(reader, (text) => {
					const state = text.trim();
					if (state === "interrupted") showPhase("interrupted");
					else setAgentState(state);
				}),
			);

			await lk.connect(admission.server_url, admission.room_token);
			if (abandoned()) {
				void lk.disconnect();
				return;
			}
			const agent = (): Participant | undefined => [...lk.remoteParticipants.values()][0];
			// Armed before publishing, which can hang on a blocked media path. The call must never just sit at "joining".
			setTimeout(() => {
				if (lk.state === ConnectionState.Connected && agent() === undefined) showPhase("no-agent");
			}, AGENT_WAIT_MS);
			lk.on(RoomEvent.ParticipantConnected, (participant) => {
				showPhase("listening");
				setAgentState(participant.attributes[ATTR_AGENT_STATE]);
			});
			// An agent can go mid-call too. It says so, and ParticipantConnected picks up its return.
			lk.on(RoomEvent.ParticipantDisconnected, () => {
				if (agent() === undefined) showPhase("no-agent");
			});
			try {
				await lk.localParticipant.setMicrophoneEnabled(true);
			} catch (error) {
				if (abandoned()) return;
				console.warn("microphone refused", error);
				end();
				setPhase("no-microphone");
				return;
			}
			if (abandoned()) {
				void lk.disconnect();
				return;
			}
			await lk.startAudio().catch(() => undefined);

			const present = agent();
			if (present !== undefined) {
				showPhase("listening");
				setAgentState(present.attributes[ATTR_AGENT_STATE]);
			}
		} catch (error) {
			if (abandoned()) return;
			console.warn("call failed", error);
			end();
			if (error instanceof ApiError && error.status === 401) return;
			setPhase("failed");
		}
	}, [end, language]);

	const toggleMute = useCallback(() => {
		const next = !muted;
		setMuted(next);
		void current.current?.localParticipant.setMicrophoneEnabled(!next);
	}, [muted]);

	return { phase, interim, reply, heard, muted, start, end, toggleMute, active: current.current !== undefined };
}
