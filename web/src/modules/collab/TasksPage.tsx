import { navigateOptions } from "../../lib/layout.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckSquare, Circle, CircleDot, CircleOff, Eye, Flag, Hand, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore, usePaged } from "../../lib/paged.tsx";
import { Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { claimItem, createItem, dueDay, getSettings, type Item, itemsPage, listItems, listOffers, listsPage, type Status, today, updateItem, type Visibility } from "./api.ts";
import { OfferRow, WaitingRow } from "./offers.tsx";

type View = "owned" | "claimable" | "sent" | "collaborating" | "reports";

const TABS: Record<View, string> = { owned: "Owned", claimable: "Up for grabs", sent: "Sent", collaborating: "Collaborating", reports: "Reports" };

const VISIBILITY: Record<Visibility, string> = {
	none: "Your manager can't see your tasks.",
	direct_reports: "Your direct manager can see your tasks.",
	all_reports: "Anyone you report to can see your tasks.",
};

const STATUS_ICONS = { todo: Circle, doing: CircleDot, done: Check, cancelled: CircleOff } satisfies Record<Status, unknown>;

export function isClosed(item: Item): boolean {
	return item.status === "done" || item.status === "cancelled";
}

/** A due day as collab keeps it: midnight UTC. */
function dayStart(day: string): string {
	return `${day}T00:00:00Z`;
}

function nextDay(day: string): string {
	const date = new Date(dayStart(day));
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
}

/** The filters run in collab, so they reach every task and not only the pages loaded. */
function query(view: View, search: string, due: string, showCompleted: boolean): string {
	const params = new URLSearchParams({ view });
	if (!showCompleted && view !== "claimable") params.set("status", "open");
	if (search !== "") params.set("q", search);
	if (due === "overdue") {
		params.set("status", "open");
		params.set("due_before", dayStart(today()));
	} else if (due === "today") {
		params.set("due_from", dayStart(today()));
		params.set("due_before", dayStart(nextDay(today())));
	}
	return params.toString();
}

/** What a person typed, once they've paused, so each key doesn't start a request. */
function useSettled(value: string, ms = 250): string {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return settled;
}

function isOverdue(item: Item): boolean {
	return !isClosed(item) && item.due_at !== null && dueDay(item.due_at) < today();
}

/** A task in a list of them. A shared list lets every member edit, so it passes `editable`, and its own controls as children. */
export function ItemRow({ item, editable, children }: { item: Item; editable?: boolean; children?: ReactNode }) {
	const { t, day, describe } = useI18n();
	const { toast } = useFeedback();
	const { me, path } = useWorkspace();
	const client = useQueryClient();
	const canEdit = editable ?? (item.owners.includes(me.user_id) || item.collaborators.includes(me.user_id));
	const finished = item.status === "done";
	const refresh = () => void client.invalidateQueries({ queryKey: ["items"] });
	const toggle = useMutation({
		mutationFn: () => updateItem(item.id, { status: finished ? "todo" : "done", version: item.version }),
		onSuccess: (saved) => {
			refresh();
			// A finished task leaves the list it was ticked in, so the way back is right here.
			if (!finished) {
				toast(t("Marked {title} as done", { title: item.title }), {
					label: t("Undo"),
					run: () => void updateItem(item.id, { status: item.status, version: saved.version }).then(refresh, (error: Error) => toast(describe(error))),
				});
			}
		},
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
				{children}
				<span className={`pill ${item.status}`}>{t({ todo: "To do", doing: "In progress", done: "Done", cancelled: "Cancelled" }[item.status])}</span>
			</div>
		</li>
	);
}

export function TasksPage() {
	const { t, describe } = useI18n();
	const { toast } = useFeedback();
	const { path } = useWorkspace();
	const client = useQueryClient();
	const [view, setView] = useState<View>("owned");
	const [title, setTitle] = useState("");
	const [search, setSearch] = useState("");
	const [due, setDue] = useState("all");
	const [showCompleted, setShowCompleted] = useState(false);
	const settled = useSettled(search.trim());
	const filter = query(view, settled, due, showCompleted);
	const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 60_000 });
	const items = usePaged(["items", view, filter], (cursor) => itemsPage(filter, cursor));
	// Counted on every tab, so open work on a list is seen without opening it.
	const claimable = useQuery({ queryKey: ["items", "claimable-count"], queryFn: () => listItems("view=claimable") });
	const lists = useQuery({ queryKey: ["lists", "names"], queryFn: () => listsPage(""), enabled: view === "claimable", staleTime: 60_000 });
	const inbox = useQuery({ queryKey: ["offers", "inbox"], queryFn: () => listOffers("inbox") });
	const sent = useQuery({ queryKey: ["offers", "sent"], queryFn: () => listOffers("sent") });
	const add = useMutation({
		mutationFn: () => createItem({ title, client_ref: crypto.randomUUID() }),
		onSuccess: () => {
			setTitle("");
			if (view !== "owned") setView("owned");
			void client.invalidateQueries({ queryKey: ["items"] });
		},
	});
	const claim = useMutation({
		mutationFn: claimItem,
		onSuccess: (item) => {
			toast(t("{title} is yours now", { title: item.title }));
			void client.invalidateQueries({ queryKey: ["items"] });
		},
		onError: (error) => toast(describe(error)),
	});
	// Finished work moves down, so what's left stays on top, soonest due first.
	const sorted = (Array.isArray(items.data) ? items.data : []).toSorted((a, b) => Number(isClosed(a)) - Number(isClosed(b)) || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
	const listName = (id?: string) => lists.data?.items.find((list) => list.id === id)?.name;
	const visibility = settings.data?.manager_visibility;
	const views: View[] = visibility === undefined || visibility === "none" ? ["owned", "claimable", "sent", "collaborating"] : ["owned", "claimable", "sent", "collaborating", "reports"];
	const toClaim = claimable.data?.length ?? 0;
	const offers = (Array.isArray(inbox.data) ? inbox.data : []).filter((offer) => offer.state === "pending");
	const waiting = (Array.isArray(sent.data) ? sent.data : []).filter((offer) => offer.state === "pending");
	const filtered = settled !== "" || due !== "all";
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (title.trim() !== "" && !add.isPending) add.mutate();
	};

	return (
		<div className="page">
			<header className="page-head">
				<h1>{t("Tasks")}</h1>
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
						{t(TABS[name])}
						{name === "claimable" && toClaim > 0 && <span className="badge">{toClaim >= 100 ? "99+" : toClaim}</span>}
					</button>
				))}
			</div>
			{view === "claimable" && <p className="quiet">{t("Open work on your shared lists that nobody has taken yet.")}</p>}
			<div className="task-filters">
				<input type="search" value={search} placeholder={t("Search tasks")} aria-label={t("Search tasks")} onChange={(event) => setSearch(event.target.value)} />
				<select value={due} aria-label={t("Due date")} onChange={(event) => setDue(event.target.value)}>
					<option value="all">{t("Any due date")}</option><option value="overdue">{t("Overdue")}</option><option value="today">{t("Due today")}</option>
				</select>
				{view !== "claimable" && <label className="with-label"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />{t("Show completed work")}</label>}
			</div>
			{items.isPending && <Skeleton />}
			{items.isError && <p className="inline-error" role="alert">{t("Couldn't load this. Try again.")} <button type="button" className="link" onClick={() => void items.refetch()}>{t("Retry")}</button></p>}
			{items.isSuccess && sorted.length === 0 && (
				filtered ? <Empty icon={CheckSquare} title={t("No tasks match these filters.")} />
				: view === "claimable" ? <Empty icon={Hand} title={t("Nothing to claim on your lists.")}><Link className="button ghost" to={path("lists")}>{t("Shared lists")}</Link></Empty>
				: <Empty icon={CheckSquare} title={t(view === "owned" ? "Nothing on your plate. Add a task above." : "Nothing here yet")} />
			)}
			<ul className="rows">
				{sorted.map((item) =>
					view === "claimable" ? (
						<ItemRow key={item.id} item={item} editable>
							{listName(item.list_id) !== undefined && <Link className="chip muted" to={path(`lists/${item.list_id}`)}>{listName(item.list_id)}</Link>}
							<button type="button" className="ghost small" disabled={claim.isPending} onClick={() => claim.mutate(item.id)}>
								{t("Claim")}
							</button>
						</ItemRow>
					) : (
						<ItemRow key={item.id} item={item} />
					),
				)}
			</ul>
			<LoadMore list={items} label="Load more tasks" />
		</div>
	);
}
