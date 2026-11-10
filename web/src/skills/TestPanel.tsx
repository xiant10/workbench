import { FlaskConical, Loader2, RotateCcw, Send, Wrench, X } from "lucide-react";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { Markdown } from "../conversation/Markdown.tsx";
import type { FlowRunTrace, TranscriptMessage } from "../lib/agent.ts";
import { newTurnId, rpc } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { WorkflowView } from "../results/WorkflowView.tsx";

const POLL_MS = 1_000;
/** Longest a test turn is waited for before the panel says it's still going. */
const WAIT_MS = 180_000;

/**
 * A private chat with the agent that uses the editor's draft: of one skill, or with `draft`, another of the agent's
 * drafts, such as `{ configDraft: true }` for the agent's customization. The agent reads a draft only for a
 * conversation whose owner wrote it, so nobody else's turns change. Test conversations stay out of the sidebar.
 */
export function TestPanel({ agent, name, draft, prepare, onClose }: { agent: string; name: string; draft?: Record<string, unknown>; prepare(): Promise<void>; onClose(): void }) {
	const { t, describe } = useI18n();
	const [sessionId, setSessionId] = useState<string>();
	const [messages, setMessages] = useState<TranscriptMessage[]>([]);
	const [trace, setTrace] = useState<FlowRunTrace>();
	const [input, setInput] = useState("");
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string>();
	const opened = useRef<string>();
	const end = useRef<HTMLDivElement>(null);

	// The conversations a panel opened are closed when it goes, so they don't pile up.
	useEffect(() => () => void (opened.current !== undefined && rpc(agent, "session.close", {}, opened.current).catch(() => undefined)), [agent]);
	// A block, not an expression: newer browsers return a Promise from scrollIntoView, and React would call it as cleanup.
	useEffect(() => {
		end.current?.scrollIntoView({ block: "end" });
	}, [messages, running]);

	const refresh = async (id: string) => {
		const [page, details] = await Promise.all([
			rpc<{ messages: TranscriptMessage[] }>(agent, "session.messages", { limit: 100 }, id),
			rpc<{ busy: boolean; flow?: FlowRunTrace }>(agent, "session.get", {}, id),
		]);
		// Newest last, as a chat reads.
		setMessages([...page.messages].sort((a, b) => a.id - b.id));
		setTrace(details.flow);
		return details.busy;
	};

	const send = async () => {
		const text = input.trim();
		if (text === "" || running) return;
		setRunning(true);
		setError(undefined);
		try {
			// The agent must read what the editor shows, so unsaved edits are saved first.
			await prepare();
			let id = sessionId;
			if (id === undefined) {
				({ sessionId: id } = await rpc<{ sessionId: string }>(agent, "session.create", { metadata: { title: t("Test: {name}", { name }), ...(draft ?? { skillDraft: name }) } }));
				opened.current = id;
				setSessionId(id);
			}
			setInput("");
			const turnId = newTurnId();
			setMessages((current) => [...current, { id: Number.MAX_SAFE_INTEGER, role: "user", text }]);
			await rpc(agent, "session.prompt", { input: text, requestId: crypto.randomUUID(), turnId, wait: false }, id, turnId);
			const started = Date.now();
			while (Date.now() - started < WAIT_MS) {
				await new Promise((resolve) => setTimeout(resolve, POLL_MS));
				if (!(await refresh(id))) break;
			}
		} catch (failure) {
			setError(failure instanceof Error ? describe(failure) : String(failure));
		} finally {
			setRunning(false);
		}
	};

	const restart = () => {
		if (opened.current !== undefined) void rpc(agent, "session.close", {}, opened.current).catch(() => undefined);
		opened.current = undefined;
		setSessionId(undefined);
		setMessages([]);
		setTrace(undefined);
		setError(undefined);
	};

	return (
		<aside className="skill-test" aria-label={t("Test this skill")} data-testid="skill-test">
			<header>
				<strong>
					<FlaskConical size={15} aria-hidden="true" /> {t("Test this skill")}
				</strong>
				<span>
					<button type="button" className="ghost small" onClick={restart} disabled={running || sessionId === undefined} aria-label={t("New test chat")}>
						<RotateCcw size={13} aria-hidden="true" />
					</button>
					<button type="button" className="ghost small" onClick={onClose} aria-label={t("Close")}>
						<X size={13} aria-hidden="true" />
					</button>
				</span>
			</header>
			<p className="quiet">{t("Only you, using your unpublished changes. Everyone else keeps the published version.")}</p>
			<div className="skill-test-log" data-testid="skill-test-log">
				{messages.map((message) =>
					message.role === "user" ? (
						<div key={`u${message.id}`} className="skill-test-user">
							{message.text}
						</div>
					) : message.role === "assistant" ? (
						<div key={`a${message.id}`} className="skill-test-agent">
							{message.text !== "" && <Markdown text={message.text} />}
							{message.error !== undefined && <span className="danger-text">{message.error}</span>}
						</div>
					) : message.role === "tool" ? (
						<div key={`t${message.id}`} className={message.isError ? "skill-test-tool failed" : "skill-test-tool"}>
							<Wrench size={12} aria-hidden="true" /> <code>{message.name}</code>
						</div>
					) : null,
				)}
				{running && (
					<div className="skill-test-agent quiet">
						<Loader2 size={13} className="spin" aria-hidden="true" /> {t("Working…")}
					</div>
				)}
				{error !== undefined && <div className="danger-text">{error}</div>}
				<div ref={end} />
			</div>
			{trace !== undefined && (
				<details className="skill-test-trace" open>
					<summary>{t("Workflow run")}</summary>
					<WorkflowView agent={agent} readOnly trace={trace} />
				</details>
			)}
			<form
				className="skill-test-input"
				onSubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<textarea
					rows={2}
					value={input}
					placeholder={t("Ask what a user would ask")}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							void send();
						}
					}}
					data-testid="skill-test-input"
				/>
				<button type="submit" className="primary small" disabled={running || input.trim() === ""} aria-label={t("Send")} data-testid="skill-test-send">
					<Send size={14} aria-hidden="true" />
				</button>
			</form>
		</aside>
	);
}

/** Keeps a failure inside the test panel to the panel, so the editor and its unpublished changes stay on screen. */
export class TestPanelBoundary extends Component<{ message: string; closeLabel: string; onClose(): void; children: ReactNode }, { failed: boolean }> {
	override state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	override render() {
		if (!this.state.failed) return this.props.children;
		return (
			<aside className="skill-test" role="alert">
				<p className="danger-text">{this.props.message}</p>
				<button type="button" className="ghost small" onClick={this.props.onClose} aria-label={this.props.closeLabel}>
					<X size={13} aria-hidden="true" />
				</button>
			</aside>
		);
	}
}
