import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ClipboardList, Receipt, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { type Attention, root } from "./api.ts";

/** Home's "Needs you", from the counts every client reads, so nobody with work is told they're caught up. */
export function HomeRows() {
	const { t } = useI18n();
	const { tenant, path } = useWorkspace();
	// No failure row: someone with no property role is refused, and Home isn't the place to say so.
	const attention = useQuery({ queryKey: ["property", tenant, "attention"], queryFn: () => request<Attention>(`${root}/attention`), retry: false });
	const counts = attention.data;
	if (counts === undefined) return null;
	const followups = counts.followups_overdue + counts.followups_today;
	const adjustments = counts.adjustments_to_approve + counts.adjustments_to_execute;
	const row = (key: string, Icon: typeof Wrench, tone: string, to: string, label: string) => (
		<li key={key} className="row">
			<span className={`row-icon ${tone}`}><Icon size={16} aria-hidden="true" /></span>
			<div className="row-main"><Link to={path(to)}>{label}</Link></div>
		</li>
	);
	return (
		<>
			{followups > 0 && row("followups", AlarmClock, counts.followups_overdue > 0 ? "danger" : "warn", "property", t("Property follow-ups due: {count}", { count: followups }))}
			{counts.work_orders > 0 && row("orders", Wrench, "accent", "property/work-orders?mine=1", t("Property work orders to handle: {count}", { count: counts.work_orders }))}
			{counts.tasks_open + counts.notices_unread > 0 && row("messages", ClipboardList, "accent", "property/messages", t("Property notices and tasks: {count}", { count: counts.tasks_open + counts.notices_unread }))}
			{adjustments > 0 && row("adjustments", Receipt, "warn", "property/bills", t("Property adjustments waiting: {count}", { count: adjustments }))}
		</>
	);
}
