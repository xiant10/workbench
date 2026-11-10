import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ChevronDown, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { TaskForm } from "./TaskForm.tsx";
import { type Automation, createAutomation, deleteAutomation, type Firing, fromCron, getAutomation, listAutomations, runAutomation, updateAutomation } from "./api.ts";

const DAY_NAMES: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
const STATE_LABELS: Record<Automation["state"], string> = { active: "On", paused: "Paused", failing: "Stopped after failures", revoked: "Consent ended" };
const FIRING_LABELS: Record<Firing["state"], string> = { claimed: "Waiting", running: "Running", done: "Done", failed: "Failed", skipped: "Skipped" };

/** A person's automations: what runs for them, when, and what each run did. */
export function AutomationsPage() {
	const { t } = useI18n();
	const automations = useQuery({ queryKey: ["automations"], queryFn: listAutomations, refetchInterval: 10_000 });
	const [creating, setCreating] = useState(false);
	const [open, setOpen] = useState<string>();
	return (
		<div className="page">
			<header className="page-head">
				<h1>{t("Automations")}</h1>
				<button type="button" className="primary" disabled={creating} onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />{t("New automation")}</button>
			</header>
			<p className="quiet">{t("Reusable tasks an agent runs for you, on demand or on a schedule. Each run acts as you and opens a conversation with its results.")}</p>
			<NewAutomation visible={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />
			{automations.isPending && <Skeleton />}
			{automations.isError && <p role="alert">{t("Couldn't load this. Try again.")} <button type="button" className="link" onClick={() => void automations.refetch()}>{t("Retry")}</button></p>}
			{automations.data?.length === 0 && (
				<Empty icon={AlarmClock} title={t("No automations yet.")}>
					{t("Save a task to run when needed, or schedule a recurring brief.")}
				</Empty>
			)}
			<ul className="rows">
				{(automations.data ?? []).map((automation) => (
					<AutomationRow key={automation.id} automation={automation} open={open === automation.id} onToggle={() => setOpen(open === automation.id ? undefined : automation.id)} />
				))}
			</ul>
		</div>
	);
}

function NewAutomation({ visible, onClose, onCreated }: { visible: boolean; onClose(): void; onCreated(id: string): void }) {
	const { t } = useI18n();
	const { toast } = useFeedback();
	const client = useQueryClient();
	if (!visible) return null;
	return <TaskForm onCancel={onClose} onSave={async (draft) => {
		const created = await createAutomation(draft);
		onClose();
		onCreated(created.id);
		toast(t("Automation saved. It runs with your permissions."));
		void client.invalidateQueries({ queryKey: ["automations"] });
	}} />;
}

function AutomationRow({ automation, open, onToggle }: { automation: Automation; open: boolean; onToggle(): void }) {
	const [editing, setEditing] = useState(false);
	const { t, describe } = useI18n();
	const { confirm, toast } = useFeedback();
	const client = useQueryClient();
	const detail = useQuery({
		queryKey: ["automation", automation.id], queryFn: () => getAutomation(automation.id),
		enabled: (query) => open || query.state.data?.firings.some((firing) => firing.state === "claimed" || firing.state === "running") === true,
		refetchInterval: 5_000,
	});
	const busy = detail.data?.firings.some((firing) => firing.state === "claimed" || firing.state === "running") === true;
	const refresh = () => {
		void client.invalidateQueries({ queryKey: ["automations"] });
		void client.invalidateQueries({ queryKey: ["automation", automation.id] });
	};
	const act = useMutation({
		mutationFn: async (action: "pause" | "resume" | "run" | "delete") => {
			if (action === "run") {
				const firing = await runAutomation(automation.id);
				client.setQueryData<{ automation: Automation; firings: Firing[] }>(["automation", automation.id], (old) => ({ automation, firings: [firing, ...(old?.firings ?? [])].slice(0, 20) }));
				if (!open) onToggle();
				toast(t("Started. You'll be told when it's ready."));
			} else if (action === "delete") await deleteAutomation(automation.id);
			else await updateAutomation(automation.id, { state: action === "pause" ? "paused" : "active" });
		},
		onSuccess: refresh,
		onError: (error) => toast(describe(error)),
	});
	const when = describeSchedule(automation, t);
	const running = automation.state === "active";
	return (
		<li className="row automation-row">
			<button type="button" className="row-main as-button" aria-expanded={open} onClick={onToggle}>
				<span>
					{automation.name} <ChevronDown size={14} aria-hidden="true" className={open ? "automation-chevron open" : "automation-chevron"} />
					{automation.state !== "active" && <span className={automation.state === "paused" ? "pill" : "pill warn"}>{t(STATE_LABELS[automation.state])}</span>}
				</span>
				<span className="quiet">
					{when}
					{running && automation.next_fire_at !== null && <> · {t("next {when}", { when: new Date(automation.next_fire_at).toLocaleString() })}</>}
				</span>
			</button>
			<div className="row-actions">
				{automation.state !== "revoked" && <button type="button" className="ghost small" onClick={() => { setEditing(true); if (!open) onToggle(); }}>{t("Edit automation")}</button>}
				{automation.state !== "revoked" && (
					<button type="button" className="ghost small" disabled={act.isPending || busy} onClick={() => act.mutate("run")}>
						{busy ? t("Running") : t("Run now")}
					</button>
				)}
				{automation.state === "active" && automation.cron !== "" && (
					<button type="button" className="icon-button" aria-label={t("Pause schedule")} title={t("Pause schedule")} disabled={act.isPending} onClick={() => act.mutate("pause")}>
						<Pause size={15} aria-hidden="true" />
					</button>
				)}
				{(automation.state === "paused" || automation.state === "failing") && (
					<button type="button" className="icon-button" aria-label={t("Resume")} title={t("Resume")} disabled={act.isPending} onClick={() => act.mutate("resume")}>
						<Play size={15} aria-hidden="true" />
					</button>
				)}
				{open && <button
					type="button"
					className="icon-button"
					aria-label={t("Delete")}
					title={t("Delete")}
					disabled={act.isPending}
					onClick={async () => {
						if (await confirm({ title: t("Delete {name}?", { name: automation.name }), body: t("It stops running, and your consent to it ends. Its conversations stay."), action: t("Delete"), danger: true })) act.mutate("delete");
					}}
				>
					<Trash2 size={15} aria-hidden="true" />
				</button>}
			</div>
			{open && <Firings detail={detail} automation={automation} editing={editing} setEditing={setEditing} />}
		</li>
	);
}

function describeSchedule(automation: Automation, t: ReturnType<typeof useI18n>["t"]): string {
	if (automation.cron === "") return t("On demand");
	const simple = fromCron(automation.cron);
	if (simple === undefined) return `${automation.cron} (${automation.timezone})`;
	const time = `${String(simple.hour).padStart(2, "0")}:${String(simple.minute).padStart(2, "0")}`;
	const days = simple.days.length === 7 ? t("every day") : simple.days.join(",") === "1,2,3,4,5" ? t("weekdays") : simple.days.map((day) => t(DAY_NAMES[day]!)).join(" ");
	return t("{time}, {days}, {zone}", { time, days, zone: automation.timezone });
}

function Firings({ detail, automation, editing, setEditing }: { detail: UseQueryResult<Awaited<ReturnType<typeof getAutomation>>, Error>; automation: Automation; editing: boolean; setEditing(value: boolean): void }) {
	const { t, describe } = useI18n();
	const client = useQueryClient();
	const { path } = useWorkspace();
	if (detail.isError) return <p role="alert">{describe(detail.error)} <button type="button" className="link" onClick={() => void detail.refetch()}>{t("Retry")}</button></p>;
	if (detail.data === undefined) return <Skeleton rows={1} />;
	return (
		<div className="automation-detail">
			{editing ? <TaskForm initial={detail.data.automation} onCancel={() => setEditing(false)} onSave={async ({ agent: _agent, ...draft }) => {
				await updateAutomation(automation.id, draft);
				setEditing(false);
				void client.invalidateQueries({ queryKey: ["automations"] });
				void client.invalidateQueries({ queryKey: ["automation", automation.id] });
			}} /> : <>
				<p className="automation-instruction">{automation.instruction}</p>
				<p className="quiet">{t("Agent")}: {automation.agent} · {t("Maximum runs in 24 hours")}: {automation.runs_per_day}</p>
			</>}
			<h3>{t("Recent runs")}</h3>
			{automation.state === "paused" && automation.cron !== "" && <p className="quiet">{t("The schedule is paused. You can still use Run now.")}</p>}
			{detail.data.firings.length === 0 && <p className="quiet">{t("It hasn't run yet.")}</p>}
			<ul className="firings">
				{detail.data.firings.map((firing) => (
					<li key={firing.id}>
						<span className={firing.state === "failed" ? "pill warn" : "pill"}>{t(FIRING_LABELS[firing.state])}</span> {new Date(firing.scheduled_for).toLocaleString()}
						{firing.problem !== undefined && firing.problem !== "" && <span className="quiet"> · {firing.problem}</span>}
						{firing.session_id !== undefined && firing.session_id !== "" && (
							<>
								{" · "}
								<Link to={path(`c/${encodeURIComponent(firing.session_id)}`)}>{t("Open conversation")}</Link>
							</>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}
