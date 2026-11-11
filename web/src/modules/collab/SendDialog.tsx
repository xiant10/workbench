import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { suggestTitle, toPlainText } from "../../conversation/plaintext.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Avatar, Dialog, Segmented } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { createItem, findPeople, type Item, type Offer, sendItem } from "./api.ts";
import { usePeople } from "./usePeople.ts";

const UNDO_SECONDS = 5;
const MAX_DESCRIPTION = 20_000;

type Props = {
	/** Send as task: the reply's text. A new task is created, holding plain text only. */
	text?: string;
	/** Hand over an existing task. */
	item?: Item;
	onClose(): void;
};

/**
 * "Send" hides what happens next, so there are two verbs, and the line above the button says what each will do. The
 * service still decides, and the screen shows what it returned. Once collab returns `relation`, this line can be exact.
 */
export function SendDialog({ text, item, onClose }: Props) {
	const { t, describe } = useI18n();
	const { me } = useWorkspace();
	const client = useQueryClient();
	const { unit } = usePeople();
	const [title, setTitle] = useState(() => (text === undefined ? "" : suggestTitle(text)));
	const [description, setDescription] = useState(() => (text === undefined ? "" : toPlainText(text).slice(0, MAX_DESCRIPTION)));
	const [query, setQuery] = useState("");
	const [to, setTo] = useState<{ id: string; name: string }>();
	const [mode, setMode] = useState<"transfer" | "share">("transfer");
	const [note, setNote] = useState("");
	const [countdown, setCountdown] = useState<number>();
	const [result, setResult] = useState<Offer>();
	const clientRef = useRef(crypto.randomUUID());
	const people = useQuery({ queryKey: ["people-search", query], queryFn: () => findPeople(query) });
	const candidates = (people.data ?? []).filter((person) => person.user_id !== me.user_id);

	const send = useMutation({
		mutationFn: async (): Promise<Offer> => {
			const delivery = { to: to?.id, mode, note, client_ref: clientRef.current };
			if (item !== undefined) return sendItem(item.id, delivery);
			const created = await createItem({ title, description, client_ref: clientRef.current });
			return sendItem(created.id, delivery);
		},
		onSuccess: (offer) => {
			setResult(offer);
			void client.invalidateQueries();
		},
	});

	// Held in the page, so closing the tab during the window cancels the send.
	useEffect(() => {
		if (countdown === undefined) return;
		if (countdown === 0) {
			setCountdown(undefined);
			send.mutate();
			return;
		}
		const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
		return () => clearTimeout(timer);
	}, [countdown]); // eslint-disable-line react-hooks/exhaustive-deps

	if (result !== undefined && to !== undefined) {
		return (
			<Dialog label={t("Send as task")} onClose={onClose}>
				<div className="sent">
					<CircleCheck size={32} aria-hidden="true" />
					<p role="status">{t(result.state === "assigned" ? "Assigned to {name}" : "Waiting for {name}", { name: to.name })}</p>
				</div>
				<div className="dialog-actions">
					<button type="button" className="primary" onClick={onClose}>
						{t("Close")}
					</button>
				</div>
			</Dialog>
		);
	}

	const ready = to !== undefined && (item !== undefined || title.trim() !== "");
	const counting = countdown !== undefined;
	return (
		<Dialog label={t("Send as task")} {...(counting ? {} : { onClose })}>
			<h2>{item === undefined ? t("Send as task") : t("Hand over this task")}</h2>
			{item === undefined && (
				<>
					<label>
						{t("Title")}
						<input value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
					</label>
					<label>
						{t("Description")}
						<textarea rows={5} value={description} maxLength={MAX_DESCRIPTION} onChange={(event) => setDescription(event.target.value)} />
					</label>
				</>
			)}
			<label>
				{t("Who to")}
				<input
					value={to?.name ?? query}
					placeholder={t("Find a teammate")}
					onChange={(event) => {
						setTo(undefined);
						setQuery(event.target.value);
					}}
				/>
			</label>
			{to === undefined && (
				<ul className="picker">
					{candidates.map((person) => (
						<li key={person.user_id}>
							<button type="button" onClick={() => setTo({ id: person.user_id, name: person.display_name || t("Teammate") })}>
								<Avatar name={person.display_name || t("Teammate")} size={26} />
								<span>{person.display_name || t("Teammate")}</span>
								{person.org_unit_id !== "" && <span className="quiet">{unit(person.org_unit_id)}</span>}
								{person.agent === true && <span className="pill">{t("Agent teammate")}</span>}
							</button>
						</li>
					))}
					{people.isSuccess && candidates.length === 0 && <li className="quiet picker-none">{t(query === "" ? "No teammates yet. A tenant admin sends invitations." : "Nobody matches that name.")}</li>}
				</ul>
			)}
			<Segmented<"transfer" | "share">
				label={t("How to send")}
				value={mode}
				options={[
					{ value: "transfer", label: t("Hand over") },
					{ value: "share", label: t("Share") },
				]}
				onChange={setMode}
			/>
			<label>
				{t("Note")}
				<input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
			</label>
			<p className="outcome">
				{t(
					mode === "transfer"
						? "If they report to you, this assigns it now and you stay on as a collaborator. Otherwise they need to accept, and you keep it until then."
						: "If they report to you, this assigns it now and you both own it. Otherwise they need to accept, and you both own it after that.",
				)}
			</p>
			{send.isError && (
				<p className="inline-error" role="alert">
					{describe(send.error)}
				</p>
			)}
			<div className="dialog-actions">
				{counting ? (
					<>
						<span className="quiet" role="status">
							{t("Sending in {n}…", { n: countdown })}
						</span>
						<button type="button" className="primary" onClick={() => setCountdown(undefined)}>
							{t("Undo")}
						</button>
					</>
				) : (
					<>
						<button type="button" className="ghost" onClick={onClose}>
							{t("Cancel")}
						</button>
						<button type="button" className="primary" disabled={!ready || send.isPending} onClick={() => setCountdown(UNDO_SECONDS)}>
							{t(mode === "transfer" ? "Hand over" : "Share")}
						</button>
					</>
				)}
			</div>
		</Dialog>
	);
}
