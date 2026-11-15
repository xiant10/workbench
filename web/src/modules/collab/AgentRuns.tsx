import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../../lib/i18n.tsx";
import { FIRING_LABELS, recordRuns } from "../automations/api.ts";
import { workItemRef } from "./api.ts";
import { runCause } from "./events.ts";
import { usePeople } from "./usePeople.ts";

/**
 * The agent teammates' runs on a task, oldest first, each with what woke it: a person's change, or the run of the
 * teammate that handed it on. Only a tenant admin, or the person a teammate's notices go to, gets any, so for everyone
 * else, and where t10-automations isn't deployed, it shows nothing.
 */
export function AgentRuns({ item }: { item: string }) {
	const { t, dateTime } = useI18n();
	const { name } = usePeople();
	const runs = useQuery({ queryKey: ["record-runs", item], queryFn: () => recordRuns(workItemRef(item)), retry: false, refetchInterval: 30_000 });
	const list = [...(runs.data ?? [])].reverse();
	if (list.length === 0) return null;
	const byId = new Map(list.map((run) => [run.id, run]));
	return (
		<div className="side-group" data-testid="agent-runs">
			<h2>{t("Agent runs")}</h2>
			<ul className="plain-list">
				{list.map((run) => {
					const cause = run.cause_firing === undefined ? undefined : byId.get(run.cause_firing);
					return (
						<li key={run.id}>
							<span className={run.state === "failed" ? "pill warn" : "pill"}>{t(FIRING_LABELS[run.state])}</span> <strong>{name(run.principal)}</strong> · {dateTime(run.scheduled_for)}
							<div className="quiet">
								{cause !== undefined
									? t("After {name}'s run at {time}", { name: name(cause.principal), time: dateTime(cause.scheduled_for) })
									: run.event?.kind !== undefined && runCause(run.event.kind, name(run.event.actor ?? ""), t)}
								{(run.hops ?? 0) > 0 && <> · {t("Hand-offs between agents before it: {count}", { count: run.hops! })}</>}
								{run.problem !== undefined && run.problem !== "" && <> · {run.problem}</>}
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
