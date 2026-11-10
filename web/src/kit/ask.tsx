import { MessageSquarePlus, Sparkles, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n.tsx";

export type AskMessage = { role: "user" | "assistant"; text: string };

/**
 * How one app reaches its assistant. Each app keeps its own way there, such as a service that checks consent before
 * anything leaves it, so the panel never talks to an agent itself.
 */
export type AskTransport = {
	/** One conversation read back: the latest, or the one named. */
	read(session?: string): Promise<{ session?: string; messages: AskMessage[] }>;
	/** Sends a turn. A refusal is what to show instead: nothing was sent, and what was typed stays. */
	send(turn: { text: string; session?: string; fresh: boolean; withContext: boolean }): Promise<{ session: string } | { refusal: ReactNode }>;
	/** Where the turn's server-sent events are: the agent's run events, as the app passes them on. */
	events(session: string): string;
	/** What a tool step means to a reader, if anything. */
	step?(tool: string): string | undefined;
};

type AgentEvent = { type: string; text?: string; delta?: string; name?: string };

type AskPanelProps = {
	transport: AskTransport;
	/** "inline" sits in a page, as one line to the assistant. "side" is the panel beside any page, with the conversation. */
	placement: "inline" | "side";
	/** The conversation to open; the latest when not given. */
	session?: string;
	/** What the person is looking at, offered with the message, such as "This household". They can take it off. */
	context?: string;
	placeholder: string;
	/** A failure the app knows better words for, such as a refusal for the account. */
	describe?(failure: unknown): string | undefined;
	/** After each turn, to refresh what the assistant may have changed, such as drafts. */
	onTurnEnd?(): void;
	onClose?(): void;
};

/** One way to talk to the assistant, in every app, beside whatever page is open. */
export function AskPanel({ transport, placement, session: opened, context, placeholder, describe, onTurnEnd, onClose }: AskPanelProps) {
	const { t } = useI18n();
	const side = placement === "side";
	const [session, setSession] = useState(opened);
	const [fresh, setFresh] = useState(false);
	const [messages, setMessages] = useState<AskMessage[]>([]);
	const [text, setText] = useState("");
	const [withContext, setWithContext] = useState(context !== undefined);
	const [running, setRunning] = useState(false);
	const [answer, setAnswer] = useState("");
	const [step, setStep] = useState("");
	const [error, setError] = useState("");
	const [refusal, setRefusal] = useState<ReactNode>();
	const stream = useRef<EventSource | null>(null);
	const said = useRef("");
	const end = useRef<HTMLDivElement>(null);

	useEffect(() => () => stream.current?.close(), []);
	useEffect(() => setWithContext(context !== undefined), [context]);
	// The side panel shows the conversation it continues. A failed read only means starting with nothing shown.
	useEffect(() => {
		if (!side) return;
		let live = true;
		transport.read(opened).then(
			(read) => {
				if (!live) return;
				setSession(read.session);
				setMessages(read.messages);
			},
			() => undefined,
		);
		return () => {
			live = false;
		};
	}, [side, opened, transport]);
	useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages, answer]);

	const finish = () => {
		stream.current?.close();
		stream.current = null;
		setRunning(false);
		setStep("");
		if (side && said.current !== "") {
			const reply = said.current;
			setMessages((so) => [...so, { role: "assistant", text: reply }]);
			setAnswer("");
		}
		said.current = "";
		onTurnEnd?.();
	};

	const follow = (id: string) => {
		const source = new EventSource(transport.events(id));
		stream.current = source;
		source.onmessage = (message) => {
			const event = JSON.parse(message.data as string) as AgentEvent;
			if (event.type === "tool.started") setStep(transport.step?.(event.name ?? "") ?? "Looking this up");
			if (event.type === "text.delta") said.current += event.delta ?? event.text ?? "";
			if (event.type === "message.end" && event.text !== undefined) said.current = event.text;
			if (event.type === "text.delta" || event.type === "message.end") setAnswer(said.current);
			if (event.type === "error") setError("The assistant stopped. What you typed is still here.");
			if (event.type === "run.finished") finish();
		};
		source.onerror = () => {
			if (source.readyState === EventSource.CLOSED) {
				setError("The assistant stopped. What you typed is still here.");
				finish();
			}
		};
	};

	const send = async (event: FormEvent) => {
		event.preventDefault();
		const typed = text;
		setRunning(true);
		setAnswer("");
		setError("");
		setRefusal(undefined);
		try {
			const result = await transport.send({ text: typed, ...(session === undefined ? {} : { session }), fresh, withContext });
			if ("refusal" in result) {
				setRefusal(result.refusal);
				setRunning(false);
				return;
			}
			setText("");
			setFresh(false);
			setSession(result.session);
			if (side) setMessages((so) => [...so, { role: "user", text: typed }]);
			follow(result.session);
		} catch (failure) {
			setError(describe?.(failure) ?? "The assistant is unavailable. What you typed is still here.");
			setRunning(false);
		}
	};

	const startOver = () => {
		stream.current?.close();
		stream.current = null;
		setSession(undefined);
		setFresh(true);
		setMessages([]);
		setAnswer("");
		setStep("");
		setError("");
		setRefusal(undefined);
		setRunning(false);
	};

	return (
		<section className={`ask ask-${placement}`} aria-label={t("Assistant")} data-testid={`ask-${placement}`}>
			{side && (
				<header className="ask-head">
					<h2>
						<Sparkles size={16} aria-hidden="true" /> {t("Assistant")}
					</h2>
					<button type="button" className="icon-button" aria-label={t("New conversation")} onClick={startOver}>
						<MessageSquarePlus size={17} aria-hidden="true" />
					</button>
					{onClose !== undefined && (
						<button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}>
							<X size={17} aria-hidden="true" />
						</button>
					)}
				</header>
			)}
			{side && (
				<div className="ask-messages">
					{messages.length === 0 && answer === "" && <p className="quiet">{t("Ask about this page, or anything in your work.")}</p>}
					{messages.map((message, index) => (
						<p key={index} className={`ask-message ask-${message.role}`}>
							{message.text}
						</p>
					))}
					{answer !== "" && (
						<p role="status" className="ask-message ask-assistant">
							{answer}
						</p>
					)}
					<div ref={end} />
				</div>
			)}
			<form className="ask-form" onSubmit={(event) => void send(event)}>
				<label>
					{!side && (
						<span>
							<Sparkles size={16} aria-hidden="true" /> {t("Ask the assistant")}
						</span>
					)}
					<textarea required maxLength={4000} rows={side ? 3 : 2} value={text} placeholder={placeholder} aria-label={side ? t("Message") : undefined} onChange={(event) => setText(event.target.value)} />
				</label>
				<div className="ask-actions">
					{context !== undefined && withContext && (
						<span className="ask-context">
							{context}
							<button type="button" aria-label={t("Don't include {what}", { what: context })} onClick={() => setWithContext(false)}>
								<X size={13} aria-hidden="true" />
							</button>
						</span>
					)}
					<button type="submit" disabled={running || text.trim() === ""}>
						{t("Send")}
					</button>
				</div>
			</form>
			{step !== "" && <p role="status">{t(step)}</p>}
			{!side && answer !== "" && (
				<p role="status" className="ask-answer">
					{answer}
				</p>
			)}
			{error !== "" && (
				<p role="alert" className="ask-error">
					{t(error)}
				</p>
			)}
			{refusal}
		</section>
	);
}

/** The rail's way to the assistant, beside Search. */
export function AskButton({ onClick }: { onClick(): void }) {
	const { t } = useI18n();
	return (
		<button type="button" className="search-button" onClick={onClick} data-testid="ask-button">
			<Sparkles size={15} aria-hidden="true" />
			<span>{t("Ask the assistant")}</span>
		</button>
	);
}
