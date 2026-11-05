import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileQuestion, ListTodo, Plus, UserPlus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore, usePaged } from "../../lib/paged.tsx";
import { Avatar, Empty, Skeleton } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { claimItem, createItem, createList, getList, itemsPage, listsPage, putListMember, removeListMember } from "./api.ts";
import { usePeople } from "./usePeople.ts";

export function ListsPage() {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const client = useQueryClient();
	const [name, setName] = useState("");
	const lists = usePaged(["lists"], listsPage);
	const add = useMutation({
		mutationFn: () => createList(name),
		onSuccess: () => {
			setName("");
			void client.invalidateQueries({ queryKey: ["lists"] });
		},
	});
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (name.trim() !== "") add.mutate();
	};
	return (
		<div className="page">
			<header className="page-head">
				<h1>{t("Shared lists")}</h1>
			</header>
			<p className="quiet">{t("Lists anyone on them can take work from.")}</p>
			<form className="add-row" onSubmit={submit}>
				<input value={name} maxLength={200} placeholder={t("New list")} aria-label={t("New list")} onChange={(event) => setName(event.target.value)} />
				<button type="submit" className="primary" disabled={name.trim() === ""}>
					<Plus size={15} aria-hidden="true" />
					{t("Add")}
				</button>
			</form>
			{lists.isPending && <Skeleton />}
			{lists.isSuccess && lists.data?.length === 0 && <Empty icon={ListTodo} title={t("No shared lists yet.")} />}
			<ul className="rows">
				{lists.data?.map((list) => (
					<li key={list.id} className="row">
						<span className="row-icon accent">
							<ListTodo size={16} aria-hidden="true" />
						</span>
						<div className="row-main">
							<Link to={path(`lists/${list.id}`)}>{list.name}</Link>
						</div>
						<ChevronRight size={16} className="quiet" aria-hidden="true" />
					</li>
				))}
			</ul>
			<LoadMore list={lists} />
		</div>
	);
}

export function ListPage() {
	const { id = "" } = useParams();
	const { t, describe } = useI18n();
	const { path, me } = useWorkspace();
	const client = useQueryClient();
	const { people, name: nameOf } = usePeople();
	const [title, setTitle] = useState("");
	const [adding, setAdding] = useState("");
	const list = useQuery({ queryKey: ["list", id], queryFn: () => getList(id), retry: false });
	const items = usePaged(["items", "list", id], (cursor) => itemsPage(`view=list&list=${id}`, cursor));
	const refresh = () => {
		void client.invalidateQueries({ queryKey: ["list", id] });
		void client.invalidateQueries({ queryKey: ["items", "list", id] });
	};
	const add = useMutation({
		mutationFn: () => createItem({ title, list_id: id, unowned: true, client_ref: crypto.randomUUID() }),
		onSuccess: () => {
			setTitle("");
			refresh();
		},
	});
	const claim = useMutation({ mutationFn: claimItem, onSuccess: refresh });
	const addMember = useMutation({
		mutationFn: () => putListMember(id, adding),
		onSuccess: () => {
			setAdding("");
			refresh();
		},
	});
	const removeMember = useMutation({ mutationFn: (user: string) => removeListMember(id, user), onSuccess: refresh });

	if (list.error instanceof ApiError && list.error.status === 404) {
		return (
			<div className="page">
				<Empty icon={FileQuestion} title={t("This list is gone, or you no longer have access")} />
			</div>
		);
	}
	const members = list.data?.members ?? [];
	const isOwner = members.some((member) => member.user_id === me.user_id && member.role === "owner");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (title.trim() !== "") add.mutate();
	};
	return (
		<div className="page">
			<Link className="crumb" to={path("lists")}>
				<ChevronLeft size={16} aria-hidden="true" />
				{t("Shared lists")}
			</Link>
			<header className="page-head">
				<h1>{list.data?.name}</h1>
			</header>
			<form className="add-row" onSubmit={submit}>
				<input value={title} maxLength={300} placeholder={t("Add a task")} aria-label={t("Add a task")} onChange={(event) => setTitle(event.target.value)} />
				<button type="submit" className="primary" disabled={title.trim() === ""}>
					<Plus size={15} aria-hidden="true" />
					{t("Add")}
				</button>
			</form>
			{claim.isError && <p className="inline-error">{describe(claim.error)}</p>}
			{items.isSuccess && items.data?.length === 0 && <Empty icon={ListTodo} title={t("Nothing here.")} />}
			<ul className="rows">
				{items.data?.map((item) => (
					<li key={item.id} className="row">
						<div className="row-main">
							<Link to={path(`tasks/${item.id}`)}>{item.title}</Link>
							{item.owners.length === 0 && <span className="quiet">{t("Open for anyone on this list")}</span>}
						</div>
						{item.owners.length === 0 ? (
							<button type="button" className="ghost" onClick={() => claim.mutate(item.id)}>
								{t("Claim")}
							</button>
						) : (
							<span className="quiet">{item.owners.map(nameOf).join(t(", "))}</span>
						)}
					</li>
				))}
			</ul>
			<LoadMore list={items} label="Load more tasks" />
			<section>
				<h2>{t("Members")}</h2>
				<ul className="people">
					{members.map((member) => (
						<li key={member.user_id}>
							<Avatar name={nameOf(member.user_id)} size={24} />
							<span>{nameOf(member.user_id)}</span>
							{member.source === "org" ? (
								<span className="quiet">{t("From a linked team")}</span>
							) : (
								isOwner && (
									<button type="button" className="icon-button" aria-label={t("Remove {name}", { name: nameOf(member.user_id) })} onClick={() => removeMember.mutate(member.user_id)}>
										<X size={14} aria-hidden="true" />
									</button>
								)
							)}
						</li>
					))}
				</ul>
				{isOwner && (
					<div className="add-row">
						<select value={adding} aria-label={t("Find a teammate")} onChange={(event) => setAdding(event.target.value)}>
							<option value="">{t("Find a teammate")}</option>
							{people
								.filter((person) => !members.some((member) => member.user_id === person.user_id))
								.map((person) => (
									<option key={person.user_id} value={person.user_id}>
										{person.display_name || t("Teammate")}
									</option>
								))}
						</select>
						<button type="button" className="ghost icon-only" aria-label={t("Add member")} disabled={adding === ""} onClick={() => addMember.mutate()}>
							<UserPlus size={15} aria-hidden="true" />
						</button>
					</div>
				)}
			</section>
		</div>
	);
}
