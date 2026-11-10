import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { type Automation, DAYS, type Draft, fromCron, toCron } from "./api.ts";

const DAY_NAMES: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
const STARTERS = [
	{ name: "Morning brief", instruction: "Review my work for today. Summarize priorities, deadlines and blockers, link to the relevant records, and suggest the next actions. Ask for approval before making changes." },
	{ name: "Follow-up review", instruction: "Review work that needs a follow-up. Explain what changed, identify overdue items, and draft the next steps with links to the source records. Ask for approval before sending messages or changing records." },
	{ name: "Research report", instruction: "Research the topic I describe below using the sources available to you. Compare the findings, cite sources, flag uncertainty, and finish with actionable recommendations.\n\nTopic: " },
];

/** The same task editor serves creation and changes, preserving custom timing. */
export function TaskForm({ initial, onSave, onCancel }: { initial?: Automation; onSave(draft: Draft): Promise<void>; onCancel?(): void }) {
	const heading = useId();
	const { t, describe } = useI18n();
	const { agents, agent } = useWorkspace();
	const simple = initial ? fromCron(initial.cron) : undefined;
	const [name, setName] = useState(initial?.name ?? "");
	const [instruction, setInstruction] = useState(initial?.instruction ?? "");
	const [chosen, setChosen] = useState(initial?.agent ?? "");
	const [mode, setMode] = useState(initial ? (initial.cron === "" ? "manual" : simple ? "days" : "cron") : "days");
	const [time, setTime] = useState(simple ? `${String(simple.hour).padStart(2, "0")}:${String(simple.minute).padStart(2, "0")}` : "08:00");
	const [days, setDays] = useState<number[]>(simple?.days ?? [1, 2, 3, 4, 5]);
	const [cron, setCron] = useState(initial?.cron || "0 8 * * 1-5");
	const [timezone, setTimezone] = useState(initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
	const [limit, setLimit] = useState(initial?.runs_per_day ?? 24);
	const selected = chosen || agent || agents[0]?.name || "";
	let validZone = true;
	try { new Intl.DateTimeFormat("en", { timeZone: timezone.trim() }); } catch { validZone = false; }
	const repetition = days.length === 7 ? "daily" : [...days].sort().join(",") === "1,2,3,4,5" ? "weekdays" : "chosen";
	const summaryDays = repetition === "daily" ? t("every day") : repetition === "weekdays" ? t("weekdays") : days.map((day) => t(DAY_NAMES[day]!)).join(" ");
	const save = useMutation({ mutationFn: onSave });
	const ready = name.trim() !== "" && instruction.trim() !== "" && selected !== "" && validZone && Number.isInteger(limit) && limit >= 1 && limit <= 288 && (mode === "manual" || (mode === "days" ? days.length > 0 && time !== "" : cron.trim() !== ""));
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!ready || save.isPending) return;
		const [hour, minute] = time.split(":").map(Number);
		save.mutate({ name, instruction, agent: selected, cron: mode === "manual" ? "" : mode === "cron" ? cron.trim() : toCron({ hour: hour!, minute: minute!, days }), timezone: timezone.trim(), runs_per_day: limit });
	};
	return (
		<form className="card automation-form" onSubmit={submit} aria-labelledby={heading} aria-busy={save.isPending}>
			<h2 id={heading}>{t(initial ? "Edit automation" : "New automation")}</h2>
			{!initial && <label>{t("Start from an example")}
				<select defaultValue="" onChange={(event) => {
					const starter = STARTERS[Number(event.target.value)];
					if (event.target.value !== "" && starter) { setName(t(starter.name)); setInstruction(t(starter.instruction)); }
				}}>
					<option value="">{t("Custom task")}</option>
					{STARTERS.map((starter, i) => <option key={starter.name} value={i}>{t(starter.name)}</option>)}
				</select>
			</label>}
			<label>{t("Name")}<input value={name} autoFocus maxLength={120} required placeholder={t("Name, such as Morning brief")} onChange={(event) => setName(event.target.value)} /></label>
			<label>{t("Instruction")}<textarea value={instruction} maxLength={4000} required rows={5} placeholder={t("Describe the goal, sources to use, actions allowed, and the result you want.")} onChange={(event) => setInstruction(event.target.value)} /></label>
			<details className="automation-options"><summary>{t("Tips for a useful task")}</summary><p className="quiet">{t("Specify what success looks like and when the agent should ask for approval. Available tools and permissions depend on the selected agent.")}</p></details>
			{initial || agents.length === 1 ? <p className="quiet">{t("Agent")}: {agents.find((entry) => entry.name === selected)?.title ?? selected}</p> : <label>{t("Agent")}<select value={selected} onChange={(event) => setChosen(event.target.value)} required>
				{!selected && <option value="">{t("Choose an agent")}</option>}
				{agents.map((entry) => <option key={entry.name} value={entry.name}>{entry.title ?? entry.name}</option>)}
			</select></label>}
			<label>{t("When to run")}<select value={mode} onChange={(event) => setMode(event.target.value)}>
				<option value="manual">{t("On demand")}</option><option value="days">{t("Time and days")}</option><option value="cron">{t("Custom schedule")}</option>
			</select></label>
			{mode === "days" && <div className="automation-when">
				<input type="time" aria-label={t("Time")} value={time} onChange={(event) => setTime(event.target.value)} required />
				<label>{t("Repeat")}<select aria-label={t("Repeat")} value={repetition} onChange={(event) => setDays(event.target.value === "daily" ? [...DAYS] : event.target.value === "weekdays" ? [1, 2, 3, 4, 5] : [1])}>
					<option value="daily">{t("Every day")}</option><option value="weekdays">{t("Weekdays")}</option><option value="chosen">{t("Choose days")}</option>
				</select></label>
				<div className="day-picks" role="group" aria-label={t("Days")}>
					{DAYS.map((day) => <label key={day} className={days.includes(day) ? "day-pick on" : "day-pick"}>
						<input type="checkbox" checked={days.includes(day)} onChange={(event) => setDays(event.target.checked ? [...days, day] : days.filter((d) => d !== day))} />{t(DAY_NAMES[day]!)}
					</label>)}
				</div>
			</div>}
			{mode === "cron" && <label>{t("Cron expression")}<input value={cron} onChange={(event) => setCron(event.target.value)} required placeholder="*/15 9-17 * * 1-5" />
				<span className="quiet">{t("Five fields: minute, hour, day of month, month, day of week. At most every 5 minutes. Example: */15 9-17 * * 1-5.")}</span>
			</label>}
			{mode === "days" && days.length === 0 && <p role="alert">{t("Choose at least one day.")}</p>}
			{(mode !== "manual" || !validZone) && <details className="automation-options"><summary>{t("Timezone")}: {timezone}</summary><label>{t("Timezone")}<input value={timezone} required placeholder="America/Chicago" aria-invalid={!validZone} onChange={(event) => setTimezone(event.target.value)} /></label></details>}
			{!validZone && <p role="alert">{t("Enter a valid timezone, such as America/Chicago.")}</p>}
			{mode === "days" && days.length > 0 && time && <p className="automation-preview" role="status">{t("Runs at {time}, {days}, {zone}.", { time, days: summaryDays, zone: timezone })}</p>}
			{mode === "cron" && <p className="quiet">{t("Your custom schedule is checked when you save.")}</p>}
			{mode === "manual" && <p className="quiet">{t("Saved for reuse. It runs only when you choose Run now.")}</p>}
			<details className="automation-options" open={initial && initial.runs_per_day !== 24 ? true : undefined}><summary>{t("Run limits")}</summary><p className="quiet">{t("Limit how often this automation can run, including Run now.")}</p><label>{t("Maximum runs in 24 hours")}<input type="number" min={1} max={288} step={1} value={Number.isNaN(limit) ? "" : limit} required onChange={(event) => setLimit(event.target.valueAsNumber)} /></label></details>
			<p className="quiet">{t("Results appear in a new conversation. You’ll get a notification when a run finishes.")}</p>
			{save.isError && <p role="alert">{describe(save.error)}</p>}
			<div className="automation-when automation-submit">
				{onCancel && <button type="button" className="ghost" disabled={save.isPending} onClick={onCancel}>{t("Cancel")}</button>}
				<button type="submit" className="primary" disabled={!ready || save.isPending}>{t(save.isPending ? "Saving…" : initial ? "Save changes" : "Create automation")}</button>
			</div>
		</form>
	);
}
