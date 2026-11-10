import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronLeft, ChevronRight, FileQuestion, ListTodo, LogOut, Plus, Settings, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore, usePaged } from "../../lib/paged.tsx";
import { Avatar, Dialog, Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { claimItem, createItem, createList, getList, type Item, itemsPage, type ListRole, listsPage, listUnits, putListMember, removeListMember, type TaskList, updateList } from "./api.ts";
import { PersonPicker } from "./PersonPicker.tsx";
import { isClosed, ItemRow } from "./TasksPage.tsx";
import { usePeople } from "./usePeople.ts";

export function ListsPage() {
	const { t, describe } = useI18n();
	const { path } = useWorkspace();
	const { unit } = usePeople();
	const client = useQueryClient();
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [archived, setArchived] = useState(false);
	const lists = usePaged(["lists", archived], (cursor) => listsPage(cursor, archived));
	const add = useMutation({
		mutationFn: () => createList(name),
		onSuccess: (list) => {
			setName("");
			void client.invalidateQueries({ queryKey: ["lists"] });
			// A new list is empty, so the next step is on its own page: add work and people.
			navigate(path(`lists/${list.id}`));
		},
	});
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (name.trim() !== "" && !add.isPending) add.mutate();
	};
	return (
		<div className="page">
			<header className="page-head">
				<h1>{t("Shared lists")}</h1>
			</header>
			<p className="quiet">{t("Lists anyone on them can take work from.")}</p>
			{!archived && (
				<form className="add-row" onSubmit={submit}>
					<input value={name} maxLength={200} placeholder={t("New list")} aria-label={t("New list")} onChange={(event) => setName(event.target.value)} />
					<button type="submit" className="primary" disabled={name.trim() === "" || add.isPending}>
						<Plus size={15} aria-hidden="true" />
						{t("Add")}
					</button>
				</form>
			)}
			{add.isError && <p className="inline-error" role="alert">{describe(add.error)}</p>}
			{lists.isPending && <Skeleton />}
			{lists.isSuccess && lists.data?.length === 0 && <Empty icon={ListTodo} title={t(archived ? "No archived lists." : "No shared lists yet.")} />}
			<ul className="rows">
				{lists.data?.map((list) => (
					<li key={list.id} className="row">
						<span className="row-icon accent">
							<ListTodo size={16} aria-hidden="true" />
						</span>
						<div className="row-main">
							<Link to={path(`lists/${list.id}`)}>{list.name}</Link>
							<span className="quiet">{summary(list, t, unit)}</span>
						</div>
						{(list.counts?.unclaimed ?? 0) > 0 && <span className="pill doing">{t("{n} to claim", { n: list.counts?.unclaimed ?? 0 })}</span>}
						<ChevronRight size={16} className="quiet" aria-hidden="true" />
					</li>
				))}
			</ul>
			<LoadMore list={lists} />
			<p>
				<button type="button" className="link" onClick={() => setArchived(!archived)}>
					{t(archived ? "Back to current lists" : "Show archived lists")}
				</button>
			</p>
		</div>
	);
}

function summary(list: TaskList, t: ReturnType<typeof useI18n>["t"], unit: (id: string) => string): string {
	const parts = [t("{n} open", { n: list.counts?.open ?? 0 }), t("{n} members", { n: list.counts?.members ?? 0 })];
	if (list.org_unit_id && unit(list.org_unit_id) !== "") parts.push(t("Linked to {team}", { team: unit(list.org_unit_id) }));
	return parts.join(" · ");
}

export function ListPage() {
	const { id = "" } = useParams();
	const { t, describe } = useI18n();
	const { toast, confirm } = useFeedback();
	const { path, me } = useWorkspace();
	const client = useQueryClient();
	const navigate = useNavigate();
	const { name: nameOf, unit } = usePeople();
	const [title, setTitle] = useState("");
	const [showDone, setShowDone] = useState(false);
	const [editing, setEditing] = useState(false);
	const list = useQuery({ queryKey: ["list", id], queryFn: () => getList(id), retry: false });
	const items = usePaged(["items", "list", id], (cursor) => itemsPage(`view=list&list=${id}`, cursor));
	const refresh = () => {
		void client.invalidateQueries({ queryKey: ["list", id] });
		void client.invalidateQueries({ queryKey: ["lists"] });
		void client.invalidateQueries({ queryKey: ["items"] });
	};
	const failed = (error: Error) => toast(describe(error));
	const add = useMutation({
		mutationFn: () => createItem({ title, list_id: id, unowned: true, client_ref: crypto.randomUUID() }),
		onSuccess: () => {
			setTitle("");
			refresh();
		},
	});
	const claim = useMutation({ mutationFn: claimItem, onSuccess: refresh, onError: failed });
	const addMember = useMutation({ mutationFn: (user: string) => putListMember(id, user), onSuccess: refresh, onError: failed });
	const setRole = useMutation({ mutationFn: ({ user, role }: { user: string; role: ListRole }) => putListMember(id, user, role), onSuccess: refresh, onError: failed });
	const removeMember = useMutation({ mutationFn: (user: string) => removeListMember(id, user), onSuccess: refresh, onError: failed });
	const archive = useMutation({ mutationFn: (archived: boolean) => updateList(id, { archived }), onSuccess: refresh, onError: failed });
	const leave = useMutation({
		mutationFn: () => removeListMember(id, me.user_id),
		onSuccess: () => {
			refresh();
			toast(t("You left {name}", { name: list.data?.name ?? "" }));
			navigate(path("lists"));
		},
		onError: failed,
	});

	if (list.error instanceof ApiError && list.error.status === 404) {
		return (
			<div className="page">
				<Empty icon={FileQuestion} title={t("This list is gone, or you no longer have access")} />
			</div>
		);
	}
	const members = list.data?.members ?? [];
	const mine = members.find((member) => member.user_id === me.user_id);
	const isOwner = mine?.role === "owner";
	const owners = members.filter((member) => member.role === "owner").length;
	const isArchived = Boolean(list.data?.archived_at);
	// A list keeps an owner, and a team's member comes back with the next sync, so neither can leave.
	const canLeave = mine !== undefined && mine.source === "manual" && !(isOwner && owners === 1);
	const loaded = Array.isArray(items.data) ? items.data : [];
	// Open work first, and what's still unclaimed before what someone has taken.
	const open = loaded.filter((item) => !isClosed(item)).toSorted((a, b) => Number(a.owners.length > 0) - Number(b.owners.length > 0));
	const done = loaded.filter(isClosed);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (title.trim() !== "" && !add.isPending) add.mutate();
	};
	const askLeave = async () => {
		if (await confirm({ title: t("Leave this list?"), body: t("You keep tasks you own or collaborate on. An owner can add you back."), action: t("Leave") })) leave.mutate();
	};
	const askArchive = async () => {
		if (await confirm({ title: t("Archive this list?"), body: t("Nobody can add to it, and it moves to archived lists. You can restore it."), action: t("Archive") })) archive.mutate(true);
	};
	const row = (item: Item) => (
		<ItemRow key={item.id} item={item} editable>
			{item.owners.length === 0 ? (
				!isClosed(item) && (
					<button type="button" className="ghost small" disabled={claim.isPending} onClick={() => claim.mutate(item.id)}>
						{t("Claim")}
					</button>
				)
			) : (
				<span className="avatars" title={item.owners.map(nameOf).join(t(", "))}>
					{item.owners.map((user) => (
						<Avatar key={user} name={nameOf(user)} size={22} />
					))}
				</span>
			)}
		</ItemRow>
	);
	return (
		<div className="page">
			<Link className="crumb" to={path("lists")}>
				<ChevronLeft size={16} aria-hidden="true" />
				{t("Shared lists")}
			</Link>
			<header className="page-head">
				<h1>{list.data?.name}</h1>
				{isOwner && !isArchived && (
					<button type="button" className="ghost" onClick={() => setEditing(true)}>
						<Settings size={15} aria-hidden="true" />
						{t("List settings")}
					</button>
				)}
			</header>
			{list.data?.org_unit_id && unit(list.data.org_unit_id) !== "" && <p className="quiet">{t("Everyone in {team} is on this list.", { team: unit(list.data.org_unit_id) })}</p>}
			{isArchived && (
				<p className="banner card-banner">
					<Archive size={15} aria-hidden="true" />
					{t("This list is archived, so nothing new can be added.")}
					{isOwner && (
						<button type="button" className="link" disabled={archive.isPending} onClick={() => archive.mutate(false)}>
							{t("Restore")}
						</button>
					)}
				</p>
			)}
			{!isArchived && (
				<form className="add-row" onSubmit={submit}>
					<input value={title} maxLength={300} placeholder={t("Add a task")} aria-label={t("Add a task")} onChange={(event) => setTitle(event.target.value)} />
					<button type="submit" className="primary" disabled={title.trim() === "" || add.isPending}>
						<Plus size={15} aria-hidden="true" />
						{t("Add")}
					</button>
				</form>
			)}
			{add.isError && <p className="inline-error" role="alert">{describe(add.error)}</p>}
			{items.isPending && <Skeleton />}
			{items.isSuccess && open.length === 0 && <Empty icon={ListTodo} title={t(done.length === 0 ? "Nothing here." : "Everything on this list is done.")} />}
			<ul className="rows">{open.map(row)}</ul>
			{done.length > 0 && (
				<p>
					<button type="button" className="link" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
						{t(showDone ? "Hide finished ({n})" : "Show finished ({n})", { n: done.length })}
					</button>
				</p>
			)}
			{showDone && <ul className="rows">{done.map(row)}</ul>}
			<LoadMore list={items} label="Load more tasks" />
			<section>
				<h2>{t("Members")}</h2>
				<ul className="people">
					{members.map((member) => {
						const who = nameOf(member.user_id);
						const lastOwner = member.role === "owner" && owners === 1;
						return (
							<li key={member.user_id}>
								<Avatar name={who} size={24} />
								<span>{who}</span>
								{member.source === "org" && <span className="quiet">{t("From a linked team")}</span>}
								{isOwner && !lastOwner ? (
									<select className="compact" value={member.role} aria-label={t("Role of {name}", { name: who })} disabled={setRole.isPending} onChange={(event) => setRole.mutate({ user: member.user_id, role: event.target.value as ListRole })}>
										<option value="owner">{t("Owner")}</option>
										<option value="member">{t("Member")}</option>
									</select>
								) : (
									<span className="quiet">{t(member.role === "owner" ? "Owner" : "Member")}</span>
								)}
								{isOwner && member.source === "manual" && !lastOwner && member.user_id !== me.user_id && (
									<button type="button" className="icon-button" aria-label={t("Remove {name}", { name: who })} onClick={() => removeMember.mutate(member.user_id)}>
										<X size={14} aria-hidden="true" />
									</button>
								)}
							</li>
						);
					})}
				</ul>
				{isOwner && <PersonPicker label={t("Add member")} exclude={members.map((member) => member.user_id)} disabled={addMember.isPending} onPick={(user) => addMember.mutate(user)} />}
				{canLeave && (
					<p>
						<button type="button" className="ghost small" disabled={leave.isPending} onClick={() => void askLeave()}>
							<LogOut size={14} aria-hidden="true" />
							{t("Leave list")}
						</button>
					</p>
				)}
			</section>
			{editing && list.data !== undefined && <ListSettings list={list.data} onArchive={() => { setEditing(false); void askArchive(); }} onClose={() => setEditing(false)} onSaved={refresh} />}
		</div>
	);
}

/** Name and team link for a list owner. Archiving asks first, from the page. */
function ListSettings({ list, onArchive, onClose, onSaved }: { list: TaskList; onArchive(): void; onClose(): void; onSaved(): void }) {
	const { t, describe } = useI18n();
	const { tenant } = useWorkspace();
	const [name, setName] = useState(list.name);
	const [team, setTeam] = useState(list.org_unit_id ?? "");
	const units = useQuery({ queryKey: ["units", tenant], queryFn: listUnits, staleTime: 60_000 });
	const save = useMutation({
		mutationFn: () => updateList(list.id, { ...(name.trim() !== list.name ? { name: name.trim() } : {}), ...(team !== (list.org_unit_id ?? "") ? { org_unit_id: team } : {}) }),
		onSuccess: () => {
			onSaved();
			onClose();
		},
	});
	const changed = name.trim() !== list.name || team !== (list.org_unit_id ?? "");
	return (
		<Dialog label={t("List settings")} onClose={onClose}>
			<h2>{t("List settings")}</h2>
			<label>
				{t("Name")}
				<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
			</label>
			<label>
				{t("Linked team")}
				<select value={team} onChange={(event) => setTeam(event.target.value)}>
					<option value="">{t("Not linked")}</option>
					{(units.data ?? []).map((unit) => (
						<option key={unit.id} value={unit.id}>
							{unit.name}
						</option>
					))}
				</select>
			</label>
			<p className="outcome">{t("Everyone in a linked team joins the list, and leaves it when they leave the team. People you add yourself stay either way.")}</p>
			{save.isError && <p className="inline-error" role="alert">{describe(save.error)}</p>}
			<div className="dialog-actions">
				<button type="button" className="ghost danger-text" onClick={onArchive}>
					<Archive size={14} aria-hidden="true" />
					{t("Archive list")}
				</button>
				<span className="spacer" />
				<button type="button" className="ghost" onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="button" className="primary" disabled={!changed || name.trim() === "" || save.isPending} onClick={() => save.mutate()}>
					{t("Save")}
				</button>
			</div>
		</Dialog>
	);
}
