import { useQuery } from "@tanstack/react-query";
import { Archive, CircleAlert, MessageSquareOff, PanelRight, Phone, PhoneOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CallBar } from "../call/CallBar.tsx";
import { useCall } from "../call/useCall.ts";
import { type PromptInput, supports } from "../lib/agent.ts";
import { rpc } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { save } from "../lib/storage.ts";
import { Empty } from "../lib/ui.tsx";
import { useModules, useResultAction } from "../modules/index.ts";
import { type Output, outputsOf } from "../results/outputs.ts";
import { ResultsPanel, type ResultsTab } from "../results/ResultsPanel.tsx";
import { useRefreshSessions, useSessions, useWorkspace } from "../shell/workspace.ts";
import { Composer } from "./Composer.tsx";
import { composerMode } from "./reducer.ts";
import { Transcript } from "./Transcript.tsx";
import { useConversation } from "./useConversation.ts";

const CLOCK_MS = 5000;
/** Wide enough for all three panes at once. Below this, results open only when asked for. */
const THREE_PANES_PX = 1100;

export function ConversationPage() {
	const { sessionId = "" } = useParams();
	// A new conversation is new state: a new stream, a new reducer, a new draft.
	return <Conversation key={sessionId} sessionId={sessionId} />;
}

function Conversation({ sessionId }: { sessionId: string }) {
	const { t } = useI18n();
	const { agent, config, signedOut, path } = useWorkspace();
	const modules = useModules();
	const resultAction = useResultAction();
	const open = useSessions();
	const archivedList = useSessions(true);
	const refresh = useRefreshSessions();
	const session = open.data?.find((item) => item.sessionId === sessionId) ?? archivedList.data?.find((item) => item.sessionId === sessionId);
	const archived = session?.archived === true;

	const call = useCall(`conv-${sessionId}`);
	const inCall = call.phase !== "off" && call.phase !== "failed" && call.phase !== "no-microphone";
	const voice = { inCall, speaking: call.phase === "thinking" || call.phase === "speaking" };
	const { state, send, stopAndSend, retry, stop, resume, loadEarlier, details, discard } = useConversation(agent, sessionId, archived, voice);
	// The room's reply stands in until the message itself is read, which is when an assistant line appears beyond these.
	const assistants = state.lines.filter((line) => line.role === "assistant").length;
	const replyBase = useRef({ id: 0, assistants });
	if (replyBase.current.id !== call.reply.id) replyBase.current = { id: call.reply.id, assistants };
	// Likewise for each thing the caller said: it stands in until a user line beyond these has been read.
	const users = state.lines.filter((line) => line.role === "user").length;
	const heardBase = useRef(new Map<number, number>());
	for (const item of call.heard) if (!heardBase.current.has(item.id)) heardBase.current.set(item.id, users);
	if (call.heard.length === 0) heardBase.current.clear();
	const heard = call.heard.filter((item) => users <= (heardBase.current.get(item.id) ?? users)).map((item) => item.text);
	const spoken = assistants > replyBase.current.assistants ? "" : call.reply.text;
	const [now, setNow] = useState(Date.now);
	const [resultsChoice, setResultsOpen] = useState<boolean>();
	const [tab, setTab] = useState<ResultsTab>("outputs");
	const [selected, setSelected] = useState<Output>();
	const [taskText, setTaskText] = useState<string>();

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		if (state.settled > 0) refresh();
	}, [state.settled]); // eslint-disable-line react-hooks/exhaustive-deps
	// Opening it marks it seen, so Home stops listing it as finished.
	useEffect(() => save(`seen:${sessionId}`, String(Date.now())), [sessionId, state.settled]);

	const info = useQuery({ queryKey: ["session", sessionId, state.settled], queryFn: details, enabled: state.status === "open", retry: false });
	const outputs = useMemo(() => state.lines.flatMap((line) => (line.role === "assistant" ? outputsOf(line.key, line.text) : [])), [state.lines]);
	const mode = signedOut ? "signed-out" : composerMode(state, now);
	const queued = state.pending.filter((item) => item.state === "queued");
	const stalled = state.pending.find((item) => item.state === "sending");
	const title = session?.metadata?.title ?? t("New conversation");
	const resultCount = outputs.length + state.tasks.length;
	// An empty pane only takes room from the reply, so it waits until there's something in it.
	const resultsOpen = resultsChoice ?? (resultCount > 0 && window.innerWidth >= THREE_PANES_PX);
	const sendResult = resultAction === undefined ? {} : { resultAction: { label: resultAction.label, icon: resultAction.icon, run: setTaskText } };

	if (state.status === "gone") {
		return (
			<div className="page">
				<Empty icon={MessageSquareOff} title={t("This conversation is gone.")}>
					<Link className="button primary" to={path()}>
						{t("New conversation")}
					</Link>
				</Empty>
			</div>
		);
	}

	return (
		<div className="conversation">
			<div className="conversation-main">
				<header className="conversation-head">
					<h1>{title}</h1>
					{session !== undefined && modules.map(({ id, SessionChip }) => SessionChip !== undefined && <SessionChip key={id} session={session} />)}
					<span className="spacer" />
					{config.voice && !archived && (inCall || supports(session, "voice")) && (
						<button type="button" className="ghost" aria-label={t(call.phase === "off" ? "Call" : "End call")} onClick={() => (call.phase === "off" ? void call.start() : call.end())}>
							{call.phase === "off" ? <Phone size={15} aria-hidden="true" /> : <PhoneOff size={15} aria-hidden="true" />}
							<span className="label">{t(call.phase === "off" ? "Call" : "End call")}</span>
						</button>
					)}
					<button type="button" className="ghost" onClick={() => setResultsOpen(!resultsOpen)} aria-label={t("Results")} aria-expanded={resultsOpen}>
						<PanelRight size={15} aria-hidden="true" />
						<span className="label">{t("Results")}</span>
						{resultCount > 0 && <span className="badge">{resultCount}</span>}
					</button>
				</header>
				{call.phase !== "off" && <CallBar phase={call.phase} muted={call.muted} onToggleMute={call.toggleMute} onEnd={call.end} />}
				{(info.data?.parked ?? 0) > 0 && (
					<div className="banner">
						<CircleAlert size={15} aria-hidden="true" />
						{t("No reply yet. It may be stalled.")}{" "}
						<button type="button" className="link" onClick={() => void resume()}>
							{t("Resume stalled work")}
						</button>
					</div>
				)}
				<Transcript
					state={state}
					spoken={spoken}
					heard={heard}
					interim={call.interim}
					onOpenOutput={(output) => {
						setSelected(output);
						setTab("outputs");
						setResultsOpen(true);
					}}
					{...sendResult}
					onRetry={(pending) => void retry(pending)}
					onDiscard={discard}
					onLoadEarlier={() => void loadEarlier()}
				/>
				{archived ? (
					<div className="banner">
						<Archive size={15} aria-hidden="true" />
						{t("This conversation is archived.")}{" "}
						<button
							type="button"
							className="link"
							onClick={() => void rpc(agent, "session.update", { archived: false }, sessionId).then(() => refresh())}
						>
							{t("Restore")}
						</button>
					</div>
				) : (
					<Composer
						draftKey={sessionId}
						mode={mode}
						inCall={inCall}
						canAddToRun={supports(session, "steer")}
						placeholder={!state.busy ? t("Ask your agent") : supports(session, "steer") ? t("Add to this run…") : t("Wait for this run to finish")}
						queued={queued}
						autoFocus
						onSend={(input, text, images) => void send(input, text, images, state.busy).then(refresh)}
						onStop={() => void stop()}
						{...(supports(session, "interrupt") ? { onStopAndSend: (input: PromptInput, text: string, images: number) => void stopAndSend(input, text, images) } : {})}
						{...(stalled === undefined ? {} : { onRetry: () => void retry(stalled) })}
						onEndCall={call.end}
						onSignIn={() => window.location.assign(`/auth/login?next=${encodeURIComponent(path(`c/${sessionId}`))}`)}
					/>
				)}
			</div>
			{resultsOpen && <div className="sheet-backdrop" onClick={() => setResultsOpen(false)} />}
			{resultsOpen && (
				<ResultsPanel
					state={state}
					outputs={outputs}
					{...(selected === undefined ? {} : { selected })}
					tab={tab}
					{...(info.data === undefined ? {} : { details: info.data })}
					onTab={setTab}
					onSelect={setSelected}
					onClose={() => setResultsOpen(false)}
					{...sendResult}
					onStopTasks={() => void stop(true)}
				/>
			)}
			{taskText !== undefined && resultAction !== undefined && <resultAction.Dialog text={taskText} onClose={() => setTaskText(undefined)} />}
		</div>
	);
}
