import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Pause, Play, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { type Automation, createAutomation, DAYS, deleteAutomation, type Firing, fromCron, getAutomation, listAutomations, runAutomation, toCron, updateAutomation } from "./api.ts";

const DAY_NAMES: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
const STATE_LABELS: Record<Automation["state"], string> = { active: "On", paused: "Paused", failing: "Stopped after failures", revoked: "Consent ended" };
const FIRING_LABELS: Record<Firing["state"], string> = { claimed: "Waiting", running: "Running", done: "Done", failed: "Failed", skipped: "Skipped" };

/** A person's automations: what runs for them, when, and what each run did. */
export function AutomationsPage() {
	const { t } = useI18n();
	const automations = useQuery({ queryKey: ["automations"], queryFn: listAutomations });
	const [open, setOpen] = useState<string>();
	return (
		<div className="page">
			<header className="page-head">
				<h1>{t("Automations")}</h1>
			</header>
			<p className="quiet">{t("Instructions an agent runs for you on a schedule, as you, while you're away. You're told when each run is ready.")}</p>
			<NewAutomation />
			{automations.isPending && <Skeleton />}
			{automations.data?.length === 0 && (
				<Empty icon={AlarmClock} title={t("Nothing scheduled yet.")}>
					{t("A morning brief on weekdays is a good first one.")}
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

function NewAutomation() {
	const { t, describe } = useI18n();
	const { agents, agent } = useWorkspace();
	const { toast } = useFeedback();
	const client = useQueryClient();
	const [name, setName] = useState("");
	const [instruction, setInstruction] = useState("");
	const [chosen, setChosen] = useState(agent);
	const [time, setTime] = useState("08:00");
	const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
	const create = useMutation({
		mutationFn: () => {
			const [hour, minute] = time.split(":").map(Number);
			return createAutomation({
				name,
				instruction,
				agent: chosen,
				cron: toCron({ hour: hour ?? 8, minute: minute ?? 0, days }),
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			});
		},
		onSuccess: () => {
			setName("");
			setInstruction("");
			toast(t("Scheduled. It runs as you, so it can do what you can."));
			void client.invalidateQueries({ queryKey: ["automations"] });
		},
		onError: (error) => toast(describe(error)),
	});
	const ready = name.trim() !== "" && instruction.trim() !== "" && days.length > 0 && chosen !== "";
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (ready) create.mutate();
	};
	return (
		<form className="card automation-form" onSubmit={submit}>
			<h2>{t("New automation")}</h2>
			<input value={name} maxLength={120} placeholder={t("Name, such as Morning brief")} aria-label={t("Name")} onChange={(event) => setName(event.target.value)} />
			<textarea value={instruction} maxLength={4000} rows={3} placeholder={t("What the agent should do each time")} aria-label={t("Instruction")} onChange={(event) => setInstruction(event.target.value)} />
			<div className="automation-when">
				{agents.length > 1 && (
					<select aria-label={t("Agent")} value={chosen} onChange={(event) => setChosen(event.target.value)}>
						{agents.map((entry) => (
							<option key={entry.name} value={entry.name}>
								{entry.title ?? entry.name}
							</option>
						))}
					</select>
				)}
				<input type="time" aria-label={t("Time")} value={time} onChange={(event) => setTime(event.target.value)} required />
				<div className="day-picks" role="group" aria-label={t("Days")}>
					{DAYS.map((day) => (
						<label key={day} className={days.includes(day) ? "day-pick on" : "day-pick"}>
							<input type="checkbox" checked={days.includes(day)} onChange={(event) => setDays(event.target.checked ? [...days, day] : days.filter((d) => d !== day))} />
							{t(DAY_NAMES[day]!)}
						</label>
					))}
				</div>
				<button type="submit" className="primary" disabled={!ready || create.isPending}>
					<Plus size={15} aria-hidden="true" />
					{t("Schedule")}
				</button>
			</div>
		</form>
	);
}

function AutomationRow({ automation, open, onToggle }: { automation: Automation; open: boolean; onToggle(): void }) {
	const { t, describe } = useI18n();
	const { confirm, toast } = useFeedback();
	const client = useQueryClient();
	const refresh = () => {
		void client.invalidateQueries({ queryKey: ["automations"] });
		void client.invalidateQueries({ queryKey: ["automation", automation.id] });
	};
	const act = useMutation({
		mutationFn: async (action: "pause" | "resume" | "run" | "delete") => {
			if (action === "run") {
				await runAutomation(automation.id);
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
					{automation.name}
					{automation.state !== "active" && <span className={automation.state === "paused" ? "pill" : "pill warn"}>{t(STATE_LABELS[automation.state])}</span>}
				</span>
				<span className="quiet">
					{when}
					{running && automation.next_fire_at !== null && <> · {t("next {when}", { when: new Date(automation.next_fire_at).toLocaleString() })}</>}
				</span>
			</button>
			<div className="row-actions">
				{automation.state !== "revoked" && (
					<button type="button" className="ghost small" disabled={act.isPending} onClick={() => act.mutate("run")}>
						{t("Run now")}
					</button>
				)}
				{automation.state === "active" && (
					<button type="button" className="icon-button" aria-label={t("Pause")} title={t("Pause")} disabled={act.isPending} onClick={() => act.mutate("pause")}>
						<Pause size={15} aria-hidden="true" />
					</button>
				)}
				{(automation.state === "paused" || automation.state === "failing") && (
					<button type="button" className="icon-button" aria-label={t("Resume")} title={t("Resume")} disabled={act.isPending} onClick={() => act.mutate("resume")}>
						<Play size={15} aria-hidden="true" />
					</button>
				)}
				<button
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
				</button>
			</div>
			{open && <Firings automation={automation} />}
		</li>
	);
}

function describeSchedule(automation: Automation, t: ReturnType<typeof useI18n>["t"]): string {
	const simple = fromCron(automation.cron);
	if (simple === undefined) return `${automation.cron} (${automation.timezone})`;
	const time = `${String(simple.hour).padStart(2, "0")}:${String(simple.minute).padStart(2, "0")}`;
	const days = simple.days.length === 7 ? t("every day") : simple.days.join(",") === "1,2,3,4,5" ? t("weekdays") : simple.days.map((day) => t(DAY_NAMES[day]!)).join(" ");
	return t("{time}, {days}, {zone}", { time, days, zone: automation.timezone });
}

function Firings({ automation }: { automation: Automation }) {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const detail = useQuery({ queryKey: ["automation", automation.id], queryFn: () => getAutomation(automation.id), refetchInterval: 10_000 });
	if (detail.data === undefined) return <Skeleton rows={1} />;
	return (
		<div className="automation-detail">
			<p className="quiet">{automation.instruction}</p>
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
