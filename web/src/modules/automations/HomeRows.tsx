import { useQuery } from "@tanstack/react-query";
import { AlarmClockOff } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { type Automation, listAutomations } from "./api.ts";

/** What this automation needs from its owner, or nothing while it's running well or paused on purpose. */
function problem(automation: Automation): string | undefined {
	if (automation.state === "failing") return "{name} stopped after failures";
	if (automation.state === "revoked") return "{name} stopped: your consent ended";
	return automation.state === "active" && automation.failures > 0 ? "{name}'s last run failed" : undefined;
}

/** A successful run is news, so it shows in the conversation it made. Only trouble goes here. */
export function HomeRows() {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const automations = useQuery({ queryKey: ["automations"], queryFn: listAutomations });
	if (automations.isError) {
		return (
			<li className="row" role="alert">
				{t("Couldn't load this. Try again.")}{" "}
				<button type="button" className="link" onClick={() => void automations.refetch()}>
					{t("Retry")}
				</button>
			</li>
		);
	}
	return (
		<>
			{(automations.data ?? []).flatMap((automation) => {
				const label = problem(automation);
				return label === undefined
					? []
					: [
							<li key={automation.id} className="row">
								<span className="row-icon danger">
									<AlarmClockOff size={16} aria-hidden="true" />
								</span>
								<div className="row-main">
									<Link to={path("automations")}>{t(label, { name: automation.name })}</Link>
								</div>
							</li>,
						];
			})}
		</>
	);
}
