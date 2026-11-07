import { useQuery } from "@tanstack/react-query";
import { Megaphone, Pin } from "lucide-react";
import { type FormEvent, useState } from "react";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, Empty, Segmented } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { useCommand } from "./Admin.tsx";
import { type Publication, type Recipient, root, useAccess, usePeople } from "./api.ts";

type Kind = "announcements" | "assigned-tasks";

function Receipts({ kind, item, onClose }: { kind: Kind; item: Publication; onClose(): void }) {
	const { t, dateTime } = useI18n();
	const { tenant } = useWorkspace();
	const { name } = usePeople();
	const receipts = useQuery({
		queryKey: ["property", tenant, "receipts", item.id],
		queryFn: () => request<{ recipients: Recipient[] }>(`${root}/${kind}/${encodeURIComponent(item.id)}/recipients`),
		retry: false,
		gcTime: 0,
	});
	return (
		<Dialog label={t("Receipts")} onClose={onClose}>
			<div className="property-editor">
				<h2>{item.title}</h2>
				{receipts.isPending && <p role="status">{t("Loading…")}</p>}
				{receipts.isError && <p role="alert">{t("Couldn't load this. Try again.")}</p>}
				<ul className="property-items">
					{receipts.data?.recipients.map((recipient) => (
						<li key={recipient.user_id} className="property-item">
							<span>{name(recipient.user_id)}{!recipient.available && ` · ${t("No longer active")}`}</span>
							<span className="property-quiet">
								{kind === "assigned-tasks" && recipient.completed_at !== null ? t("Completed {time}", { time: dateTime(recipient.completed_at) })
									: recipient.read_at !== null ? t("Read {time}", { time: dateTime(recipient.read_at) })
									: t("Not read")}
							</span>
							{recipient.explanation !== "" && <p className="property-pre">{recipient.explanation}</p>}
						</li>
					))}
				</ul>
				<div className="property-form-actions"><button type="button" onClick={onClose}>{t("Close")}</button></div>
			</div>
		</Dialog>
	);
}

function Compose({ kind, onClose }: { kind: Kind; onClose(): void }) {
	const { t } = useI18n();
	const { people, name } = usePeople();
	const cmd = useCommand();
	const [mode, setMode] = useState("all");
	const [chosen, setChosen] = useState<string[]>([]);
	const notice = kind === "announcements";
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const value = (key: string) => String(form.get(key) ?? "");
		const body: Record<string, unknown> = { name: value("name"), text: value("text"), audience_mode: mode, ...(mode === "users" ? { recipient_ids: chosen } : {}) };
		if (notice) {
			body.pinned = form.has("pinned");
			if (value("expires_at") !== "") body.expires_at = new Date(value("expires_at")).toISOString();
		} else {
			body.due_at = new Date(value("due_at")).toISOString();
		}
		if (await cmd.save(kind, body, false)) onClose();
	}
	const title = t(notice ? "Publish a notice" : "Assign a task");
	return (
		<Dialog label={title} onClose={cmd.busy ? undefined : onClose}>
			<form className="property-editor" onSubmit={(event) => void submit(event)}>
				<h2>{title}</h2>
				<label>{t("Title")}<input name="name" required maxLength={160} /></label>
				<label>{t(notice ? "Notice" : "Instructions")}<textarea name="text" required rows={4} /></label>
				<label>{t("Send to")}
					<select aria-label={t("Send to")} value={mode} onChange={(event) => setMode(event.target.value)}>
						<option value="all">{t("Everyone")}</option>
						<option value="users">{t("Chosen people")}</option>
					</select>
				</label>
				{mode === "users" && (
					<fieldset>
						<legend>{t("People")}</legend>
						{people.map((person) => (
							<label key={person.user_id} className="property-check">
								<input type="checkbox" checked={chosen.includes(person.user_id)} onChange={(event) => setChosen((current) => (event.target.checked ? [...current, person.user_id] : current.filter((id) => id !== person.user_id)))} />
								{name(person.user_id)}
							</label>
						))}
					</fieldset>
				)}
				{notice ? (
					<>
						<label className="property-check"><input type="checkbox" name="pinned" /> {t("Pin to the top")}</label>
						<label>{t("Expires, if it should")}<input name="expires_at" type="datetime-local" /></label>
					</>
				) : (
					<label>{t("Due")}<input name="due_at" type="datetime-local" required /></label>
				)}
				<p>{t("The audience is fixed when you publish. Later role changes don't add or remove anyone.")}</p>
				{cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
				<div className="property-form-actions">
					<button type="button" disabled={cmd.busy} onClick={onClose}>{t("Cancel")}</button>
					<button type="submit" disabled={cmd.busy || (mode === "users" && chosen.length === 0)}>{cmd.busy ? t("Saving…") : t("Publish")}</button>
				</div>
			</form>
		</Dialog>
	);
}

/** Notices and tasks: read and complete your own; a manager also publishes and sees who has. */
export function Messages() {
	const { t, dateTime } = useI18n();
	const { tenant, me } = useWorkspace();
	const access = useAccess();
	const cmd = useCommand();
	const [kind, setKind] = useState<Kind>("announcements");
	const [composing, setComposing] = useState(false);
	const [receipts, setReceipts] = useState<Publication>();
	const [completing, setCompleting] = useState<Publication>();
	const list = useQuery({
		queryKey: ["property", tenant, "publications", kind],
		queryFn: async () => {
			const body = await request<{ announcements?: Publication[]; assigned_tasks?: Publication[] }>(`${root}/${kind}`);
			return body.announcements ?? body.assigned_tasks ?? [];
		},
		retry: false,
	});
	const scope = access.data?.scopes[kind === "announcements" ? "property:notice.publish" : "property:task.assign"];
	return (
		<>
			<header className="property-header">
				<div>
					<h1>{t("Notices & tasks")}</h1>
					<p>{t("From your project manager, with who has read and finished them.")}</p>
				</div>
				{scope?.all === true && <button type="button" onClick={() => setComposing(true)}>{t(kind === "announcements" ? "Publish a notice" : "Assign a task")}</button>}
			</header>
			<Segmented<Kind> label={t("Notices & tasks")} value={kind} onChange={setKind} options={[{ value: "announcements", label: t("Notices") }, { value: "assigned-tasks", label: t("Tasks") }]} />
			<section className="property-card">
				{list.isPending && <div className="property-empty" role="status">{t("Loading…")}</div>}
				{list.isError && <div className="property-empty" role="alert">{t("Couldn't load this. Try again.")}</div>}
				{list.data?.length === 0 && <Empty icon={Megaphone} title={t("Nothing here yet")} />}
				{cmd.error !== "" && <p role="alert" className="property-form-error property-body">{t(cmd.error)}</p>}
				<ul className="property-items">
					{list.data?.map((item) => {
						const recipient = item.recipient_revision !== null;
						return (
							<li key={item.id} className="property-item">
								<div>
									<strong>{item.pinned && <Pin size={13} aria-label={t("Pinned")} />} {item.title}</strong>
									<p className="property-pre">{item.text}</p>
									<p className="property-quiet">
										{item.due_at !== null ? t("Due {time}", { time: dateTime(item.due_at) }) : dateTime(item.created_at)}
										{item.recipient_count !== undefined && kind === "assigned-tasks" && ` · ${t("{done} of {total} finished", { done: item.completed_count ?? 0, total: item.recipient_count })}`}
										{item.recipient_count !== undefined && kind === "announcements" && ` · ${t("{done} of {total} read", { done: item.read_count ?? 0, total: item.recipient_count })}`}
									</p>
								</div>
								<div className="property-form-actions">
									{recipient && item.read_at === null && <button type="button" disabled={cmd.busy} onClick={() => void cmd.save(`${kind}/${encodeURIComponent(item.id)}/read`, {}, false)}>{t("Mark as read")}</button>}
									{recipient && kind === "assigned-tasks" && item.completed_at === null && <button type="button" onClick={() => setCompleting(item)}>{t("Finish")}</button>}
									{item.creator_id === me.user_id && <button type="button" onClick={() => setReceipts(item)}>{t("Receipts")}</button>}
								</div>
							</li>
						);
					})}
				</ul>
			</section>
			{composing && <Compose kind={kind} onClose={() => setComposing(false)} />}
			{receipts !== undefined && <Receipts kind={kind} item={receipts} onClose={() => setReceipts(undefined)} />}
			{completing !== undefined && (
				<Dialog label={t("Finish")} onClose={cmd.busy ? undefined : () => setCompleting(undefined)}>
					<form
						className="property-editor"
						onSubmit={(event) => {
							event.preventDefault();
							const explanation = String(new FormData(event.currentTarget).get("explanation") ?? "");
							void cmd.save(`assigned-tasks/${encodeURIComponent(completing.id)}/complete`, { revision: completing.recipient_revision, explanation }, false).then((saved) => saved && setCompleting(undefined));
						}}
					>
						<h2>{completing.title}</h2>
						<label>{t("Anything to add")}<textarea name="explanation" maxLength={1000} /></label>
						{cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
						<div className="property-form-actions">
							<button type="button" disabled={cmd.busy} onClick={() => setCompleting(undefined)}>{t("Cancel")}</button>
							<button type="submit" disabled={cmd.busy}>{t("Finish")}</button>
						</div>
					</form>
				</Dialog>
			)}
		</>
	);
}
