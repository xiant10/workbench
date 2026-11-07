import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Wrench } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, Empty } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { useCommand } from "./Admin.tsx";
import { CATEGORIES, holds, root, STATES, useAccess, usePeople, type WorkOrder } from "./api.ts";
import { Pager } from "./Layout.tsx";

/** Choosing who handles an order: only people the service says can take it. */
export function AssigneeSelect({ account, label }: { account: string; label: string }) {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const { name } = usePeople();
	const assignees = useQuery({
		queryKey: ["property", tenant, "assignees", account],
		queryFn: () => request<{ assignees: string[] }>(`${root}/assignees?${new URLSearchParams({ account })}`),
		retry: false,
		enabled: account !== "",
	});
	return (
		<label>{label}
			<select name="assignee_id" aria-label={label} required disabled={assignees.isPending}>
				<option value="">{t("Choose a handler")}</option>
				{assignees.data?.assignees.map((id) => <option key={id} value={id}>{name(id)}</option>)}
			</select>
		</label>
	);
}

function NewOrder({ account, onClose }: { account: string; onClose(): void }) {
	const { t } = useI18n();
	const { tenant, path } = useWorkspace();
	const navigate = useNavigate();
	const cmd = useCommand();
	const [search, setSearch] = useState("");
	const [chosen, setChosen] = useState(account);
	const [category, setCategory] = useState("repair");
	const rooms = useQuery({
		queryKey: ["property", tenant, "room-search", search],
		queryFn: () => request<{ rooms: { id: string; room_no: string; building: string; account_id: string }[] }>(`${root}/registry?${new URLSearchParams({ q: search })}`),
		retry: false,
		enabled: account === "",
	});
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const body = { account_id: chosen, name: String(form.get("name") ?? ""), text: String(form.get("text") ?? ""), category, priority: String(form.get("priority") ?? "normal"), assignee_id: String(form.get("assignee_id") ?? "") };
		const created = await cmd.saveFor<{ id: string }>("work_order", body);
		if (created !== undefined) navigate(path(`property/work-orders/${encodeURIComponent(created.id)}`));
	}
	return (
		<Dialog label={t("Report a problem")} onClose={cmd.busy ? undefined : onClose}>
			<form className="property-editor" onSubmit={(event) => void submit(event)}>
				<h2>{t("Report a problem")}</h2>
				{account === "" && (
					<>
						<label>{t("Find the room")}<input value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} /></label>
						<label>{t("Room")}
							<select aria-label={t("Room")} required value={chosen} onChange={(event) => setChosen(event.target.value)}>
								<option value="">{t("Choose a room")}</option>
								{rooms.data?.rooms.filter((room) => room.account_id !== "").map((room) => <option key={room.id} value={room.account_id}>{room.room_no} · {room.building}</option>)}
							</select>
						</label>
					</>
				)}
				<label>{t("Category")}
					<select aria-label={t("Category")} value={category} onChange={(event) => setCategory(event.target.value)}>
						{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
					</select>
				</label>
				<label>{t("Title")}<input name="name" required maxLength={160} /></label>
				<label>{t("Description")}<textarea name="text" maxLength={20000} rows={4} /></label>
				<label>{t("Priority")}
					<select name="priority" aria-label={t("Priority")} defaultValue="normal">
						<option value="normal">{t("Normal")}</option>
						<option value="urgent">{t("Urgent")}</option>
					</select>
				</label>
				{category === "alarm" ? <p>{t("Alarms go to the project manager.")}</p> : <AssigneeSelect account={chosen} label={t("Handler")} />}
				{cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
				<div className="property-form-actions">
					<button type="button" disabled={cmd.busy} onClick={onClose}>{t("Cancel")}</button>
					<button type="submit" disabled={cmd.busy || chosen === ""}>{cmd.busy ? t("Saving…") : t("Report")}</button>
				</div>
			</form>
		</Dialog>
	);
}

/** Work orders the person's roles reach. A manager sees the whole project here, and transfers from an order's page. */
export function WorkOrders() {
	const { t, dateTime } = useI18n();
	const { tenant, path } = useWorkspace();
	const access = useAccess();
	const { name } = usePeople();
	const [params, setParams] = useSearchParams();
	const [state, setState] = useState("open");
	const [category, setCategory] = useState("");
	const [mine, setMine] = useState(params.get("mine") === "1");
	const [search, setSearch] = useState("");
	const [q, setQ] = useState("");
	const [cursor, setCursor] = useState("");
	const [history, setHistory] = useState<string[]>([]);
	const creating = params.get("new") === "1";
	const reset = () => {
		setCursor("");
		setHistory([]);
	};
	const list = useQuery({
		queryKey: ["property", tenant, "work-orders", state, category, mine, q, cursor],
		queryFn: () => request<{ work_orders: WorkOrder[]; next_cursor: string }>(`${root}/work-orders?${new URLSearchParams({ state: state === "all" ? "" : state, category, mine: mine ? "1" : "", q, cursor })}`),
		retry: false,
	});
	return (
		<>
			<header className="property-header">
				<div>
					<h1>{t("Work orders")}</h1>
					<p>{t("Repairs, complaints and alarms, from report to accepted.")}</p>
				</div>
				{holds(access.data, "work_order.create") && <button type="button" onClick={() => setParams({ new: "1" })}><Plus size={15} aria-hidden="true" /> {t("Report a problem")}</button>}
			</header>
			<section className="property-card">
				<form
					className="property-filters property-filters-top"
					onSubmit={(event) => {
						event.preventDefault();
						setQ(search.trim());
						reset();
					}}
				>
					<label className="property-search">
						<Search size={16} aria-hidden="true" />
						<input aria-label={t("Search title or room")} placeholder={t("Search title or room")} value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} />
					</label>
					<select aria-label={t("State")} value={state} onChange={(event) => { setState(event.target.value); reset(); }}>
						<option value="open">{t("Open")}</option>
						<option value="all">{t("All states")}</option>
						{Object.entries(STATES).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
					</select>
					<select aria-label={t("Category")} value={category} onChange={(event) => { setCategory(event.target.value); reset(); }}>
						<option value="">{t("All categories")}</option>
						{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
					</select>
					<label className="property-check"><input type="checkbox" checked={mine} onChange={(event) => { setMine(event.target.checked); reset(); }} /> {t("Mine only")}</label>
					<button type="submit">{t("Search")}</button>
				</form>
				{list.isPending && <div className="property-empty" role="status">{t("Loading…")}</div>}
				{list.isError && <div className="property-empty" role="alert">{t("Couldn't load this. Try again.")}</div>}
				{list.data?.work_orders.length === 0 && <Empty icon={Wrench} title={t("No work orders match")} />}
				<ul className="property-items">
					{list.data?.work_orders.map((order) => (
						<li key={order.id} className="property-item">
							<div>
								<Link to={path(`property/work-orders/${encodeURIComponent(order.id)}`)}><strong>{order.title}</strong></Link>
								<p>
									<span className={`property-status order-${order.state}`}>{t(STATES[order.state])}</span>{" "}
									<span className="property-status">{t(CATEGORIES[order.category])}</span>
									{order.priority === "urgent" && <> <span className="property-status urgent">{t("Urgent")}</span></>}
									{order.supervised && <> <span className="property-status urgent">{t("Supervised")}</span></>}
								</p>
								<p className="property-quiet">{order.room_no} · {order.building} · {name(order.assignee_id)}</p>
							</div>
							<time className="property-quiet" dateTime={order.deadline}>{t("Due {time}", { time: dateTime(order.deadline) })}</time>
						</li>
					))}
				</ul>
				<Pager next={list.data?.next_cursor ?? ""} cursor={cursor} history={history} busy={list.isFetching} onChange={(next, past) => { setCursor(next); setHistory(past); }} />
			</section>
			{creating && <NewOrder account={params.get("account") ?? ""} onClose={() => setParams({})} />}
		</>
	);
}
