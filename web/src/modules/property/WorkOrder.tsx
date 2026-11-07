import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { useCommand } from "./Admin.tsx";
import { CATEGORIES, root, STATES, usePeople, type WorkOrderDetail } from "./api.ts";
import { AssigneeSelect } from "./WorkOrders.tsx";

const ACTIONS: Record<string, string> = {
	accept: "Accept the work",
	submit: "Submit the result",
	approve: "Accept as complete",
	reject: "Send back",
	withdraw: "Withdraw",
	transfer: "Transfer",
	supervise: "Supervise",
};

/** One work order. Its buttons are what the service says this person may do now. */
export function WorkOrderPage() {
	const { t, dateTime } = useI18n();
	const { id = "" } = useParams();
	const { tenant, path } = useWorkspace();
	const client = useQueryClient();
	const { name } = usePeople();
	const cmd = useCommand();
	const [action, setAction] = useState<string>();
	const [photos, setPhotos] = useState<string[]>([]);
	const [uploadError, setUploadError] = useState("");
	const [uploading, setUploading] = useState(false);
	const detail = useQuery({
		queryKey: ["property", tenant, "work-order", id],
		queryFn: () => request<WorkOrderDetail>(`${root}/work-orders/${encodeURIComponent(id)}`),
		retry: false,
		gcTime: 0,
	});
	if (detail.isPending) return <div className="property-empty" role="status">{t("Loading…")}</div>;
	if (detail.isError) return <div className="property-empty" role="alert"><h2>{t("This work order isn't available")}</h2><p>{t("It may be outside your work, or your access may have changed.")}</p></div>;
	const { work_order: order, history, actions } = detail.data;
	const base = { id: order.id, account_id: order.account_id, revision: order.revision };

	async function upload(event: ChangeEvent<HTMLInputElement>) {
		const files = [...(event.target.files ?? [])];
		event.target.value = "";
		setUploading(true);
		setUploadError("");
		try {
			for (const file of files) {
				const form = new FormData();
				form.set("image", file);
				const created = await request<{ id: string }>(`${root}/work-orders/${encodeURIComponent(order.id)}/attachments`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: form });
				setPhotos((current) => [...current, created.id]);
			}
			await client.invalidateQueries({ queryKey: ["property", tenant, "work-order", id] });
		} catch (error) {
			setUploadError(error instanceof ApiError && error.status === 413 ? "That photo is larger than 10 MB." : "That photo couldn't be added. Use a PNG or JPEG.");
		} finally {
			setUploading(false);
		}
	}

	async function run(decision: string, extra: Record<string, unknown> = {}) {
		if (await cmd.save("work_transition", { ...base, decision, ...extra }, false)) {
			setAction(undefined);
			setPhotos([]);
		}
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (action === undefined) return;
		const form = new FormData(event.currentTarget);
		const value = (key: string) => String(form.get(key) ?? "");
		if (action === "submit") void run(action, { text: value("text"), attachment_ids: photos });
		else if (action === "approve") void run(action, { confirmation: value("confirmation"), ...(value("rating") === "" ? {} : { rating: Number(value("rating")) }) });
		else if (action === "reject" || action === "withdraw") void run(action, { reason: value("reason") });
		else if (action === "transfer") void run(action, { assignee_id: value("assignee_id") });
	}

	return (
		<>
			<header className="property-header">
				<div>
					<div className="property-eyebrow"><Link to={path(`property/accounts/${encodeURIComponent(order.account_id)}`)}>{order.room_no}</Link> · {order.building}</div>
					<h1>{order.title}</h1>
					<p>
						<span className={`property-status order-${order.state}`}>{t(STATES[order.state])}</span>{" "}
						<span className="property-status">{t(CATEGORIES[order.category])}</span>
						{order.priority === "urgent" && <> <span className="property-status urgent">{t("Urgent")}</span></>}
						{order.supervised && <> <span className="property-status urgent">{t("Supervised")}</span></>}
					</p>
				</div>
				<div className="property-form-actions">
					{actions.map((decision) => (
						<button key={decision} type="button" disabled={cmd.busy} onClick={() => (decision === "accept" || decision === "supervise" ? void run(decision) : setAction(decision))}>{t(ACTIONS[decision] ?? decision)}</button>
					))}
				</div>
			</header>
			{action === undefined && cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
			<section className="property-card">
				<dl className="property-facts">
					<div><dt>{t("Handler")}</dt><dd>{name(order.assignee_id)}</dd></div>
					<div><dt>{t("Reported by")}</dt><dd>{name(order.reporter_id)}</dd></div>
					<div><dt>{t("Due")}</dt><dd>{dateTime(order.deadline)}</dd></div>
				</dl>
				{order.description !== "" && <p className="property-body property-pre">{order.description}</p>}
			</section>
			{history.attachment_ids.length > 0 && (
				<section className="property-card" aria-label={t("Photos")}>
					<div className="property-section"><h2>{t("Photos")}</h2></div>
					<ul className="property-photos">
						{history.attachment_ids.map((attachment) => (
							<li key={attachment}><a href={`${root}/attachments/${encodeURIComponent(attachment)}`} target="_blank" rel="noopener noreferrer"><img src={`${root}/attachments/${encodeURIComponent(attachment)}`} alt={t("Work order photo")} /></a></li>
						))}
					</ul>
				</section>
			)}
			<section className="property-card" aria-label={t("History")}>
				<div className="property-section"><h2>{t("History")}</h2></div>
				<ul className="property-items">
					{history.transitions.map((step) => (
						<li key={`${step.at}-${step.action}`} className="property-item">
							<div>
								<strong>{t(ACTIONS[step.action] ?? step.action)}</strong>
								<p className="property-quiet">{name(step.actor_id)}{step.reason !== "" && ` · ${step.reason}`}</p>
							</div>
							<time className="property-quiet" dateTime={step.at}>{dateTime(step.at)}</time>
						</li>
					))}
				</ul>
			</section>
			{action !== undefined && (
				<Dialog label={t(ACTIONS[action] ?? action)} onClose={cmd.busy ? undefined : () => setAction(undefined)}>
					<form className="property-editor" onSubmit={submit}>
						<h2>{t(ACTIONS[action] ?? action)}</h2>
						{action === "submit" && (
							<>
								<label>{t("What was done")}<textarea name="text" required maxLength={20000} rows={4} /></label>
								<label>{t("Photos")}<input type="file" accept="image/png,image/jpeg" capture="environment" multiple disabled={uploading} onChange={(event) => void upload(event)} /></label>
								<p role="status">{uploading ? t("Adding photos…") : t("Photos added: {count}", { count: photos.length })}</p>
								{uploadError !== "" && <p role="alert" className="property-form-error">{t(uploadError)}</p>}
							</>
						)}
						{action === "approve" && (
							<>
								<label>{t("Confirmed by")}
									<select name="confirmation" aria-label={t("Confirmed by")}>
										<option value="phone">{t("Phone")}</option>
										<option value="visit">{t("Visit")}</option>
									</select>
								</label>
								<label>{t("Satisfaction, if given")}
									<select name="rating" aria-label={t("Satisfaction, if given")} defaultValue="">
										<option value="">{t("Not rated")}</option>
										{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
									</select>
								</label>
							</>
						)}
						{(action === "reject" || action === "withdraw") && <label>{t("Reason")}<textarea name="reason" required maxLength={1000} /></label>}
						{action === "transfer" && <AssigneeSelect account={order.account_id} label={t("New handler")} />}
						{cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
						<div className="property-form-actions">
							<button type="button" disabled={cmd.busy} onClick={() => setAction(undefined)}>{t("Cancel")}</button>
							<button type="submit" disabled={cmd.busy || uploading || (action === "submit" && photos.length === 0)}>{cmd.busy ? t("Saving…") : t("Confirm")}</button>
						</div>
					</form>
				</Dialog>
			)}
		</>
	);
}
