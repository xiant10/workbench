import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "../../lib/i18n.tsx";
import { Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { decideApproval, listApprovals } from "./api.ts";

/** Tool calls an agent was held from, by a policy that wants a person to say yes. Approving lets that exact call run once. */
export function ApprovalsPage() {
	const { t, ago, describe } = useI18n();
	const { toast } = useFeedback();
	const client = useQueryClient();
	const approvals = useQuery({ queryKey: ["approvals"], queryFn: listApprovals, refetchInterval: 15_000 });
	const decide = useMutation({
		mutationFn: ({ id, grant }: { id: string; grant: boolean }) => decideApproval(id, grant),
		onSuccess: (_, { grant }) => {
			toast(grant ? t("Approved. The run is told to make the call again, and it can, once.") : t("Refused. The run is told not to make the call."));
			void client.invalidateQueries({ queryKey: ["approvals"] });
		},
		onError: (error) => toast(describe(error)),
	});
	return (
		<div className="page">
			<header className="page-head">
				<h1>{t("Approvals")}</h1>
			</header>
			<p className="quiet">{t("An agent's run waits for these, by your organization's policy. Approving one lets that exact call run once, with the same values. Anything different needs a new approval.")}</p>
			{approvals.isPending && <Skeleton />}
			{approvals.data?.length === 0 && <Empty icon={ShieldCheck} title={t("Nothing is waiting for you.")} />}
			<ul className="rows">
				{(approvals.data ?? []).map((item) => (
					<li key={item.id} className="row">
						<div className="row-main">
							<span>
								<span className="mono">
									{item.server}/{item.tool}
								</span>{" "}
								{Object.entries(item.summary).map(([name, value]) => (
									<span key={name} className="pill">
										{name}: {String(value)}
									</span>
								))}
							</span>
							<span className="quiet">
								{t("For {person}'s run of {agent}", { person: item.principal, agent: item.agent })}
								{item.automation !== undefined && item.automation !== "" && <> · {item.automation}</>} · {t("rule {rule}", { rule: item.rule })} · {ago(Date.parse(item.created_at))}
							</span>
						</div>
						<div className="row-actions">
							<button type="button" className="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: item.id, grant: false })}>
								{t("Refuse")}
							</button>
							<button type="button" className="primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: item.id, grant: true })}>
								{t("Approve")}
							</button>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
