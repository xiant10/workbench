import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitPullRequest, Plus, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { addLink, type Item, type LinkKind, removeLink } from "./api.ts";
import { usePeople } from "./usePeople.ts";

const KINDS: LinkKind[] = ["pull_request", "commit", "build", "document", "other"];

/** Each kind's name, written out so the translation check sees every string. */
function kindLabel(t: (text: string) => string, kind: LinkKind): string {
	switch (kind) {
		case "pull_request":
			return t("Pull request");
		case "commit":
			return t("Commit");
		case "build":
			return t("Build");
		case "document":
			return t("Document");
		default:
			return t("Link");
	}
}

/** An https URL, the only kind collab keeps. */
function isHttps(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * The task's links: where its work happens elsewhere, such as the pull request an agent teammate opened. They open in
 * a new tab with no opener and no referrer, because they lead out of t10.
 */
export function TaskLinks({ item, canEdit }: { item: Item; canEdit: boolean }) {
	const { t } = useI18n();
	const { name } = usePeople();
	const client = useQueryClient();
	const [adding, setAdding] = useState(false);
	const [url, setURL] = useState("");
	const [title, setTitle] = useState("");
	// Empty lets collab guess it from the address, such as a pull request from a GitHub /pull/ path.
	const [kind, setKind] = useState<LinkKind | "">("");
	const links = item.links ?? [];
	const refresh = () => void client.invalidateQueries({ queryKey: ["item", item.id] });
	const add = useMutation({
		mutationFn: () => addLink(item.id, { url: url.trim(), title: title.trim(), ...(kind === "" ? {} : { kind }) }),
		onSuccess: () => {
			setAdding(false);
			setURL("");
			setTitle("");
			setKind("");
			refresh();
		},
	});
	const remove = useMutation({ mutationFn: (link: string) => removeLink(item.id, link), onSuccess: refresh });
	if (links.length === 0 && !canEdit) return null;
	return (
		<div className="side-group" data-testid="task-links">
			<h2>{t("Links")}</h2>
			{links.length > 0 && (
				<ul className="people">
					{links.map((link) => (
						<li key={link.id}>
							{link.kind === "pull_request" ? <GitPullRequest size={14} aria-hidden="true" /> : <ExternalLink size={14} aria-hidden="true" />}
							<a href={link.url} target="_blank" rel="noopener noreferrer" title={`${kindLabel(t, link.kind)} · ${t("added by {name}", { name: name(link.added_by) })}`}>
								{link.title}
							</a>
							{canEdit && (
								<button type="button" className="icon-button" aria-label={t("Remove {name}", { name: link.title })} disabled={remove.isPending} onClick={() => remove.mutate(link.id)}>
									<X size={14} aria-hidden="true" />
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{canEdit && !adding && (
				<button type="button" className="ghost small" onClick={() => setAdding(true)}>
					<Plus size={13} aria-hidden="true" /> {t("Add link")}
				</button>
			)}
			{canEdit && adding && (
				<form
					style={{ display: "grid", gap: "0.4rem" }}
					onSubmit={(event) => {
						event.preventDefault();
						add.mutate();
					}}
				>
					<input type="url" value={url} placeholder="https://" aria-label={t("Address")} onChange={(event) => setURL(event.target.value)} />
					<input value={title} maxLength={200} placeholder={t("Title (optional)")} aria-label={t("Title")} onChange={(event) => setTitle(event.target.value)} />
					<select value={kind} aria-label={t("Kind")} onChange={(event) => setKind(event.target.value as LinkKind | "")}>
						<option value="">{t("Kind: from the address")}</option>
						{KINDS.map((entry) => (
							<option key={entry} value={entry}>
								{kindLabel(t, entry)}
							</option>
						))}
					</select>
					{add.isError && (
						<p className="error" role="alert">
							{t("It wasn't added. Use an https address.")}
						</p>
					)}
					<div className="row-actions">
						<button type="button" className="ghost small" onClick={() => setAdding(false)}>
							{t("Cancel")}
						</button>
						<button type="submit" className="primary small" disabled={!isHttps(url.trim()) || add.isPending}>
							{t("Add")}
						</button>
					</div>
				</form>
			)}
		</div>
	);
}
