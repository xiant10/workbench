import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useMemberName } from "../../admin/members.ts";
import { useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { Setting, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { Evidence } from "./Evidence.tsx";
import { PolicySettings } from "./PolicySettings.tsx";
import { type AgentImpact, type AgentSettings as Settings, getAgentSettings, getPlatformChanges, getSettingHistory, putAgentSettings } from "./api.ts";

/** Routers poll every 10 seconds, so a change reaches new conversations within one poll. */
const APPLIES_MS = 11_000;

/** How many rows each list shows: the latest are what an admin checks. */
const SHOWN = 10;

/** Which of the platform's agents this tenant's people can use, and which new conversations start with. */
export function AgentSettings() {
	const { t, describe } = useI18n();
	const { confirm, toast } = useFeedback();
	const client = useQueryClient();
	const { path } = useWorkspace();
	const settings = useQuery({ queryKey: ["agent-settings"], queryFn: getAgentSettings });
	const [reason, setReason] = useState("");
	const update = useMutation({
		mutationFn: putAgentSettings,
		onSuccess: (next) => {
			client.setQueryData(["agent-settings"], next);
			setReason("");
			toast(t("Saved. New conversations follow it within a few seconds."));
			setTimeout(() => void client.invalidateQueries({ queryKey: ["agents"] }), APPLIES_MS);
		},
		onError: (error) => toast(describe(error)),
		// A refused change is recorded too, so the history moves either way.
		onSettled: () => void client.invalidateQueries({ queryKey: ["agent-settings", "history"] }),
	});
	if (settings.data === undefined) return null;
	const current: Settings = settings.data;
	const save = (disabled: string[], defaultAgent: string) => update.mutate({ disabled_agents: disabled, default_agent: defaultAgent, reason });
	// An agent reached only through its own app is never picked, so it has no switch and can't be the default.
	const enabled = current.agents.filter((agent) => agent.enabled && agent.picker !== false);
	const label = (name: string) => current.agents.find((agent) => agent.name === name)?.title ?? name;
	return (
		<>
			<div className="card">
				<h2>{t("Agents people can use")}</h2>
				<Setting title={t("Reason")} hint={t("Optional. Kept with the next change, in its history.")}>
					<input aria-label={t("Reason")} value={reason} maxLength={500} disabled={update.isPending} onChange={(event) => setReason(event.target.value)} />
				</Setting>
				{current.agents.map((agent) => (
					<Setting key={agent.name} title={agent.title ?? agent.name} hint={agent.picker === false ? t("{name}, used through its own app", { name: agent.name }) : agent.name}>
						<div className="row-actions">
						<Link className="button ghost small" to={path(`agents/${encodeURIComponent(agent.name)}`)} data-testid={`agent-open-${agent.name}`}>
							{agent.customizable ? t("Customize") : t("Details")}
							<ChevronRight size={13} aria-hidden="true" />
						</Link>
						{agent.picker !== false && <label className="switch">
							<span className="sr-only">{agent.title ?? agent.name}</span>
							<input
								type="checkbox"
								role="switch"
								checked={agent.enabled}
								disabled={update.isPending || (agent.enabled && enabled.length === 1)}
								onChange={async (event) => {
									const on = event.target.checked;
									if (!on && !(await confirm({ title: t("Turn off {name}?", { name: agent.title ?? agent.name }), body: t("People can't start new conversations with it. Their existing ones stay."), action: t("Turn off") })))
										return;
									const disabled = on ? current.disabled_agents.filter((name) => name !== agent.name) : [...current.disabled_agents, agent.name];
									save(disabled, current.default_agent === agent.name && !on ? "" : current.default_agent);
								}}
							/>
							<span aria-hidden="true" />
						</label>}
						</div>
					</Setting>
				))}
				<Setting title={t("New conversations start with")} hint={t("When someone doesn't pick an agent.")}>
					<select aria-label={t("New conversations start with")} value={current.default_agent} disabled={update.isPending} onChange={(event) => save(current.disabled_agents, event.target.value)}>
						<option value="">{current.platform_default === undefined ? t("The platform's choice") : t("The platform's choice ({name})", { name: label(current.platform_default) })}</option>
						{enabled.map((agent) => (
							<option key={agent.name} value={agent.name}>
								{agent.title ?? agent.name}
							</option>
						))}
					</select>
				</Setting>
			</div>
			<PolicySettings />
			<Evidence />
			<SettingHistory />
			<PlatformChanges />
		</>
	);
}

/** Who changed these settings, and why, with refused attempts. */
function SettingHistory() {
	const { t, ago } = useI18n();
	const nameOf = useMemberName();
	const history = useQuery({ queryKey: ["agent-settings", "history"], queryFn: getSettingHistory });
	if (history.data === undefined) return null;
	return (
		<div className="card">
			<h2>{t("Changes to these settings")}</h2>
			{history.data.length === 0 && <p className="quiet">{t("Nothing yet.")}</p>}
			<ul className="rows">
				{history.data.slice(0, SHOWN).map((entry, index) => (
					<li key={`${entry.at}-${index}`} className="row">
						<div className="row-main">
							<span>
								{entry.outcome === "refused" ? <span className="pill warn">{t("Refused")}</span> : entry.disabled_agents.length === 0 ? t("Every agent on") : t("Turned off: {names}", { names: entry.disabled_agents.join(", ") })}
								{entry.outcome === "saved" && entry.default_agent !== undefined && entry.default_agent !== "" && <> · {t("starts with {name}", { name: entry.default_agent })}</>}
								{entry.reason !== "" && <> · {entry.reason}</>}
							</span>
							<span className="quiet">
								{nameOf(entry.actor)} · {ago(Date.parse(entry.at))}
								{entry.problem !== "" && <> · {entry.problem}</>}
							</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Platform changes that moved this tenant's people or changed what they can do there, so its admins aren't surprised by them. */
function PlatformChanges() {
	const { t, ago } = useI18n();
	const nameOf = useMemberName();
	const changes = useQuery({ queryKey: ["agent-settings", "platform"], queryFn: getPlatformChanges });
	if (changes.data === undefined) return null;
	const labels: Record<AgentImpact["changes"][number], string> = {
		access: t("access changed"),
		default: t("platform default changed"),
		placement: t("where conversations go changed"),
		capabilities: t("what conversations can do changed"),
	};
	return (
		<div className="card">
			<h2>{t("Changes by the platform")}</h2>
			{changes.data.length === 0 && <p className="quiet">{t("Nothing yet.")}</p>}
			<ul className="rows">
				{changes.data.slice(0, SHOWN).map((change) => (
					<li key={change.revision} className="row">
						<div className="row-main">
							<span>{change.agents.map((agent) => `${agent.title ?? agent.agent}: ${agent.changes.map((kind) => labels[kind]).join(", ")}`).join("; ")}</span>
							<span className="quiet">
								{nameOf(change.actor)} · {ago(Date.parse(change.at))}
								{change.reason !== "" && <> · {change.reason}</>}
							</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
