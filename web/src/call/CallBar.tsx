import { Mic, MicOff, PhoneOff } from "lucide-react";
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

type Props = { phase: CallPhase; caption: string; muted: boolean; onToggleMute(): void; onEnd(): void };

export function CallBar({ phase, caption, muted, onToggleMute, onEnd }: Props) {
	const { t } = useI18n();
	const stopped = phase === "failed" || phase === "no-microphone";
	return (
		<div className={`call-bar ${phase}`} role="status">
			<span className="call-dot" aria-hidden="true" />
			<span className="call-state">{t(LABELS[phase] ?? "")}</span>
			<span className="call-caption">{caption}</span>
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
