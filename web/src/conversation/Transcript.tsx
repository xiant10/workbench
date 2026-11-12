import { ArrowDown, Bot, Check, ChevronRight, CirclePlay, FileText, GitBranch, Image as ImageIcon, type LucideIcon, Pencil, RotateCcw, Share2, Sparkles, ThumbsDown, ThumbsUp, Trash2, Volume2, Zap } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n.tsx";
import { CopyButton, Logo } from "../lib/ui.tsx";
import { load, save } from "../lib/storage.ts";
import { type Output, outputsOf } from "../results/outputs.ts";
import { useTypewriter } from "../call/useTypewriter.ts";
import { useWorkspace } from "../shell/workspace.ts";
import { Markdown } from "./Markdown.tsx";
import type { ConversationState, Line, Pending } from "./reducer.ts";
import type { FlowRunTrace, SessionDetails } from "../lib/agent.ts";

type Props = {
	sessionId?: string;
	state: ConversationState;
	agentName?: string;
	details?: SessionDetails;
	onOpenOutput(output: Output): void;
	onOpenWorkflow?(): void;
	/** Absent when tasks aren't available here. */
	resultAction?: { label: string; icon: LucideIcon; run(text: string): void };
	onRegenerate?(): void;
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

const TOOL_MAP_ZH: Record<string, { running: string; done: string }> = {
	search_quote_catalog: { running: "正在查询报价目录…", done: "查询报价目录" },
	find_product_documents: { running: "正在检索产品文档…", done: "查找产品文档" },
	find_success_cases: { running: "正在查找成功案例…", done: "查找成功案例" },
	get_daily_sales_brief: { running: "正在获取销售日报…", done: "获取销售日报" },
	get_sales_weekly_report: { running: "正在获取销售周报…", done: "获取销售周报" },
	get_sales_monthly_report: { running: "正在获取销售月报…", done: "获取销售月报" },
	query_work_records: { running: "正在查询工作记录…", done: "查询工作记录" },
	list_companies: { running: "正在获取客户公司列表…", done: "获取公司列表" },
	get_company: { running: "正在获取公司详情…", done: "获取公司信息" },
	list_contacts: { running: "正在获取联系人列表…", done: "获取联系人列表" },
	get_contact: { running: "正在获取联系人详情…", done: "获取联系人信息" },
	list_deals: { running: "正在获取商机列表…", done: "获取商机列表" },
	get_deal: { running: "正在获取商机详情…", done: "获取商机详情" },
	create_deal: { running: "正在创建新商机…", done: "创建商机" },
	list_tasks: { running: "正在获取任务列表…", done: "获取任务列表" },
	get_task: { running: "正在获取任务详情…", done: "获取任务详情" },
	get_my_tasks: { running: "正在获取待办任务…", done: "获取我的任务" },
	load_skill: { running: "正在加载技能组件…", done: "加载技能" },
	crm_lookup: { running: "正在检索客户数据 (CRM)…", done: "检索客户数据 (CRM)" },
	bash: { running: "正在执行命令…", done: "运行命令" },
	exec: { running: "正在执行命令…", done: "运行命令" },
	run_command: { running: "正在执行命令…", done: "运行命令" },
	read_file: { running: "正在查看文件…", done: "查看文件" },
	view_file: { running: "正在查看文件…", done: "查看文件" },
	write_file: { running: "正在写入文件…", done: "写入文件" },
	edit_file: { running: "正在编辑文件…", done: "编辑文件" },
};

const TOOL_MAP_EN: Record<string, { running: string; done: string }> = {
	search_quote_catalog: { running: "Searching quote catalog…", done: "Search quote catalog" },
	find_product_documents: { running: "Finding product documents…", done: "Find product documents" },
	find_success_cases: { running: "Finding success cases…", done: "Find success cases" },
	get_daily_sales_brief: { running: "Fetching daily sales brief…", done: "Fetch daily sales brief" },
	get_sales_weekly_report: { running: "Fetching weekly sales report…", done: "Fetch weekly sales report" },
	get_sales_monthly_report: { running: "Fetching monthly sales report…", done: "Fetch monthly sales report" },
	query_work_records: { running: "Querying work records…", done: "Query work records" },
	list_companies: { running: "Listing companies…", done: "List companies" },
	get_company: { running: "Fetching company details…", done: "Fetch company details" },
	list_contacts: { running: "Listing contacts…", done: "List contacts" },
	get_contact: { running: "Fetching contact info…", done: "Fetch contact info" },
	list_deals: { running: "Listing deals…", done: "List deals" },
	get_deal: { running: "Fetching deal details…", done: "Fetch deal details" },
	create_deal: { running: "Creating deal…", done: "Create deal" },
	list_tasks: { running: "Listing tasks…", done: "List tasks" },
	get_task: { running: "Fetching task details…", done: "Fetch task details" },
	get_my_tasks: { running: "Fetching my tasks…", done: "Fetch my tasks" },
	load_skill: { running: "Loading skill…", done: "Load skill" },
	crm_lookup: { running: "Looking up CRM records…", done: "Lookup CRM records" },
	bash: { running: "Running command…", done: "Run command" },
	exec: { running: "Running command…", done: "Run command" },
	run_command: { running: "Running command…", done: "Run command" },
	read_file: { running: "Reading file…", done: "Read file" },
	view_file: { running: "Viewing file…", done: "View file" },
	write_file: { running: "Writing file…", done: "Write file" },
	edit_file: { running: "Editing file…", done: "Edit file" },
};

const VERBS_ZH: Record<string, { running: string; done: string }> = {
	search: { running: "正在查询", done: "查询" },
	find: { running: "正在查找", done: "查找" },
	lookup: { running: "正在检索", done: "检索" },
	query: { running: "正在查询", done: "查询" },
	get: { running: "正在获取", done: "获取" },
	fetch: { running: "正在获取", done: "获取" },
	retrieve: { running: "正在检索", done: "检索" },
	load: { running: "正在加载", done: "加载" },
	read: { running: "正在查看", done: "查看" },
	view: { running: "正在查看", done: "查看" },
	inspect: { running: "正在检查", done: "检查" },
	check: { running: "正在校验", done: "校验" },
	verify: { running: "正在校验", done: "校验" },
	validate: { running: "正在校验", done: "校验" },
	write: { running: "正在写入", done: "写入" },
	create: { running: "正在创建", done: "创建" },
	generate: { running: "正在生成", done: "生成" },
	edit: { running: "正在编辑", done: "编辑" },
	update: { running: "正在更新", done: "更新" },
	run: { running: "正在运行", done: "运行" },
	exec: { running: "正在执行", done: "执行" },
	calculate: { running: "正在计算", done: "计算" },
	calc: { running: "正在计算", done: "计算" },
	send: { running: "正在发送", done: "发送" },
	list: { running: "正在列出", done: "列出" },
};

const NOUNS_ZH: Record<string, string> = {
	quote: "报价",
	catalog: "目录",
	product: "产品",
	documents: "文档",
	document: "文档",
	doc: "文档",
	docs: "文档",
	cases: "案例",
	skill: "技能",
	customer: "客户",
	crm: "客户数据",
	deal: "商机",
	deals: "商机",
	company: "公司",
	companies: "公司",
	contact: "联系人",
	contacts: "联系人",
	task: "任务",
	tasks: "任务",
	brief: "简报",
	report: "报告",
	records: "记录",
	record: "记录",
	file: "文件",
	files: "文件",
	command: "命令",
	data: "数据",
	info: "信息",
	user: "用户",
	account: "账户",
};

function humanizeToolName(name: string, isRunning: boolean, language: string): string {
	if (/[\u4e00-\u9fa5]/.test(name)) {
		return isRunning && !name.startsWith("正在") ? `正在${name}…` : name;
	}
	if (name.includes(" ")) {
		if (language === "zh") {
			if (name.toLowerCase().includes("validate") && name.toLowerCase().includes("skill")) {
				return isRunning ? "正在校验技能结构…" : "校验技能结构";
			}
			return isRunning ? `正在处理 ${name}…` : name;
		}
		return isRunning ? `${name}…` : name;
	}

	const isZh = language === "zh";
	const mapped = isZh ? TOOL_MAP_ZH[name] : TOOL_MAP_EN[name];
	if (mapped) return isRunning ? mapped.running : mapped.done;

	const parts = name.split(/[_-]/).filter(Boolean);
	if (parts.length === 0) return name;

	const first = parts[0]?.toLowerCase() ?? "";
	const rest = parts.slice(1);

	if (isZh) {
		const verb = VERBS_ZH[first];
		if (verb) {
			const restZh = rest.map((w) => NOUNS_ZH[w.toLowerCase()] ?? w).join("");
			return isRunning ? `${verb.running}${restZh}…` : `${verb.done}${restZh}`;
		}
		return isRunning ? `正在处理 ${name}…` : `处理 ${name}`;
	} else {
		const capitalizedVerb = first.charAt(0).toUpperCase() + first.slice(1);
		const verb = isRunning ? `${capitalizedVerb.endsWith("e") ? capitalizedVerb.slice(0, -1) : capitalizedVerb}ing` : capitalizedVerb;
		const restEn = rest.join(" ");
		return isRunning ? `${verb} ${restEn}…` : `${verb} ${restEn}`;
	}
}

function formatDuration(sec: number): string {
	if (sec < 60) return `${Math.max(1, sec)}s`;
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return `${m}m${s}s`;
}

/** The time of day, with the date when it isn't today. */
function formatTime(at: number): string {
	const date = new Date(at);
	const pad = (n: number) => String(n).padStart(2, "0");
	const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	return date.toDateString() === new Date().toDateString() ? time : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

function getTurnHasFinalResponse(lines: Line[], currentIndex: number, liveText: string): boolean {
	let turnStart = 0;
	for (let i = currentIndex; i >= 0; i--) {
		if (lines[i]?.role === "user") {
			turnStart = i + 1;
			break;
		}
	}
	let turnEnd = lines.length;
	for (let i = currentIndex; i < lines.length; i++) {
		if (lines[i]?.role === "user") {
			turnEnd = i;
			break;
		}
	}
	const turnLines = lines.slice(turnStart, turnEnd);
	const hasAssistant = turnLines.some((l) => l.role === "assistant" && l.text.trim() !== "");
	if (turnEnd === lines.length && liveText.trim() !== "") return true;
	return hasAssistant;
}

function formatOutputSize(body: string): string {
	const bytes = new Blob([body]).size;
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function AgentHeader({
	name,
	duration,
	isBusy,
	hasTools,
	isExpanded,
	onToggle,
	flow,
	onOpenWorkflow,
	note,
}: {
	name: string;
	/** What the agent said it is doing, shown for as long as the turn runs. */
	note?: string;
	duration?: number;
	isBusy?: boolean;
	hasTools?: boolean;
	isExpanded?: boolean;
	onToggle?(): void;
	flow?: FlowRunTrace;
	onOpenWorkflow?(): void;
}) {
	const { t, language } = useI18n();
	const isZh = language === "zh";
	return (
		<div className="agent-header">
			<span className="agent-mark">
				<Logo size={20} />
			</span>
			<div className="agent-header-info">
				<span className="agent-header-name">{name}</span>
				{duration !== undefined && duration > 0 && (
					hasTools && !isBusy && onToggle ? (
						<button
							type="button"
							className="agent-header-time-button"
							onClick={onToggle}
							aria-expanded={isExpanded}
							title={isExpanded ? t("Hide details") : t("Show details")}
						>
							<span>{t("Completed {time}", { time: formatDuration(duration) })}</span>
							<ChevronRight size={13} className={`chevron-icon${isExpanded ? " expanded" : ""}`} aria-hidden="true" />
						</button>
					) : (
						<span className="agent-header-time">
							{isBusy ? t("Processed {time}", { time: formatDuration(duration) }) : t("Completed {time}", { time: formatDuration(duration) })}
						</span>
					)
				)}
				{note !== undefined && note !== "" && <span className="agent-header-note">{note}</span>}
				{flow !== undefined && onOpenWorkflow !== undefined && (
					<button
						type="button"
						className={`agent-flow-chip ${flow.mode}`}
						onClick={onOpenWorkflow}
						title={isZh ? "查看可视化执行工作流" : "View visual workflow trace"}
					>
						{flow.mode === "deterministic" ? <Zap size={12} aria-hidden="true" /> : <GitBranch size={12} aria-hidden="true" />}
						<span>
							{isZh
								? (flow.titleZh ?? flow.flow?.titleZh ?? flow.title ?? flow.flow?.title ?? flow.skill ?? "工作流")
								: (flow.title ?? flow.flow?.title ?? flow.skill ?? "Workflow")}
							{(flow.parallelToolsRun ?? 0) > 0
								? isZh
									? ` · ${flow.parallelToolsRun} 并发`
									: ` · ${flow.parallelToolsRun} parallel`
								: ""}
						</span>
					</button>
				)}
			</div>
		</div>
	);
}

function SpokenView({ text }: { text: string }) {
	const typed = useTypewriter(text, true);
	return (
		<div className="line assistant live">
			<span className="agent-mark sr-only">
				<Logo size={24} />
			</span>
			<div className="line-body">
				<Markdown text={typed} />
			</div>
		</div>
	);
}

function ToolLineView({ line, hidden = false }: { line: Extract<Line, { role: "tool" }>; hidden?: boolean }) {
	const { t, language } = useI18n();

	const isSkill = line.name.toLowerCase().includes("skill");
	const isWrite = line.name.toLowerCase().includes("write") || line.name.toLowerCase().includes("edit") || line.name.includes("写入");

	const Icon = isSkill ? Sparkles : isWrite ? Pencil : CirclePlay;
	const isRunning = line.state === "running";
	const displayText = humanizeToolName(line.name, isRunning, language);

	return (
		<div className={`line tool ${line.state}${hidden ? " hidden" : ""}`} style={hidden ? { display: "none" } : undefined}>
			<Icon size={14} aria-hidden="true" />
			<span>{displayText}</span>
			<span className="sr-only">
				{line.name} {t(line.state === "running" ? "Running" : line.state === "failed" ? "Failed" : "Done")}
			</span>
		</div>
	);
}

function OutputCardView({ output, onOpen }: { output: Output; onOpen(output: Output): void }) {
	const { t } = useI18n();
	const isMd = output.title.toLowerCase().endsWith(".md") || output.kind === "document";
	const isCode = output.kind === "code";
	const ext = output.language ?? (output.title.includes(".") ? output.title.split(".").pop() ?? "" : "");

	return (
		<button
			type="button"
			key={output.key}
			className="output-chip"
			aria-label={`${output.title}: ${t("Open")}`}
			onClick={() => onOpen(output)}
		>
			<div className={`artifact-badge${isCode ? " code" : ""}`} aria-hidden="true">
				{isMd ? <span>M</span> : isCode ? <span>{ext ? ext.toUpperCase().slice(0, 3) : "<>"}</span> : <FileText size={18} />}
			</div>
			<div className="artifact-info">
				<span className="artifact-title">{output.title}</span>
				<span className="artifact-size">{formatOutputSize(output.body)}</span>
			</div>
			<ChevronRight size={15} className="chevron-arrow" aria-hidden="true" />
		</button>
	);
}

function AssistantFooter({
	text,
	tokenCost,
	timestamp,
	model,
	onRegenerate,
	resultAction,
}: {
	text: string;
	tokenCost?: string;
	/** When the reply was written, in Unix milliseconds; no time shows without it. */
	timestamp?: number;
	model?: string;
	onRegenerate?(): void;
	resultAction?: { label: string; icon: LucideIcon; run(text: string): void };
}) {
	const { t } = useI18n();
	const [liked, setLiked] = useState(false);
	const [disliked, setDisliked] = useState(false);
	const [speaking, setSpeaking] = useState(false);
	const [shared, setShared] = useState(false);

	useEffect(() => {
		return () => {
			if (speaking && typeof window !== "undefined" && "speechSynthesis" in window) {
				window.speechSynthesis.cancel();
			}
		};
	}, [speaking]);

	const handleLike = () => {
		setLiked(!liked);
		if (!liked) setDisliked(false);
	};

	const handleDislike = () => {
		setDisliked(!disliked);
		if (!disliked) setLiked(false);
	};

	const handleSpeak = () => {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
		if (speaking) {
			window.speechSynthesis.cancel();
			setSpeaking(false);
		} else {
			window.speechSynthesis.cancel();
			const utterance = new SpeechSynthesisUtterance(text.slice(0, 1000));
			utterance.onend = () => setSpeaking(false);
			utterance.onerror = () => setSpeaking(false);
			setSpeaking(true);
			window.speechSynthesis.speak(utterance);
		}
	};

	const handleShare = async () => {
		try {
			if (navigator.clipboard) {
				await navigator.clipboard.writeText(window.location.href);
				setShared(true);
				setTimeout(() => setShared(false), 2000);
			}
		} catch {
			// fallback
		}
	};

	const timeStr = timestamp === undefined ? undefined : formatTime(timestamp);

	return (
		<div className="assistant-footer">
			<div className="assistant-footer-actions">
				<CopyButton text={text} />
				<button
					type="button"
					className={`icon-button${liked ? " active" : ""}`}
					aria-label={t("Helpful")}
					title={t("Helpful")}
					onClick={handleLike}
				>
					<ThumbsUp size={15} aria-hidden="true" />
				</button>
				<button
					type="button"
					className={`icon-button${disliked ? " active" : ""}`}
					aria-label={t("Not helpful")}
					title={t("Not helpful")}
					onClick={handleDislike}
				>
					<ThumbsDown size={15} aria-hidden="true" />
				</button>
				<button
					type="button"
					className={`icon-button${speaking ? " active" : ""}`}
					aria-label={t("Read aloud")}
					title={t("Read aloud")}
					onClick={handleSpeak}
				>
					<Volume2 size={15} aria-hidden="true" />
				</button>
				{onRegenerate !== undefined && (
					<button
						type="button"
						className="icon-button"
						aria-label={t("Regenerate")}
						title={t("Regenerate")}
						onClick={onRegenerate}
					>
						<RotateCcw size={15} aria-hidden="true" />
					</button>
				)}
				<button
					type="button"
					className="icon-button"
					aria-label={t("Share")}
					title={t("Share")}
					onClick={handleShare}
				>
					{shared ? <Check size={15} aria-hidden="true" /> : <Share2 size={15} aria-hidden="true" />}
				</button>
				{resultAction !== undefined && (
					<button
						type="button"
						className="icon-button"
						aria-label={t(resultAction.label)}
						title={t(resultAction.label)}
						onClick={() => resultAction.run(text)}
					>
						<resultAction.icon size={15} aria-hidden="true" />
					</button>
				)}
			</div>
			<div className="assistant-footer-meta">
				{tokenCost !== undefined && <span className="assistant-footer-cost">{t("Total ✧ {cost}", { cost: tokenCost })}</span>}
				<span className="assistant-footer-model">
					<Bot size={13} aria-hidden="true" />
					<span>{model ?? "Auto"}</span>
				</span>
				{timeStr !== undefined && <span className="assistant-footer-time">{timeStr}</span>}
			</div>
		</div>
	);
}

function TempFooter({ cost, status }: { cost?: string; status: string }) {
	const { t } = useI18n();
	return (
		<div className="working temp-footer" role="status" aria-label={t("Working…")} aria-live="polite" aria-atomic="true" data-temporary="true">
			{cost !== undefined && (
				<>
					<span className="temp-cost">{t("Consumed ✧ {cost}", { cost })}</span>
					<span className="temp-divider" aria-hidden="true">|</span>
				</>
			)}
			<span className="temp-status">{status}</span>
		</div>
	);
}

function LineView({
	line,
	hiddenTool,
	footer = false,
	tokenCost,
	onOpenOutput,
	onRegenerate,
	resultAction,
}: {
	line: Line;
	hiddenTool?: boolean;
	/** Whether this line ends a finished turn, which gets the one footer the turn has. */
	footer?: boolean;
	tokenCost?: string;
	onRegenerate?(): void;
} & Pick<Props, "onOpenOutput" | "resultAction">) {
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
					<span className="agent-mark sr-only">
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
							<OutputCardView key={output.key} output={output} onOpen={onOpenOutput} />
						))}
						{outputs.length > 0 && outputs[0] !== undefined && (
							<button
								type="button"
								className="view-all-artifacts-btn"
								onClick={() => {
									if (outputs[0]) onOpenOutput(outputs[0]);
								}}
							>
								<span>{t("View all artifacts ({count})", { count: outputs.length })}</span>
								<ChevronRight size={14} aria-hidden="true" />
							</button>
						)}
						{footer && (
							<AssistantFooter
								text={line.text}
								{...(tokenCost === undefined ? {} : { tokenCost })}
								{...(line.at === undefined ? {} : { timestamp: line.at })}
								{...(line.model === undefined ? {} : { model: line.model })}
								onRegenerate={onRegenerate}
								resultAction={resultAction}
							/>
						)}
					</div>
				</div>
			);
		}
		case "tool":
			return <ToolLineView line={line} hidden={hiddenTool} />;
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

export function Transcript({ sessionId = "", state, agentName = "Assistant", details, onOpenOutput, onOpenWorkflow, resultAction, onRegenerate, onRetry, onDiscard, onLoadEarlier, spoken = "", heard = [], interim = "" }: Props) {
	const { t, language } = useI18n();
	const { isAdmin } = useWorkspace();
	const scroller = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	const [away, setAway] = useState(false);
	const failed = state.pending.filter((item) => item.state === "failed");
	// A queued message waits for the run to reach it, but the person sent it now, so it sits where it will land.
	const sending = state.pending.filter((item) => item.state === "sending" || item.state === "queued");

	const [elapsedSec, setElapsedSec] = useState(0);
	const startRef = useRef(0);
	const [turnDurations, setTurnDurations] = useState<Record<string, number>>(() => {
		if (!sessionId) return {};
		const raw = load(`durations:${sessionId}`);
		if (!raw) return {};
		try {
			return JSON.parse(raw);
		} catch {
			return {};
		}
	});

	const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});

	let lastUserIndex = -1;
	for (let i = state.lines.length - 1; i >= 0; i--) {
		if (state.lines[i]?.role === "user") {
			lastUserIndex = i;
			break;
		}
	}

	useEffect(() => {
		if (state.busy) {
			if (startRef.current === 0) {
				startRef.current = Date.now();
				setElapsedSec(1);
			}
			const interval = setInterval(() => {
				setElapsedSec(Math.max(1, Math.floor((Date.now() - startRef.current) / 1000)));
			}, 1000);
			return () => clearInterval(interval);
		} else {
			if (startRef.current > 0) {
				const finalDuration = Math.max(1, Math.floor((Date.now() - startRef.current) / 1000));
				const lastUserLine = lastUserIndex >= 0 ? state.lines[lastUserIndex] : undefined;
				const firstAgentLine = state.lines.slice(lastUserIndex + 1).find((l) => l.role !== "user" && l.role !== "compaction");

				setTurnDurations((prev) => {
					const next = { ...prev };
					if (lastUserLine) next[lastUserLine.key] = finalDuration;
					if (firstAgentLine) next[firstAgentLine.key] = finalDuration;
					if (sessionId) save(`durations:${sessionId}`, JSON.stringify(next));
					return next;
				});
				startRef.current = 0;
			}
		}
	}, [state.busy, state.lines, lastUserIndex, sessionId]);

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

	const hasAgentInCurrentTurn = state.lines.slice(lastUserIndex + 1).some((l) => l.role !== "user" && l.role !== "compaction");
	const showLiveHeader = !hasAgentInCurrentTurn && (state.busy || state.live !== "" || state.thinking !== "");

	const counted = (value: unknown): number => (value as { totalTokens?: number } | null)?.totalTokens ?? 0;
	const own = Object.values(details?.usage?.models ?? {}).reduce<number>((sum, usage) => sum + counted(usage), 0);
	const totalTokens = own + counted(details?.taskUsage);
	// Usage is for admins, and shows only what the agent counted.
	const tokenCost = isAdmin && totalTokens > 0 ? (totalTokens / 1000).toFixed(2) : undefined;

	const progressText = [...new Set(Object.values(state.progress).filter(Boolean))].join(" ");
	const activeTool = [...state.lines].reverse().find((l): l is Extract<Line, { role: "tool" }> => l.role === "tool" && l.state === "running");

	let statusMessage = "";
	if (activeTool) {
		statusMessage = humanizeToolName(activeTool.name, true, language);
	} else if (state.lines.some((l) => l.role === "tool")) {
		statusMessage = language === "zh" ? "正在整理分析结果，准备回复…" : "Analyzing results and preparing response…";
	} else if (state.thinking !== "") {
		statusMessage = language === "zh" ? "正在深入思考中…" : "Thinking…";
	} else {
		statusMessage = language === "zh" ? "正在理解您的需求…" : "Understanding your request…";
	}

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
					{state.lines.map((line, index) => {
						// Determine turn bounds for this index
						let turnUserIdx = -1;
						for (let i = index; i >= 0; i--) {
							if (state.lines[i]?.role === "user") {
								turnUserIdx = i;
								break;
							}
						}
						const turnStartIdx = turnUserIdx + 1;
						let turnEndIdx = state.lines.length;
						for (let i = turnStartIdx; i < state.lines.length; i++) {
							if (state.lines[i]?.role === "user") {
								turnEndIdx = i;
								break;
							}
						}
						const turnLines = state.lines.slice(turnStartIdx, turnEndIdx);
						const firstAgentLineInTurn = turnLines.find((l) => l.role !== "user" && l.role !== "compaction");
						const turnKey = firstAgentLineInTurn?.key ?? `turn-${turnStartIdx}`;
						const turnHasTools = turnLines.some((l) => l.role === "tool");
						const isTurnExpanded = !!expandedTurns[turnKey];
						const isFirstAgent = line.key === firstAgentLineInTurn?.key;
						const isCurrentTurn = index > lastUserIndex;

						let duration: number | undefined;
						if (isCurrentTurn && state.busy) {
							duration = elapsedSec;
						} else {
							const userKey = turnUserIdx >= 0 ? state.lines[turnUserIdx]?.key : undefined;
							duration = turnDurations[line.key] ?? (userKey ? turnDurations[userKey] : undefined);

							// Fallback estimate for historical completed turns if unrecorded
							if (duration === undefined) {
								const assistantLine = turnLines.find((l) => l.role === "assistant");
								if (assistantLine && assistantLine.text.trim() !== "") {
									const toolsCount = turnLines.filter((l) => l.role === "tool").length;
									const charCount = assistantLine.text.length;
									duration = Math.max(2, Math.round(toolsCount * 3 + charCount / 45));
								}
							}
						}

						// One footer per turn, under its last reply, once the turn is over. Usage is the session's, so only the newest turn shows it.
						const lastReply = turnLines.findLast((l) => l.role === "assistant" && l.text !== "");
						const footer = line.key === lastReply?.key && !(isCurrentTurn && state.busy);
						const turnCost = turnEndIdx === state.lines.length ? tokenCost : undefined;

						const hasFinalResponse = getTurnHasFinalResponse(state.lines, index, state.live);
						const isHiddenTool = line.role === "tool" && line.state !== "running" && hasFinalResponse && !isTurnExpanded;

						return (
							<Fragment key={line.key}>
								{isFirstAgent && (
									<AgentHeader
										name={agentName}
										duration={duration}
										isBusy={isCurrentTurn && state.busy}
										hasTools={turnHasTools}
										isExpanded={isTurnExpanded}
										onToggle={() => setExpandedTurns((prev) => ({ ...prev, [turnKey]: !prev[turnKey] }))}
										{...(isCurrentTurn && state.busy ? { note: progressText } : {})}
										{...(isCurrentTurn && (state.flow ?? details?.flow) !== undefined ? { flow: state.flow ?? details?.flow } : {})}
										{...(onOpenWorkflow === undefined ? {} : { onOpenWorkflow })}
									/>
								)}
								<LineView
									line={line}
									hiddenTool={isHiddenTool}
									footer={footer}
									{...(turnCost === undefined ? {} : { tokenCost: turnCost })}
									onOpenOutput={onOpenOutput}
									onRegenerate={onRegenerate}
									resultAction={resultAction}
								/>
							</Fragment>
						);
					})}
					{sending.map((item) => (
						<div key={item.requestId} className="line user sending">
							<div className="bubble">{item.text}</div>
							{item.state === "queued" && <p className="queued-note">{t("Queued")}</p>}
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
					{showLiveHeader && (
						<AgentHeader
							name={agentName}
							duration={state.busy ? elapsedSec : undefined}
							isBusy={state.busy}
							note={progressText}
							{...((state.flow ?? details?.flow) !== undefined ? { flow: state.flow ?? details?.flow } : {})}
							{...(onOpenWorkflow === undefined ? {} : { onOpenWorkflow })}
						/>
					)}
					{state.thinking !== "" && (
						<details className="line thinking">
							<summary>{t("Thinking")}</summary>
							{state.thinking}
						</details>
					)}
					{state.live !== "" && (
						<div className="line assistant live">
							<span className="agent-mark sr-only">
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
					{(state.busy || Object.values(state.progress).some(Boolean)) && spoken === "" && state.live === "" && (
						<TempFooter cost={tokenCost} status={statusMessage} />
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
