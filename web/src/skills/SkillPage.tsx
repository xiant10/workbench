import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, FilePlus, FileText, FlaskConical, History, Loader2, LockKeyhole, RotateCcw, Save, Trash2, TriangleAlert, Upload, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { SkillFlow } from "../lib/agent.ts";
import { request } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { Empty, Skeleton, useFeedback } from "../lib/ui.tsx";
import {
	disableTenantSkill,
	discardSkillDraft,
	listSkillDrafts,
	putSkillDraft,
	putTenantSkill,
	removeTenantSkill,
	type SkillVersion,
	type TenantSkill,
	type TenantSkillContent,
} from "../modules/agents/api.ts";
import { addFiles, FILE_ACCEPT, usableFilePath } from "./files.ts";
import { createWorkflowFromTemplate, WorkflowView } from "../results/WorkflowView.tsx";
import { useMemberName } from "../admin/members.ts";
import { useWorkspace } from "../shell/workspace.ts";
import { type CatalogTool, checkFlow, covers, getPolicy, getSkill, getTenantSkills, kindOf, listSkills, listTools, policyFor } from "./api.ts";
import type { NewSkill } from "./SkillsPage.tsx";
import { TestPanel, TestPanelBoundary } from "./TestPanel.tsx";
import "./skills.css";

type Tab = "overview" | "instructions" | "files" | "tools" | "workflow" | "history";

const TABS: Record<Tab, string> = {
	overview: "Overview",
	instructions: "Instructions",
	files: "Files",
	tools: "Tools",
	workflow: "Workflow",
	history: "History",
};

/** Everything one publish sends. An override uses only `flow`. */
type Draft = { description: string; body: string; keywords: string[]; tools: string[]; files: Record<string, string>; flow?: SkillFlow };

const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** How long typing pauses before the draft is saved. */
const AUTOSAVE_MS = 800;

/** What a version or a draft holds for a skill of this kind. Publishing adds the workflow's tools and checks the flow. */
function contentOf(draft: Draft, kind: "override" | "custom"): TenantSkillContent {
	if (kind === "override") return draft.flow === undefined ? {} : { flow: draft.flow };
	return {
		description: draft.description,
		body: draft.body,
		tools: draft.tools,
		keywords: draft.keywords,
		...(draft.flow === undefined ? {} : { flow: draft.flow }),
		...(Object.keys(draft.files).length === 0 ? {} : { files: draft.files }),
	};
}

/** A draft from stored content, over what the editor starts from. */
function fromContent(content: TenantSkillContent, over: Draft): Draft {
	return {
		description: content.description ?? over.description,
		body: content.body ?? over.body,
		keywords: content.keywords ?? over.keywords,
		tools: content.tools ?? over.tools,
		files: content.files ?? over.files,
		...(content.flow === undefined ? (over.flow === undefined ? {} : { flow: over.flow }) : { flow: content.flow }),
	};
}

/** The tools a flow's steps call, which a custom skill must list. */
function flowTools(flow: SkillFlow | undefined): string[] {
	if (flow === undefined) return [];
	return [...new Set(flow.nodes.flatMap((node) => [...(node.tools ?? []), ...(node.call?.tool ? [node.call.tool] : []), ...(node.parallel ?? []).map((call) => call.tool)]))];
}

/** `/t/<tenant>/skills/<agent>/<name>`: one skill's tabs, all editing one draft that Publish sends as one version. */
export function SkillPage() {
	const { t, ago, describe, language } = useI18n();
	const isZh = language === "zh";
	const { isAdmin, path } = useWorkspace();
	const { agent = "", name = "" } = useParams();
	const location = useLocation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast, confirm } = useFeedback();
	const newSkill = (location.state as { newSkill?: NewSkill } | null)?.newSkill;
	const [tab, setTab] = useState<Tab>(newSkill !== undefined ? "instructions" : "overview");
	const [edited, setEdited] = useState<Draft>();
	const [busy, setBusy] = useState(false);
	const [testing, setTesting] = useState(false);
	/** Whether the server's draft has been read into the editor, which happens once. */
	const [restored, setRestored] = useState(false);
	const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
	const [problems, setProblems] = useState<string[]>([]);

	// The agent's list says whether this is one of its skills; only those are asked for, so a new skill isn't a 404.
	const listed = useQuery({ queryKey: ["skills", agent], queryFn: () => listSkills(agent), select: (body) => body.skills.find((s) => s.name === name) ?? null, retry: false, enabled: isAdmin });
	const skill = useQuery({ queryKey: ["skill", agent, name], queryFn: () => getSkill(agent, name), retry: false, enabled: isAdmin && listed.data != null });
	const records = useQuery({ queryKey: ["tenant-skills", agent], queryFn: () => getTenantSkills(agent), retry: false, enabled: isAdmin });
	const record = records.data?.find((r) => r.name === name);
	// Only a skill this tenant has published has a history; asking for any other would be a 404 in the console.
	const history = useQuery({
		queryKey: ["skill-history", agent, name],
		queryFn: () => request<{ skill: TenantSkill; versions: SkillVersion[] }>(`/api/modules/agents/admin/skills/${encodeURIComponent(agent)}/${encodeURIComponent(name)}`),
		retry: false,
		enabled: isAdmin && record !== undefined,
	});
	// Your draft, from the list of your drafts, which answers even when there's none.
	const drafts = useQuery({ queryKey: ["skill-drafts", agent], queryFn: () => listSkillDrafts(agent), retry: false, enabled: isAdmin });
	const serverDraft = { ...drafts, data: drafts.isSuccess ? (drafts.data.find((d) => d.name === name) ?? null) : undefined };
	const missing =
		(listed.data === null || listed.isError) && records.isSuccess && record === undefined && newSkill === undefined && (serverDraft.isError || serverDraft.data === null);
	const kind = record?.kind ?? serverDraft.data?.kind ?? (listed.data == null ? "custom" : kindOf(listed.data, record));

	// What the editor starts from: the tenant's version when there is one, or what the agent has.
	const base = useMemo<Draft | undefined>(() => {
		if (kind === "custom") {
			const content = record?.content;
			if (content !== undefined) {
				return { description: content.description ?? "", body: content.body ?? "", keywords: content.keywords ?? [], tools: content.tools ?? [], files: content.files ?? {}, ...(content.flow === undefined ? {} : { flow: content.flow }) };
			}
			if (newSkill !== undefined) return { description: newSkill.description, body: newSkill.body, keywords: newSkill.keywords, tools: [], files: newSkill.files };
			// A skill that so far is only your draft.
			if (serverDraft.data) return { description: "", body: "", keywords: [], tools: [], files: {} };
			return undefined;
		}
		if (skill.data === undefined) return undefined;
		const flow = record?.state === "published" ? record.content.flow : skill.data.flow;
		return { description: skill.data.description, body: skill.data.body, keywords: skill.data.keywords, tools: skill.data.tools, files: {}, ...(flow === undefined ? {} : { flow }) };
	}, [kind, record, newSkill, skill.data, serverDraft.data]);
	const draft = edited ?? base;
	const dirty = edited !== undefined && base !== undefined && !sameDraft(edited, base);
	const editable = kind === "custom";
	const change = (next: Partial<Draft>) => setEdited({ ...(draft as Draft), ...next });

	// Your draft from last time, or another device, comes back once.
	useEffect(() => {
		if (restored || base === undefined || serverDraft.isPending) return;
		if (serverDraft.data) setEdited(fromContent(serverDraft.data.content, base));
		setRestored(true);
	}, [restored, serverDraft.isSuccess, serverDraft.data, base]);

	const draftKind = kind === "custom" ? "custom" : "override";
	const saveDraft = useCallback(
		async (next: Draft) => {
			setSaving("saving");
			try {
				const saved = await putSkillDraft(agent, name, { kind: draftKind, content: contentOf(next, draftKind), base_version: record?.version ?? 0 });
				setProblems((saved.problems ?? []).map((problem) => problem.text));
				setSaving("saved");
			} catch {
				setSaving("failed");
			}
		},
		[agent, name, draftKind, record?.version],
	);

	// Edits save as your draft once typing pauses; undoing every edit discards it.
	useEffect(() => {
		if (!restored || edited === undefined) return;
		const timer = setTimeout(() => {
			if (dirty) void saveDraft(edited);
			else
				void discardSkillDraft(agent, name)
					.then(() => setSaving("idle"))
					.catch(() => undefined);
		}, AUTOSAVE_MS);
		return () => clearTimeout(timer);
	}, [edited, dirty, restored, saveDraft, agent, name]);

	// Only a save still under way can be lost by leaving.
	useEffect(() => {
		if (saving !== "saving") return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [saving]);

	if (!isAdmin) {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("Only this tenant's admins can open this page.")} />
			</div>
		);
	}
	const back = path(`skills?agent=${encodeURIComponent(agent)}`);
	if (missing) {
		return (
			<div className="page">
				<Link to={back} className="skills-back">
					<ArrowLeft size={14} aria-hidden="true" /> {t("Skills")}
				</Link>
				<Empty icon={FileText} title={t("This agent has no skill of that name.")} />
			</div>
		);
	}
	if (draft === undefined) {
		return (
			<div className="page">
				<Skeleton rows={6} />
			</div>
		);
	}

	const refresh = () =>
		Promise.all(
			[["skills", agent], ["skill", agent, name], ["tenant-skills", agent], ["skill-history", agent, name], ["skill-drafts", agent]].map((queryKey) =>
				queryClient.invalidateQueries({ queryKey }),
			),
		);

	const publish = async (from: Draft, reason?: string) => {
		setBusy(true);
		try {
			let content;
			if (kind === "custom") {
				const tools = [...new Set([...from.tools, ...flowTools(from.flow)])];
				const flow = from.flow === undefined ? undefined : (await checkFlow(agent, name, from.flow, tools)).flow;
				content = contentOf({ ...from, description: from.description.trim() || name, tools, ...(flow === undefined ? {} : { flow }) }, "custom");
			} else {
				if (from.flow === undefined) throw new Error(t("Only a workflow can be customized on a built-in skill."));
				content = { flow: (await checkFlow(agent, name, from.flow)).flow };
			}
			const { skill: published } = await putTenantSkill(agent, name, {
				kind: kind === "custom" ? "custom" : "override",
				content,
				version: record?.version ?? 0,
				...(reason === undefined ? {} : { reason }),
			});
			// Publishing cleared your draft on the server too.
			setEdited(undefined);
			setSaving("idle");
			setProblems([]);
			// A new skill's starting values came through navigation; it now has a record.
			if (newSkill !== undefined) navigate(location.pathname, { replace: true });
			await refresh();
			toast(t("Published version {version}. The agent uses it from the next turn.", { version: published.version }));
		} catch (error) {
			toast(error instanceof Error ? describe(error) : String(error));
		} finally {
			setBusy(false);
		}
	};

	const turnOff = async () => {
		if (record === undefined) return;
		const ok = await confirm({
			title: kind === "override" ? t("Restore the built-in workflow?") : t("Turn this skill off?"),
			body: t("The agent stops using this tenant's version on the next turn. Its history is kept, and publishing turns it on again."),
			action: kind === "override" ? t("Restore built-in") : t("Turn off"),
			danger: kind !== "override",
		});
		if (!ok) return;
		setBusy(true);
		try {
			await disableTenantSkill(agent, name, record.version);
			setEdited(undefined);
			await refresh();
		} catch (error) {
			toast(error instanceof Error ? describe(error) : String(error));
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (record === undefined) return;
		const ok = await confirm({
			title: t("Delete {name}?", { name }),
			body: t("The agent stops using it on the next turn, and it leaves this list. Its versions are kept as a record, and the name can be used again."),
			action: t("Delete"),
			danger: true,
		});
		if (!ok) return;
		setBusy(true);
		try {
			await removeTenantSkill(agent, name, record.version);
			await refresh();
			navigate(back);
		} catch (error) {
			toast(error instanceof Error ? describe(error) : String(error));
			setBusy(false);
		}
	};

	const discard = async () => {
		setBusy(true);
		try {
			await discardSkillDraft(agent, name);
			setEdited(undefined);
			setSaving("idle");
			setProblems([]);
			await queryClient.invalidateQueries({ queryKey: ["skill-drafts", agent] });
		} catch (error) {
			toast(error instanceof Error ? describe(error) : String(error));
		} finally {
			setBusy(false);
		}
	};

	/** The test chat must use what the editor shows, so a pending edit is saved first. */
	const prepare = async () => {
		if (dirty && edited !== undefined) await saveDraft(edited);
	};
	const staleDraft = serverDraft.data && record !== undefined && serverDraft.data.base_version < record.version && dirty;

	const kindLabel = kind === "builtin" ? t("Built-in") : kind === "override" ? t("Customized") : t("Ours");
	const stateLabel = record === undefined ? (kind === "custom" ? t("Not published") : undefined) : record.state === "published" ? t("v{version} live", { version: record.version }) : kind === "override" ? t("Built-in in use") : t("Off");
	const tabs: Tab[] = ["overview", "instructions", "files", "tools", "workflow", "history"];

	return (
		<div className={testing ? "skill-layout testing" : "skill-layout"}>
		<div className="page skill-page" data-testid="skill-page">
			<Link to={back} className="skills-back">
				<ArrowLeft size={14} aria-hidden="true" /> {t("Skills")}
			</Link>
			<header className="skill-head">
				<div>
					<h1>{name}</h1>
					<span className={`skills-kind ${kind}`}>{kindLabel}</span>
					{stateLabel !== undefined && <span className="skills-state">{stateLabel}</span>}
					{dirty && <span className="skills-dirty">{t("Unpublished changes")}</span>}
					{dirty && saving === "saving" && (
						<span className="quiet skills-saving">
							<Loader2 size={12} className="spin" aria-hidden="true" /> {t("Saving draft")}
						</span>
					)}
					{dirty && saving === "saved" && (
						<span className="quiet skills-saving" data-testid="skill-draft-saved">
							<Check size={12} aria-hidden="true" /> {t("Draft saved, only you see it")}
						</span>
					)}
					{saving === "failed" && <span className="danger-text">{t("The draft couldn't be saved.")}</span>}
				</div>
				<div className="skill-actions">
					{dirty && (
						<button type="button" className="ghost small" disabled={busy} onClick={() => void discard()} data-testid="skill-discard">
							{t("Discard changes")}
						</button>
					)}
					<button type="button" className={testing ? "ghost small active" : "ghost small"} onClick={() => setTesting(!testing)} aria-pressed={testing} data-testid="skill-test-toggle">
						<FlaskConical size={13} aria-hidden="true" />
						{t("Test")}
					</button>
					{kind === "custom" && record !== undefined && (
						<button type="button" className="ghost small danger-text" disabled={busy} onClick={() => void remove()} data-testid="skill-delete">
							<Trash2 size={13} aria-hidden="true" />
							{t("Delete")}
						</button>
					)}
					{record?.state === "published" && (
						<button type="button" className="ghost small" disabled={busy} onClick={() => void turnOff()} data-testid="skill-turn-off">
							<RotateCcw size={13} aria-hidden="true" />
							{kind === "override" ? t("Restore built-in") : t("Turn off")}
						</button>
					)}
					<button
						type="button"
						className="primary small"
						disabled={busy || (!dirty && !(kind === "custom" && record === undefined) && !(record?.state === "disabled" && kind === "custom"))}
						onClick={() => void publish(draft)}
						data-testid="skill-publish"
					>
						{busy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
						{t("Publish")}
					</button>
				</div>
			</header>
			{kind !== "custom" && (
				<p className="quiet">
					{kind === "builtin"
						? t("This skill comes with the agent. You can customize its workflow for this tenant; its instructions, files and tools stay the platform's.")
						: t("This tenant has its own workflow for this built-in skill. Restore built-in goes back to the platform's.")}
				</p>
			)}
			{staleDraft && (
				<p className="skills-notice" role="status">
					<TriangleAlert size={14} aria-hidden="true" />
					{t("Version {version} was published after your draft began. Publishing your draft replaces it; check History first.", { version: record.version })}
				</p>
			)}
			{dirty && problems.length > 0 && (
				<div className="skills-notice" role="status" data-testid="skill-problems">
					<TriangleAlert size={14} aria-hidden="true" />
					<span>
						{t("Before publishing:")} {problems.join("; ")}
					</span>
				</div>
			)}
			<div className="tabs" role="tablist" aria-label={name}>
				{tabs.map((id) => (
					<button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)} data-testid={`skill-tab-${id}`}>
						{t(TABS[id])}
						{id === "files" && (editable ? Object.keys(draft.files).length : (skill.data?.files.length ?? 0)) > 0 && (
							<span className="skills-count">{editable ? Object.keys(draft.files).length : skill.data?.files.length}</span>
						)}
					</button>
				))}
			</div>
			<section className="skill-tab">
				{tab === "overview" && <OverviewTab draft={draft} editable={editable} onChange={change} />}
				{tab === "instructions" && <InstructionsTab draft={draft} editable={editable} onChange={change} />}
				{tab === "files" && <FilesTab draft={draft} editable={editable} builtinFiles={skill.data?.files ?? []} onChange={change} isZh={isZh} />}
				{tab === "tools" && <ToolsTab agent={agent} draft={draft} editable={editable} onChange={change} />}
				{tab === "workflow" && <WorkflowTab agent={agent} name={name} draft={draft} editable kind={kind} onChange={change} />}
				{tab === "history" && (
					<HistoryTab
						versions={history.data?.versions ?? []}
						current={record}
						loading={record !== undefined && history.isPending}
						busy={busy}
						ago={ago}
						onRestore={(version) => {
							const c = version.content;
							void publish(
								{ description: c.description ?? "", body: c.body ?? "", keywords: c.keywords ?? [], tools: c.tools ?? [], files: c.files ?? {}, ...(c.flow === undefined ? {} : { flow: c.flow }) },
								t("Restored version {version}", { version: version.version }),
							);
						}}
					/>
				)}
			</section>
		</div>
		{testing && (
			<TestPanelBoundary message={t("The test chat stopped working. Close it and open it again.")} closeLabel={t("Close")} onClose={() => setTesting(false)}>
				<TestPanel agent={agent} name={name} prepare={prepare} onClose={() => setTesting(false)} />
			</TestPanelBoundary>
		)}
		</div>
	);
}

function OverviewTab({ draft, editable, onChange }: { draft: Draft; editable: boolean; onChange(next: Partial<Draft>): void }) {
	const { t } = useI18n();
	const [keywords, setKeywords] = useState(draft.keywords.join(", "));
	return (
		<div className="skills-form">
			<label>
				<span>{t("When should the agent use it?")}</span>
				<span className="quiet">{t("The agent reads this to decide when the skill fits a request.")}</span>
				{editable ? (
					<textarea rows={3} maxLength={1024} value={draft.description} onChange={(e) => onChange({ description: e.target.value })} data-testid="skill-description" />
				) : (
					<p>{draft.description}</p>
				)}
			</label>
			<label>
				<span>{t("Trigger words")}</span>
				<span className="quiet">{t("Words in a request that make the skill's tools ready before the agent answers. Separate them with commas.")}</span>
				{editable ? (
					<input
						value={keywords}
						onChange={(e) => {
							setKeywords(e.target.value);
							onChange({ keywords: e.target.value.split(/[,，]/).map((k) => k.trim()).filter(Boolean) });
						}}
						data-testid="skill-keywords"
					/>
				) : (
					<p>{draft.keywords.join(", ") || "—"}</p>
				)}
			</label>
		</div>
	);
}

function InstructionsTab({ draft, editable, onChange }: { draft: Draft; editable: boolean; onChange(next: Partial<Draft>): void }) {
	const { t } = useI18n();
	const box = useRef<HTMLTextAreaElement>(null);
	const files = Object.keys(draft.files).sort();
	if (!editable) return <pre className="skill-pre">{draft.body}</pre>;
	const insert = (path: string) => {
		const area = box.current;
		const text = `\`${path}\``;
		const at = area?.selectionStart ?? draft.body.length;
		const end = area?.selectionEnd ?? at;
		onChange({ body: draft.body.slice(0, at) + text + draft.body.slice(end) });
		requestAnimationFrame(() => {
			area?.focus();
			area?.setSelectionRange(at + text.length, at + text.length);
		});
	};
	return (
		<div className="skills-form">
			<div className="skills-toolbar">
				<span className="quiet">{t("Markdown. Tell the agent when to read each file: it reads them with load_skill.")}</span>
				{files.length > 0 && (
					<select value="" aria-label={t("Insert file reference")} onChange={(e) => e.target.value !== "" && insert(e.target.value)}>
						<option value="">{t("Insert file reference")}</option>
						{files.map((path) => (
							<option key={path} value={path}>
								{path}
							</option>
						))}
					</select>
				)}
			</div>
			<textarea ref={box} className="skill-editor" rows={20} value={draft.body} onChange={(e) => onChange({ body: e.target.value })} data-testid="skill-body" />
		</div>
	);
}

function FilesTab({ draft, editable, builtinFiles, onChange, isZh }: { draft: Draft; editable: boolean; builtinFiles: string[]; onChange(next: Partial<Draft>): void; isZh: boolean }) {
	const { t } = useI18n();
	const paths = Object.keys(draft.files).sort();
	const [open, setOpen] = useState<string | undefined>(paths[0]);
	const [newPath, setNewPath] = useState("");
	const [problems, setProblems] = useState<string[]>([]);
	if (!editable) {
		return builtinFiles.length === 0 ? (
			<Empty icon={FileText} title={t("This skill has no reference files.")} />
		) : (
			<ul className="skill-files">
				{builtinFiles.map((path) => (
					<li key={path}>
						<FileText size={13} aria-hidden="true" />
						<code>{path}</code>
					</li>
				))}
			</ul>
		);
	}
	const add = async (list: FileList | null, folder: boolean) => {
		if (list === null || list.length === 0) return;
		const { next, problems: found } = await addFiles(list, folder, { description: draft.description, body: draft.body, files: draft.files }, isZh);
		setProblems(found);
		onChange(next);
		setOpen((current) => current ?? Object.keys(next.files).sort()[0]);
	};
	const create = () => {
		const path = newPath.trim();
		if (!usableFilePath(path)) {
			setProblems([t("{path} isn't a usable file name. Use letters, digits, ., - and _, folders with /, ending in .md, .txt, .json or .csv.", { path })]);
			return;
		}
		if (draft.files[path] !== undefined) {
			setOpen(path);
			return;
		}
		onChange({ files: { ...draft.files, [path]: "" } });
		setOpen(path);
		setNewPath("");
		setProblems([]);
	};
	const remove = (path: string) => {
		const files = { ...draft.files };
		delete files[path];
		onChange({ files });
		if (open === path) setOpen(Object.keys(files).sort()[0]);
	};
	return (
		<div className="skill-files-tab">
			<aside className="skill-files-side">
				<ul className="skill-files">
					{paths.map((path) => (
						<li key={path} className={path === open ? "active" : undefined}>
							<button type="button" className="skill-file" onClick={() => setOpen(path)}>
								<FileText size={13} aria-hidden="true" />
								<code>{path}</code>
							</button>
							{!draft.body.includes(path) && (
								<span className="skills-warn" title={t("The instructions never mention this file, so the agent may not read it.")}>
									{t("Not mentioned")}
								</span>
							)}
							<button type="button" className="ghost small" aria-label={t("Remove {name}", { name: path })} onClick={() => remove(path)}>
								<Trash2 size={12} aria-hidden="true" />
							</button>
						</li>
					))}
				</ul>
				<form
					className="skills-new-file"
					onSubmit={(e) => {
						e.preventDefault();
						create();
					}}
				>
					<input value={newPath} placeholder="references/notes.md" aria-label={t("New file name")} onChange={(e) => setNewPath(e.target.value)} data-testid="skill-new-file" />
					<button type="submit" className="ghost small" aria-label={t("New file")}>
						<FilePlus size={13} aria-hidden="true" />
					</button>
				</form>
				<label className="button ghost small">
					<Upload size={13} aria-hidden="true" />
					{t("Upload files")}
					<input type="file" multiple accept={FILE_ACCEPT} hidden onChange={(e) => void add(e.target.files, false).finally(() => (e.target.value = ""))} data-testid="skill-files-input" />
				</label>
				{problems.length > 0 && (
					<div className="workflow-validation err" role="alert">
						{problems.map((text) => (
							<div key={text}>{text}</div>
						))}
					</div>
				)}
				<p className="quiet">{t("At most 50 text files of 256 KiB each. Files are read by the agent, never run.")}</p>
			</aside>
			{open !== undefined && draft.files[open] !== undefined ? (
				<label className="skill-file-editor">
					<span>
						<code>{open}</code> · {(new Blob([draft.files[open]!]).size / 1024).toFixed(1)} KiB
					</span>
					<textarea className="skill-editor" rows={22} value={draft.files[open]} onChange={(e) => onChange({ files: { ...draft.files, [open]: e.target.value } })} data-testid="skill-file-editor" />
				</label>
			) : (
				<Empty icon={FileText} title={t("Create or upload a file the instructions can point to.")} />
			)}
		</div>
	);
}

function ToolsTab({ agent, draft, editable, onChange }: { agent: string; draft: Draft; editable: boolean; onChange(next: Partial<Draft>): void }) {
	const { t } = useI18n();
	const tools = useQuery({ queryKey: ["agent-tools", agent], queryFn: () => listTools(agent), retry: false, staleTime: 60_000 });
	const policy = useQuery({ queryKey: ["agent-policy"], queryFn: getPolicy, retry: false, staleTime: 60_000 });
	const rules = policy.data?.policy.rules ?? [];
	const used = new Set(flowTools(draft.flow));
	const byServer = new Map<string, CatalogTool[]>();
	for (const tool of tools.data ?? []) byServer.set(tool.server, [...(byServer.get(tool.server) ?? []), tool]);
	if (tools.isPending) return <Skeleton rows={4} />;
	if (tools.isError) return <Empty icon={Wrench} title={t("This agent's tools can't be read right now.")} />;
	const toggle = (pattern: string, on: boolean) => onChange({ tools: on ? [...new Set([...draft.tools, pattern])] : draft.tools.filter((p) => p !== pattern) });
	const shown = editable ? [...byServer] : [...byServer].map(([server, list]) => [server, list.filter((tool) => covers(draft.tools, tool))] as const).filter(([, list]) => list.length > 0);
	return (
		<div className="skill-tools">
			<p className="quiet">
				{editable
					? t("Tools the skill turns on when the agent loads it. Every call still goes through this tenant's policy.")
					: t("Tools this skill turns on. They're the platform's.")}
			</p>
			{shown.length === 0 && <Empty icon={Wrench} title={t("This skill turns on no tools.")} />}
			{shown.map(([server, list]) => {
				const all = `${server}:*`;
				const allOn = draft.tools.includes(all);
				return (
					<fieldset key={server} className="skill-tool-group">
						<legend>
							<code>{server}</code>
							{editable && (
								<label className="skill-tool-all">
									<input type="checkbox" checked={allOn} onChange={(e) => toggle(all, e.target.checked)} />
									{t("All tools of this server")}
								</label>
							)}
						</legend>
						{list.map((tool) => {
							const exact = `${server}:${tool.tool}`;
							const on = covers(draft.tools, tool);
							const inFlow = used.has(tool.name) || used.has(exact);
							const rule = policyFor(rules, agent, tool);
							return (
								<label key={tool.name} className="skill-tool">
									<input
										type="checkbox"
										checked={on || inFlow}
										disabled={!editable || allOn || inFlow || (on && !draft.tools.includes(exact))}
										onChange={(e) => toggle(exact, e.target.checked)}
										data-testid={`skill-tool-${tool.name}`}
									/>
									<span className="skill-tool-name">
										<code>{tool.tool}</code>
										<span className="quiet">{tool.description}</span>
									</span>
									{inFlow && <span className="skills-badge">{t("Used by the workflow")}</span>}
									<span className={`skills-badge policy-${rule.effect}`}>
										{rule.effect === "deny" ? t("Blocked by policy") : rule.effect === "approve" ? t("Needs approval") : t("Allowed")}
										{rule.partial && ` · ${t("some runs")}`}
									</span>
								</label>
							);
						})}
					</fieldset>
				);
			})}
		</div>
	);
}

function WorkflowTab({ agent, name, draft, kind, onChange }: { agent: string; name: string; draft: Draft; editable: boolean; kind: string; onChange(next: Partial<Draft>): void }) {
	const { t } = useI18n();
	if (draft.flow === undefined) {
		const start = (template: "minimal" | "parallel" | "branching") =>
			onChange({
				flow: createWorkflowFromTemplate({
					id: name,
					title: name,
					mode: "guided",
					triggerKeywords: draft.keywords,
					template,
					...(draft.tools[0] === undefined || draft.tools[0].includes("*") ? {} : { defaultTool: draft.tools[0].replace(":", "_") }),
				}),
			});
		return (
			<div className="skill-no-flow">
				<Empty icon={History} title={t("No workflow: the agent decides the steps from the instructions.")}>
					{kind === "custom" && (
						<div className="dialog-actions">
							<button type="button" className="ghost small" onClick={() => start("minimal")} data-testid="skill-add-workflow">
								{t("Add a simple workflow")}
							</button>
							<button type="button" className="ghost small" onClick={() => start("parallel")}>
								{t("Look things up at the same time")}
							</button>
							<button type="button" className="ghost small" onClick={() => start("branching")}>
								{t("Branch on the answer")}
							</button>
						</div>
					)}
				</Empty>
			</div>
		);
	}
	return (
		<div className="skill-flow">
			{kind === "builtin" && <p className="quiet">{t("Changing this workflow and publishing makes this tenant's own copy of it.")}</p>}
			{kind === "custom" && (
				<div className="skills-toolbar">
					<span className="quiet">{t("A workflow fixes the steps; without one the agent decides them.")}</span>
					<button type="button" className="ghost small" onClick={() => onChange({ flow: undefined })}>
						{t("Remove workflow")}
					</button>
				</div>
			)}
			<WorkflowView agent={agent} embedded={{ flow: draft.flow, onChange: (flow) => onChange({ flow }) }} />
		</div>
	);
}

/** What a version changed from the one before it, in words. */
function changes(version: SkillVersion, previous: SkillVersion | undefined, t: (text: string) => string): string {
	if (previous === undefined) return t("First version");
	const fields: [keyof SkillVersion["content"], string][] = [
		["description", "Overview"],
		["body", "Instructions"],
		["files", "Files"],
		["tools", "Tools"],
		["keywords", "Trigger words"],
		["flow", "Workflow"],
	];
	const changed = fields.filter(([key]) => JSON.stringify(version.content[key] ?? null) !== JSON.stringify(previous.content[key] ?? null)).map(([, label]) => t(label));
	return changed.length === 0 ? t("No change") : changed.join(", ");
}

function HistoryTab({
	versions,
	current,
	loading,
	busy,
	ago,
	onRestore,
}: {
	versions: SkillVersion[];
	current: TenantSkill | undefined;
	loading: boolean;
	busy: boolean;
	ago(value: number): string;
	onRestore(version: SkillVersion): void;
}) {
	const { t } = useI18n();
	const nameOf = useMemberName();
	if (loading) return <Skeleton rows={3} />;
	if (versions.length === 0) return <Empty icon={History} title={t("Nothing published yet. Each publish is kept here, and any version can be restored.")} />;
	return (
		<ol className="skill-history" data-testid="skill-history">
			{versions.map((version, index) => {
				const live = current?.state === "published" && current.version === version.version;
				return (
					<li key={version.version}>
						<strong>v{version.version}</strong>
						{live && <span className="skills-badge policy-allow">{t("Live")}</span>}
						<span>{changes(version, versions[index + 1], t)}</span>
						<span className="quiet">
							{nameOf(version.actor)} · {ago(Date.parse(version.at))}
							{version.reason !== "" && ` · ${version.reason}`}
						</span>
						{!live && (
							<button type="button" className="ghost small" disabled={busy} onClick={() => onRestore(version)} data-testid={`skill-restore-${version.version}`}>
								<RotateCcw size={12} aria-hidden="true" />
								{t("Restore this version")}
							</button>
						)}
					</li>
				);
			})}
		</ol>
	);
}
