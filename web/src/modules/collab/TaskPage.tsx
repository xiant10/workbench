import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, CircleAlert, Eye, FileQuestion, Hand, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { load, save as saveLocal } from "../../lib/storage.ts";
import { ApiError } from "../../lib/api.ts";
import { startConversation, titleOf } from "../../lib/agent.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore, usePaged } from "../../lib/paged.tsx";
import { Avatar, Dialog, Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useRefreshSessions, useWorkspace } from "../../shell/workspace.ts";
import { addCollaborator, addComment, type Can, claimItem, deleteItem, dueDay, getItem, getList, type Item, commentsPage, eventsPage, removeCollaborator, updateItem, workItemPrompt, workItemRef } from "./api.ts";
import { CommentBox } from "./CommentBox.tsx";
import { eventLabel } from "./events.ts";
import { PersonPicker } from "./PersonPicker.tsx";
import { SendDialog } from "./SendDialog.tsx";
import { TaskStatus } from "./TaskStatus.tsx";
import { usePeople } from "./usePeople.ts";

const POLL_MS = 15_000;

type Editable = "title" | "description" | "status" | "priority" | "due_at";
type Draft = Pick<Item, Editable>;

const FIELDS: Editable[] = ["title", "description", "status", "priority", "due_at"];

function draftOf(item: Item): Draft {
	return { title: item.title, description: item.description, status: item.status, priority: item.priority, due_at: item.due_at };
}

function changes(base: Draft, draft: Draft): Partial<Draft> {
	return Object.fromEntries(FIELDS.filter((field) => draft[field] !== base[field]).map((field) => [field, draft[field]]));
}

export function TaskPage() {
	const { id = "" } = useParams();
	const { t } = useI18n();
	const item = useQuery({
		queryKey: ["item", id],
		queryFn: () => getItem(id),
		retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
		refetchInterval: POLL_MS,
	});
	if (item.error instanceof ApiError && item.error.status === 404) {
		return (
			<div className="page">
				<Empty icon={FileQuestion} title={t("This task is gone, or you no longer have access")} />
			</div>
		);
	}
	if (item.isError) {
		return (
			<div className="page">
				<Empty icon={CircleAlert} title={t("Couldn't load this. Try again.")}>
					<button type="button" className="ghost" onClick={() => void item.refetch()}>
						{t("Retry")}
					</button>
				</Empty>
			</div>
		);
	}
	if (item.data === undefined) {
		return (
			<div className="page">
				<Skeleton rows={6} />
			</div>
		);
	}
	return <TaskEditor key={id} item={item.data} />;
}

function TaskEditor({ item }: { item: Item }) {
	const { t, dateTime, describe } = useI18n();
	const { confirm, toast } = useFeedback();
	const { me, tenant, agent, profile, path } = useWorkspace();
	const navigate = useNavigate();
	const client = useQueryClient();
	const refreshSessions = useRefreshSessions();
	const { name, named } = usePeople();
	const draftKey = `task-draft:${tenant}:${me.user_id}:${item.id}`;
	const [restored] = useState(() => {
		try {
			const saved = JSON.parse(load(draftKey) ?? "null") as { base: Draft; version: number; draft: Draft } | null;
			const valid = (value: Draft) => value && typeof value.title === "string" && typeof value.description === "string" && ["todo", "doing", "done", "cancelled"].includes(value.status) && ["low", "normal", "high"].includes(value.priority) && (value.due_at === null || (typeof value.due_at === "string" && Number.isFinite(Date.parse(value.due_at))));
			return saved && valid(saved.base) && valid(saved.draft) && Number.isInteger(saved.version) ? saved : undefined;
		} catch { return undefined; }
	});
	const [base, setBase] = useState(() => restored ? { ...item, ...restored.base, version: restored.version } : item);
	const [draft, setDraft] = useState(() => restored?.draft ?? draftOf(item));
	const titleBox = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const element = titleBox.current;
		if (element === null) return;
		const fit = () => { element.style.height = "auto"; element.style.height = `${element.scrollHeight + 2}px`; };
		fit();
		let width = element.clientWidth;
		const observer = new ResizeObserver(() => {
			if (element.clientWidth !== width) { width = element.clientWidth; fit(); }
		});
		observer.observe(element);
		void document.fonts.ready.then(() => { if (element.isConnected) fit(); });
		return () => observer.disconnect();
	}, [draft.title]);
	const [conflict, setConflict] = useState<{ field: Editable; theirs: Item }>();
	const [handing, setHanding] = useState(false);
	const [preview, setPreview] = useState(false);
	const commentBox = useRef<HTMLTextAreaElement>(null);
	// Collab says what this person can do. The fallback is for a collab that doesn't yet.
	const isOwner = item.owners.includes(me.user_id);
	const can: Can = item.can ?? { edit: isOwner || item.collaborators.includes(me.user_id), cancel: isOwner, claim: false, send: isOwner, delete: isOwner, manage_people: isOwner };
	const canEdit = can.edit;
	const list = useQuery({ queryKey: ["list", item.list_id], queryFn: () => getList(item.list_id as string), enabled: item.list_id !== undefined && item.list_id !== "", retry: false, staleTime: 60_000 });
	const comments = usePaged(["comments", item.id], (cursor) => commentsPage(item.id, cursor), { refetchInterval: POLL_MS });
	const events = usePaged(["events", item.id], (cursor) => eventsPage(item.id, cursor), { refetchInterval: POLL_MS });
	const mine = changes(draftOf(base), draft);
	const dirty = Object.keys(mine).length > 0;
	useEffect(() => {
		if (canEdit) saveLocal(draftKey, dirty ? JSON.stringify({ base: draftOf(base), version: base.version, draft }) : undefined);
	}, [draftKey, base, draft, dirty, canEdit]);

	// A poll takes a teammate's edit, unless something typed here would be overwritten.
	useEffect(() => {
		if (item.version !== base.version && !dirty) {
			setBase(item);
			setDraft(draftOf(item));
		}
	}, [item, base.version, dirty]);

	const refresh = () => void client.invalidateQueries({ queryKey: ["item", item.id] });

	const save = useMutation({
		mutationFn: async ({ values, version = base.version }: { values: Partial<Draft>; version?: number }) => {
			try {
				return await updateItem(item.id, { ...values, version });
			} catch (error) {
				if (!(error instanceof ApiError) || error.code !== "version_conflict") throw error;
				// Changes to different fields merge. One field, changed on both sides, is the person's choice.
				const theirs = await getItem(item.id);
				const clash = (Object.keys(values) as Editable[]).find((field) => theirs[field] !== base[field]);
				if (clash !== undefined) {
					setConflict({ field: clash, theirs });
					return undefined;
				}
				return updateItem(item.id, { ...values, version: theirs.version });
			}
		},
		onSuccess: (saved) => {
			if (saved === undefined) return;
			setConflict(undefined);
			setBase(saved);
			setDraft(draftOf(saved));
			// An edit answers without `can`, and a status change can change it, so the item is read again.
			client.setQueryData(["item", item.id], { ...saved, can: item.can });
			refresh();
			void client.invalidateQueries({ queryKey: ["items"] });
			void client.invalidateQueries({ queryKey: ["events", item.id] });
		},
	});
	const post = useMutation({
		mutationFn: ({ body, mentions }: { body: string; mentions: string[] }) => addComment(item.id, body, mentions),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["comments", item.id] });
			// Answering a mention clears it from where the task stands.
			refresh();
		},
		onError: (error) => toast(describe(error)),
	});
	const remove = useMutation({
		mutationFn: () => deleteItem(item.id),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["items"] });
			toast(t("Task deleted"));
			navigate(path(list.data === undefined ? "tasks" : `lists/${list.data.id}`));
		},
		onError: (error) => toast(describe(error)),
	});
	const addPerson = useMutation({ mutationFn: (user: string) => addCollaborator(item.id, user), onSuccess: refresh, onError: (error) => toast(describe(error)) });
	const removePerson = useMutation({ mutationFn: (user: string) => removeCollaborator(item.id, user), onSuccess: refresh, onError: (error) => toast(describe(error)) });
	const claim = useMutation({
		mutationFn: () => claimItem(item.id),
		onSuccess: () => {
			refresh();
			void client.invalidateQueries({ queryKey: ["items"] });
		},
		onError: (error) => toast(describe(error)),
	});
	const work = useMutation({
		mutationFn: (current: Item) => startConversation(agent, profile, workItemPrompt(current), titleOf(current.title), { ref: workItemRef(item.id) }),
		onSuccess: (sessionId) => {
			refreshSessions();
			navigate(path(`c/${sessionId}`));
		},
	});
	const set = <K extends Editable>(field: K, value: Draft[K]) => setDraft({ ...draft, [field]: value });

	const askDelete = async () => {
		if (await confirm({ title: t("Delete this task?"), body: t("Everyone on it loses access. This can't be undone."), action: t("Delete"), danger: true })) remove.mutate();
	};

	return (
		<div className="page wide">
			<header className="task-bar">
				{/* A list item goes back to its list, if this person is on it. */}
				<Link className="crumb" to={path(list.data === undefined ? "tasks" : `lists/${list.data.id}`)}>
					<ChevronLeft size={16} aria-hidden="true" />
					{list.data === undefined ? t("Tasks") : list.data.name}
				</Link>
				<span className="draft-status" role="status">{t(dirty ? "Unsaved changes · Draft kept on this device" : "Saved")}</span>
				{dirty && <button type="button" className="link" onClick={() => { setBase(item); setDraft(draftOf(item)); }}>{t("Discard draft")}</button>}
				<span className="spacer" />
				{canEdit && (
					<button type="button" className="ghost" onClick={() => setPreview(true)}>
						<Sparkles size={15} aria-hidden="true" />
						{t("Work on this with my agent")}
					</button>
				)}
				{canEdit && (
					<button type="button" className="primary" disabled={!dirty || save.isPending || draft.title.trim() === ""} onClick={() => save.mutate({ values: mine })}>
						{t("Save")}
					</button>
				)}
			</header>
			{!canEdit && (
				<p className="banner card-banner">
					<Eye size={15} aria-hidden="true" />
					{t("You're reading this as a manager, so it can't be edited.")}
				</p>
			)}
			{conflict !== undefined && (
				<div className="conflict" role="alert">
					<p>
						<strong>{t("Someone else changed this task. Yours is kept below.")}</strong>
					</p>
					<dl>
						<dt>{t("Theirs")}</dt>
						<dd className="plain">{String(conflict.theirs[conflict.field] ?? "")}</dd>
						<dt>{t("Yours")}</dt>
						<dd className="plain">{String(draft[conflict.field] ?? "")}</dd>
					</dl>
					<div className="row-actions">
						<button
							type="button"
							className="primary small"
							onClick={() => {
								setBase(conflict.theirs);
								setConflict(undefined);
								save.mutate({ values: mine, version: conflict.theirs.version });
							}}
						>
							{t("Keep mine")}
						</button>
						<button
							type="button"
							className="ghost small"
							onClick={() => {
								setBase(conflict.theirs);
								setDraft(draftOf(conflict.theirs));
								setConflict(undefined);
							}}
						>
							{t("Use theirs")}
						</button>
					</div>
				</div>
			)}
			{save.isError && (
				<p className="inline-error" role="alert">
					{describe(save.error)}
				</p>
			)}
			<TaskStatus item={item} onReply={() => commentBox.current?.focus()} />
			<div className="task-layout">
				<div className="task-main">
					<textarea ref={titleBox} rows={1} className="title-input" value={draft.title} maxLength={300} aria-label={t("Title")} readOnly={!canEdit || save.isPending} onChange={(event) => set("title", event.target.value)} />
					<textarea className="description-input" rows={6} value={draft.description} maxLength={20_000} aria-label={t("Description")} placeholder={t("Add a description")} readOnly={!canEdit || save.isPending} onChange={(event) => set("description", event.target.value)} />

					<section className="always">
						<h2>{t("Comments")}</h2>
						<ul className="comments">
							{comments.data?.map((entry) => (
								<li key={entry.id}>
									<Avatar name={name(entry.author_id)} size={28} />
									<div className="comment-body">
										<div className="quiet">
											<strong>{name(entry.author_id)}</strong>
											{/* An agent account's ID starts with acc_, as auth-server issues them. */}
											{entry.author_id.startsWith("acc_") && <span className="pill">{t("Agent")}</span>} · {dateTime(entry.created_at)}
										</div>
										<div className="plain">{named(entry.body)}</div>
									</div>
								</li>
							))}
						</ul>
						<LoadMore list={comments} label="Show more comments" />
						<CommentBox inputRef={commentBox} pending={post.isPending} onSend={(body, mentions) => post.mutateAsync({ body, mentions })} />
					</section>

					<details className="history-box">
						<summary>{t("History")}</summary>
						<ul className="history quiet">
							{events.data?.map((event) => (
								<li key={event.id}>
									{dateTime(event.at)} · {name(event.actor_user_id)} · {t(eventLabel(event.kind))}
								</li>
							))}
						</ul>
						<LoadMore list={events} label="Show more history" />
					</details>
				</div>

				<aside className="task-side">
					<div className="fields">
						<label>
							{t("Status")}
							{/* Only an owner or the creator cancels, or reopens what they cancelled. */}
							<select value={draft.status} disabled={!canEdit || save.isPending || (base.status === "cancelled" && !can.cancel)} onChange={(event) => set("status", event.target.value as Item["status"])}>
								{(["todo", "doing", "done", "cancelled"] as const).map((value) => (
									<option key={value} value={value} disabled={value === "cancelled" && !can.cancel && base.status !== "cancelled"}>
										{t({ todo: "To do", doing: "In progress", done: "Done", cancelled: "Cancelled", low: "Low", normal: "Normal", high: "High" }[value])}
									</option>
								))}
							</select>
						</label>
						<label>
							{t("Priority")}
							<select value={draft.priority} disabled={!canEdit || save.isPending} onChange={(event) => set("priority", event.target.value as Item["priority"])}>
								{(["low", "normal", "high"] as const).map((value) => (
									<option key={value} value={value}>
										{t({ todo: "To do", doing: "In progress", done: "Done", cancelled: "Cancelled", low: "Low", normal: "Normal", high: "High" }[value])}
									</option>
								))}
							</select>
						</label>
						<label>
							{t("Due")}
							<input
								type="date"
								value={draft.due_at === null ? "" : dueDay(draft.due_at)}
								disabled={!canEdit || save.isPending}
								onChange={(event) => set("due_at", event.target.value === "" ? null : new Date(event.target.value).toISOString())}
							/>
						</label>
					</div>
					<div className="side-group">
						<h2>{t("Owners")}</h2>
						{item.owners.length === 0 && <p className="quiet">{t(item.list_id ? "Open for anyone on this list" : "Unowned")}</p>}
						{can.claim && (
							<button type="button" className="primary wide" disabled={claim.isPending} onClick={() => claim.mutate()}>
								<Hand size={14} aria-hidden="true" />
								{t("Claim")}
							</button>
						)}
						<ul className="people">
							{item.owners.map((user) => (
								<li key={user}>
									<Avatar name={name(user)} size={24} />
									<span>{name(user)}</span>
								</li>
							))}
						</ul>
					</div>
					<div className="side-group">
						<h2>{t("Collaborators")}</h2>
						<ul className="people">
							{item.collaborators.map((user) => (
								<li key={user}>
									<Avatar name={name(user)} size={24} />
									<span>{name(user)}</span>
									{can.manage_people && (
										<button type="button" className="icon-button" aria-label={t("Remove {name}", { name: name(user) })} onClick={() => removePerson.mutate(user)}>
											<X size={14} aria-hidden="true" />
										</button>
									)}
								</li>
							))}
						</ul>
						{can.manage_people && <PersonPicker label={t("Add collaborator")} exclude={[...item.owners, ...item.collaborators]} disabled={addPerson.isPending} onPick={(user) => addPerson.mutate(user)} />}
					</div>
					{(can.send || can.delete) && (
						<div className="side-actions">
							{can.send && (
								<button type="button" className="ghost wide" onClick={() => setHanding(true)}>
									<Send size={14} aria-hidden="true" />
									{t("Hand over")}
								</button>
							)}
							{can.delete && (
								<button type="button" className="ghost wide danger-text" onClick={() => void askDelete()}>
									<Trash2 size={14} aria-hidden="true" />
									{t("Delete")}
								</button>
							)}
						</div>
					)}
				</aside>
			</div>

			{handing && <SendDialog item={item} onClose={() => setHanding(false)} />}
			{preview && (
				<Dialog label={t("Work on this with my agent")} onClose={() => setPreview(false)}>
					<h2>{t("Work on this with my agent")}</h2>
					<p className="quiet">{t("This text comes from the task, and anyone on it may have written it. Your agent reads it as data, not as instructions.")}</p>
					<pre className="preview">{workItemPrompt({ ...item, ...draft })}</pre>
					{save.isError && <p className="inline-error" role="alert">{describe(save.error)}</p>}
					{conflict !== undefined && <p role="alert">{t("Resolve the task conflict before starting your agent.")}</p>}
					{work.isError && <p className="inline-error">{describe(work.error)}</p>}
					<div className="dialog-actions">
						<button type="button" className="ghost" onClick={() => setPreview(false)}>
							{t("Cancel")}
						</button>
						<button type="button" className="primary" disabled={work.isPending || save.isPending || draft.title.trim() === ""} onClick={async () => {
								try {
									const current = dirty ? await save.mutateAsync({ values: mine }) : item;
									if (current !== undefined) work.mutate(current);
								} catch { /* The save error stays visible in this dialog. */ }
							}}>
							{t(dirty ? "Save and start" : "Start")}
						</button>
					</div>
				</Dialog>
			)}
		</div>
	);
}
