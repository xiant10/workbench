import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { rpc } from "../lib/api.ts";
import { createConversation, titleOf } from "../lib/agent.ts";
import { useI18n } from "../lib/i18n.tsx";
import { useFeedback } from "../lib/ui.tsx";
import { useRefreshSessions, useWorkspace } from "../shell/workspace.ts";
import { CallBar } from "./CallBar.tsx";
import { type CallPhase, useCall } from "./useCall.ts";

/** The browser won't give a new voice conversation the microphone. Nothing was created. */
export class MicrophoneRefused extends Error {}

type CallState = {
	phase: CallPhase;
	interim: string;
	reply: { id: number; text: string };
	heard: { id: number; text: string }[];
	muted: boolean;
	/** Nothing said on either side yet, so the caller may not know it's their turn. */
	quiet: boolean;
};

type Calls = CallState & {
	/** The conversation the call is on, while there is one. */
	sessionId?: string;
	/** A call on a conversation, ending one on another conversation if the person agrees. */
	start(sessionId: string): Promise<void>;
	/** A new conversation that starts with a call. Throws MicrophoneRefused before creating anything. */
	startNew(): Promise<void>;
	end(): void;
	toggleMute(): void;
};

const OFF: CallState = { phase: "off", interim: "", reply: { id: 0, text: "" }, heard: [], muted: false, quiet: true };

export function live(phase: CallPhase): boolean {
	return phase !== "off" && phase !== "failed" && phase !== "no-microphone";
}

const CallContext = createContext<Calls | undefined>(undefined);

/**
 * The call belongs to the shell, not to a page: it starts in the click that asked for it, which the browser needs before
 * it plays the agent's voice, and it goes on while the person looks at something else.
 */
export function CallProvider({ children }: { children: ReactNode }) {
	const { t, language } = useI18n();
	const { agent, profile, path } = useWorkspace();
	const { confirm, toast } = useFeedback();
	const navigate = useNavigate();
	const location = useLocation();
	const refresh = useRefreshSessions();
	const call = useCall(language);
	const { phase, start: join, end, toggleMute } = call;
	const [sessionId, setSessionId] = useState<string>();
	/** A conversation this call created, until it has a title from what was said or is closed for having none. */
	const fresh = useRef<{ sessionId: string; agent: string; titled: boolean }>();
	const where = useRef(location.pathname);
	where.current = location.pathname;

	// A conversation started by voice that ended with nothing said is nothing to keep.
	const settle = useCallback(async () => {
		const started = fresh.current;
		fresh.current = undefined;
		if (started === undefined || started.titled) return;
		const page = await rpc<{ messages: { role: string }[] }>(started.agent, "session.messages", { limit: 10 }, started.sessionId).catch(() => undefined);
		if (page === undefined || page.messages.some((message) => message.role === "user")) return;
		await rpc(started.agent, "session.close", {}, started.sessionId).catch(() => undefined);
		refresh();
		if (where.current.endsWith(`/c/${started.sessionId}`)) {
			navigate(path());
			toast(t("Call ended. Nothing was said, so it wasn't kept."));
		}
	}, [navigate, path, refresh, t, toast]);

	useEffect(() => {
		if (!live(phase)) void settle();
		if (phase === "off") setSessionId(undefined);
	}, [phase, settle]);

	// What the caller said first names the conversation, as the first typed message does.
	const first = call.heard[0]?.text;
	useEffect(() => {
		const started = fresh.current;
		if (first === undefined || started === undefined || started.titled) return;
		started.titled = true;
		void rpc(started.agent, "session.update", { title: titleOf(first) }, started.sessionId).then(refresh, () => undefined);
	}, [first, refresh]);

	/** Whether a call may start, which ends one on another conversation if the person agrees. */
	const takeOver = useCallback(
		async (next?: string) => {
			if (sessionId === undefined || sessionId === next || !live(phase)) return true;
			const yes = await confirm({ title: t("End the current call?"), body: t("A call is going on in another conversation. Starting this one ends it."), action: t("End call and start") });
			if (!yes) return false;
			end();
			await settle();
			return true;
		},
		[confirm, end, phase, sessionId, settle, t],
	);

	const start = useCallback(
		async (next: string) => {
			if (!(await takeOver(next))) return;
			end();
			setSessionId(next);
			await join(`conv-${next}`);
		},
		[end, join, takeOver],
	);

	const startNew = useCallback(async () => {
		if (!(await takeOver())) return;
		// Asked here, where the person pressed the button, so a refusal leaves no empty conversation behind.
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of stream.getTracks()) track.stop();
		} catch {
			throw new MicrophoneRefused();
		}
		const created = await createConversation(agent, profile, t("Voice conversation"));
		end();
		fresh.current = { sessionId: created, agent, titled: false };
		setSessionId(created);
		void join(`conv-${created}`);
		refresh();
		navigate(path(`c/${created}`));
	}, [agent, end, join, navigate, path, profile, refresh, t, takeOver]);

	const value = useMemo<Calls>(
		() => ({
			phase,
			interim: call.interim,
			reply: call.reply,
			heard: call.heard,
			muted: call.muted,
			quiet: call.heard.length === 0 && call.reply.text === "" && call.interim === "",
			...(sessionId === undefined ? {} : { sessionId }),
			start,
			startNew,
			end,
			toggleMute,
		}),
		[phase, call.interim, call.reply, call.heard, call.muted, end, toggleMute, sessionId, start, startNew],
	);
	return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCalls(): Calls {
	const calls = useContext(CallContext);
	if (calls === undefined) throw new Error("useCalls needs CallProvider");
	return calls;
}

/** The call as one conversation sees it: its own, or off when the call is on another conversation. */
export function useCallOn(sessionId: string) {
	const calls = useCalls();
	const mine = calls.sessionId === sessionId;
	return { ...(mine ? calls : OFF), start: () => calls.start(sessionId), end: calls.end, toggleMute: calls.toggleMute };
}

/** The call, shown on every page but its own conversation's, with the way back to it. */
export function CallElsewhere() {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const calls = useCalls();
	const location = useLocation();
	if (calls.sessionId === undefined || !live(calls.phase) || location.pathname.endsWith(`/c/${calls.sessionId}`)) return null;
	return (
		<CallBar phase={calls.phase} muted={calls.muted} quiet={calls.quiet} onToggleMute={calls.toggleMute} onEnd={calls.end}>
			<Link className="button ghost small" to={path(`c/${calls.sessionId}`)}>
				{t("Back to the call")}
			</Link>
		</CallBar>
	);
}
