import { navigateOptions } from "../../lib/layout.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckSquare, ChevronRight, Circle, CircleDot, CircleOff, Eye, Flag, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { createItem, dueDay, getSettings, type Item, listItems, listOffers, type Status, today, updateItem, type Visibility } from "./api.ts";
import { OfferRow, WaitingRow } from "./offers.tsx";

type View = "owned" | "sent" | "collaborating" | "reports";

const VISIBILITY: Record<Visibility, string> = {
	none: "Your manager can't see your tasks.",
	direct_reports: "Your direct manager can see your tasks.",
	all_reports: "Anyone you report to can see your tasks.",
};

const STATUS_ICONS = { todo: Circle, doing: CircleDot, done: Check, cancelled: CircleOff } satisfies Record<Status, unknown>;

function isClosed(item: Item): boolean {
	return item.status === "done" || item.status === "cancelled";
}

function isOverdue(item: Item): boolean {
	return !isClosed(item) && item.due_at !== null && dueDay(item.due_at) < today();
}

function ItemRow({ item }: { item: Item }) {
	const { t, day, describe } = useI18n();
	const { toast } = useFeedback();
	const { me, path } = useWorkspace();
	const client = useQueryClient();
	const canEdit = item.owners.includes(me.user_id) || item.collaborators.includes(me.user_id);
	const finished = item.status === "done";
	const toggle = useMutation({
		mutationFn: () => updateItem(item.id, { status: finished ? "todo" : "done", version: item.version }),
		onSuccess: () => void client.invalidateQueries({ queryKey: ["items"] }),
		onError: (error) => toast(describe(error)),
	});
	const Icon = STATUS_ICONS[item.status];
	return (
		<li className={isClosed(item) ? "row task-row closed" : "row task-row"}>
			<button type="button" className={`status-toggle ${item.status}`} disabled={!canEdit || toggle.isPending || item.status === "cancelled"} aria-label={t(finished ? "Mark as to do" : "Mark as done")} onClick={() => toggle.mutate()}>
				<Icon size={finished ? 13 : 19} aria-hidden="true" />
			</button>
			<div className="row-main">
				<Link to={path(`tasks/${item.id}`)}>{item.title}</Link>
			</div>
			<div className="row-actions">
				{item.priority === "high" && (
					<span className="flag">
						<Flag size={13} aria-hidden="true" />
						{t("high")}
					</span>
				)}
				{item.due_at !== null && <span className={isOverdue(item) ? "due overdue" : "due"}>{day(item.due_at)}</span>}
				<span className={`pill ${item.status}`}>{t({ todo: "To do", doing: "In progress", done: "Done", cancelled: "Cancelled" }[item.status])}</span>
			</div>
		</li>
	);
}

export function TasksPage() {
	const { t, describe } = useI18n();
	const { path } = useWorkspace();
	const client = useQueryClient();
	const [view, setView] = useState<View>("owned");
	const [title, setTitle] = useState("");
	const [search, setSearch] = useState("");
	const [due, setDue] = useState("all");
	const [showCompleted, setShowCompleted] = useState(false);
	const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 60_000 });
	const items = useQuery({ queryKey: ["items", view], queryFn: () => listItems(`view=${view}`) });
	const inbox = useQuery({ queryKey: ["offers", "inbox"], queryFn: () => listOffers("inbox") });
	const sent = useQuery({ queryKey: ["offers", "sent"], queryFn: () => listOffers("sent") });
	const add = useMutation({
		mutationFn: () => createItem({ title, client_ref: crypto.randomUUID() }),
		onSuccess: () => {
			setTitle("");
			void client.invalidateQueries({ queryKey: ["items"] });
		},
	});
	const filtered = (items.data ?? []).filter((item) =>
		(showCompleted || !isClosed(item)) && item.title.toLowerCase().includes(search.trim().toLowerCase()) &&
		(due === "all" || (due === "overdue" ? isOverdue(item) : item.due_at !== null && dueDay(item.due_at) === today()))
	).toSorted((a, b) => Number(isClosed(a)) - Number(isClosed(b)) || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
	const visibility = settings.data?.manager_visibility;
	const views: View[] = visibility === undefined || visibility === "none" ? ["owned", "sent", "collaborating"] : ["owned", "sent", "collaborating", "reports"];
	const offers = (inbox.data ?? []).filter((offer) => offer.state === "pending");
	const waiting = (sent.data ?? []).filter((offer) => offer.state === "pending");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (title.trim() !== "") add.mutate();
	};

	return (
		<div className="page">
			<header className="page-head">
				<h1>{t("Tasks")}</h1>
				<Link className="button ghost" to={path("lists")}>
					{t("Shared lists")}
					<ChevronRight size={15} aria-hidden="true" />
				</Link>
			</header>
			{visibility !== undefined && (
				<p className="quiet with-icon">
					<Eye size={14} aria-hidden="true" />
					{t(VISIBILITY[visibility])}
				</p>
			)}
			<form className="add-row" onSubmit={submit}>
				<input value={title} maxLength={300} placeholder={t("Add a task")} aria-label={t("Add a task")} onChange={(event) => setTitle(event.target.value)} />
				<button type="submit" className="primary" disabled={title.trim() === "" || add.isPending}>
					<Plus size={15} aria-hidden="true" />
					{t("Add")}
				</button>
			</form>
			{add.isError && (
				<p className="inline-error" role="alert">
					{describe(add.error)}
				</p>
			)}
			{offers.length > 0 && (
				<section>
					<h2>{t("Offers")}</h2>
					<ul className="rows">
						{offers.map((offer) => (
							<OfferRow key={offer.id} offer={offer} />
						))}
					</ul>
				</section>
			)}
			{waiting.length > 0 && (
				<section>
					<h2>{t("Waiting on others")}</h2>
					<ul className="rows">
						{waiting.map((offer) => (
							<WaitingRow key={offer.id} offer={offer} />
						))}
					</ul>
				</section>
			)}
			<div className="tabs" role="tablist" onKeyDown={navigateOptions}>
				{views.map((name) => (
					<button key={name} type="button" role="tab" tabIndex={view === name ? 0 : -1} aria-selected={view === name} className={view === name ? "tab active" : "tab"} onClick={() => setView(name)}>
						{t({ owned: "Owned", sent: "Sent", collaborating: "Collaborating", reports: "Reports" }[name])}
					</button>
				))}
			</div>
			<div className="task-filters">
				<input type="search" value={search} placeholder={t("Search tasks")} aria-label={t("Search tasks")} onChange={(event) => setSearch(event.target.value)} />
				<select value={due} aria-label={t("Due date")} onChange={(event) => setDue(event.target.value)}>
					<option value="all">{t("Any due date")}</option><option value="overdue">{t("Overdue")}</option><option value="today">{t("Due today")}</option>
				</select>
				<label className="with-label"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />{t("Show completed work")}</label>
			</div>
			{items.isPending && <Skeleton />}
			{items.isError && <p className="inline-error" role="alert">{t("Couldn't load this. Try again.")} <button type="button" className="link" onClick={() => void items.refetch()}>{t("Retry")}</button></p>}
			{items.isSuccess && filtered.length === 0 && <Empty icon={CheckSquare} title={t("No tasks match these filters.")} />}
			<ul className="rows">
				{/* Finished work moves down, so what's left stays on top. */}
				{filtered.map((item) => (
					<ItemRow key={item.id} item={item} />
				))}
			</ul>
		</div>
	);
}
