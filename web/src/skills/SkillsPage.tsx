import { useQuery } from "@tanstack/react-query";
import { Bot, FolderUp, LockKeyhole, Plus, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { Dialog, Empty, Skeleton } from "../lib/ui.tsx";
import { addFiles, type SkillText } from "./files.ts";
import { useWorkspace } from "../shell/workspace.ts";
import { getTenantSkills, kindOf, listSkills, type SkillKind } from "./api.ts";
import { listSkillDrafts } from "../modules/agents/api.ts";
import "./skills.css";

const NAME = /^[a-z][a-z0-9_-]*$/;

/** What a new skill starts as, handed to its page before anything is published. */
export type NewSkill = SkillText & { keywords: string[] };

const KIND_LABELS: Record<SkillKind, string> = { builtin: "Built-in", override: "Customized", custom: "Ours" };

/** The agent picker the skill pages share. */
export function AgentPicker({ agent, onChange }: { agent: string; onChange(agent: string): void }) {
	const { t } = useI18n();
	const { agents, config } = useWorkspace();
	const list = agents.length > 0 ? agents : config.agents.map((name) => ({ name, title: undefined }));
	if (list.length <= 1) return null;
	return (
		<div className="workflow-agent-pills" role="tablist" aria-label={t("Agent")}>
			{list.map((entry) => (
				<button
					key={entry.name}
					type="button"
					role="tab"
					aria-selected={entry.name === agent}
					className={entry.name === agent ? "workflow-agent-pill active" : "workflow-agent-pill"}
					onClick={() => onChange(entry.name)}
					data-testid={`skills-agent-${entry.name}`}
				>
					<Bot size={13} aria-hidden="true" />
					<span>{entry.title || entry.name}</span>
				</button>
			))}
		</div>
	);
}

/** Every skill an agent has for this tenant, built-in, customized or the tenant's own, with what state each is in. */
export function SkillsLibrary({ agent, onAgent }: { agent: string; onAgent(agent: string): void }) {
	const { t, ago, language } = useI18n();
	const { path } = useWorkspace();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState(false);
	const listed = useQuery({ queryKey: ["skills", agent], queryFn: () => listSkills(agent), select: (body) => body.skills, retry: false });
	const records = useQuery({ queryKey: ["tenant-skills", agent], queryFn: () => getTenantSkills(agent), retry: false });
	const drafts = useQuery({ queryKey: ["skill-drafts", agent], queryFn: () => listSkillDrafts(agent), retry: false });

	// Turned-off skills of the tenant's own aren't in the agent's list, but an admin still needs them.
	// So are skills that are only your draft so far.
	const names = new Set([...(listed.data ?? []).map((s) => s.name), ...(records.data ?? []).map((r) => r.name), ...(drafts.data ?? []).map((d) => d.name)]);
	const rows = [...names]
		.map((name) => {
			// The agent's list can trail a change by a second; control's records decide what's the tenant's.
			const agentSkill = listed.data?.find((s) => s.name === name);
			const gone = agentSkill?.source !== undefined && records.isSuccess && !records.data.some((r) => r.name === name);
			const skill = gone && agentSkill?.source?.kind === "custom" ? undefined : agentSkill;
			const record = records.data?.find((r) => r.name === name);
			const draft = drafts.data?.find((d) => d.name === name);
			const kind = record === undefined && skill === undefined ? (draft?.kind ?? "custom") : gone ? "builtin" : kindOf(skill, record);
			return { name, skill, record, draft, kind };
		})
		.filter((row) => row.skill !== undefined || row.record !== undefined || row.draft !== undefined)
		.filter((row) => `${row.name} ${row.skill?.description ?? row.record?.content.description ?? row.draft?.content.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
		.sort((a, b) => a.name.localeCompare(b.name));
	const open = (name: string, state?: NewSkill) => navigate(path(`skills/${encodeURIComponent(agent)}/${encodeURIComponent(name)}`), state === undefined ? undefined : { state: { newSkill: state } });

	const importFolder = async (list: FileList | null) => {
		if (list === null || list.length === 0) return;
		const folder = list[0]!.webkitRelativePath.split("/")[0] ?? "";
		const name = folder.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "");
		const { next } = await addFiles(list, true, { description: "", body: "", files: {} }, language === "zh");
		if (NAME.test(name)) open(name, { ...next, keywords: [] });
	};

	return (
		<div className="skills-library" data-testid="skills-library">
			<div className="skills-bar">
				<AgentPicker agent={agent} onChange={onAgent} />
				<label className="skills-search">
					<Search size={14} aria-hidden="true" />
					<input type="search" value={query} placeholder={t("Search skills")} aria-label={t("Search skills")} onChange={(e) => setQuery(e.target.value)} />
				</label>
				<label className="button ghost small">
					<FolderUp size={14} aria-hidden="true" />
					{t("Import folder")}
					<input type="file" hidden {...{ webkitdirectory: "" }} onChange={(e) => void importFolder(e.target.files).finally(() => (e.target.value = ""))} />
				</label>
				<button type="button" className="primary small" onClick={() => setCreating(true)} data-testid="skills-new">
					<Plus size={14} aria-hidden="true" />
					{t("New skill")}
				</button>
			</div>
			{(listed.isPending || records.isPending) && <Skeleton rows={4} />}
			{listed.isError && <Empty icon={Sparkles} title={t("This agent's skills can't be read right now.")} />}
			{listed.isSuccess && rows.length === 0 && <Empty icon={Sparkles} title={query === "" ? t("This agent has no skills yet.") : t("No skill matches.")} />}
			{rows.length > 0 && (
				<ul className="skills-list">
					{rows.map(({ name, skill, record, draft, kind }) => {
						// A turned-off override leaves the built-in working, which "Off" would hide.
						const state = record === undefined ? undefined : record.state === "published" ? t("Live") : kind === "override" ? t("Built-in in use") : t("Off");
						return (
							<li key={name}>
								<button type="button" className="skills-row" onClick={() => open(name)} data-testid={`skill-row-${name}`}>
									<span className="skills-name">
										<strong>{name}</strong>
										<span className="quiet">{skill?.description ?? record?.content.description ?? draft?.content.description ?? ""}</span>
									</span>
									<span className={`skills-kind ${kind}`}>{t(KIND_LABELS[kind])}</span>
									<span className="skills-state">
										{state ?? (draft === undefined ? "—" : "")}
										{draft !== undefined && <span className="skills-dirty">{t("Your draft")}</span>}
									</span>
									<span className="skills-version">{record === undefined ? "—" : `v${record.version}`}</span>
									<span className="skills-changed quiet">{record === undefined ? "" : ago(Date.parse(record.updated_at))}</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{creating && <NewSkillDialog taken={names} onClose={() => setCreating(false)} onCreate={(name, description) => open(name, { description, body: "", files: {}, keywords: [] })} />}
		</div>
	);
}

function NewSkillDialog({ taken, onClose, onCreate }: { taken: ReadonlySet<string>; onClose(): void; onCreate(name: string, description: string): void }) {
	const { t } = useI18n();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const problem = name === "" ? undefined : !NAME.test(name) || name.length > 64 ? t("Lowercase letters, digits, - and _, starting with a letter.") : taken.has(name) ? t("A skill with this name already exists.") : undefined;
	return (
		<Dialog label={t("New skill")} onClose={onClose}>
			<h2>{t("New skill")}</h2>
			<form
				className="skills-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (problem === undefined && name !== "" && description.trim() !== "") onCreate(name, description.trim());
				}}
			>
				<label>
					<span>{t("Name")}</span>
					<input value={name} autoFocus maxLength={64} placeholder="account-review" onChange={(e) => setName(e.target.value.toLowerCase())} data-testid="new-skill-name" />
					{problem !== undefined && <span className="danger-text">{problem}</span>}
				</label>
				<label>
					<span>{t("When should the agent use it?")}</span>
					<input value={description} maxLength={1024} placeholder={t("e.g. Reviewing an account before a renewal call")} onChange={(e) => setDescription(e.target.value)} data-testid="new-skill-description" />
				</label>
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={problem !== undefined || name === "" || description.trim() === ""} data-testid="new-skill-create">
						{t("Create")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

/** `/t/<tenant>/skills`: the library, for admins only. */
export function SkillsPage() {
	const { t } = useI18n();
	const { agent: current, isAdmin } = useWorkspace();
	// In the address, so a skill page's way back returns to the same agent.
	const [params, setParams] = useSearchParams();
	const agent = params.get("agent") || current;
	const setAgent = (next: string) => setParams({ agent: next }, { replace: true });
	if (!isAdmin) {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("Only this tenant's admins can open this page.")} />
			</div>
		);
	}
	return (
		<div className="page skills-page">
			<header className="page-head">
				<h1>{t("Skills")}</h1>
			</header>
			<p className="quiet">{t("Instructions, files and workflows the agent uses. A change reaches everyone in this tenant on their next turn.")}</p>
			<SkillsLibrary agent={agent} onAgent={setAgent} />
		</div>
	);
}
