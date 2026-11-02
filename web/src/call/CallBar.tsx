import { CircleAlert, LoaderCircle, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { useI18n } from "../lib/i18n.tsx";
import type { CallPhase } from "./useCall.ts";

const LABELS: Partial<Record<CallPhase, string>> = {
	joining: "Joining the call…",
	listening: "Listening",
	idle: "Listening",
	thinking: "Thinking",
	speaking: "Speaking",
	interrupted: "Interrupted",
	"no-agent": "The voice agent hasn't joined this room.",
	failed: "This call can't start.",
	"no-microphone": "Allow the microphone to start a call.",
};

type Props = { phase: CallPhase; muted: boolean; onToggleMute(): void; onEnd(): void };

function PhaseIcon({ phase }: { phase: CallPhase }) {
	switch (phase) {
		case "joining":
		case "thinking":
			return <LoaderCircle size={16} className="spin" />;
		case "speaking":
			return <Volume2 size={16} />;
		case "no-agent":
		case "failed":
		case "no-microphone":
			return <CircleAlert size={16} />;
		default:
			return <Mic size={16} />;
	}
}

export function CallBar({ phase, muted, onToggleMute, onEnd }: Props) {
	const { t } = useI18n();
	const stopped = phase === "failed" || phase === "no-microphone";
	return (
		<div className={`call-bar ${phase}`} role="status">
			<span className="call-icon" aria-hidden="true">
				<PhaseIcon phase={phase} />
			</span>
			<span className="call-state">{t(LABELS[phase] ?? "")}</span>
			<span className="spacer" />
			{!stopped && (
				<button type="button" className="ghost small" onClick={onToggleMute} aria-pressed={muted}>
					{muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
					{t(muted ? "Unmute" : "Mute")}
				</button>
			)}
			<button type="button" className={stopped ? "ghost small" : "danger small"} onClick={onEnd}>
				{!stopped && <PhoneOff size={14} aria-hidden="true" />}
				{t(stopped ? "Close" : "End call")}
			</button>
		</div>
	);
}
