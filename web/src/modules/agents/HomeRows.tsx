import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { usePeople } from "../collab/usePeople.ts";
import { listApprovals } from "./api.ts";
import { approvalItem } from "./ApprovalCard.tsx";

/** Runs held until this person decides. One about a task opens the task, which shows it; any other opens Approvals. */
export function HomeRows() {
	const { t, ago } = useI18n();
	const { me, path } = useWorkspace();
	const { name } = usePeople();
	const approvals = useQuery({ queryKey: ["approvals"], queryFn: listApprovals, refetchInterval: 15_000 });
	if (approvals.isError) {
		return (
			<li className="row" role="alert">
				{t("Couldn't load this. Try again.")}{" "}
				<button type="button" className="link" onClick={() => void approvals.refetch()}>
					{t("Retry")}
				</button>
			</li>
		);
	}
	return (
		<>
			{(approvals.data ?? []).map((item) => (
				<li key={item.id} className="row">
					<span className="row-icon warn">
						<ShieldCheck size={16} aria-hidden="true" />
					</span>
					<div className="row-main">
						<Link to={path(approvalItem(item) === undefined ? "approvals" : `tasks/${approvalItem(item)}`)}>{t("Approve or refuse {tool}", { tool: `${item.server}/${item.tool}` })}</Link>
						<span className="quiet">
							{item.principal === me.user_id ? t("For your assistant") : t("For {person}'s run of {agent}", { person: name(item.principal), agent: item.agent })} · {ago(Date.parse(item.created_at))}
						</span>
					</div>
				</li>
			))}
		</>
	);
}
