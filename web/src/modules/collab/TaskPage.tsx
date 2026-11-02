import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, CircleAlert, Eye, FileQuestion, Send, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api.ts";
import { startConversation, titleOf } from "../../lib/agent.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Avatar, Dialog, Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useRefreshSessions, useWorkspace } from "../../shell/workspace.ts";
import { addCollaborator, addComment, deleteItem, dueDay, getItem, type Item, listComments, listEvents, removeCollaborator, updateItem, workItemPrompt, workItemRef } from "./api.ts";
import { eventLabel } from "./events.ts";
import { SendDialog } from "./SendDialog.tsx";
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
	const { me, agent, profile, path } = useWorkspace();
	const navigate = useNavigate();
	const client = useQueryClient();
	const refreshSessions = useRefreshSessions();
	const { people, name } = usePeople();
	const [base, setBase] = useState(item);
	const [draft, setDraft] = useState(() => draftOf(item));
	const [conflict, setConflict] = useState<{ field: Editable; theirs: Item }>();
	const [handing, setHanding] = useState(false);
	const [preview, setPreview] = useState(false);
	const [comment, setComment] = useState("");
	const [adding, setAdding] = useState("");
	const canEdit = item.owners.includes(me.user_id) || item.collaborators.includes(me.user_id);
	const isOwner = item.owners.includes(me.user_id);
	const comments = useQuery({ queryKey: ["comments", item.id], queryFn: () => listComments(item.id), refetchInterval: POLL_MS });
	const events = useQuery({ queryKey: ["events", item.id], queryFn: () => listEvents(item.id), refetchInterval: POLL_MS });
	const mine = changes(draftOf(base), draft);
	const dirty = Object.keys(mine).length > 0;

	// A poll takes a teammate's edit, unless something typed here would be overwritten.
	useEffect(() => {
		if (item.version !== base.version && !dirty) {
			setBase(item);
			setDraft(draftOf(item));
		}
	}, [item, base.version, dirty]);

	const refresh = () => void client.invalidateQueries({ queryKey: ["item", item.id] });

	const save = useMutation({
		mutationFn: async (values: Partial<Draft>) => {
			try {
				return await updateItem(item.id, { ...values, version: base.version });
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
			client.setQueryData(["item", item.id], saved);
			void client.invalidateQueries({ queryKey: ["events", item.id] });
		},
	});
	const post = useMutation({
		mutationFn: () => addComment(item.id, comment),
		onSuccess: () => {
			setComment("");
			void client.invalidateQueries({ queryKey: ["comments", item.id] });
		},
	});
	const remove = useMutation({
		mutationFn: () => deleteItem(item.id),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["items"] });
			toast(t("Task deleted"));
			navigate(path("tasks"));
		},
		onError: (error) => toast(describe(error)),
	});
	const addPerson = useMutation({
		mutationFn: () => addCollaborator(item.id, adding),
		onSuccess: () => {
			setAdding("");
			refresh();
		},
	});
	const removePerson = useMutation({ mutationFn: (user: string) => removeCollaborator(item.id, user), onSuccess: refresh });
	const work = useMutation({
		mutationFn: () => startConversation(agent, profile, workItemPrompt(item), titleOf(item.title), { ref: workItemRef(item.id) }),
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
				<Link className="crumb" to={path("tasks")}>
					<ChevronLeft size={16} aria-hidden="true" />
					{t("Tasks")}
				</Link>
				<span className="spacer" />
				{canEdit && (
					<button type="button" className="ghost" onClick={() => setPreview(true)}>
						<Sparkles size={15} aria-hidden="true" />
						{t("Work on this with my agent")}
					</button>
				)}
				{canEdit && (
					<button type="button" className="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(mine)}>
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
								save.mutate(mine);
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
			<div className="task-layout">
				<div className="task-main">
					<input className="title-input" value={draft.title} maxLength={300} aria-label={t("Title")} readOnly={!canEdit} onChange={(event) => set("title", event.target.value)} />
					<textarea className="description-input" rows={6} value={draft.description} maxLength={20_000} aria-label={t("Description")} placeholder={t("Add a description")} readOnly={!canEdit} onChange={(event) => set("description", event.target.value)} />

					<section className="always">
						<h2>{t("Comments")}</h2>
						<ul className="comments">
							{comments.data?.map((entry) => (
								<li key={entry.id}>
									<Avatar name={name(entry.author_id)} size={28} />
									<div className="comment-body">
										<div className="quiet">
											<strong>{name(entry.author_id)}</strong> · {dateTime(entry.created_at)}
										</div>
										<div className="plain">{entry.body}</div>
									</div>
								</li>
							))}
						</ul>
						<div className="comment-box">
							<textarea
								rows={2}
								value={comment}
								maxLength={10_000}
								placeholder={t("Add a comment")}
								aria-label={t("Add a comment")}
								onChange={(event) => setComment(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && comment.trim() !== "") post.mutate();
								}}
							/>
							<button type="button" className="ghost small" disabled={comment.trim() === "" || post.isPending} onClick={() => post.mutate()}>
								<Send size={13} aria-hidden="true" />
								{t("Send")}
							</button>
						</div>
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
					</details>
				</div>

				<aside className="task-side">
					<div className="fields">
						<label>
							{t("Status")}
							<select value={draft.status} disabled={!canEdit} onChange={(event) => set("status", event.target.value as Item["status"])}>
								{(["todo", "doing", "done", "cancelled"] as const).map((value) => (
									<option key={value} value={value}>
										{t(value)}
									</option>
								))}
							</select>
						</label>
						<label>
							{t("Priority")}
							<select value={draft.priority} disabled={!canEdit} onChange={(event) => set("priority", event.target.value as Item["priority"])}>
								{(["low", "normal", "high"] as const).map((value) => (
									<option key={value} value={value}>
										{t(value)}
									</option>
								))}
							</select>
						</label>
						<label>
							{t("Due")}
							<input
								type="date"
								value={draft.due_at === null ? "" : dueDay(draft.due_at)}
								disabled={!canEdit}
								onChange={(event) => set("due_at", event.target.value === "" ? null : new Date(event.target.value).toISOString())}
							/>
						</label>
					</div>
					<div className="side-group">
						<h2>{t("Owners")}</h2>
						{item.owners.length === 0 && <p className="quiet">{t("Unowned")}</p>}
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
									{isOwner && (
										<button type="button" className="icon-button" aria-label={t("Remove {name}", { name: name(user) })} onClick={() => removePerson.mutate(user)}>
											<X size={14} aria-hidden="true" />
										</button>
									)}
								</li>
							))}
						</ul>
						{isOwner && (
							<div className="add-row">
								<select value={adding} aria-label={t("Find a teammate")} onChange={(event) => setAdding(event.target.value)}>
									<option value="">{t("Find a teammate")}</option>
									{people
										.filter((person) => !item.owners.includes(person.user_id) && !item.collaborators.includes(person.user_id))
										.map((person) => (
											<option key={person.user_id} value={person.user_id}>
												{person.display_name || t("Teammate")}
											</option>
										))}
								</select>
								<button type="button" className="ghost icon-only" aria-label={t("Add collaborator")} disabled={adding === ""} onClick={() => addPerson.mutate()}>
									<UserPlus size={15} aria-hidden="true" />
								</button>
							</div>
						)}
					</div>
					{isOwner && (
						<div className="side-actions">
							<button type="button" className="ghost wide" onClick={() => setHanding(true)}>
								<Send size={14} aria-hidden="true" />
								{t("Hand over")}
							</button>
							<button type="button" className="ghost wide danger-text" onClick={() => void askDelete()}>
								<Trash2 size={14} aria-hidden="true" />
								{t("Delete")}
							</button>
						</div>
					)}
				</aside>
			</div>

			{handing && <SendDialog item={item} onClose={() => setHanding(false)} />}
			{preview && (
				<Dialog label={t("Work on this with my agent")} onClose={() => setPreview(false)}>
					<h2>{t("Work on this with my agent")}</h2>
					<p className="quiet">{t("This text comes from the task, and anyone on it may have written it. Your agent reads it as data, not as instructions.")}</p>
					<pre className="preview">{workItemPrompt(item)}</pre>
					{work.isError && <p className="inline-error">{describe(work.error)}</p>}
					<div className="dialog-actions">
						<button type="button" className="ghost" onClick={() => setPreview(false)}>
							{t("Cancel")}
						</button>
						<button type="button" className="primary" disabled={work.isPending} onClick={() => work.mutate()}>
							{t("Start")}
						</button>
					</div>
				</Dialog>
			)}
		</div>
	);
}
