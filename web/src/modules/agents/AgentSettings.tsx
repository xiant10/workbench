import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../lib/i18n.tsx";
import { Setting, useFeedback } from "../../lib/ui.tsx";
import { type AgentSettings as Settings, getAgentSettings, putAgentSettings } from "./api.ts";

/** Routers poll every 10 seconds, so a change reaches new conversations within one poll. */
const APPLIES_MS = 11_000;

/** Which of the platform's agents this tenant's people can use, and which new conversations start with. */
export function AgentSettings() {
	const { t, describe } = useI18n();
	const { confirm, toast } = useFeedback();
	const client = useQueryClient();
	const settings = useQuery({ queryKey: ["agent-settings"], queryFn: getAgentSettings });
	const update = useMutation({
		mutationFn: putAgentSettings,
		onSuccess: (next) => {
			client.setQueryData(["agent-settings"], next);
			toast(t("Saved. New conversations follow it within a few seconds."));
			setTimeout(() => void client.invalidateQueries({ queryKey: ["agents"] }), APPLIES_MS);
		},
		onError: (error) => toast(describe(error)),
	});
	if (settings.data === undefined) return null;
	const current: Settings = settings.data;
	const save = (disabled: string[], defaultAgent: string) => update.mutate({ disabled_agents: disabled, default_agent: defaultAgent });
	const enabled = current.agents.filter((agent) => agent.enabled);
	const label = (name: string) => current.agents.find((agent) => agent.name === name)?.title ?? name;
	return (
		<div className="card">
			<h2>{t("Agents people can use")}</h2>
			{current.agents.map((agent) => (
				<Setting key={agent.name} title={agent.title ?? agent.name} hint={agent.name}>
					<label className="switch">
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
					</label>
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
	);
}
