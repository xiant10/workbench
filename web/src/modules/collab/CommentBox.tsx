import { Send } from "lucide-react";
import { type RefObject, useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { Avatar } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { usePeople } from "./usePeople.ts";

type Pick = { id: string; name: string };

/** What's typed after an @ just before the caret, while a mention is being written. */
export function mentionQuery(text: string, caret: number): string | undefined {
	return /(?:^|\s)@([^\s@]{0,40})$/.exec(text.slice(0, caret))?.[1];
}

/** The text with the @ being written replaced by the person's name, and where the caret goes after it. */
export function insertMention(text: string, caret: number, name: string): { text: string; caret: number } {
	const start = text.slice(0, caret).lastIndexOf("@");
	const inserted = `@${name} `;
	return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/** The people picked whose mention is still in the comment, once each. */
export function mentionedIds(body: string, picks: Pick[]): string[] {
	return [...new Set(picks.filter((pick) => body.includes(`@${pick.name}`)).map((pick) => pick.id))];
}

/**
 * The comment box. Typing @ offers the people and teammates in the tenant by name, and a pick both writes their name
 * and tells them, if they can read the task. Mentioning someone never gives them access.
 */
export function CommentBox({ inputRef, pending, onSend }: { inputRef: RefObject<HTMLTextAreaElement>; pending: boolean; onSend(body: string, mentions: string[]): Promise<unknown> }) {
	const { t } = useI18n();
	const { me } = useWorkspace();
	const { people } = usePeople();
	const [text, setText] = useState("");
	const [caret, setCaret] = useState(0);
	const [picks, setPicks] = useState<Pick[]>([]);
	const [active, setActive] = useState(0);
	const [closed, setClosed] = useState(false);
	const query = closed ? undefined : mentionQuery(text, caret);
	const matches =
		query === undefined
			? []
			: people
					.filter((person) => person.user_id !== me.user_id && person.display_name !== "" && person.display_name.toLowerCase().includes(query.toLowerCase()))
					.slice(0, 6);
	const open = matches.length > 0;

	const pick = (person: (typeof people)[number]) => {
		const next = insertMention(text, caret, person.display_name);
		setText(next.text);
		setCaret(next.caret);
		setPicks((before) => [...before, { id: person.user_id, name: person.display_name }]);
		setActive(0);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.setSelectionRange(next.caret, next.caret);
		});
	};
	const send = () => {
		if (text.trim() === "" || pending) return;
		void onSend(text, mentionedIds(text, picks)).then(() => {
			setText("");
			setPicks([]);
		}, () => undefined);
	};

	return (
		<div className="comment-box">
			<div className="mention-field">
				<textarea
					ref={inputRef}
					rows={2}
					value={text}
					maxLength={10_000}
					placeholder={t("Add a comment. Type @ to mention someone")}
					aria-label={t("Add a comment")}
					aria-autocomplete="list"
					aria-expanded={open}
					aria-controls={open ? "mention-list" : undefined}
					aria-activedescendant={open ? `mention-${active}` : undefined}
					onChange={(event) => {
						setText(event.target.value);
						setCaret(event.target.selectionStart);
						setClosed(false);
						setActive(0);
					}}
					onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
					onKeyDown={(event) => {
						if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActive((active + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
						} else if (open && (event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey) {
							event.preventDefault();
							const chosen = matches[active];
							if (chosen !== undefined) pick(chosen);
						} else if (open && event.key === "Escape") {
							event.preventDefault();
							setClosed(true);
						} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							send();
						}
					}}
				/>
				{open && (
					<ul id="mention-list" className="picker mention-picker" role="listbox" aria-label={t("People to mention")}>
						{matches.map((person, index) => (
							<li key={person.user_id} id={`mention-${index}`} role="option" aria-selected={index === active}>
								<button type="button" tabIndex={-1} className={index === active ? "active" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(person)}>
									<Avatar name={person.display_name} size={22} />
									<span>{person.display_name}</span>
									<span className="pill">{t(person.agent === true ? "Agent" : "Person")}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			<button type="button" className="ghost small" disabled={text.trim() === "" || pending} onClick={send}>
				<Send size={13} aria-hidden="true" />
				{t("Send")}
			</button>
		</div>
	);
}
