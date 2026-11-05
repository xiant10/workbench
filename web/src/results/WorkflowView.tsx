import { useQuery } from "@tanstack/react-query";
import {
	Check,
	CheckCircle2,
	CircleAlert,
	CircleDot,
	Clock,
	Code2,
	Compass,
	Download,
	Filter,
	GitBranch,
	HelpCircle,
	Layers,
	Loader2,
	Pencil,
	Play,
	Plus,
	SkipForward,
	Sparkles,
	Trash2,
	Wrench,
	X,
	Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
	FlowExtractField,
	FlowNode,
	FlowNodeKind,
	FlowParallelCall,
	FlowRunTrace,
	FlowStepStatus,
	FlowStepTrace,
	FlowSwitchBranch,
	SkillEntry,
	SkillFlow,
} from "../lib/agent.ts";
import { rpc } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { CopyButton, Empty } from "../lib/ui.tsx";

type Props = {
	agent: string;
	trace?: FlowRunTrace;
	/** Hide the Edit Flow button (used inside conversation ResultsPanel so workflow trace is strictly read-only). */
	readOnly?: boolean;
	/**
	 * Edit one skill's workflow inside its skill page. The page owns the flow and publishes the whole skill, so there's no
	 * skill picker, no new-workflow card and no publishing here: every edit goes to `onChange`.
	 */
	embedded?: { readonly flow: SkillFlow; readonly onChange: (flow: SkillFlow) => void };
};

/** Built-in fallback blueprints in case an older backend does not yet return `flow` on `skills.list`. */
const FALLBACK_FLOWS: SkillFlow[] = [
	{
		id: "customer-visit-preparation",
		title: "Customer Visit Preparation Flow",
		titleZh: "客户拜访准备确定性工作流",
		mode: "deterministic",
		triggerKeywords: ["拜访", "见客户", "沟通材料", "拜访简报"],
		nodes: [
			{
				id: "start",
				kind: "start",
				label: "Visit Prep Request",
				labelZh: "客户拜访请求",
				description: "Receive customer clue, visit goal, and relationship-only flag",
				descriptionZh: "接收客户名称/联系人线索与拜访目标",
			},
			{
				id: "extract_target",
				kind: "extract",
				label: "Extract Target & Intent",
				labelZh: "提取客户线索与拜访意图",
				description: "Zero-LLM slot extraction for company query, pricing interest, and visit type",
				descriptionZh: "毫秒级提取目标企业名称、是否关注报价及是否纯关系维护",
				extract: {
					company: {
						pattern: "(?:拜访|见|关于|准备|准备一下|调研)\\s*([\\u4e00-\\u9fa5A-Za-z0-9]{2,20}?)(?:的|公司|集团|客户|拜访|简报|$)",
						fallbackInput: true,
					},
					relationshipOnly: {
						keywords: { 纯关系维护: true, 不讨论产品: true },
						default: false,
					},
					includeQuote: {
						keywords: { 报价: true, 价格: true, 预算: true, 多少钱: true },
						default: false,
					},
				},
			},
			{
				id: "lookup_company",
				kind: "tool",
				label: "Identify Customer (CRM)",
				labelZh: "CRM 客户识别与检索",
				description: "Search CRM companies to verify identity or detect multiple candidates",
				descriptionZh: "调用 list_companies 核验客户唯一身份或发现多候选同名企业",
				tools: ["list_companies"],
				call: { tool: "list_companies", args: { query: "$vars.company" }, storeAs: "lookup" },
			},
			{
				id: "check_candidates",
				kind: "switch",
				label: "Disambiguation Gate",
				labelZh: "客户消歧与分支路由",
				description: "Route by CRM match count (>1 candidates, 1 unique match, or 0 found)",
				descriptionZh: "按匹配数量自动分流：多候选暂停确认、唯一匹配拉取 CRM 事实、查无直接进产品匹配",
				branches: [
					{ id: "multiple", label: "> 1 candidates", labelZh: "多个候选客户 (needs_input)", when: "steps.lookup.count > 1", target: "ask_disambiguate" },
					{ id: "single", label: "1 unique match", labelZh: "唯一匹配客户", when: "steps.lookup.count == 1", target: "crm_facts" },
				],
				defaultTarget: "product_cases",
			},
			{
				id: "ask_disambiguate",
				kind: "ask_user",
				label: "Ask User to Select Customer",
				labelZh: "多候选客户确认 (needs_input)",
				description: "Stop without guessing and ask the user to pick the exact company (0 LLM calls)",
				descriptionZh: "发现多个合理候选，展示真实企业名称请用户选择，零模型调用防幻觉",
				promptTemplate: 'Found multiple matching companies for "{{vars.company}}". Please select which one to prepare the visit brief for:\n{{steps.lookup.candidateNames}}',
				promptTemplateZh: "在 CRM 中检索到多个与“{{vars.company}}”匹配的候选企业，请确认本次拜访的具体对象：\n{{steps.lookup.candidateNames}}",
			},
			{
				id: "crm_facts",
				kind: "parallel",
				label: "Parallel CRM Facts",
				labelZh: "并行拉取 CRM 权威事实",
				description: "Fetch company profile, active deals, and recent activities concurrently via Promise.all",
				descriptionZh: "并发调用 get_company、list_deals、list_activities 一次性补齐客户、商机与互动事实",
				tools: ["get_company", "list_deals", "list_activities"],
				parallel: [
					{ id: "company_detail", label: "Company Profile", labelZh: "企业与联系人概况", tool: "get_company", args: { companyId: "$steps.lookup.firstId" }, storeAs: "company_detail" },
					{ id: "deals", label: "Active Deals", labelZh: "关联商机列表", tool: "list_deals", args: { companyId: "$steps.lookup.firstId" }, storeAs: "deals" },
					{ id: "activities", label: "Recent Activities", labelZh: "近期真实互动", tool: "list_activities", args: { companyId: "$steps.lookup.firstId" }, storeAs: "activities" },
				],
			},
			{
				id: "product_cases",
				kind: "parallel",
				label: "Parallel Product & Case Match",
				labelZh: "并行匹配我司产品与案例",
				description: "Concurrently search product docs, success cases, and optional quote catalog",
				descriptionZh: "并发检索产品文档、成功案例及报价目录（纯关系维护拜访自动标记 skipped）",
				tools: ["find_product_documents", "find_success_cases", "search_quote_catalog"],
				parallel: [
					{ id: "products", label: "Product Documents", labelZh: "产品资料检索", tool: "find_product_documents", args: { query: "$vars.company" }, when: "vars.relationshipOnly != true", storeAs: "products" },
					{ id: "cases", label: "Success Cases", labelZh: "行业成功案例", tool: "find_success_cases", args: { query: "$vars.company" }, when: "vars.relationshipOnly != true", storeAs: "cases" },
					{ id: "quotes", label: "Quote Catalog", labelZh: "标准报价目录", tool: "search_quote_catalog", args: { query: "$vars.company" }, when: "vars.includeQuote == true", storeAs: "quotes" },
				],
			},
			{
				id: "reply",
				kind: "llm_reply",
				label: "Synthesize Visit Briefing",
				labelZh: "合成结构化拜访简报",
				description: "1-turn LLM synthesis strictly separating CRM facts, product evidence, and unverified gaps",
				descriptionZh: "单次模型调用生成完整拜访简报：明确区分 CRM 事实、我司资料、待核实假设与信息缺口",
			},
		],
		edges: [
			{ id: "e1", source: "start", target: "extract_target" },
			{ id: "e2", source: "extract_target", target: "lookup_company" },
			{ id: "e3", source: "lookup_company", target: "check_candidates" },
			{ id: "e4", source: "check_candidates", target: "ask_disambiguate", branch: "ask_disambiguate", label: "> 1 matches", labelZh: "多候选消歧" },
			{ id: "e5", source: "check_candidates", target: "crm_facts", branch: "crm_facts", label: "1 match", labelZh: "唯一匹配" },
			{ id: "e6", source: "check_candidates", target: "product_cases", branch: "product_cases", label: "0 matches", labelZh: "查无直接匹配" },
			{ id: "e7", source: "crm_facts", target: "product_cases" },
			{ id: "e8", source: "product_cases", target: "reply" },
		],
	},
	{
		id: "sales-reports",
		title: "Sales Report Generation Flow",
		titleZh: "销售报告（日/周/月报）工作流",
		mode: "deterministic",
		triggerKeywords: ["日报", "周报", "月报"],
		nodes: [
			{ id: "start", kind: "start", label: "Report Request", labelZh: "销售报告请求", description: "Identify report cadence (daily, weekly, monthly)", descriptionZh: "接收销售日报、周报或月报生成指令" },
			{ id: "extract_period", kind: "extract", label: "Detect Report Period", labelZh: "识别报告周期类型", description: "Deterministically classify daily, weekly, or monthly cadence", descriptionZh: "确定性识别日报、周报或月报周期" },
			{
				id: "route_period",
				kind: "switch",
				label: "Route by Cadence",
				labelZh: "按周期分流工具",
				branches: [
					{ id: "monthly", label: "Monthly", labelZh: "销售月报", when: "vars.period == 'monthly'", target: "fetch_monthly" },
					{ id: "weekly", label: "Weekly", labelZh: "销售周报", when: "vars.period == 'weekly'", target: "fetch_weekly" },
				],
				defaultTarget: "fetch_daily",
			},
			{ id: "fetch_daily", kind: "tool", label: "Fetch Daily Sales Brief", labelZh: "拉取销售日报数据", tools: ["get_daily_sales_brief"], call: { tool: "get_daily_sales_brief", args: {}, storeAs: "report_data" } },
			{ id: "fetch_weekly", kind: "tool", label: "Fetch Weekly Sales Report", labelZh: "拉取销售周报数据", tools: ["get_sales_weekly_report"], call: { tool: "get_sales_weekly_report", args: {}, storeAs: "report_data" } },
			{ id: "fetch_monthly", kind: "tool", label: "Fetch Monthly Sales Report", labelZh: "拉取销售月报数据", tools: ["get_sales_monthly_report"], call: { tool: "get_sales_monthly_report", args: {}, storeAs: "report_data" } },
			{ id: "reply", kind: "llm_reply", label: "Format Executive Report", labelZh: "生成管理层分析报告", description: "1-turn LLM synthesis with KPI highlights and risk actions", descriptionZh: "基于权威统计指标单次合成结构化报告" },
		],
		edges: [
			{ id: "e1", source: "start", target: "extract_period" },
			{ id: "e2", source: "extract_period", target: "route_period" },
			{ id: "e3", source: "route_period", target: "fetch_daily", branch: "fetch_daily", label: "Daily", labelZh: "日报" },
			{ id: "e4", source: "route_period", target: "fetch_weekly", branch: "fetch_weekly", label: "Weekly", labelZh: "周报" },
			{ id: "e5", source: "route_period", target: "fetch_monthly", branch: "fetch_monthly", label: "Monthly", labelZh: "月报" },
			{ id: "e6", source: "fetch_daily", target: "reply" },
			{ id: "e7", source: "fetch_weekly", target: "reply" },
			{ id: "e8", source: "fetch_monthly", target: "reply" },
		],
	},
];

/** Assign each DAG node to a topological depth layer so branches render side-by-side in the same row. */
export function computeFlowLayers(flow: SkillFlow): FlowNode[][] {
	const byId = new Map((flow.nodes ?? []).map((node) => [node.id, node]));
	const indegree = new Map<string, number>();
	const parents = new Map<string, string[]>();
	for (const node of flow.nodes ?? []) {
		indegree.set(node.id, 0);
		parents.set(node.id, []);
	}
	for (const edge of flow.edges ?? []) {
		if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
		parents.get(edge.target)!.push(edge.source);
	}
	// Longest-path layering keeps join nodes below all of their incoming branches.
	const depth = new Map<string, number>();
	const visiting = new Set<string>();
	const depthOf = (id: string): number => {
		if (depth.has(id)) return depth.get(id)!;
		if (visiting.has(id)) return 0;
		visiting.add(id);
		const incoming = parents.get(id) ?? [];
		const d = incoming.length === 0 ? 0 : Math.max(...incoming.map(depthOf)) + 1;
		visiting.delete(id);
		depth.set(id, d);
		return d;
	};
	for (const node of flow.nodes ?? []) depthOf(node.id);

	const maxDepth = Math.max(0, ...depth.values());
	const layers: FlowNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
	for (const node of flow.nodes ?? []) {
		layers[depth.get(node.id) ?? 0]!.push(node);
	}
	return layers.filter((layer) => layer.length > 0);
}

/** Validate a `SkillFlow` in the browser for unique node IDs, valid edge endpoints, switch targets, and DAG acyclicity. */
export function validateFlowGraph(flow: SkillFlow): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!flow.id.trim()) errors.push("Flow ID is required.");
	if (flow.nodes.length === 0) errors.push("Flow must contain at least one node.");
	const byId = new Map<string, FlowNode>();
	for (const node of flow.nodes) {
		if (!node.id.trim()) errors.push("Every node requires a non-empty ID.");
		else if (byId.has(node.id)) errors.push(`Duplicate node ID "${node.id}".`);
		else byId.set(node.id, node);
	}
	const adj = new Map<string, string[]>();
	for (const edge of flow.edges) {
		if (!byId.has(edge.source)) errors.push(`Edge "${edge.id}" references unknown source "${edge.source}".`);
		if (!byId.has(edge.target)) errors.push(`Edge "${edge.id}" references unknown target "${edge.target}".`);
		const list = adj.get(edge.source) ?? [];
		list.push(edge.target);
		adj.set(edge.source, list);
	}
	for (const node of flow.nodes) {
		if (node.kind === "switch") {
			for (const b of node.branches ?? []) {
				if (!b.target || !byId.has(b.target)) {
					errors.push(`Switch "${node.id}" branch "${b.label || b.id}" targets unknown node "${b.target}".`);
				}
			}
			if (node.defaultTarget !== undefined && node.defaultTarget !== "" && !byId.has(node.defaultTarget)) {
				errors.push(`Switch "${node.id}" defaultTarget references unknown node "${node.defaultTarget}".`);
			}
		}
	}
	// 3-color DFS cycle check
	const color = new Map<string, 0 | 1 | 2>();
	const visit = (id: string): void => {
		color.set(id, 1);
		for (const next of adj.get(id) ?? []) {
			const c = color.get(next) ?? 0;
			if (c === 1) {
				errors.push(`Cycle detected involving node "${next}".`);
				return;
			}
			if (c === 0) visit(next);
		}
		color.set(id, 2);
	};
	for (const node of flow.nodes) {
		if ((color.get(node.id) ?? 0) === 0) visit(node.id);
	}
	return { valid: errors.length === 0, errors };
}

/** Insert a new node after `afterNodeId` and splice it into `afterNodeId`'s outgoing edges. */
export function insertNodeAfter(flow: SkillFlow, afterNodeId: string, newNode: FlowNode): SkillFlow {
	const afterIdx = flow.nodes.findIndex((n) => n.id === afterNodeId);
	const nodes = [...flow.nodes];
	if (afterIdx === -1) {
		nodes.push(newNode);
	} else {
		nodes.splice(afterIdx + 1, 0, newNode);
	}

	const afterNode = flow.nodes.find((n) => n.id === afterNodeId);
	const outgoing = flow.edges.filter((e) => e.source === afterNodeId);
	let edges = [...flow.edges];

	if (afterNode?.kind === "switch" || outgoing.length === 0) {
		edges.push({
			id: `e_${afterNodeId}_${newNode.id}`,
			source: afterNodeId,
			target: newNode.id,
		});
	} else {
		// Splice inline: afterNode -> newNode -> original targets
		edges = edges.filter((e) => e.source !== afterNodeId);
		edges.push({
			id: `e_${afterNodeId}_${newNode.id}`,
			source: afterNodeId,
			target: newNode.id,
		});
		for (const out of outgoing) {
			edges.push({
				...out,
				id: `e_${newNode.id}_${out.target}`,
				source: newNode.id,
			});
		}
	}
	return { ...flow, nodes, edges };
}

/** Delete `nodeId` from `flow` and heal incoming -> outgoing edges so the graph stays connected. */
export function deleteFlowNode(flow: SkillFlow, nodeId: string): SkillFlow {
	const incoming = flow.edges.filter((e) => e.target === nodeId);
	const outgoing = flow.edges.filter((e) => e.source === nodeId);
	const remainingEdges = flow.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
	const healedEdges = [...remainingEdges];

	for (const inc of incoming) {
		for (const out of outgoing) {
			if (inc.source !== out.target && !healedEdges.some((e) => e.source === inc.source && e.target === out.target)) {
				healedEdges.push({
					id: `e_${inc.source}_${out.target}`,
					source: inc.source,
					target: out.target,
					...(inc.label ? { label: inc.label } : {}),
					...(inc.labelZh ? { labelZh: inc.labelZh } : {}),
					...(inc.branch ? { branch: inc.branch } : {}),
				});
			}
		}
	}

	const nodes = flow.nodes
		.filter((n) => n.id !== nodeId)
		.map((n) => {
			if (n.kind !== "switch") return n;
			return {
				...n,
				...(n.branches ? { branches: n.branches.filter((b) => b.target !== nodeId) } : {}),
				...(n.defaultTarget === nodeId ? { defaultTarget: outgoing[0]?.target } : {}),
			};
		});

	return { ...flow, nodes, edges: healedEdges };
}

function kindMeta(kind: FlowNodeKind, isZh: boolean): { label: string; Icon: typeof Play; tone: string } {
	switch (kind) {
		case "start":
			return { label: isZh ? "触发入口" : "Trigger", Icon: Play, tone: "tone-start" };
		case "extract":
			return { label: isZh ? "零模型槽位提取" : "Slot Extract", Icon: Filter, tone: "tone-extract" };
		case "tool":
			return { label: isZh ? "工具调用" : "Tool Call", Icon: Wrench, tone: "tone-tool" };
		case "parallel":
			return { label: isZh ? "并发工具组" : "Parallel Fan-Out", Icon: Layers, tone: "tone-parallel" };
		case "switch":
			return { label: isZh ? "确定性路由" : "Branch Switch", Icon: GitBranch, tone: "tone-switch" };
		case "ask_user":
			return { label: isZh ? "消歧确认" : "Disambiguate", Icon: HelpCircle, tone: "tone-ask" };
		case "llm_reply":
			return { label: isZh ? "单次模型合成" : "LLM Synthesis", Icon: Sparkles, tone: "tone-llm" };
	}
}

function statusMeta(status: FlowStepStatus | undefined, isZh: boolean): { label: string; Icon: typeof CircleDot; cls: string } {
	switch (status) {
		case "running":
			return { label: isZh ? "执行中" : "Running", Icon: Loader2, cls: "status-running" };
		case "completed":
			return { label: isZh ? "已完成" : "Completed", Icon: CheckCircle2, cls: "status-completed" };
		case "skipped":
			return { label: isZh ? "已剪枝跳过" : "Skipped", Icon: SkipForward, cls: "status-skipped" };
		case "needs_input":
			return { label: isZh ? "等待用户确认" : "Needs Input", Icon: CircleAlert, cls: "status-needs-input" };
		case "failed":
			return { label: isZh ? "执行失败" : "Failed", Icon: CircleAlert, cls: "status-failed" };
		default:
			return { label: isZh ? "待执行" : "Blueprint", Icon: CircleDot, cls: "status-pending" };
	}
}

function getStepTrace(trace: FlowRunTrace | undefined, nodeId: string): FlowStepTrace | undefined {
	if (!trace) return undefined;
	if (Array.isArray(trace.steps)) {
		return trace.steps.find((s) => (s.stepId ?? s.nodeId) === nodeId);
	}
	return trace.steps[nodeId];
}

function getTraceFlowId(trace: FlowRunTrace | undefined): string | undefined {
	if (!trace) return undefined;
	return trace.flowId ?? trace.flow?.id ?? trace.skill ?? trace.skillName;
}

function defaultNodeForKind(kind: FlowNodeKind, idSuffix: number, defaultTool?: string): FlowNode {
	const id = `${kind}_${idSuffix}`;
	switch (kind) {
		case "extract":
			return {
				id,
				kind: "extract",
				label: "Extract Slot",
				labelZh: "提取槽位参数",
				description: "Extract entities or flags without an LLM round-trip",
				descriptionZh: "零模型调用提取关键实体或意图标记",
				extract: { query: { fallbackInput: true } },
			};
		case "tool":
			return {
				id,
				kind: "tool",
				label: "Call MCP Tool",
				labelZh: "调用 MCP 工具",
				tools: defaultTool ? [defaultTool] : [],
				call: { tool: defaultTool ?? "", args: { query: "$vars.query" }, storeAs: id },
			};
		case "parallel":
			return {
				id,
				kind: "parallel",
				label: "Parallel Tool Fan-Out",
				labelZh: "并发工具组 (Promise.all)",
				tools: defaultTool ? [defaultTool] : [],
				parallel: [
					{
						id: `p_${idSuffix}_1`,
						label: "Parallel Call 1",
						labelZh: "并发调用 1",
						tool: defaultTool ?? "",
						args: { query: "$vars.query" },
						storeAs: `p_${idSuffix}_1`,
					},
				],
			};
		case "switch":
			return {
				id,
				kind: "switch",
				label: "Condition Router",
				labelZh: "条件分支路由",
				branches: [],
			};
		case "ask_user":
			return {
				id,
				kind: "ask_user",
				label: "Ask User to Confirm",
				labelZh: "请求用户确认消歧",
				promptTemplate: "Multiple matches found for {{vars.query}}. Please confirm which one to use.",
				promptTemplateZh: "检索到多个与“{{vars.query}}”匹配的候选项，请确认具体对象。",
			};
		case "llm_reply":
			return {
				id,
				kind: "llm_reply",
				label: "Synthesize Response",
				labelZh: "单次模型合成回复",
			};
		case "start":
			return { id, kind: "start", label: "Start", labelZh: "触发入口" };
	}
}

function downloadFlowJson(flow: SkillFlow): void {
	const json = `${JSON.stringify(flow, null, "\t")}\n`;
	const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = `${flow.id}-flow.json`;
	link.click();
	URL.revokeObjectURL(url);
}

export type WorkflowTemplateKind = "parallel" | "branching" | "minimal";

export function createWorkflowFromTemplate(opts: {
	id: string;
	title: string;
	titleZh?: string;
	description?: string;
	mode: "deterministic" | "guided";
	triggerKeywords: string[];
	template: WorkflowTemplateKind;
	defaultTool?: string;
}): SkillFlow {
	const primaryTool = opts.defaultTool || "crm_search_companies";
	const base = {
		id: opts.id,
		title: opts.title,
		...(opts.titleZh ? { titleZh: opts.titleZh } : {}),
		...(opts.description ? { description: opts.description, descriptionZh: opts.description } : {}),
		mode: opts.mode,
		...(opts.triggerKeywords.length > 0 ? { triggerKeywords: opts.triggerKeywords } : {}),
	};

	if (opts.template === "minimal") {
		return {
			...base,
			nodes: [
				{ id: "start", kind: "start", label: "User Request", labelZh: "用户请求触发" },
				{
					id: "call_tool",
					kind: "tool",
					label: "Execute Primary Tool",
					labelZh: "调用核心工具获取数据",
					tools: [primaryTool],
					call: { tool: primaryTool, args: { query: "{{vars.query}}" }, storeAs: "toolResult" },
				},
				{
					id: "synthesize",
					kind: "llm_reply",
					label: "Synthesize Response",
					labelZh: "单次模型合成回复",
				},
			],
			edges: [
				{ id: "e_start_tool", source: "start", target: "call_tool" },
				{ id: "e_tool_synth", source: "call_tool", target: "synthesize" },
			],
		};
	}

	if (opts.template === "branching") {
		return {
			...base,
			nodes: [
				{ id: "start", kind: "start", label: "Trigger Request", labelZh: "触发技能请求" },
				{
					id: "extract_slots",
					kind: "extract",
					label: "Extract Target & Intent",
					labelZh: "提取目标对象与意图槽位",
					extract: { query: { fallbackInput: true } },
				},
				{
					id: "lookup_entity",
					kind: "tool",
					label: "Search Target Entity",
					labelZh: "检索目标实体候选项",
					tools: [primaryTool],
					call: { tool: primaryTool, args: { query: "{{vars.query}}" }, storeAs: "candidates" },
				},
				{
					id: "route_match",
					kind: "switch",
					label: "Evaluate Match Count",
					labelZh: "条件分支：校验匹配数量",
					branches: [
						{ id: "b_none", label: "0 matches", labelZh: "0 个匹配", when: "candidates.count == 0", target: "ask_clarify" },
						{ id: "b_single", label: "Exact match", labelZh: "唯一匹配", when: "candidates.count == 1", target: "parallel_context" },
						{ id: "b_multi", label: ">1 matches", labelZh: "多个同名候选", when: "candidates.count > 1", target: "ask_clarify" },
					],
					defaultTarget: "parallel_context",
				},
				{
					id: "ask_clarify",
					kind: "ask_user",
					label: "Ask User to Clarify",
					labelZh: "向用户追问确认",
					promptTemplate: "Please clarify which target entity you would like to inspect for \"{{vars.query}}\".",
					promptTemplateZh: "针对“{{vars.query}}”未找到唯一匹配项，请确认具体名称或编号。",
				},
				{
					id: "parallel_context",
					kind: "parallel",
					label: "Parallel Context Fetch",
					labelZh: "并发拉取多维上下文 (Promise.all)",
					tools: [primaryTool],
					parallel: [
						{
							id: "p_detail",
							label: "Fetch Primary Details",
							labelZh: "拉取核心档案明细",
							tool: primaryTool,
							args: { query: "{{vars.query}}" },
							storeAs: "detailData",
						},
					],
				},
				{
					id: "synthesize",
					kind: "llm_reply",
					label: "Single-Pass LLM Synthesis",
					labelZh: "单次模型合成结构化结论",
				},
			],
			edges: [
				{ id: "e1", source: "start", target: "extract_slots" },
				{ id: "e2", source: "extract_slots", target: "lookup_entity" },
				{ id: "e3", source: "lookup_entity", target: "route_match" },
				{ id: "e4", source: "route_match", target: "ask_clarify", label: "0 / >1" },
				{ id: "e5", source: "route_match", target: "parallel_context", label: "1 match" },
				{ id: "e6", source: "parallel_context", target: "synthesize" },
			],
		};
	}

	// Default: "parallel" (Extract -> Parallel Fan-Out -> Single LLM Synthesis)
	return {
		...base,
		nodes: [
			{ id: "start", kind: "start", label: "Trigger Request", labelZh: "触发技能请求" },
			{
				id: "extract_slots",
				kind: "extract",
				label: "Extract Parameters",
				labelZh: "确定性提取请求参数",
				extract: { query: { fallbackInput: true } },
			},
			{
				id: "parallel_gather",
				kind: "parallel",
				label: "Parallel MCP Tool Fan-Out",
				labelZh: "并发调用多源 MCP 工具 (Promise.all)",
				tools: [primaryTool],
				parallel: [
					{
						id: "call_1",
						label: "Primary Data Lookup",
						labelZh: "主数据源查询",
						tool: primaryTool,
						args: { query: "{{vars.query}}" },
						storeAs: "primaryData",
					},
				],
			},
			{
				id: "synthesize",
				kind: "llm_reply",
				label: "Single-Pass LLM Synthesis",
				labelZh: "单次模型合成结构化回复",
			},
		],
		edges: [
			{ id: "e_start_extract", source: "start", target: "extract_slots" },
			{ id: "e_extract_parallel", source: "extract_slots", target: "parallel_gather" },
			{ id: "e_parallel_synth", source: "parallel_gather", target: "synthesize" },
		],
	};
}

export function WorkflowView({ agent, trace, readOnly = false, embedded }: Props) {
	const { t, language } = useI18n();
	const isZh = language === "zh";

	const skillsQuery = useQuery({
		queryKey: ["skills", agent],
		queryFn: () => rpc<{ skills: SkillEntry[] }>(agent, "skills.list"),
		staleTime: 60_000,
		retry: false,
	});

	const traceFlowId = getTraceFlowId(trace);

	const availableFlows = useMemo(() => {
		const map = new Map<string, SkillFlow>();
		if (trace?.flow) map.set(trace.flow.id, trace.flow);
		for (const skill of skillsQuery.data?.skills ?? []) {
			if (skill.flow) map.set(skill.flow.id, skill.flow);
		}
		for (const fallback of FALLBACK_FLOWS) {
			if (!map.has(fallback.id)) map.set(fallback.id, fallback);
		}
		return [...map.values()];
	}, [skillsQuery.data?.skills, trace?.flow]);

	const [selectedFlowId, setSelectedFlowId] = useState<string>();
	const [editing, setEditing] = useState(false);
	const [ownDraft, setOwnDraft] = useState<SkillFlow>();
	// Embedded, the page's flow is the draft and every change goes back to it.
	const draft = embedded?.flow ?? ownDraft;
	const setDraft = (next: SkillFlow | undefined | ((prev: SkillFlow | undefined) => SkillFlow | undefined)) => {
		if (embedded === undefined) {
			setOwnDraft(next);
			return;
		}
		const value = typeof next === "function" ? next(embedded.flow) : next;
		if (value !== undefined) embedded.onChange(value);
	};
	const [showJson, setShowJson] = useState(false);
	const [saveStatus, setSaveStatus] = useState<{ kind: "ok" | "err"; message: string }>();
	const activeFlowId = embedded?.flow.id ?? selectedFlowId ?? traceFlowId ?? availableFlows[0]?.id;
	const sourceFlow = availableFlows.find((f) => f.id === activeFlowId) ?? trace?.flow ?? availableFlows[0];
	const activeFlow = draft ?? sourceFlow;
	const isEditing = !readOnly && (editing || draft !== undefined);
	const isShowingLiveTrace = !isEditing && trace !== undefined && activeFlow?.id === traceFlowId;

	// Allowlisted tools for the currently selected skill (plus agent-wide tools for new workflows)
	const allowlistedTools = useMemo(() => {
		const skillEntry = skillsQuery.data?.skills.find((s) => s.name === activeFlow?.id);
		const set = new Set<string>(skillEntry?.tools ?? []);
		for (const skill of skillsQuery.data?.skills ?? []) {
			for (const tName of skill.tools ?? []) {
				if (tName !== "*") set.add(tName);
			}
		}
		for (const node of activeFlow?.nodes ?? []) {
			for (const tool of node.tools ?? []) set.add(tool);
			if (node.call?.tool) set.add(node.call.tool);
			for (const p of node.parallel ?? []) if (p.tool) set.add(p.tool);
		}
		return [...set].filter(Boolean);
	}, [skillsQuery.data?.skills, activeFlow]);

	const layers = useMemo(() => (activeFlow ? computeFlowLayers(activeFlow) : []), [activeFlow]);
	const validation = useMemo(() => (activeFlow ? validateFlowGraph(activeFlow) : { valid: true, errors: [] }), [activeFlow]);
	const [selectedNodeId, setSelectedNodeId] = useState<string>();

	const activeNode = useMemo(() => {
		if (!activeFlow) return undefined;
		if (selectedNodeId) {
			const found = activeFlow.nodes.find((n) => n.id === selectedNodeId);
			if (found) return found;
		}
		if (isShowingLiveTrace && trace) {
			const running = activeFlow.nodes.find((n) => getStepTrace(trace, n.id)?.status === "running");
			if (running) return running;
			const needsInput = activeFlow.nodes.find((n) => getStepTrace(trace, n.id)?.status === "needs_input");
			if (needsInput) return needsInput;
		}
		return activeFlow.nodes.find((n) => n.kind === "parallel" || n.kind === "switch") ?? activeFlow.nodes[0];
	}, [activeFlow, selectedNodeId, isShowingLiveTrace, trace]);

	if (!activeFlow) {
		return <Empty icon={GitBranch} title={t("No workflow available")} />;
	}

	const flowTitle = isZh ? activeFlow.titleZh ?? activeFlow.title : activeFlow.title;
	const activeStepTrace: FlowStepTrace | undefined = isShowingLiveTrace && activeNode ? getStepTrace(trace, activeNode.id) : undefined;
	const traceDurationMs = trace?.totalDurationMs ?? trace?.durationMs;

	const startEditing = () => {
		if (readOnly) return;
		setEditing(true);
		setDraft(structuredClone(activeFlow));
		setSaveStatus(undefined);
	};

	const cancelEditing = () => {
		setEditing(false);
		setDraft(undefined);
		setShowJson(false);
		setSaveStatus(undefined);
	};

	const updateNode = (nodeId: string, updater: (node: FlowNode) => FlowNode) => {
		setDraft((prev) => {
			const base = prev ?? structuredClone(activeFlow);
			const nodes = base.nodes.map((n) => (n.id === nodeId ? updater(n) : n));
			return { ...base, nodes };
		});
		setSaveStatus(undefined);
	};

	const handleAddStep = (kind: FlowNodeKind) => {
		const base = draft ?? structuredClone(activeFlow);
		const anchorId = activeNode?.id ?? base.nodes.at(-1)?.id ?? "start";
		const newNode = defaultNodeForKind(kind, base.nodes.length + 1, allowlistedTools[0]);
		const updated = insertNodeAfter(base, anchorId, newNode);
		setDraft(updated);
		setSelectedNodeId(newNode.id);
		setSaveStatus(undefined);
	};

	const handleDeleteNode = (nodeId: string) => {
		const base = draft ?? structuredClone(activeFlow);
		const updated = deleteFlowNode(base, nodeId);
		setDraft(updated);
		setSelectedNodeId(updated.nodes[0]?.id);
		setSaveStatus(undefined);
	};

	return (
		<div className="workflow-view" data-testid="workflow-view">
			{/* Top selector & builder action bar */}
			<div className="workflow-toolbar">
				{embedded === undefined && (<>
				<label className="workflow-selector-label" htmlFor="workflow-skill-select">
					<GitBranch size={14} aria-hidden="true" />
					<span>{isZh ? "技能工作流" : "Skill Workflow"}</span>
				</label>
				<select
					id="workflow-skill-select"
					className="workflow-select"
					value={activeFlow.id}
					onChange={(e) => {
						setSelectedFlowId(e.target.value);
						setDraft(undefined);
						setSelectedNodeId(undefined);
						setSaveStatus(undefined);
					}}
				>
					{availableFlows.map((flow) => {
						const label = isZh ? flow.titleZh ?? flow.title : flow.title;
						const isLive = traceFlowId === flow.id;
						const modeTag = flow.mode === "deterministic" ? (isZh ? "⚡ 确定性" : "⚡ Deterministic") : isZh ? "🧭 引导式" : "🧭 Guided";
						return (
							<option key={flow.id} value={flow.id}>
								{isLive ? (isZh ? `● 当前执行：${label}` : `● Live: ${label}`) : `${label} (${modeTag})`}
							</option>
						);
					})}
				</select>
				</>)}
				{!readOnly && !isEditing && (
					<button
						type="button"
						className="ghost small"
						onClick={startEditing}
						data-testid="workflow-edit-btn"
					>
						<Pencil size={13} aria-hidden="true" />
						<span>{isZh ? "可视化编排" : "Edit Flow"}</span>
					</button>
				)}
				{isEditing && (
					<div className="workflow-builder-actions">
						<button
							type="button"
							className="ghost small"
							onClick={() => setShowJson(!showJson)}
							title={isZh ? "查看/导出 flow.json" : "View / Export flow.json"}
						>
							<Code2 size={13} aria-hidden="true" />
							<span>JSON</span>
						</button>
						{embedded === undefined && (
							<button type="button" className="ghost small" onClick={cancelEditing}>
								<X size={13} aria-hidden="true" />
								<span>{isZh ? "预览视图" : "Preview"}</span>
							</button>
						)}
					</div>
				)}
			</div>

			{/* Save status or DAG validation banner in Builder mode */}
			{isEditing && (
				<div className="workflow-builder-bar" data-testid="workflow-builder-bar">
					<div className="workflow-builder-meta">
						<label className="workflow-field-inline">
							<span>{isZh ? "执行模式" : "Execution Mode"}</span>
							<select
								value={activeFlow.mode}
								onChange={(e) => setDraft({ ...(draft ?? structuredClone(activeFlow)), mode: e.target.value as "deterministic" | "guided" })}
							>
								<option value="deterministic">{isZh ? "⚡ 确定性自动编排 (Deterministic)" : "⚡ Deterministic"}</option>
								<option value="guided">{isZh ? "🧭 引导式技能流 (Guided)" : "🧭 Guided"}</option>
							</select>
						</label>
						<label className="workflow-field-inline">
							<span>{isZh ? "触发词 (逗号分隔)" : "Triggers (comma-sep)"}</span>
							<input
								type="text"
								value={(activeFlow.triggerKeywords ?? []).join(", ")}
								placeholder={isZh ? "例如：拜访, 见客户, 沟通材料" : "e.g. visit, brief, report"}
								onChange={(e) =>
									setDraft({
										...(draft ?? structuredClone(activeFlow)),
										triggerKeywords: e.target.value
											.split(",")
											.map((s) => s.trim())
											.filter(Boolean),
									})
								}
							/>
						</label>
					</div>

					{/* Add Step palette */}
					<div className="workflow-palette">
						<span className="workflow-palette-label">
							<Plus size={12} aria-hidden="true" />
							{isZh ? `在「${activeNode?.labelZh ?? activeNode?.label ?? "当前节点"}」后插入：` : `Insert after "${activeNode?.label ?? "selected"}":`}
						</span>
						{(["extract", "tool", "parallel", "switch", "ask_user", "llm_reply"] as const).map((kind) => {
							const { label, Icon, tone } = kindMeta(kind, isZh);
							return (
								<button
									key={kind}
									type="button"
									className={`workflow-palette-btn ${tone}`}
									onClick={() => handleAddStep(kind)}
									data-testid={`add-node-${kind}`}
								>
									<Icon size={11} aria-hidden="true" />
									<span>+ {label}</span>
								</button>
							);
						})}
					</div>

					{/* Live DAG Validation status */}
					<div className={`workflow-validation ${validation.valid ? "ok" : "err"}`}>
						{validation.valid ? (
							<>
								<Check size={13} aria-hidden="true" />
								<span>
									{isZh
										? `DAG 校验通过（${activeFlow.nodes.length} 个节点，${activeFlow.edges.length} 条有向边，无环）`
										: `Valid acyclic DAG (${activeFlow.nodes.length} nodes, ${activeFlow.edges.length} edges)`}
								</span>
							</>
						) : (
							<>
								<CircleAlert size={13} aria-hidden="true" />
								<span>{validation.errors.join(" ")}</span>
							</>
						)}
					</div>

					{saveStatus && (
						<div className={`workflow-save-alert ${saveStatus.kind}`} role="status">
							{saveStatus.kind === "ok" ? <CheckCircle2 size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
							<span>{saveStatus.message}</span>
						</div>
					)}
				</div>
			)}

			{/* Raw JSON preview & export drawer */}
			{isEditing && showJson && (
				<div className="workflow-json-drawer">
					<div className="workflow-json-head">
						<strong><code>{activeFlow.id}/flow.json</code></strong>
						<div className="workflow-builder-actions">
							<CopyButton text={JSON.stringify(activeFlow, null, 2)} label="Copy" className="ghost small" />
							<button type="button" className="ghost small" onClick={() => downloadFlowJson(activeFlow)}>
								<Download size={13} aria-hidden="true" />
								<span>{isZh ? "下载 flow.json" : "Download flow.json"}</span>
							</button>
						</div>
					</div>
					<pre className="workflow-inspector-pre">{JSON.stringify(activeFlow, null, 2)}</pre>
				</div>
			)}

			{/* Mode & Performance Metrics Banner (when not in builder mode) */}
			{!isEditing && (
				<div className={`workflow-banner ${activeFlow.mode === "deterministic" ? "deterministic" : "guided"}`}>
					<div className="workflow-banner-top">
						<span className={`workflow-mode-pill ${activeFlow.mode}`}>
							{activeFlow.mode === "deterministic" ? <Zap size={13} aria-hidden="true" /> : <Compass size={13} aria-hidden="true" />}
							<span>
								{activeFlow.mode === "deterministic"
									? isZh
										? "确定性编排工作流 (Deterministic)"
										: "Deterministic Step-by-Step Flow"
									: isZh
										? "引导式技能工作流 (Guided)"
										: "Guided Agent Skill Flow"}
							</span>
						</span>
						{isShowingLiveTrace && trace && (
							<span className={`workflow-run-status status-${trace.status}`}>
								{trace.status === "running" && <Loader2 size={12} className="spin" aria-hidden="true" />}
								{trace.status === "completed" && <CheckCircle2 size={12} aria-hidden="true" />}
								{trace.status === "needs_input" && <CircleAlert size={12} aria-hidden="true" />}
								<span>
									{trace.status === "running"
										? isZh
											? "实时执行中"
											: "Running Live"
										: trace.status === "completed"
											? isZh
												? "执行完成"
												: "Completed"
											: trace.status === "needs_input"
												? isZh
													? "待用户确认"
													: "Needs Input"
												: isZh
													? "执行异常"
													: "Failed"}
								</span>
							</span>
						)}
					</div>
					<p className="workflow-banner-desc">
						{activeFlow.mode === "deterministic"
							? isZh
								? "无需多轮串行模型思考：由确定性状态机自动提取槽位、并发调用 MCP 工具并按条件路由，仅在汇总阶段调用 1 次大模型。"
								: "Eliminates multi-turn LLM round-trips: extracts slots, runs parallel MCP tools via Promise.all, and branches deterministically before a 1-turn synthesis."
							: isZh
								? "展示智能体执行该技能时的标准推理阶段与挂载工具。可点击右上角「可视化编排」将其升级为确定性工作流。"
								: "Visualizes how the agent reasons through this skill's stages and tools. Click 'Edit Flow' above to customize or upgrade to deterministic mode."}
					</p>
					{isShowingLiveTrace && trace && (
						<div className="workflow-metrics" data-testid="workflow-metrics">
							{traceDurationMs !== undefined && (
								<span className="workflow-metric-chip">
									<Clock size={12} aria-hidden="true" />
									<span>
										{isZh ? "编排耗时" : "Flow Time"}: <strong>{traceDurationMs}ms</strong>
									</span>
								</span>
							)}
							{(trace.llmCallsSaved ?? 0) > 0 && (
								<span className="workflow-metric-chip highlight">
									<Zap size={12} aria-hidden="true" />
									<span>
										{isZh ? `节省 ${trace.llmCallsSaved} 轮模型往返` : `Saved ${trace.llmCallsSaved} LLM turns`}
									</span>
								</span>
							)}
							{(trace.parallelToolsRun ?? 0) > 0 && (
								<span className="workflow-metric-chip highlight">
									<Layers size={12} aria-hidden="true" />
									<span>
										{isZh ? `并发执行 ${trace.parallelToolsRun} 个工具` : `${trace.parallelToolsRun} Parallel Tools`}
									</span>
								</span>
							)}
						</div>
					)}
				</div>
			)}

			<div className="workflow-main-body">
			{/* Layered DAG Canvas */}
			<div className="workflow-dag" aria-label={flowTitle}>
				{layers.map((layer, layerIndex) => {
					const prevLayer = layerIndex > 0 ? layers[layerIndex - 1] : undefined;
					const incomingEdges = (activeFlow.edges ?? []).filter((edge) => layer.some((n) => n.id === edge.target));
					return (
						<div key={layerIndex} className="workflow-layer-group">
							{layerIndex > 0 && (
								<div className="workflow-connector-row" aria-hidden="true">
									{layer.map((targetNode) => {
										const edgesToNode = incomingEdges.filter((e) => e.target === targetNode.id);
										const stepStatus = isShowingLiveTrace ? getStepTrace(trace, targetNode.id)?.status : undefined;
										const edgeTone =
											stepStatus === "completed" || stepStatus === "running"
												? "active"
												: stepStatus === "needs_input"
													? "warning"
													: stepStatus === "skipped"
														? "skipped"
														: "idle";
										const edgeLabels = edgesToNode
											.map((e) => (isZh ? e.labelZh ?? e.label : e.label))
											.filter((l): l is string => Boolean(l));
										return (
											<div key={targetNode.id} className={`workflow-connector ${edgeTone}`}>
												<div className="workflow-connector-line" />
												{edgeLabels.length > 0 && (
													<span className="workflow-edge-label">{edgeLabels.join(" / ")}</span>
												)}
												<div className="workflow-connector-arrow" />
											</div>
										);
									})}
									{prevLayer && prevLayer.length > 1 && layer.length === 1 && (
										<span className="workflow-join-badge">{isZh ? "分支汇合 (Join)" : "Branch Join"}</span>
									)}
								</div>
							)}
							<div className={`workflow-layer cols-${Math.min(layer.length, 3)}`}>
								{layer.map((node) => {
									const step = isShowingLiveTrace ? getStepTrace(trace, node.id) : undefined;
									const { label: kindLabel, Icon: KindIcon, tone } = kindMeta(node.kind, isZh);
									const { label: statusLabel, Icon: StatusIcon, cls: statusCls } = statusMeta(step?.status, isZh);
									const isSelected = activeNode?.id === node.id;
									const nodeLabel = isZh ? node.labelZh ?? node.label : node.label;
									const nodeDesc = isZh ? node.descriptionZh ?? node.description : node.description;
									const tools = node.tools ?? (node.call?.tool ? [node.call.tool] : node.parallel?.map((p) => p.tool).filter(Boolean) ?? []);

									return (
										<button
											key={node.id}
											type="button"
											className={`workflow-node ${tone} ${statusCls}${isSelected ? " selected" : ""}`}
											onClick={() => setSelectedNodeId(node.id)}
											data-testid={`workflow-node-${node.id}`}
										>
											<div className="workflow-node-head">
												<span className={`workflow-kind-badge ${tone}`}>
													<KindIcon size={12} aria-hidden="true" />
													<span>{kindLabel}</span>
												</span>
												<span className={`workflow-status-pill ${statusCls}`}>
													<StatusIcon size={12} className={step?.status === "running" ? "spin" : ""} aria-hidden="true" />
													<span>
														{step?.durationMs !== undefined && step.status === "completed"
															? `${step.durationMs}ms`
															: isEditing
																? node.id
																: statusLabel}
													</span>
												</span>
											</div>
											<div className="workflow-node-title">{nodeLabel}</div>
											{nodeDesc && <div className="workflow-node-desc">{nodeDesc}</div>}

											{(step?.toolCalls && step.toolCalls.length > 0) ? (
												<div className="workflow-node-tools">
													{step.toolCalls.map((call, idx) => {
														const callName = call.name ?? call.tool ?? "";
														const done = call.status === "completed" || call.status === "done";
														return (
															<span key={`${callName}-${idx}`} className={`workflow-tool-chip tool-${done ? "completed" : call.status}`}>
																<Wrench size={10} aria-hidden="true" />
																<span>{isZh ? call.labelZh ?? call.label ?? callName : call.label ?? callName}</span>
																{call.durationMs !== undefined && done && (
																	<small>{call.durationMs}ms</small>
																)}
																{call.status === "skipped" && <small>{isZh ? "跳过" : "skip"}</small>}
															</span>
														);
													})}
												</div>
											) : (
												tools.length > 0 && (
													<div className="workflow-node-tools">
														{tools.map((toolName) => (
															<span key={toolName} className="workflow-tool-chip">
																<Wrench size={10} aria-hidden="true" />
																<span>{toolName}</span>
															</span>
														))}
													</div>
												)
											)}
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>

			{/* Step Inspector OR Visual Step Builder Form */}
			{activeNode && !isEditing && (
				<section className="workflow-inspector" aria-label={isZh ? "节点详情" : "Step Details"}>
					<div className="workflow-inspector-head">
						<div>
							<span className="workflow-inspector-eyebrow">
								{isZh ? "步骤详情与证据追踪" : "Step Inspector & Trace"} · <code>{activeNode.id}</code>
							</span>
							<h4>{isZh ? activeNode.labelZh ?? activeNode.label : activeNode.label}</h4>
						</div>
						{activeStepTrace && (
							<span className={`workflow-status-pill status-${activeStepTrace.status}`}>
								{statusMeta(activeStepTrace.status, isZh).label}
								{activeStepTrace.durationMs !== undefined ? ` · ${activeStepTrace.durationMs}ms` : ""}
							</span>
						)}
					</div>
					{(activeNode.description || activeNode.descriptionZh) && (
						<p className="workflow-inspector-desc">
							{isZh ? activeNode.descriptionZh ?? activeNode.description : activeNode.description}
						</p>
					)}

					{activeNode.kind === "switch" && activeNode.branches && activeNode.branches.length > 0 && (
						<div className="workflow-inspector-block">
							<h5>{isZh ? "分支路由规则 (Switch Rules)" : "Branch Routing Rules"}</h5>
							<ul className="workflow-branch-list">
								{activeNode.branches.map((b) => {
									const branchChosen = activeStepTrace?.branchId ?? activeStepTrace?.branchChosen;
									const chosen = branchChosen === b.id || branchChosen === b.target;
									return (
										<li key={b.id} className={chosen ? "chosen" : ""}>
											<span>{isZh ? b.labelZh ?? b.label : b.label}</span>
											<code>{b.when}</code>
											<span className="branch-target">→ {b.target}</span>
										</li>
									);
								})}
								{activeNode.defaultTarget && (
									<li className={(activeStepTrace?.branchId ?? activeStepTrace?.branchChosen) === "default" || (activeStepTrace?.branchId ?? activeStepTrace?.branchChosen) === activeNode.defaultTarget ? "chosen" : ""}>
										<span>{isZh ? "默认分支 (Default)" : "Default branch"}</span>
										<code>else</code>
										<span className="branch-target">→ {activeNode.defaultTarget}</span>
									</li>
								)}
							</ul>
						</div>
					)}

					{activeStepTrace?.toolCalls && activeStepTrace.toolCalls.length > 0 && (
						<div className="workflow-inspector-block">
							<h5>
								{activeNode.kind === "parallel"
									? isZh
										? "并发工具执行明细 (Promise.all)"
										: "Parallel Tool Calls (Promise.all)"
									: isZh
										? "工具调用明细"
										: "Tool Call Execution"}
							</h5>
							<ul className="workflow-tool-trace-list">
								{activeStepTrace.toolCalls.map((tc, i) => {
									const tcName = tc.name ?? tc.tool ?? "";
									return (
										<li key={`${tcName}-${i}`} className={`tool-trace-${tc.status}`}>
											<div className="tool-trace-row">
												<strong>{isZh ? tc.labelZh ?? tc.label ?? tcName : tc.label ?? tcName}</strong>
												<code>{tcName}</code>
												<span className="spacer" />
												{tc.durationMs !== undefined && <span className="quiet">{tc.durationMs}ms</span>}
											</div>
											{tc.summary && <div className="tool-trace-summary">{tc.summary}</div>}
										</li>
									);
								})}
							</ul>
						</div>
					)}

					{(activeStepTrace?.summary ?? activeStepTrace?.outputSummary) && (
						<div className="workflow-inspector-block">
							<h5>{isZh ? "节点输出摘要" : "Step Output Summary"}</h5>
							<pre className="workflow-inspector-pre">{activeStepTrace.summary ?? activeStepTrace.outputSummary}</pre>
						</div>
					)}

					{isShowingLiveTrace && trace?.variables && Object.keys(trace.variables).length > 0 && activeNode.kind === "extract" && (
						<div className="workflow-inspector-block">
							<h5>{isZh ? "提取的上下文变量" : "Extracted Slot Variables"}</h5>
							<pre className="workflow-inspector-pre">{JSON.stringify(trace.variables, null, 2)}</pre>
						</div>
					)}
				</section>
			)}

			{/* Visual Step Editor Form when in Builder Mode */}
			{activeNode && isEditing && (
				<StepEditorForm
					node={activeNode}
					flow={activeFlow}
					allowlistedTools={allowlistedTools}
					isZh={isZh}
					onChange={(updater) => updateNode(activeNode.id, updater)}
					onFlowChange={setDraft}
					onDelete={() => handleDeleteNode(activeNode.id)}
				/>
			)}
			</div>
		</div>
	);
}

function StepEditorForm({
	node,
	flow,
	allowlistedTools,
	isZh,
	onChange,
	onFlowChange,
	onDelete,
}: {
	node: FlowNode;
	flow: SkillFlow;
	allowlistedTools: string[];
	isZh: boolean;
	onChange: (updater: (n: FlowNode) => FlowNode) => void;
	onFlowChange: (next: SkillFlow) => void;
	onDelete: () => void;
}) {
	const otherNodes = flow.nodes.filter((n) => n.id !== node.id);
	const outgoingEdges = flow.edges.filter((e) => e.source === node.id);

	return (
		<section className="workflow-inspector workflow-step-editor" data-testid="workflow-step-editor">
			<div className="workflow-inspector-head">
				<div>
					<span className="workflow-inspector-eyebrow">
						{isZh ? "可视化节点配置" : "Step Configuration"} · <code>{node.id}</code>
					</span>
					<h4>{isZh ? node.labelZh ?? node.label : node.label}</h4>
				</div>
				{node.kind !== "start" && (
					<button
						type="button"
						className="ghost small danger-text"
						onClick={onDelete}
						data-testid={`delete-node-${node.id}`}
					>
						<Trash2 size={13} aria-hidden="true" />
						<span>{isZh ? "删除节点" : "Delete Step"}</span>
					</button>
				)}
			</div>

			<div className="workflow-form-grid">
				<label>
					<span>{isZh ? "节点类型 (Kind)" : "Step Kind"}</span>
					<select
						value={node.kind}
						disabled={node.kind === "start"}
						onChange={(e) => {
							const nextKind = e.target.value as FlowNodeKind;
							onChange((prev) => ({ ...prev, kind: nextKind }));
						}}
					>
						{(["start", "extract", "tool", "parallel", "switch", "ask_user", "llm_reply"] as const).map((k) => (
							<option key={k} value={k}>
								{kindMeta(k, isZh).label} ({k})
							</option>
						))}
					</select>
				</label>
				<label>
					<span>{isZh ? "节点名称" : "Step Label"}</span>
					<input
						type="text"
						value={isZh ? node.labelZh ?? node.label : node.label}
						onChange={(e) =>
							onChange((prev) => (isZh ? { ...prev, labelZh: e.target.value, label: prev.label || e.target.value } : { ...prev, label: e.target.value }))
						}
					/>
				</label>
				<label className="full-width">
					<span>{isZh ? "步骤说明" : "Description"}</span>
					<input
						type="text"
						value={isZh ? node.descriptionZh ?? node.description ?? "" : node.description ?? ""}
						onChange={(e) =>
							onChange((prev) => (isZh ? { ...prev, descriptionZh: e.target.value } : { ...prev, description: e.target.value }))
						}
					/>
				</label>
			</div>

			{/* Kind-specific visual editors */}
			{node.kind === "extract" && (
				<div className="workflow-inspector-block">
					<div className="workflow-subhead">
						<h5>{isZh ? "零模型槽位提取规则 (Slot Extraction)" : "Slot Extraction Rules"}</h5>
						<button
							type="button"
							className="ghost small"
							onClick={() => {
								const nextKey = `slot_${Object.keys(node.extract ?? {}).length + 1}`;
								onChange((prev) => ({
									...prev,
									extract: { ...(prev.extract ?? {}), [nextKey]: { fallbackInput: true } },
								}));
							}}
						>
							<Plus size={12} aria-hidden="true" />
							<span>{isZh ? "新增槽位" : "Add Slot"}</span>
						</button>
					</div>
					{Object.entries(node.extract ?? {}).map(([slotName, rule]) => (
						<div key={slotName} className="workflow-subcard">
							<div className="workflow-form-grid">
								<label>
									<span>{isZh ? "变量名 ($vars.<name>)" : "Slot Variable"}</span>
									<input type="text" value={slotName} readOnly />
								</label>
								<label>
									<span>{isZh ? "正则提取 (Pattern)" : "Regex Pattern"}</span>
									<input
										type="text"
										value={rule.pattern ?? ""}
										placeholder="(?:拜访|见)\s*([\u4e00-\u9fa5A-Za-z0-9]+)"
										onChange={(e) => {
											const updated: FlowExtractField = { ...rule, pattern: e.target.value };
											onChange((prev) => ({ ...prev, extract: { ...(prev.extract ?? {}), [slotName]: updated } }));
										}}
									/>
								</label>
							</div>
						</div>
					))}
				</div>
			)}

			{node.kind === "tool" && (
				<div className="workflow-inspector-block">
					<h5>{isZh ? "MCP 工具调用配置" : "MCP Tool Call Configuration"}</h5>
					<div className="workflow-form-grid">
						<label>
							<span>{isZh ? "选择授权工具" : "Allowlisted Tool"}</span>
							<select
								value={node.call?.tool ?? node.tools?.[0] ?? ""}
								onChange={(e) => {
									const tool = e.target.value;
									onChange((prev) => ({
										...prev,
										tools: tool ? [tool] : [],
										call: { tool, args: prev.call?.args ?? {}, storeAs: prev.call?.storeAs ?? prev.id },
									}));
								}}
							>
								<option value="">{isZh ? "-- 选择工具 --" : "-- Select tool --"}</option>
								{allowlistedTools.map((tName) => (
									<option key={tName} value={tName}>
										{tName}
									</option>
								))}
							</select>
						</label>
						<label>
							<span>{isZh ? "输出存入变量 ($steps.<name>)" : "Store Output As ($steps.<name>)"}</span>
							<input
								type="text"
								value={node.call?.storeAs ?? node.id}
								onChange={(e) =>
									onChange((prev) => ({
										...prev,
										call: { tool: prev.call?.tool ?? prev.tools?.[0] ?? "", args: prev.call?.args ?? {}, storeAs: e.target.value },
									}))
								}
							/>
						</label>
						<label className="full-width">
							<span>{isZh ? "调用参数 JSON（支持 $vars.xxx 与 $steps.xxx）" : "Tool Arguments JSON (supports $vars.x & $steps.x)"}</span>
							<input
								type="text"
								value={JSON.stringify(node.call?.args ?? {})}
								onChange={(e) => {
									try {
										const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
										onChange((prev) => ({
											...prev,
											call: { tool: prev.call?.tool ?? "", args: parsed, ...(prev.call?.storeAs ? { storeAs: prev.call.storeAs } : {}) },
										}));
									} catch {
										// Wait until valid JSON
									}
								}}
							/>
						</label>
					</div>
				</div>
			)}

			{node.kind === "parallel" && (
				<div className="workflow-inspector-block">
					<div className="workflow-subhead">
						<h5>{isZh ? "并发工具调用列表 (Promise.all)" : "Parallel Tool Calls (Promise.all)"}</h5>
						<button
							type="button"
							className="ghost small"
							onClick={() => {
								const nextIdx = (node.parallel?.length ?? 0) + 1;
								const tool = allowlistedTools[0] ?? "";
								const nextCall: FlowParallelCall = {
									id: `p_${nextIdx}`,
									label: tool || `Call ${nextIdx}`,
									tool,
									args: {},
									storeAs: `p_${nextIdx}`,
								};
								onChange((prev) => {
									const parallel = [...(prev.parallel ?? []), nextCall];
									const tools = [...new Set(parallel.map((p) => p.tool).filter(Boolean))];
									return { ...prev, parallel, tools };
								});
							}}
						>
							<Plus size={12} aria-hidden="true" />
							<span>{isZh ? "添加并发工具" : "Add Parallel Tool"}</span>
						</button>
					</div>
					{(node.parallel ?? []).map((item, idx) => (
						<div key={item.id || idx} className="workflow-subcard">
							<div className="workflow-form-grid">
								<label>
									<span>{isZh ? "工具 (Tool)" : "Tool"}</span>
									<select
										value={item.tool}
										onChange={(e) => {
											const tool = e.target.value;
											onChange((prev) => {
												const parallel = (prev.parallel ?? []).map((p, i) => (i === idx ? { ...p, tool, label: p.label || tool } : p));
												const tools = [...new Set(parallel.map((p) => p.tool).filter(Boolean))];
												return { ...prev, parallel, tools };
											});
										}}
									>
										<option value="">{isZh ? "-- 选择工具 --" : "-- Select tool --"}</option>
										{allowlistedTools.map((tName) => (
											<option key={tName} value={tName}>
												{tName}
											</option>
										))}
									</select>
								</label>
								<label>
									<span>{isZh ? "执行条件 (可选 when)" : "Condition (optional when)"}</span>
									<input
										type="text"
										value={item.when ?? ""}
										placeholder="vars.relationshipOnly != true"
										onChange={(e) => {
											const when = e.target.value;
											onChange((prev) => ({
												...prev,
												parallel: (prev.parallel ?? []).map((p, i) =>
													i === idx ? { ...p, ...(when ? { when } : { when: undefined }) } : p,
												),
											}));
										}}
									/>
								</label>
							</div>
						</div>
					))}
				</div>
			)}

			{node.kind === "switch" && (
				<div className="workflow-inspector-block">
					<div className="workflow-subhead">
						<h5>{isZh ? "条件分支路由 (Switch Branches)" : "Conditional Branches"}</h5>
						<button
							type="button"
							className="ghost small"
							onClick={() => {
								const target = otherNodes[0]?.id ?? "";
								const newBranch: FlowSwitchBranch = {
									id: `b_${(node.branches?.length ?? 0) + 1}`,
									label: "New Branch",
									labelZh: "新分支",
									when: "steps.lookup.count > 1",
									target,
								};
								onChange((prev) => ({ ...prev, branches: [...(prev.branches ?? []), newBranch] }));
								if (target && !flow.edges.some((e) => e.source === node.id && e.target === target)) {
									onFlowChange({
										...flow,
										nodes: flow.nodes.map((n) => (n.id === node.id ? { ...n, branches: [...(n.branches ?? []), newBranch] } : n)),
										edges: [
											...flow.edges,
											{ id: `e_${node.id}_${target}`, source: node.id, target, branch: target, label: newBranch.label, labelZh: newBranch.labelZh },
										],
									});
								}
							}}
						>
							<Plus size={12} aria-hidden="true" />
							<span>{isZh ? "添加分支" : "Add Branch"}</span>
						</button>
					</div>
					{(node.branches ?? []).map((b, idx) => (
						<div key={b.id || idx} className="workflow-subcard">
							<div className="workflow-form-grid">
								<label>
									<span>{isZh ? "分支名称" : "Branch Label"}</span>
									<input
										type="text"
										value={isZh ? b.labelZh ?? b.label : b.label}
										onChange={(e) => {
											const val = e.target.value;
											onChange((prev) => ({
												...prev,
												branches: (prev.branches ?? []).map((item, i) =>
													i === idx ? (isZh ? { ...item, labelZh: val } : { ...item, label: val }) : item,
												),
											}));
										}}
									/>
								</label>
								<label>
									<span>{isZh ? "条件表达式 (when)" : "Condition (when)"}</span>
									<input
										type="text"
										value={b.when}
										onChange={(e) => {
											const val = e.target.value;
											onChange((prev) => ({
												...prev,
												branches: (prev.branches ?? []).map((item, i) => (i === idx ? { ...item, when: val } : item)),
											}));
										}}
									/>
								</label>
								<label>
									<span>{isZh ? "目标节点 (Target)" : "Target Step"}</span>
									<select
										value={b.target}
										onChange={(e) => {
											const target = e.target.value;
											onChange((prev) => ({
												...prev,
												branches: (prev.branches ?? []).map((item, i) => (i === idx ? { ...item, target } : item)),
											}));
										}}
									>
										{otherNodes.map((n) => (
											<option key={n.id} value={n.id}>
												{isZh ? n.labelZh ?? n.label : n.label} ({n.id})
											</option>
										))}
									</select>
								</label>
							</div>
						</div>
					))}
					<label className="workflow-field-inline">
						<span>{isZh ? "默认兜底目标 (Default Target)" : "Default Target (else)"}</span>
						<select
							value={node.defaultTarget ?? ""}
							onChange={(e) => onChange((prev) => ({ ...prev, defaultTarget: e.target.value || undefined }))}
						>
							<option value="">{isZh ? "-- 无 --" : "-- None --"}</option>
							{otherNodes.map((n) => (
								<option key={n.id} value={n.id}>
									{isZh ? n.labelZh ?? n.label : n.label} ({n.id})
								</option>
							))}
						</select>
					</label>
				</div>
			)}

			{node.kind === "ask_user" && (
				<div className="workflow-inspector-block">
					<h5>{isZh ? "消歧追问模板 (零模型调用直接回复)" : "Disambiguation Prompt Template (0-LLM Reply)"}</h5>
					<label className="full-width">
						<span>{isZh ? "提示语模板（支持 {{vars.xxx}} 与 {{steps.xxx}}）" : "Prompt Template (supports {{vars.x}} & {{steps.x}})"}</span>
						<textarea
							rows={3}
							className="workflow-textarea"
							value={isZh ? node.promptTemplateZh ?? node.promptTemplate ?? "" : node.promptTemplate ?? ""}
							onChange={(e) =>
								onChange((prev) =>
									isZh ? { ...prev, promptTemplateZh: e.target.value } : { ...prev, promptTemplate: e.target.value },
								)
							}
						/>
					</label>
				</div>
			)}

			{/* Outgoing edge connections editor */}
			<div className="workflow-inspector-block">
				<div className="workflow-subhead">
					<h5>{isZh ? "下游连接边 (Outgoing Edges)" : "Outgoing Connections"}</h5>
					{otherNodes.length > 0 && (
						<select
							className="workflow-edge-add-select"
							value=""
							onChange={(e) => {
								const target = e.target.value;
								if (!target) return;
								if (flow.edges.some((edge) => edge.source === node.id && edge.target === target)) return;
								onFlowChange({
									...flow,
									edges: [...flow.edges, { id: `e_${node.id}_${target}`, source: node.id, target }],
								});
							}}
						>
							<option value="">{isZh ? "+ 连接到节点…" : "+ Connect to step…"}</option>
							{otherNodes.map((n) => (
								<option key={n.id} value={n.id}>
									→ {isZh ? n.labelZh ?? n.label : n.label} ({n.id})
								</option>
							))}
						</select>
					)}
				</div>
				<ul className="workflow-branch-list">
					{outgoingEdges.map((edge) => {
						const targetNode = flow.nodes.find((n) => n.id === edge.target);
						return (
							<li key={edge.id}>
								<span>
									<code>{node.id}</code> → <strong>{targetNode ? (isZh ? targetNode.labelZh ?? targetNode.label : targetNode.label) : edge.target}</strong>
								</span>
								<button
									type="button"
									className="ghost small"
									onClick={() => onFlowChange({ ...flow, edges: flow.edges.filter((e) => e.id !== edge.id) })}
								>
									<X size={12} aria-hidden="true" />
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		</section>
	);
}
