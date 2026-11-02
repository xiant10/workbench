import { ArrowDown, Check, ChevronRight, FileText, Image as ImageIcon, LoaderCircle, type LucideIcon, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n.tsx";
import { CopyButton, Logo } from "../lib/ui.tsx";
import { type Output, outputsOf } from "../results/outputs.ts";
import { useTypewriter } from "../call/useTypewriter.ts";
import { Markdown } from "./Markdown.tsx";
import type { ConversationState, Line, Pending } from "./reducer.ts";

type Props = {
	state: ConversationState;
	onOpenOutput(output: Output): void;
	/** Absent when tasks aren't available here. */
	resultAction?: { label: string; icon: LucideIcon; run(text: string): void };
	onRetry(pending: Pending): void;
	onDiscard(requestId: string): void;
	onLoadEarlier(): void;
	/** In a call, the reply being spoken, typed out as it arrives. It gives way to the message once that is read. */
	spoken?: string;
	/** In a call, what the caller said, shown at once and replaced by the user's message once that is read. */
	heard?: string[];
	/** In a call, the caller's words so far, while they are still speaking. */
	interim?: string;
};

function SpokenView({ text }: { text: string }) {
	const typed = useTypewriter(text, true);
	return (
		<div className="line assistant live">
			<span className="agent-mark">
				<Logo size={24} />
			</span>
			<div className="line-body">
				<Markdown text={typed} />
			</div>
		</div>
	);
}

function LineView({ line, onOpenOutput, resultAction }: { line: Line } & Pick<Props, "onOpenOutput" | "resultAction">) {
	const { t } = useI18n();
	switch (line.role) {
		case "user":
			return (
				<div className="line user">
					<div className="bubble">
						{line.text}
						{(line.images ?? 0) > 0 && (
							<div className="image-count">
								<ImageIcon size={14} aria-label={t("Images")} /> {line.images}
							</div>
						)}
					</div>
				</div>
			);
		case "assistant": {
			const outputs = outputsOf(line.key, line.text);
			return (
				<div className="line assistant">
					<span className="agent-mark">
						<Logo size={24} />
					</span>
					<div className="line-body">
						{line.text !== "" && <Markdown text={line.text} />}
						{line.aborted === true && <p className="quiet">{t("Stopped")}</p>}
						{line.error !== undefined && (
							<p className="inline-error" role="alert">
								{line.error}
							</p>
						)}
						{outputs.map((output) => (
							<button type="button" key={output.key} className="output-chip" aria-label={`${output.title}: ${t("Open")}`} onClick={() => onOpenOutput(output)}>
								<FileText size={16} aria-hidden="true" />
								<span>{output.title}</span>
								<ChevronRight size={15} aria-hidden="true" />
							</button>
						))}
						{line.text !== "" && (
							<div className="line-actions">
								<CopyButton text={line.text} />
								{resultAction !== undefined && (
									<button type="button" className="icon-button" aria-label={t(resultAction.label)} title={t(resultAction.label)} onClick={() => resultAction.run(line.text)}>
										<resultAction.icon size={15} aria-hidden="true" />
									</button>
								)}
							</div>
						)}
					</div>
				</div>
			);
		}
		case "tool":
			return (
				<div className={`line tool ${line.state}`}>
					{line.state === "running" ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : line.state === "failed" ? <X size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
					<span>
						{t(line.state === "running" ? "Running" : line.state === "failed" ? "Failed" : "Done")}: <code>{line.name}</code>
					</span>
				</div>
			);
		case "task":
			return (
				<div className="line task">
					<p className="quiet">{t("From background task {name}", { name: line.name })}</p>
					<Markdown text={line.text} />
				</div>
			);
		case "compaction":
			return <div className="line divider">{t("Earlier messages were summarized.")}</div>;
		case "error":
			return (
				<p className="line inline-error" role="alert">
					{line.text}
				</p>
			);
	}
}

export function Transcript({ state, onOpenOutput, resultAction, onRetry, onDiscard, onLoadEarlier, spoken = "", heard = [], interim = "" }: Props) {
	const { t } = useI18n();
	const scroller = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	const [away, setAway] = useState(false);
	const failed = state.pending.filter((item) => item.state === "failed");
	const sending = state.pending.filter((item) => item.state === "sending");
	const quiet = state.live === "" && state.thinking === "" && !state.lines.some((line) => line.role === "tool" && line.state === "running");

	useEffect(() => {
		if (pinned.current && scroller.current !== null) scroller.current.scrollTop = scroller.current.scrollHeight;
	});

	// Only finished messages are announced, not each delta.
	const finished = useMemo(() => {
		for (let at = state.lines.length - 1; at >= 0; at--) {
			const line = state.lines[at];
			if (line?.role === "assistant") return line.text;
		}
		return "";
	}, [state.lines]);

	const toBottom = () => {
		pinned.current = true;
		setAway(false);
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
	};

	return (
		<div className="transcript-frame">
			<div
				className="transcript"
				ref={scroller}
				tabIndex={0}
				onScroll={(event) => {
					const element = event.currentTarget;
					pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
					setAway(!pinned.current);
				}}
			>
				<div className="transcript-inner">
					{state.earlier !== undefined && (
						<button type="button" className="link center" onClick={onLoadEarlier}>
							{t("Load earlier messages")}
						</button>
					)}
					{state.lines.map((line) => (
						<LineView key={line.key} line={line} onOpenOutput={onOpenOutput} resultAction={resultAction} />
					))}
					{sending.map((item) => (
						<div key={item.requestId} className="line user sending">
							<div className="bubble">{item.text}</div>
						</div>
					))}
					{failed.map((item) => (
						<div key={item.requestId} className="line user failed">
							<div className="bubble">{item.text}</div>
							<p className="inline-error" role="alert">
								{item.reason}
							</p>
							<div className="failed-actions">
								<button type="button" className="ghost small" onClick={() => onRetry(item)}>
									<RotateCcw size={13} aria-hidden="true" />
									{t("Retry")}
								</button>
								<button type="button" className="ghost small" onClick={() => onDiscard(item.requestId)}>
									<Trash2 size={13} aria-hidden="true" />
									{t("Remove")}
								</button>
							</div>
						</div>
					))}
					{state.thinking !== "" && (
						<details className="line thinking">
							<summary>{t("Thinking")}</summary>
							{state.thinking}
						</details>
					)}
					{state.live !== "" && (
						<div className="line assistant live">
							<span className="agent-mark">
								<Logo size={24} />
							</span>
							<div className="line-body">
								<Markdown text={state.live} />
							</div>
						</div>
					)}
					{heard.map((text, at) => (
						<div key={`heard${at}`} className="line user">
							<div className="bubble">{text}</div>
						</div>
					))}
					{interim !== "" && (
						<div className="line user interim">
							<div className="bubble">{interim}</div>
						</div>
					)}
					{spoken !== "" && <SpokenView text={spoken} />}
					{state.busy && quiet && spoken === "" && (
						<div className="working" role="status" aria-label={t("Working…")}>
							<span className="agent-mark">
								<Logo size={24} />
							</span>
							<span className="dots" aria-hidden="true">
								<i />
								<i />
								<i />
							</span>
						</div>
					)}
					{state.retry !== undefined && <p className="line quiet">{t("Retrying, attempt {n}", { n: state.retry.attempt })}</p>}
				</div>
				<div className="sr-only" aria-live="polite">
					{state.busy ? "" : finished}
				</div>
			</div>
		{away && (
			<button type="button" className="to-bottom" aria-label={t("Jump to latest")} onClick={toBottom}>
				<ArrowDown size={16} aria-hidden="true" />
			</button>
		)}
		</div>
	);
}
