import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "../../lib/i18n.tsx";
import { Empty, Skeleton } from "../../lib/ui.tsx";
import { listApprovals } from "./api.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";

/** Tool calls an agent was held from, by a policy that wants a person to say yes. Approving lets that exact call run once. */
export function ApprovalsPage() {
	const { t } = useI18n();
	const approvals = useQuery({ queryKey: ["approvals"], queryFn: listApprovals, refetchInterval: 15_000 });
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
					<ApprovalCard key={item.id} approval={item} />
				))}
			</ul>
		</div>
	);
}
