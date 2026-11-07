import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Bell, CheckCheck, ClipboardList, Receipt, Wrench } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, Empty } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import type { WorkbenchModule } from "../types.ts";
import { useNotifications } from "../useNotifications.ts";
import { useCommand } from "./Admin.tsx";
import { type Attention, eventLabel, type Followup, type Publication, recordPath, root, STATES, type WorkOrder } from "./api.ts";

const events = { id: "property", eventLabel } as WorkbenchModule;

/** A source-made follow-up's title is fixed English in the service, so its meaning comes from its source. */
export function followupTitle(followup: Followup): string {
	if (followup.source_kind === "promise") return "Payment promise";
	if (followup.source_kind === "dispute") return "Resolve account complaint";
	if (followup.source_kind === "acceptance") return "Accept completed work";
	if (followup.source_kind === "work_order_overdue") return "Overdue work order";
	return followup.title;
}

const BUCKETS: Record<Followup["bucket"], string> = { overdue: "Overdue", today: "Due today", upcoming: "Upcoming", closed: "Closed" };

export function FollowupRow({ followup }: { followup: Followup }) {
	const { t, dateTime } = useI18n();
	const { path } = useWorkspace();
	const cmd = useCommand();
	const [cancelling, setCancelling] = useState(false);
	const [reason, setReason] = useState("");
	const command = { id: followup.id, account_id: followup.account_id, revision: followup.revision };
	const title = followupTitle(followup);
	const source = followup.source_kind !== "manual" && followup.source_kind !== "promise";
	return (
		<li className="property-item">
			<div>
				<strong>{source || followup.source_kind === "promise" ? t(title) : title}</strong>
				<p>
					<Link to={path(`property/accounts/${encodeURIComponent(followup.account_id)}`)}>{followup.room_no}</Link>
					{" · "}
					<span className={`property-due ${followup.bucket}`}>{t(BUCKETS[followup.bucket])}</span>
					{" · "}
					{dateTime(followup.due_at)}
				</p>
				{cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
			</div>
			{followup.state === "active" && (
				<div className="property-form-actions">
					<button type="button" disabled={cmd.busy} onClick={() => void cmd.save("followup", { ...command, decision: "completed" }, false)}>{t("Done")}</button>
					<button type="button" disabled={cmd.busy} onClick={() => setCancelling(true)}>{t("Cancel task")}</button>
				</div>
			)}
			{cancelling && (
				<Dialog label={t("Cancel task")} onClose={cmd.busy ? undefined : () => setCancelling(false)}>
					<form
						className="property-editor"
						onSubmit={(event) => {
							event.preventDefault();
							void cmd.save("followup", { ...command, decision: "cancelled", reason }, false).then((saved) => saved && setCancelling(false));
						}}
					>
						<h2>{t("Cancel task")}</h2>
						<label>{t("Reason")}<textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
						{cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
						<div className="property-form-actions">
							<button type="button" disabled={cmd.busy} onClick={() => setCancelling(false)}>{t("Keep it")}</button>
							<button type="submit" disabled={cmd.busy}>{t("Cancel task")}</button>
						</div>
					</form>
				</Dialog>
			)}
		</li>
	);
}

export function MyDay() {
	const { t, day, dateTime } = useI18n();
	const { tenant, path } = useWorkspace();
	const key = ["property", tenant];
	const attention = useQuery({ queryKey: [...key, "attention"], queryFn: () => request<Attention>(`${root}/attention`), retry: false });
	const followups = useQuery({ queryKey: [...key, "followups"], queryFn: () => request<{ followups: Followup[] }>(`${root}/followups`), retry: false });
	const orders = useQuery({ queryKey: [...key, "my-orders"], queryFn: () => request<{ work_orders: WorkOrder[] }>(`${root}/work-orders?mine=1&state=open`), retry: false });
	const tasks = useQuery({ queryKey: [...key, "tasks"], queryFn: () => request<{ assigned_tasks: Publication[] }>(`${root}/assigned-tasks`), retry: false });
	const { items: notifications, open } = useNotifications(events);
	const active = followups.data?.followups.filter((followup) => followup.state === "active") ?? [];
	const openTasks = tasks.data?.assigned_tasks.filter((task) => task.recipient_revision !== null && task.completed_at === null) ?? [];
	const counts = attention.data;
	const nothing = attention.isSuccess && notifications.length === 0 && active.length === 0 && (orders.data?.work_orders.length ?? 0) === 0 && openTasks.length === 0
		&& counts?.notices_unread === 0 && counts.adjustments_to_approve === 0 && counts.adjustments_to_execute === 0;
	return (
		<>
			<header className="property-header">
				<div>
					<h1>{t("My day")}</h1>
					<p>{t("What needs you in property work, most urgent first.")}</p>
				</div>
			</header>
			{attention.isError && <div className="property-empty" role="alert"><p>{t("Couldn't load this. Try again.")}</p></div>}
			{nothing && <Empty icon={CheckCheck} title={t("Nothing needs you right now")} />}
			{notifications.length > 0 && (
				<section className="property-card" aria-label={t("Updates")}>
					<div className="property-section"><h2><Bell size={16} aria-hidden="true" /> {t("Updates")}</h2></div>
					<ul className="property-items">
						{notifications.map((notification) => (
							<li key={notification.id} className="property-item">
								<Link to={path(recordPath(notification.target ?? ""))} onClick={() => open(notification.target ?? "")}>{t(eventLabel(notification.event.kind))}</Link>
							</li>
						))}
					</ul>
				</section>
			)}
			{active.length > 0 && (
				<section className="property-card" aria-label={t("Follow-ups")}>
					<div className="property-section"><h2><AlarmClock size={16} aria-hidden="true" /> {t("Follow-ups")}</h2></div>
					<ul className="property-items">{active.map((followup) => <FollowupRow key={followup.id} followup={followup} />)}</ul>
				</section>
			)}
			{(orders.data?.work_orders.length ?? 0) > 0 && (
				<section className="property-card" aria-label={t("My work orders")}>
					<div className="property-section"><h2><Wrench size={16} aria-hidden="true" /> {t("My work orders")}</h2></div>
					<ul className="property-items">
						{orders.data?.work_orders.map((order) => (
							<li key={order.id} className="property-item">
								<div>
									<Link to={path(`property/work-orders/${encodeURIComponent(order.id)}`)}><strong>{order.title}</strong></Link>
									<p>{order.room_no} · {t(STATES[order.state])} · {dateTime(order.deadline)}</p>
								</div>
							</li>
						))}
					</ul>
				</section>
			)}
			{openTasks.length > 0 && (
				<section className="property-card" aria-label={t("Tasks from your manager")}>
					<div className="property-section"><h2><ClipboardList size={16} aria-hidden="true" /> {t("Tasks from your manager")}</h2></div>
					<ul className="property-items">
						{openTasks.map((task) => (
							<li key={task.id} className="property-item">
								<div>
									<Link to={path("property/messages")}><strong>{task.title}</strong></Link>
									{task.due_at !== null && <p>{day(task.due_at)}</p>}
								</div>
							</li>
						))}
					</ul>
				</section>
			)}
			{counts !== undefined && (counts.notices_unread > 0 || counts.adjustments_to_approve > 0 || counts.adjustments_to_execute > 0) && (
				<section className="property-card" aria-label={t("Waiting on you")}>
					<div className="property-section"><h2><Receipt size={16} aria-hidden="true" /> {t("Waiting on you")}</h2></div>
					<ul className="property-items">
						{counts.notices_unread > 0 && <li className="property-item"><Link to={path("property/messages")}>{t("Unread notices: {count}", { count: counts.notices_unread })}</Link></li>}
						{counts.adjustments_to_approve > 0 && <li className="property-item"><Link to={path("property/bills")}>{t("Adjustments to approve: {count}", { count: counts.adjustments_to_approve })}</Link></li>}
						{counts.adjustments_to_execute > 0 && <li className="property-item"><Link to={path("property/bills")}>{t("Adjustments to execute: {count}", { count: counts.adjustments_to_execute })}</Link></li>}
					</ul>
				</section>
			)}
		</>
	);
}
