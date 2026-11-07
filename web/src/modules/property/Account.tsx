import { useQuery } from "@tanstack/react-query";
import { MapPin, MessageSquarePlus, PhoneCall, Plus, Receipt, Wrench } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { useCommand } from "./Admin.tsx";
import { type Bill, CATEGORIES, CHANNELS, GROUPS, holds, money, type Overview, REASONS, reaches, root, STAGES, STATES, useAccess, usePeople } from "./api.ts";
import { FollowupRow } from "./MyDay.tsx";
import { Residents } from "./Residents.tsx";

type Editor = "contact" | "communication" | "followup" | "payment";

const RESULTS: Record<string, string> = { reached: "Reached", unreached: "Not reached", promise: "Promised to pay" };

/** One household: everything a person may see of it, and what they can do next. Each section is there only if the service sent it. */
export function Account() {
	const { t, dateTime } = useI18n();
	const { id = "" } = useParams();
	const { tenant, path } = useWorkspace();
	const access = useAccess();
	const { name } = usePeople();
	const cmd = useCommand();
	const [editor, setEditor] = useState<Editor>();
	const [selected, setSelected] = useState<string[]>([]);
	const overview = useQuery({
		queryKey: ["property", tenant, "account", id],
		queryFn: () => request<Overview>(`${root}/accounts/${encodeURIComponent(id)}/overview`),
		retry: false,
		gcTime: 0,
	});
	if (overview.isPending) return <div className="property-empty" role="status">{t("Loading…")}</div>;
	if (overview.isError) return <div className="property-empty" role="alert"><h2>{t("This household isn't available")}</h2><p>{t("It may be outside your buildings, or your access may have changed.")}</p></div>;
	const { account, residents, balance, collection, work_orders: orders, communications, followups, today } = overview.data;
	const unpaid = balance?.bills.filter((bill) => !bill.paid) ?? [];
	const chosen = unpaid.filter((bill) => selected.includes(bill.id));
	const total = chosen.reduce((sum, bill) => sum + bill.amount_fen, 0);
	const canSettle = reaches(access.data, "settlement.post");
	const canMark = reaches(access.data, "collection.manual_paid");
	const canPay = canSettle || canMark;
	const openOptions = collection?.channels.filter((channel) => channel.allowed) ?? [];
	const complaint = orders?.find((order) => order.category === "complaint" && ["pending", "processing", "acceptance"].includes(order.state));
	const canWriteComms = reaches(access.data, "communication.write");
	const canReport = holds(access.data, "work_order.create");
	const close = () => setEditor(undefined);
	const toggle = (bill: Bill) => setSelected((current) => (current.includes(bill.id) ? current.filter((other) => other !== bill.id) : [...current, bill.id]));

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const value = (key: string) => String(form.get(key) ?? "");
		let saved = false;
		if (editor === "contact") {
			const decision = value("decision");
			saved = await cmd.save("touches", { account_id: id, channel: value("channel"), decision, ...(decision === "promise" ? { promise_on: value("promise_on") } : {}) }, false);
		} else if (editor === "communication") {
			saved = await cmd.save("communication", { account_id: id, channel: value("channel"), text: value("text") }, false);
		} else if (editor === "followup") {
			saved = await cmd.save("followup", { account_id: id, name: value("name"), due_at: new Date(value("due_at")).toISOString() }, false);
		} else if (editor === "payment") {
			saved = await cmd.save(canSettle ? "settlement" : "manual_paid", { account_id: id, bill_ids: chosen.map((bill) => bill.id), amount_fen: total, method: value("method"), received_on: value("received_on") }, false);
			if (saved) setSelected([]);
		}
		if (saved) close();
	}

	return (
		<>
			<header className="property-header">
				<div>
					<div className="property-eyebrow"><MapPin size={14} aria-hidden="true" /> {account.building}{account.unit !== "" && ` · ${account.unit}`}</div>
					<h1>{account.room_no}</h1>
					<p>{account.account_no}{account.area !== "" && ` · ${Number(account.area).toLocaleString()} m²`}</p>
				</div>
				<div className="property-form-actions">
					{canReport && <Link className="property-button" to={path(`property/work-orders?new=1&account=${encodeURIComponent(id)}`)}><Wrench size={15} aria-hidden="true" /> {t("Report a problem")}</Link>}
					{canWriteComms && <button type="button" onClick={() => setEditor("communication")}><MessageSquarePlus size={15} aria-hidden="true" /> {t("Record a conversation")}</button>}
					{followups !== null && <button type="button" onClick={() => setEditor("followup")}><Plus size={15} aria-hidden="true" /> {t("Add a follow-up")}</button>}
				</div>
			</header>

			{collection !== null && collection.collection !== null && (
				<section className="property-card" aria-label={t("Collections")}>
					<div className="property-section">
						<div>
							<h2><PhoneCall size={16} aria-hidden="true" /> {t("Collections")}</h2>
							<p>
								<span className={`property-status group-${collection.collection.group}`}>{t(GROUPS[collection.collection.group])}</span>{" "}
								<span className="property-status">{t(STAGES[collection.collection.stage])}</span>{" "}
								{t("{amount} overdue for {days} days", { amount: money(collection.collection.amount_fen), days: collection.collection.age_days })}
							</p>
						</div>
						{openOptions.length > 0 && <button type="button" onClick={() => setEditor("contact")}>{t("Report contact")}</button>}
					</div>
					{collection.collection.hold && (
						<p className="property-notice" role="status">
							{t("Contact is on hold while a complaint is open.")}{" "}
							{complaint !== undefined && <Link to={path(`property/work-orders/${encodeURIComponent(complaint.id)}`)}>{t("Go to the complaint")}</Link>}
						</p>
					)}
					<ul className="property-channels">
						{collection.channels.map((channel) => (
							<li key={channel.channel} className={channel.allowed ? "open" : "closed"}>
								<strong>{t(CHANNELS[channel.channel] ?? channel.channel)}</strong>
								<span>{channel.allowed ? t("Available") : t(REASONS[channel.reason ?? ""] ?? "Not available")}</span>
								{channel.next_allowed_at !== undefined && <small>{t("Next from {time}", { time: dateTime(channel.next_allowed_at) })}</small>}
							</li>
						))}
					</ul>
					{collection.touches.length > 0 && (
						<ul className="property-items">
							{collection.touches.map((touch) => (
								<li key={touch.id} className="property-item">
									<span>{t(CHANNELS[touch.channel] ?? touch.channel)} · {t(RESULTS[touch.result] ?? touch.result)} · {name(touch.actor_id)}</span>
									<time className="property-quiet" dateTime={touch.recorded_at}>{dateTime(touch.recorded_at)}</time>
								</li>
							))}
						</ul>
					)}
				</section>
			)}

			{residents !== null && (
				<section className="property-card" aria-label={t("Residents & consent")}>
					<Residents account={id} rows={residents} admin={access.data?.tenant_admin === true} canWrite={access.data?.tenant_admin === true || reaches(access.data, "resident.write")} />
				</section>
			)}

			{followups !== null && followups.some((followup) => followup.state === "active") && (
				<section className="property-card" aria-label={t("Follow-ups")}>
					<div className="property-section"><h2>{t("Follow-ups")}</h2></div>
					<ul className="property-items">{followups.filter((followup) => followup.state === "active").map((followup) => <FollowupRow key={followup.id} followup={followup} />)}</ul>
				</section>
			)}

			{balance !== null && (
				<section className="property-card" aria-label={t("Bills")}>
					<div className="property-section">
						<div>
							<h2><Receipt size={16} aria-hidden="true" /> {t("Bills")}</h2>
							<p>{t("{unpaid} unpaid, {overdue} overdue", { unpaid: money(balance.unpaid_fen), overdue: money(balance.overdue_fen) })}</p>
						</div>
						{canPay && unpaid.length > 0 && <button type="button" disabled={chosen.length === 0} onClick={() => setEditor("payment")}>{chosen.length === 0 ? t("Choose bills to record a payment") : t("Record payment of {amount}", { amount: money(total) })}</button>}
					</div>
					<ul className="property-items">
						{balance.bills.map((bill) => (
							<li key={bill.id} className="property-item">
								<label className="property-bill">
									{canPay && !bill.paid && <input type="checkbox" checked={selected.includes(bill.id)} aria-label={t("Include {charge}", { charge: bill.charge })} onChange={() => toggle(bill)} />}
									<span>
										<strong>{bill.charge}</strong>
										<small>{bill.period_start} – {bill.period_end} · {t("Due {date}", { date: bill.due_on })}{bill.source === "opening" && ` · ${t("Opening balance")}`}</small>
									</span>
								</label>
								<div className="property-amount">
									<strong>{money(bill.amount_fen)}</strong>
									<small>{bill.paid ? (bill.amount_fen === 0 ? t("Waived") : t("Paid")) : t("Unpaid")}{bill.waiver_fen > 0 && ` · ${t("contains waiver")}`}</small>
								</div>
							</li>
						))}
						{balance.bills.length === 0 && <li className="property-item"><span>{t("No bills yet.")}</span></li>}
					</ul>
				</section>
			)}

			{orders !== null && orders.length > 0 && (
				<section className="property-card" aria-label={t("Work orders")}>
					<div className="property-section"><h2><Wrench size={16} aria-hidden="true" /> {t("Work orders")}</h2></div>
					<ul className="property-items">
						{orders.map((order) => (
							<li key={order.id} className="property-item">
								<div>
									<Link to={path(`property/work-orders/${encodeURIComponent(order.id)}`)}><strong>{order.title}</strong></Link>
									<p>{t(CATEGORIES[order.category])} · {t(STATES[order.state])}</p>
								</div>
								<time className="property-quiet" dateTime={order.created_at}>{dateTime(order.created_at)}</time>
							</li>
						))}
					</ul>
				</section>
			)}

			{communications !== null && communications.length > 0 && (
				<section className="property-card" aria-label={t("Conversations")}>
					<div className="property-section"><h2>{t("Conversations")}</h2></div>
					<ul className="property-items">
						{communications.map((item) => (
							<li key={item.id} className="property-item">
								<div>
									<strong>{t(CHANNELS[item.channel] ?? item.channel)} · {name(item.author_id)}</strong>
									<p className="property-pre">{item.text}</p>
								</div>
								<time className="property-quiet" dateTime={item.created_at}>{dateTime(item.created_at)}</time>
							</li>
						))}
					</ul>
				</section>
			)}

			{editor !== undefined && (
				<Dialog label={t(editor === "contact" ? "Report contact" : editor === "communication" ? "Record a conversation" : editor === "followup" ? "Add a follow-up" : "Record payment")} onClose={cmd.busy ? undefined : close}>
					<form className="property-editor" onSubmit={(event) => void submit(event)}>
						<h2>{t(editor === "contact" ? "Report contact" : editor === "communication" ? "Record a conversation" : editor === "followup" ? "Add a follow-up" : "Record payment")}</h2>
						{editor === "contact" && <ContactFields channels={openOptions.map((option) => option.channel)} today={today} />}
						{editor === "communication" && (
							<>
								<label>{t("Channel")}
									<select name="channel" aria-label={t("Channel")}>
										{["phone", "visit", "wechat"].map((channel) => <option key={channel} value={channel}>{t(CHANNELS[channel] ?? channel)}</option>)}
									</select>
								</label>
								<label>{t("What was said")}<textarea name="text" required maxLength={20000} rows={5} /></label>
							</>
						)}
						{editor === "followup" && (
							<>
								<label>{t("What needs doing")}<input name="name" required maxLength={160} /></label>
								<label>{t("Due")}<input name="due_at" type="datetime-local" required /></label>
							</>
						)}
						{editor === "payment" && (
							<>
								<p>{t(canSettle ? "Record {amount} received outside this system, against {count} bills. It takes effect immediately." : "Mark {amount} as received outside this system, against {count} bills. It takes effect immediately, and finance can reverse it within 24 hours.", { amount: money(total), count: chosen.length })}</p>
								<label>{t("Received date")}<input name="received_on" type="date" required max={today} defaultValue={today} /></label>
								<label>{t("Payment method")}
									<select name="method" aria-label={t("Payment method")}>
										<option value="transfer">{t("Bank transfer")}</option>
										<option value="cash">{t("Cash")}</option>
										<option value="pos">{t("POS")}</option>
										<option value="other">{t("Other")}</option>
									</select>
								</label>
							</>
						)}
						{cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
						<div className="property-form-actions">
							<button type="button" disabled={cmd.busy} onClick={close}>{t("Cancel")}</button>
							<button type="submit" disabled={cmd.busy}>{cmd.busy ? t("Saving…") : t("Confirm")}</button>
						</div>
					</form>
				</Dialog>
			)}
		</>
	);
}

function ContactFields({ channels, today }: { channels: string[]; today: string }) {
	const { t } = useI18n();
	const [decision, setDecision] = useState("reached");
	return (
		<>
			<label>{t("Channel")}
				<select name="channel" aria-label={t("Channel")}>
					{channels.map((channel) => <option key={channel} value={channel}>{t(CHANNELS[channel] ?? channel)}</option>)}
				</select>
			</label>
			<label>{t("Result")}
				<select name="decision" aria-label={t("Result")} value={decision} onChange={(event) => setDecision(event.target.value)}>
					{Object.entries(RESULTS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
				</select>
			</label>
			{decision === "promise" && <label>{t("Promised date")}<input name="promise_on" type="date" required min={today} defaultValue={today} /></label>}
		</>
	);
}
