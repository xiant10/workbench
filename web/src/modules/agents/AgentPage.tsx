import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, FlaskConical, Loader2, LockKeyhole, Plug, RotateCcw, Save, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMemberName } from "../../admin/members.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, Empty, Setting, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { type CatalogTool, listSkills, listTools } from "../../skills/api.ts";
import { TestPanel, TestPanelBoundary } from "../../skills/TestPanel.tsx";
import "../../skills/skills.css";
import { TeammatesCard } from "./TeammatePage.tsx";
import {
	type AgentConfigContent,
	type AgentConfigVersion,
	type AgentConfigView,
	discardAgentConfigDraft,
	getAgentConfig,
	getAgentConfigHistory,
	getAgentSettings,
	publishAgentConfig,
	saveAgentConfigDraft,
} from "./api.ts";

/** The limits control enforces on publish, shown as the admin types. */
const MAX_TEXT = 32 * 1024;
const MAX_CALL_TEXT = 2 * 1024;
/** A pause in typing this long saves the draft. */
const SAVE_MS = 800;

type Tab = "instructions" | "tools" | "skills" | "model" | "history";
const TABS: Record<Tab, string> = { instructions: "Instructions", tools: "Tools", skills: "Skills", model: "Model", history: "History" };

const glob = (pattern: string, value: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value);
const matches = (patterns: readonly string[] | undefined, name: string) => (patterns ?? []).some((pattern) => glob(pattern, name));
const bytes = (text: string) => new TextEncoder().encode(text).length;

/** A customization without its empty parts, so an edit back to nothing is nothing, and two equal ones look equal. */
function tidy(content: AgentConfigContent): AgentConfigContent {
	const out: AgentConfigContent = {};
	if ((content.instructions ?? "").trim() !== "") out.instructions = content.instructions;
	if ((content.callInstructions ?? "").trim() !== "") out.callInstructions = content.callInstructions;
	const off = content.tools?.off ?? [];
	const on = content.tools?.on ?? [];
	if (off.length > 0 || on.length > 0) out.tools = { ...(off.length > 0 ? { off } : {}), ...(on.length > 0 ? { on } : {}) };
	if ((content.skills?.off ?? []).length > 0) out.skills = { off: content.skills!.off };
	if ((content.model ?? "") !== "") out.model = content.model;
	return out;
}
const same = (a: AgentConfigContent, b: AgentConfigContent) => JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));

/** `/t/<tenant>/agents/<agent>`: one agent as this tenant has it: who can use it, and what the tenant changed about it. */
export function AgentPage() {
	const { agent = "" } = useParams();
	const { t } = useI18n();
	const { isAdmin, path } = useWorkspace();
	const settings = useQuery({ queryKey: ["agent-settings"], queryFn: getAgentSettings, enabled: isAdmin });
	const back = `${path("admin")}?tab=agents`;
	if (!isAdmin) {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("Only this tenant's admins can open this page.")} />
			</div>
		);
	}
	if (settings.data === undefined) {
		return (
			<div className="page">
				<Skeleton rows={6} />
			</div>
		);
	}
	const choice = settings.data.agents.find((entry) => entry.name === agent);
	if (choice === undefined) {
		return (
			<div className="page">
				<Empty icon={Sparkles} title={t("This tenant can't use this agent.")} />
			</div>
		);
	}
	const title = choice.title ?? choice.name;
	const isDefault = (settings.data.default_agent || settings.data.platform_default) === agent;
	return (
		<AgentLayout agent={agent} title={title} customizable={choice.customizable === true}>
			<Link to={back} className="skills-back">
				<ArrowLeft size={14} aria-hidden="true" /> {t("Agents")}
			</Link>
			<header className="skill-head">
				<div>
					<h1>{title}</h1>
					<span className="quiet">{agent}</span>
				</div>
			</header>
			<div className="card">
				<h2>{t("Access")}</h2>
				<Setting title={t("People can use it")} hint={choice.picker === false ? t("Through its own app. People don't pick it in conversations.") : t("Turned on or off under Administration, Agents.")}>
					<span className={choice.enabled ? "pill" : "pill warn"}>{choice.enabled ? t("On") : t("Off")}</span>
				</Setting>
				{choice.picker !== false && (
					<Setting title={t("New conversations start with it")}>
						<span className="pill">{isDefault ? t("Yes") : t("No")}</span>
					</Setting>
				)}
			</div>
			{choice.teammates === true && <TeammatesCard agent={agent} title={title} />}
			<div className="card">
				<h2>{t("Skills and connectors")}</h2>
				<p className="quiet">{t("What else this agent has in this tenant, each on its own page.")}</p>
				<div className="row-actions">
					<Link className="button ghost small" to={`${path("skills")}?agent=${encodeURIComponent(agent)}`}>
						<Wand2 size={13} aria-hidden="true" /> {t("Skills")}
					</Link>
					<Link className="button ghost small" to={path("connectors")}>
						<Plug size={13} aria-hidden="true" /> {t("Connectors")}
					</Link>
				</div>
			</div>
		</AgentLayout>
	);
}

/** The page, with the Customize section and its test chat beside it when the agent can be customized. */
function AgentLayout({ agent, title, customizable, children }: { agent: string; title: string; customizable: boolean; children: React.ReactNode }) {
	const { t } = useI18n();
	const [testing, setTesting] = useState(false);
	const prepare = useRef<() => Promise<void>>(async () => undefined);
	return (
		<div className={testing ? "skill-layout testing" : "skill-layout"}>
			<div className="page skill-page" data-testid="agent-page">
				{children}
				{customizable ? (
					<Customize agent={agent} testing={testing} onTest={setTesting} prepare={prepare} />
				) : (
					<div className="card">
						<h2>{t("Customize")}</h2>
						<p className="quiet">{t("The platform doesn't let this tenant customize this agent.")}</p>
					</div>
				)}
			</div>
			{testing && (
				<TestPanelBoundary message={t("The test chat stopped working. Close it and open it again.")} closeLabel={t("Close")} onClose={() => setTesting(false)}>
					<TestPanel agent={agent} name={title} draft={{ configDraft: true }} prepare={() => prepare.current()} onClose={() => setTesting(false)} />
				</TestPanelBoundary>
			)}
		</div>
	);
}

/** The tenant's customization of the agent: edits save as your draft, and Publish makes a version everyone's next turn uses. */
function Customize({ agent, testing, onTest, prepare }: { agent: string; testing: boolean; onTest(on: boolean): void; prepare: React.MutableRefObject<() => Promise<void>> }) {
	const { t, describe } = useI18n();
	const { confirm, toast } = useFeedback();
	const client = useQueryClient();
	const view = useQuery({ queryKey: ["agent-config", agent], queryFn: () => getAgentConfig(agent) });
	const [tab, setTab] = useState<Tab>("instructions");
	const [edited, setEdited] = useState<AgentConfigContent>();
	const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
	const [problems, setProblems] = useState<string[]>([]);
	const [publishing, setPublishing] = useState<{ content: AgentConfigContent; reason: string }>();
	const [busy, setBusy] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>();
	const pending = useRef<AgentConfigContent>();

	const data = view.data;
	const published = data?.config.content ?? {};
	const content = edited ?? data?.draft?.content ?? published;
	const dirty = data !== undefined && !same(content, published);

	const save = async (next: AgentConfigContent) => {
		if (data === undefined) return;
		pending.current = undefined;
		setSaving("saving");
		try {
			const saved = await saveAgentConfigDraft(agent, { content: tidy(next), base_version: data.config.version });
			setProblems((saved.draft?.problems ?? []).map((problem) => problem.text));
			setSaving("saved");
		} catch {
			setSaving("failed");
		}
	};
	// The test chat reads the saved draft, so an edit still waiting is saved first.
	prepare.current = async () => {
		clearTimeout(timer.current);
		if (pending.current !== undefined) await save(pending.current);
	};
	useEffect(() => () => clearTimeout(timer.current), []);
	useEffect(() => setProblems((data?.draft?.problems ?? []).map((problem) => problem.text)), [data?.draft]);

	if (data === undefined) {
		return view.isError ? <Empty icon={Sparkles} title={t("This agent's customization can't be read right now.")} /> : <Skeleton rows={6} />;
	}

	const change = (next: AgentConfigContent) => {
		setEdited(next);
		pending.current = next;
		clearTimeout(timer.current);
		timer.current = setTimeout(() => void save(next), SAVE_MS);
	};

	const refresh = (next: AgentConfigView) => {
		client.setQueryData(["agent-config", agent], next);
		void client.invalidateQueries({ queryKey: ["agent-config-history", agent] });
	};

	const publish = async (next: AgentConfigContent, reason: string) => {
		setBusy(true);
		clearTimeout(timer.current);
		pending.current = undefined;
		try {
			const result = await publishAgentConfig(agent, { content: tidy(next), version: data.config.version, reason });
			setEdited(undefined);
			setSaving("idle");
			setProblems([]);
			setPublishing(undefined);
			refresh(result);
			toast(t("Published version {version}. The agent uses it from the next turn.", { version: result.config.version }));
		} catch (error) {
			toast(error instanceof Error ? describe(error) : String(error));
		} finally {
			setBusy(false);
		}
	};

	const discard = async () => {
		setBusy(true);
		clearTimeout(timer.current);
		pending.current = undefined;
		try {
			await discardAgentConfigDraft(agent);
			setEdited(undefined);
			setSaving("idle");
			setProblems([]);
			await client.invalidateQueries({ queryKey: ["agent-config", agent] });
		} catch (error) {
			toast(error instanceof Error ? describe(error) : String(error));
		} finally {
			setBusy(false);
		}
	};

	const reset = async () => {
		const ok = await confirm({
			title: t("Reset to the platform's agent?"),
			body: t("Everything this tenant changed about the agent stops applying from its next turn. History keeps every version, so you can revert."),
			action: t("Reset"),
			danger: true,
		});
		if (ok) await publish({}, t("Reset to the platform's agent"));
	};

	const stale = data.draft !== null && data.draft.base_version < data.config.version && dirty;
	return (
		<section className="card" data-testid="agent-customize">
			<header className="skill-head">
				<div>
					<h2>{t("Customize")}</h2>
					<span className="skills-state">{data.config.version === 0 ? t("As the platform ships it") : t("v{version} live", { version: data.config.version })}</span>
					{dirty && <span className="skills-dirty">{t("Unpublished changes")}</span>}
					{dirty && saving === "saving" && (
						<span className="quiet skills-saving">
							<Loader2 size={12} className="spin" aria-hidden="true" /> {t("Saving draft")}
						</span>
					)}
					{dirty && saving === "saved" && (
						<span className="quiet skills-saving" data-testid="agent-draft-saved">
							<Check size={12} aria-hidden="true" /> {t("Draft saved, only you see it")}
						</span>
					)}
					{saving === "failed" && <span className="danger-text">{t("The draft couldn't be saved.")}</span>}
				</div>
				<div className="skill-actions">
					{dirty && (
						<button type="button" className="ghost small" disabled={busy} onClick={() => void discard()} data-testid="agent-discard">
							{t("Discard changes")}
						</button>
					)}
					<button type="button" className={testing ? "ghost small active" : "ghost small"} onClick={() => onTest(!testing)} aria-pressed={testing} data-testid="agent-test-toggle">
						<FlaskConical size={13} aria-hidden="true" />
						{t("Test")}
					</button>
					{data.config.version > 0 && Object.keys(tidy(published)).length > 0 && (
						<button type="button" className="ghost small" disabled={busy} onClick={() => void reset()} data-testid="agent-reset">
							<RotateCcw size={13} aria-hidden="true" />
							{t("Reset")}
						</button>
					)}
					<button type="button" className="primary small" disabled={busy || !dirty || problems.length > 0} onClick={() => setPublishing({ content, reason: "" })} data-testid="agent-publish">
						{busy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
						{t("Publish")}
					</button>
				</div>
			</header>
			<p className="quiet">{t("Changes apply to everyone in this tenant from their next turn with this agent, in new and existing conversations. Test them first in a private chat.")}</p>
			{stale && (
				<p className="skills-notice" role="status">
					<TriangleAlert size={14} aria-hidden="true" />
					{t("Version {version} was published after your draft began. Publishing your draft replaces it; check History first.", { version: data.config.version })}
				</p>
			)}
			{dirty && problems.length > 0 && (
				<div className="skills-notice" role="status" data-testid="agent-problems">
					<TriangleAlert size={14} aria-hidden="true" />
					<span>
						{t("Before publishing:")} {problems.join("; ")}
					</span>
				</div>
			)}
			<div className="tabs" role="tablist" aria-label={t("Customize")}>
				{(Object.keys(TABS) as Tab[]).map((id) => (
					<button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)} data-testid={`agent-tab-${id}`}>
						{t(TABS[id])}
					</button>
				))}
			</div>
			<section className="skill-tab">
				{tab === "instructions" && <InstructionsTab content={content} onChange={change} />}
				{tab === "tools" && <ToolsTab agent={agent} content={content} keep={data.keep_tools} onChange={change} />}
				{tab === "skills" && <SkillsTab agent={agent} content={content} published={published} onChange={change} />}
				{tab === "model" && <ModelTab content={content} models={data.models} onChange={change} />}
				{tab === "history" && <HistoryTab agent={agent} live={data.config.version} busy={busy} onRevert={(version) => setPublishing({ content: version.content, reason: t("Reverted to version {version}", { version: version.version }) })} />}
			</section>
			{publishing !== undefined && (
				<PublishDialog
					initial={publishing.reason}
					busy={busy}
					onClose={() => setPublishing(undefined)}
					onPublish={(reason) => void publish(publishing.content, reason)}
				/>
			)}
		</section>
	);
}

/** Publishing asks why, and keeps the answer with the version. */
function PublishDialog({ initial, busy, onClose, onPublish }: { initial: string; busy: boolean; onClose(): void; onPublish(reason: string): void }) {
	const { t } = useI18n();
	const [reason, setReason] = useState(initial);
	return (
		<Dialog label={t("Publish")} onClose={onClose}>
			<h2>{t("Publish")}</h2>
			<form
				className="skills-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (reason.trim() !== "") onPublish(reason.trim());
				}}
			>
				<label>
					<span>{t("Why this change?")}</span>
					<input value={reason} autoFocus maxLength={500} placeholder={t("e.g. Our front desk's tone")} onChange={(event) => setReason(event.target.value)} data-testid="agent-publish-reason" />
					<span className="quiet">{t("Kept with the version, in History.")}</span>
				</label>
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={busy || reason.trim() === ""} data-testid="agent-publish-confirm">
						{t("Publish")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

function InstructionsTab({ content, onChange }: { content: AgentConfigContent; onChange(next: AgentConfigContent): void }) {
	const { t } = useI18n();
	const text = content.instructions ?? "";
	const call = content.callInstructions ?? "";
	return (
		<div className="skills-form">
			<label>
				<span>{t("Instructions")}</span>
				<span className="quiet">{t("Added after the agent's own instructions, which come first where the two conflict. Use it for your organization's terms, tone, language and ways of working.")}</span>
				<textarea rows={12} value={text} onChange={(event) => onChange({ ...content, instructions: event.target.value })} data-testid="agent-instructions" />
				<span className={bytes(text) > MAX_TEXT ? "danger-text" : "quiet"}>{t("{used} of {max} KiB", { used: (bytes(text) / 1024).toFixed(1), max: MAX_TEXT / 1024 })}</span>
			</label>
			<label>
				<span>{t("In calls")}</span>
				<span className="quiet">{t("Replaces the instructions above during a voice call, which runs on a fast model. Keep it short. Left empty, calls get none of your instructions.")}</span>
				<textarea rows={4} value={call} onChange={(event) => onChange({ ...content, callInstructions: event.target.value })} data-testid="agent-call-instructions" />
				<span className={bytes(call) > MAX_CALL_TEXT ? "danger-text" : "quiet"}>{t("{used} of {max} KiB", { used: (bytes(call) / 1024).toFixed(1), max: MAX_CALL_TEXT / 1024 })}</span>
			</label>
		</div>
	);
}

/** The agent's tools by the module or server that owns them. Turning one off removes it for everyone in the tenant. */
function ToolsTab({ agent, content, keep, onChange }: { agent: string; content: AgentConfigContent; keep: string[]; onChange(next: AgentConfigContent): void }) {
	const { t } = useI18n();
	const tools = useQuery({ queryKey: ["skill-tools", agent], queryFn: () => listTools(agent), retry: false });
	if (tools.isPending) return <Skeleton rows={4} />;
	if (tools.isError) return <Empty icon={Plug} title={t("This agent's tools can't be listed right now.")} />;
	const off = content.tools?.off ?? [];
	const on = content.tools?.on ?? [];
	// The harness's own tools, such as load_skill, have no owner, and a tenant's list never reaches them.
	const owned = tools.data.filter((tool): tool is CatalogTool & { owner: string } => typeof tool.owner === "string" && tool.owner !== "");
	const groups = [...new Set(owned.map((tool) => tool.owner))].sort();
	const isOn = (key: string) => matches(keep, key) || !matches(off, key) || matches(on, key);
	const set = (nextOff: string[], nextOn: string[]) => onChange({ ...content, tools: { off: nextOff, on: nextOn } });
	const toggle = (key: string, enable: boolean) => {
		if (enable) {
			const nextOff = off.filter((pattern) => pattern !== key);
			// A group's pattern still covers it, so it's kept on within it.
			set(nextOff, matches(nextOff, key) && !on.includes(key) ? [...on, key] : on);
		} else {
			set(matches(off, key) ? off : [...off, key], on.filter((pattern) => pattern !== key));
		}
	};
	const toggleGroup = (owner: string, enable: boolean) => {
		const rest = (patterns: string[]) => patterns.filter((pattern) => !pattern.startsWith(`${owner}:`));
		set(enable ? rest(off) : [...rest(off), `${owner}:*`], rest(on));
	};
	if (groups.length === 0) return <Empty icon={Plug} title={t("This agent has no tools a tenant can turn off.")} />;
	return (
		<div className="agent-tools" data-testid="agent-tools">
			<p className="quiet">{t("All tools are on unless you turn them off. A tool that's off is never offered to the agent, and the tool gateway refuses it.")}</p>
			{groups.map((owner) => {
				const list = owned.filter((tool) => tool.owner === owner).sort((a, b) => a.tool.localeCompare(b.tool));
				const count = list.filter((tool) => isOn(`${owner}:${tool.tool}`)).length;
				return (
					<div key={owner} className="card">
						<div className="skill-head">
							<h3>
								{owner} <span className="quiet">{t("{on} of {all} on", { on: count, all: list.length })}</span>
							</h3>
							<button type="button" className="ghost small" onClick={() => toggleGroup(owner, count < list.length)} data-testid={`agent-tools-group-${owner}`}>
								{count < list.length ? t("Turn all on") : t("Turn all off")}
							</button>
						</div>
						{list.map((tool) => {
							const key = `${owner}:${tool.tool}`;
							const kept = matches(keep, key);
							return (
								<Setting key={key} title={tool.tool} hint={kept ? t("Always on: the agent depends on it.") : tool.description}>
									<label className="switch">
										<span className="sr-only">{tool.tool}</span>
										<input type="checkbox" role="switch" checked={isOn(key)} disabled={kept} onChange={(event) => toggle(key, event.target.checked)} data-testid={`agent-tool-${key}`} />
										<span aria-hidden="true" />
									</label>
								</Setting>
							);
						})}
					</div>
				);
			})}
		</div>
	);
}

/** The agent's skills, which can be turned off for this tenant. The tenant's own are edited on the Skills page. */
function SkillsTab({ agent, content, published, onChange }: { agent: string; content: AgentConfigContent; published: AgentConfigContent; onChange(next: AgentConfigContent): void }) {
	const { t } = useI18n();
	const listed = useQuery({ queryKey: ["skills", agent], queryFn: () => listSkills(agent), select: (body) => body.skills, retry: false });
	if (listed.isPending) return <Skeleton rows={4} />;
	const off = content.skills?.off ?? [];
	// The agent leaves skills that are off out of its list, so the published ones that are off come from the version.
	const names = [...new Set([...(listed.data ?? []).map((skill) => skill.name), ...(published.skills?.off ?? []), ...off])].sort();
	const describeSkill = (name: string) => listed.data?.find((skill) => skill.name === name)?.description ?? "";
	if (names.length === 0) return <Empty icon={Wand2} title={t("This agent has no skills yet.")} />;
	return (
		<div data-testid="agent-skills">
			<p className="quiet">{t("A skill that's off leaves the agent's list. A skill that's on still can't use a tool you turned off.")}</p>
			{names.map((name) => (
				<Setting key={name} title={name} hint={describeSkill(name)}>
					<label className="switch">
						<span className="sr-only">{name}</span>
						<input
							type="checkbox"
							role="switch"
							checked={!off.includes(name)}
							onChange={(event) => onChange({ ...content, skills: { off: event.target.checked ? off.filter((skill) => skill !== name) : [...off, name] } })}
							data-testid={`agent-skill-${name}`}
						/>
						<span aria-hidden="true" />
					</label>
				</Setting>
			))}
		</div>
	);
}

function ModelTab({ content, models, onChange }: { content: AgentConfigContent; models: string[]; onChange(next: AgentConfigContent): void }) {
	const { t } = useI18n();
	return (
		<div className="skills-form">
			<Setting title={t("Model for typed conversations")} hint={t("New conversations use it; existing ones keep theirs. Calls keep the agent's own fast model.")}>
				<select aria-label={t("Model for typed conversations")} value={content.model ?? ""} onChange={(event) => onChange({ ...content, model: event.target.value })} data-testid="agent-model">
					<option value="">{t("The agent's own")}</option>
					{models.map((model) => (
						<option key={model} value={model}>
							{model}
						</option>
					))}
				</select>
			</Setting>
			{models.length === 0 && <p className="quiet">{t("The platform offers no other model for this agent.")}</p>}
		</div>
	);
}

/** Every published version, newest first. Revert publishes an older one again, as a new version. */
function HistoryTab({ agent, live, busy, onRevert }: { agent: string; live: number; busy: boolean; onRevert(version: AgentConfigVersion): void }) {
	const { t, ago } = useI18n();
	const nameOf = useMemberName();
	const history = useQuery({ queryKey: ["agent-config-history", agent], queryFn: () => getAgentConfigHistory(agent) });
	if (history.isPending) return <Skeleton rows={4} />;
	if ((history.data ?? []).length === 0) return <p className="quiet">{t("Nothing published yet.")}</p>;
	const summary = (content: AgentConfigContent) => {
		const parts = [];
		if (content.instructions) parts.push(t("instructions"));
		if (content.callInstructions) parts.push(t("call instructions"));
		if ((content.tools?.off ?? []).length > 0) parts.push(t("{count} tool patterns off", { count: content.tools!.off!.length }));
		if ((content.skills?.off ?? []).length > 0) parts.push(t("{count} skills off", { count: content.skills!.off!.length }));
		if (content.model) parts.push(t("model {name}", { name: content.model }));
		return parts.length === 0 ? t("As the platform ships it") : parts.join(", ");
	};
	return (
		<ul className="rows" data-testid="agent-history">
			{history.data!.map((version) => (
				<li key={version.version} className="row">
					<div className="row-main">
						<span>
							<strong>v{version.version}</strong> · {summary(version.content)}
							{version.version === live && <span className="pill accent">{t("Live")}</span>}
						</span>
						<span className="quiet">
							{nameOf(version.actor)} · {ago(Date.parse(version.at))} · {version.reason}
						</span>
					</div>
					{version.version !== live && (
						<button type="button" className="ghost small" disabled={busy} onClick={() => onRevert(version)} data-testid={`agent-revert-${version.version}`}>
							{t("Revert")}
						</button>
					)}
				</li>
			))}
		</ul>
	);
}
