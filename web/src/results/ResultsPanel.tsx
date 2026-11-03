import { useState } from "react";
import { RESULTS_BREAKPOINT, useMedia, navigateOptions } from "../lib/layout.ts";
import { Download, Expand, FileText, type LucideIcon, Moon, Square, Wrench, X } from "lucide-react";
import { ToolActivity } from "./ToolActivity.tsx";
import { Markdown } from "../conversation/Markdown.tsx";
import type { ConversationState } from "../conversation/reducer.ts";
import { useI18n } from "../lib/i18n.tsx";
import type { SessionDetails } from "../lib/agent.ts";
import { CopyButton, Dialog, Empty } from "../lib/ui.tsx";
import { type Output, outputFilename } from "./outputs.ts";

export type ResultsTab = "outputs" | "background" | "activity";

type Props = {
	state: ConversationState;
	outputs: Output[];
	selected?: Output;
	tab: ResultsTab;
	details?: SessionDetails;
	onTab(tab: ResultsTab): void;
	onSelect(output: Output): void;
	onClose(): void;
	resultAction?: { label: string; icon: LucideIcon; run(text: string): void };
	onStopTasks(): void;
};

function download(output: Output): void {
	const url = URL.createObjectURL(new Blob([output.body], { type: "text/plain;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = outputFilename(output);
	link.click();
	URL.revokeObjectURL(url);
}

/** Own spend is kept per model. Background tasks' spend is separate, so the two are added. */
function totalTokens(details: SessionDetails | undefined): number | undefined {
	if (details === undefined) return undefined;
	const counted = (value: unknown): number => (value as { totalTokens?: number } | null)?.totalTokens ?? 0;
	const own = Object.values(details.usage.models ?? {}).reduce<number>((sum, usage) => sum + counted(usage), 0);
	const total = own + counted(details.taskUsage);
	return total === 0 ? undefined : total;
}

/** Agent-pi's words for a background task. One it adds later shows as sent. */
const TASK_STATUS: Record<string, string> = { working: "Running", done: "Done", completed: "Done", failed: "Failed", stopped: "Stopped" };

export function ResultsPanel({ state, outputs, selected, tab, details, onTab, onSelect, onClose, resultAction, onStopTasks }: Props) {
	const { t, language } = useI18n();
	const active = selected ?? outputs.at(-1);
	const tools = state.lines.filter((line) => line.role === "tool");
	const running = state.tasks.filter((task) => task.status === "working");
	const tokens = totalTokens(details);
	const narrow = useMedia(`(max-width: ${RESULTS_BREAKPOINT - 1}px)`);
	const [expanded, setExpanded] = useState(false);
	const [width, setWidth] = useState(440);
	const modal = narrow || expanded;
	const limit = () => Math.max(400, Math.min(760, window.innerWidth - 752));
	const resize = (value: number) => setWidth(Math.max(360, Math.min(limit(), value)));

	const content = <>
			{!modal && <div className="results-resize" role="separator" tabIndex={0} aria-label={t("Resize results")} aria-orientation="vertical" aria-valuemin={360} aria-valuemax={limit()} aria-valuenow={width}
				onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resize(width + (event.key === "ArrowLeft" ? 40 : -40)); } }}
				onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }}
				onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(window.innerWidth - event.clientX); }}
			/>}
			<div className="results-head">
			<div className="results-tabs" role="tablist" onKeyDown={navigateOptions}>
				{(["outputs", "background", "activity"] as const).map((name) => (
					<button key={name} type="button" role="tab" tabIndex={tab === name ? 0 : -1} aria-selected={tab === name} className={tab === name ? "tab active" : "tab"} onClick={() => onTab(name)}>
						{t({ outputs: "Outputs", background: "Background work", activity: "Activity" }[name])}
						{name === "background" && state.tasks.length > 0 && <span className="badge">{state.tasks.length}</span>}
					</button>
				))}
			</div>
				{!modal && <button type="button" className="icon-button" aria-label={t("Expand results")} onClick={() => setExpanded(true)}><Expand size={16} aria-hidden="true" /></button>}
				<button type="button" className="icon-button" onClick={onClose} aria-label={t("Hide results")}>
					<X size={16} aria-hidden="true" />
				</button>
			</div>
			<div className="results-body">
				{tab === "outputs" &&
					(active === undefined ? (
						<Empty icon={FileText} title={t("Nothing here yet")}>
							<p className="quiet">{t("Long documents, tables and code from replies open here.")}</p>
						</Empty>
					) : (
						<>
							{outputs.length > 1 && (
								<ul className="output-list">
									{outputs.map((output) => (
										<li key={output.key}>
											<button type="button" className={output.key === active.key ? "link strong" : "link"} onClick={() => onSelect(output)}>
												{output.title}
											</button>
										</li>
									))}
								</ul>
							)}
							<div className="output-actions">
								{!active.body.trimStart().startsWith("# ") && <h2>{active.title}</h2>}
								<CopyButton text={active.body} label="Copy" className="ghost small" />
								<button type="button" className="ghost small" onClick={() => download(active)}>
									<Download size={14} aria-hidden="true" />
									{t("Download")}
								</button>
								{resultAction !== undefined && (
									<button type="button" className="ghost small" onClick={() => resultAction.run(active.body)}>
										<resultAction.icon size={14} aria-hidden="true" />
										{t(resultAction.label)}
									</button>
								)}
							</div>
							{active.kind === "code" ? <pre className="output-code">{active.body}</pre> : <Markdown text={active.body} />}
						</>
					))}
				{tab === "background" &&
					(state.tasks.length === 0 ? (
						<Empty icon={Moon} title={t("No background work.")} />
					) : (
						<>
							<ul className="background">
								{state.tasks.map((task) => (
									<li key={task.taskId}>
										<span>{task.name}</span>
										<span className="quiet">{t(TASK_STATUS[task.status] ?? task.status)}</span>
									</li>
								))}
							</ul>
							{running.length > 0 && (
								<button type="button" className="ghost small" onClick={onStopTasks}>
									<Square size={12} fill="currentColor" aria-hidden="true" />
									{t("Stop background work too")}
								</button>
							)}
						</>
					))}
				{tab === "activity" &&
					(tools.length === 0 ? (
						<Empty icon={Wrench} title={t("No tool activity yet.")} />
					) : (
						<ul className="background">
							{tools.map((line) => (
								<ToolActivity key={line.callId} line={line} />
							))}
						</ul>
					))}
			</div>
			{tokens !== undefined && (
				<footer className="results-foot">
					{t("Usage for this conversation")}: {tokens.toLocaleString(language === "zh" ? "zh-CN" : "en")} {t("tokens")}
				</footer>
			)}
		</>;
	return modal ? (
		<Dialog label={t("Results")} onClose={onClose} className={expanded ? "results results-expanded" : "results results-overlay"} backdropClassName="results-backdrop">{content}</Dialog>
	) : <aside className="results" style={{ width: `min(${width}px, calc(100vw - 752px))` }} aria-label={t("Results")}>{content}</aside>;

}
