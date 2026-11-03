import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, FileText, type LucideIcon, Mail, MessageSquare, PartyPopper, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Composer } from "../conversation/Composer.tsx";
import { rpc } from "../lib/api.ts";
import { type SessionInfo, startConversation, titleOf } from "../lib/agent.ts";
import { useI18n } from "../lib/i18n.tsx";
import { load } from "../lib/storage.ts";
import { useModules, useResultAction } from "../modules/index.tsx";
import { displayName, useRefreshSessions, useSessions, useWorkspace } from "./workspace.ts";

const FINISHED_WINDOW_MS = 7 * 86_400_000;
const RECENT = 4;
/** Finished conversations can run to dozens, which would push everything else off the page. */
const FINISHED_SHOWN = 3;

const STARTERS: { icon: LucideIcon; label: string; prompt: string }[] = [
	{ icon: FileText, label: "Summarize a document", prompt: "Summarize this document and list the key points:\n\n" },
	{ icon: Mail, label: "Draft an email", prompt: "Draft a clear, friendly email about: " },
	{ icon: CalendarDays, label: "Plan my week", prompt: "Help me plan my week. Here's what's on my plate:\n\n" },
	{ icon: Search, label: "Research a topic", prompt: "Research this topic and give me a short briefing: " },
];

/** Finished since this browser last opened it. Seen state is a convenience, so it stays here. */
function finished(sessions: SessionInfo[]): SessionInfo[] {
	const now = Date.now();
	return sessions.filter((session) => {
		if (session.busy || now - session.lastActiveAt > FINISHED_WINDOW_MS) return false;
		return Number(load(`seen:${session.sessionId}`) ?? 0) < session.lastActiveAt;
	});
}

function greeting(): string {
	const hour = new Date().getHours();
	if (hour < 5) return "Working late, {name}";
	if (hour < 12) return "Good morning, {name}";
	return hour < 18 ? "Good afternoon, {name}" : "Good evening, {name}";
}

export function Home() {
	const { t, ago, describe } = useI18n();
	const { agent, agents, setAgent, profile, me, path, signedOut } = useWorkspace();
	const modules = useModules();
	const resultAction = useResultAction();
	const navigate = useNavigate();
	const refresh = useRefreshSessions();
	const sessions = useSessions();
	const [taskFrom, setTaskFrom] = useState<string>();
	const [suggestion, setSuggestion] = useState<{ text: string; id: number }>();
	const [showAll, setShowAll] = useState(false);
	const skills = useQuery({ queryKey: ["skills", agent], queryFn: () => rpc<{ skills: { name: string; description: string }[] }>(agent, "skills.list"), staleTime: 300_000 });
	const start = useMutation({
		mutationFn: ({ input, text }: { input: Parameters<typeof startConversation>[2]; text: string }) => startConversation(agent, profile, input, titleOf(text)),
		onSuccess: (sessionId) => {
			refresh();
			navigate(path(`c/${sessionId}`));
		},
	});
	const openTask = useMutation({
		mutationFn: async (session: SessionInfo) => {
			const page = await rpc<{ messages: { role: string; text?: string }[] }>(agent, "session.messages", { limit: 10 }, session.sessionId);
			return page.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? "";
		},
		onSuccess: setTaskFrom,
	});
	const done = finished(sessions.data ?? []);
	const firstRun = sessions.isSuccess && sessions.data.length === 0;
	const recent = [...(sessions.data ?? [])].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, RECENT);
	const firstName = displayName(me).split(/[\s@]/)[0] ?? "";
	const applyStarter = (text: string) => setSuggestion((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));

	return (
		<div className="page home">
			<header className="hero">
				<h1>{t(greeting(), { name: firstName })}</h1>
				<p>{t("What would you like to get done?")}</p>
			</header>
			<label className="with-label home-agent">{t("Agent")}
				<select value={agent} disabled={start.isPending} onChange={(event) => setAgent(event.target.value)}>
					{agents.map((option) => <option key={option.name} value={option.name}>{option.title ?? option.name}</option>)}
				</select>
			</label>
			<Composer
				suggestion={suggestion}
				draftKey="home"
				mode={signedOut ? "signed-out" : "idle"}
				placeholder={t("Ask your agent")}
				autoFocus
				onSend={async (input, text) => { await start.mutateAsync({ input, text: text || t("New conversation") }); }}
				onSignIn={() => window.location.assign("/auth/login")}
			/>
			{start.isError && (
				<p className="inline-error" role="alert">
					{describe(start.error)}
				</p>
			)}
			<ul className="starters" aria-label={t("Suggestions")}>
				{STARTERS.map((starter) => (
					<li key={starter.label}>
						<button type="button" disabled={start.isPending} onClick={() => applyStarter(t(starter.prompt))}>
							<starter.icon size={15} aria-hidden="true" />
							{t(starter.label)}
						</button>
					</li>
				))}
			</ul>
			{firstRun && (skills.data?.skills.length ?? 0) > 0 && (
				<section>
					<h2>{t("What can I do?")}</h2>
					<ul className="rows">
						{skills.data?.skills.map((skill) => (
							<li key={skill.name} className="row">
								<div className="row-main">
									<span>{skill.name}</span>
									<span className="quiet">{skill.description}</span>
								</div>
							</li>
						))}
					</ul>
				</section>
			)}
			{(
				<section className="always">
					<h2>{t("Needs you")}</h2>
					<ul className="rows" data-empty={t("You're all caught up.")}>
						{sessions.isPending && <li className="row" role="status">{t("Loading…")}</li>}
						{sessions.isError && <li className="row" role="alert">{t("Couldn't load this. Try again.")} <button type="button" className="link" onClick={() => void sessions.refetch()}>{t("Retry")}</button></li>}
						{modules.map(({ id, HomeRows }) => HomeRows !== undefined && <HomeRows key={id} />)}
						{(showAll ? done : done.slice(0, FINISHED_SHOWN)).map((session) => (
							<li key={session.sessionId} className="row">
								<span className="row-icon ok">
									<PartyPopper size={16} aria-hidden="true" />
								</span>
								<div className="row-main">
									<Link to={path(`c/${session.sessionId}`)}>{t("Your agent finished {title}", { title: session.metadata?.title ?? t("New conversation") })}</Link>
								</div>
								{resultAction !== undefined && (
									<div className="row-actions">
										<button type="button" className="ghost" onClick={() => openTask.mutate(session)}>
											<resultAction.icon size={15} aria-hidden="true" />
											{t(resultAction.label)}
										</button>
									</div>
								)}
							</li>
						))}
						{!showAll && done.length > FINISHED_SHOWN && (
							<li className="row more">
								<button type="button" className="link" onClick={() => setShowAll(true)}>
									{t("Show {n} more", { n: done.length - FINISHED_SHOWN })}
								</button>
							</li>
						)}
					</ul>
				</section>
			)}
			{recent.length > 0 && (
				<section>
					<h2>{t("Pick up where you left off")}</h2>
					<ul className="recent-grid">
						{recent.map((session) => (
							<li key={session.sessionId}>
								<Link to={path(`c/${session.sessionId}`)} aria-label={session.metadata?.title ?? t("New conversation")}>
									<MessageSquare size={15} aria-hidden="true" />
									<span className="recent-title">{session.metadata?.title ?? t("New conversation")}</span>
									<span className="quiet">{ago(session.lastActiveAt)}</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
			{taskFrom !== undefined && resultAction !== undefined && <resultAction.Dialog text={taskFrom} onClose={() => setTaskFrom(undefined)} />}
		</div>
	);
}
