import { useQuery } from "@tanstack/react-query";
import { FolderPlus, Search } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore, usePaged } from "../../lib/paged.tsx";
import { Dialog, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import * as api from "./api.ts";
import { Problem, StatusPill, useLibrary } from "./shared.tsx";

const MAX_DOCUMENTS = 200;
const TYPING_MS = 250;

/** Creates or edits one set: its name, what it covers for agents, and its documents. */
export function SetDialog({ set, preselected = [], close, saved }: { set?: api.Collection; preselected?: api.Doc[]; close(): void; saved(set: api.Collection | undefined): void }) {
	const { t } = useI18n();
	const { confirm } = useFeedback();
	const { tenant } = useWorkspace();
	const { bases, baseName } = useLibrary(true);
	const [title, setTitle] = useState(set?.title ?? "");
	const [description, setDescription] = useState(set?.description ?? "");
	const [selected, setSelected] = useState(new Set([...(set?.document_ids ?? []), ...preselected.map((d) => d.id)]));
	const [filter, setFilter] = useState("");
	const [query, setQuery] = useState("");
	const [base, setBase] = useState("");
	const [onlySelected, setOnlySelected] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	// The server finds documents by title a page at a time; typing waits briefly before asking.
	useEffect(() => {
		const timer = setTimeout(() => setQuery(filter.trim()), TYPING_MS);
		return () => clearTimeout(timer);
	}, [filter]);
	const docs = usePaged(["knowledge", tenant, "picker", query, base], (cursor) => api.documentsPage(true, { title: query, base, state: "active" }, cursor), { gcTime: 0 });
	// A set holds at most 200 documents, so its own members load in full for "Show selected only".
	const members = useQuery({ queryKey: ["knowledge", tenant, "set-documents", set?.id], queryFn: () => api.setDocuments(set?.id ?? ""), enabled: set !== undefined, gcTime: 0 });
	const known = useMemo(() => {
		const map = new Map<string, api.Doc>();
		for (const d of [...(members.data ?? []), ...preselected, ...(docs.data ?? [])]) map.set(d.id, d);
		return map;
	}, [members.data, preselected, docs.data]);
	const shown = onlySelected
		? [...selected].flatMap((id) => known.get(id) ?? []).filter((d) => (!base || d.base_id === base) && d.title.toLowerCase().includes(query.toLowerCase()))
		: (docs.data ?? []);
	const toggle = (ids: string[], on: boolean) => {
		const next = new Set(selected);
		for (const id of ids) {
			if (on && next.size >= MAX_DOCUMENTS) break;
			if (on) next.add(id);
			else next.delete(id);
		}
		setSelected(next);
	};
	async function save(e: FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError("");
		try {
			saved(await api.saveCollection(set?.id ?? "", { title, description, document_ids: [...selected], revision: set?.revision ?? 0 }));
		} catch (e) {
			setError(api.message(e));
		} finally {
			setBusy(false);
		}
	}
	async function remove() {
		if (!set) return;
		const yes = await confirm({
			title: t("Delete {title}", { title: set.title }),
			body: t("Delete document set “{title}”? Its documents will be kept. Agents and searches using this set will stop finding them through it.", { title: set.title }),
			action: t("Delete set"),
			danger: true,
		});
		if (!yes) return;
		setBusy(true);
		setError("");
		try {
			await api.deleteCollection(set);
			saved(undefined);
		} catch (e) {
			setError(api.message(e));
			setBusy(false);
		}
	}
	const allShownSelected = shown.length > 0 && shown.every((d) => selected.has(d.id));
	return (
		<Dialog label={t(set ? "Edit document set" : "New document set")} onClose={busy ? undefined : close} className="dialog kn-dialog">
			<form className="kn-form" onSubmit={save}>
				<h2>{t(set ? "Edit document set" : "New document set")}</h2>
				<label>
					{t("Name")}
					<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder={t("e.g. HR policies")} />
				</label>
				<label>
					{t("What it covers")}
					<textarea
						rows={2}
						maxLength={1000}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						disabled={busy}
						placeholder={t("e.g. Leave, benefits and expense rules for all employees")}
					/>
					<span className="quiet">{t("Agents read this to decide when to search the set. Everyone in the tenant can see it.")}</span>
				</label>
				<fieldset className="kn-picker" disabled={busy}>
					<legend>
						{t("Documents")} <span className="quiet">{t("{count} of {max} selected", { count: selected.size, max: MAX_DOCUMENTS })}</span>
					</legend>
					<div className="kn-picker-filters">
						<span className="kn-search-field">
							<Search size={15} aria-hidden="true" />
							<input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Find documents")} aria-label={t("Find documents")} />
						</span>
						<select value={base} onChange={(e) => setBase(e.target.value)} aria-label={t("Knowledge base")}>
							<option value="">{t("All bases")}</option>
							{bases.data?.map((b) => (
								<option key={b.id} value={b.id}>
									{baseName(b.id)}
								</option>
							))}
						</select>
					</div>
					<div className="kn-picker-tools">
						<label className="kn-inline">
							<input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
							{t("Show selected only")}
						</label>
						<span className="spacer" />
						<button type="button" className="link" disabled={shown.length === 0} onClick={() => toggle(shown.map((d) => d.id), !allShownSelected)}>
							{t(allShownSelected ? "Clear shown" : "Select shown")}
						</button>
					</div>
					{docs.isPending && <Skeleton />}
					{docs.isError && <Problem text="Documents could not be loaded." />}
					<ul className="kn-picker-list">
						{shown.map((d) => (
							<li key={d.id}>
								<label className="kn-inline">
									<input
										type="checkbox"
										aria-label={t("Include {title}", { title: d.title })}
										checked={selected.has(d.id)}
										disabled={!selected.has(d.id) && selected.size >= MAX_DOCUMENTS}
										onChange={(e) => toggle([d.id], e.target.checked)}
									/>
									<span className="kn-picker-name">
										{d.title}
										<small>{baseName(d.base_id)}</small>
									</span>
									<StatusPill doc={d} admin />
								</label>
							</li>
						))}
						{docs.isSuccess && shown.length === 0 && <li className="quiet kn-picker-empty">{t("No documents match.")}</li>}
					</ul>
					{!onlySelected && <LoadMore list={docs} label="Show more documents" />}
					<p className="quiet">{t("Only published documents are searched. New published versions are included automatically.")}</p>
				</fieldset>
				<Problem text={error} />
				<div className="dialog-actions">
					{set && (
						<button type="button" className="ghost danger-text" disabled={busy} onClick={() => void remove()}>
							{t("Delete set")}
						</button>
					)}
					<span className="spacer" />
					<button type="button" className="ghost" disabled={busy} onClick={close}>
						{t("Cancel")}
					</button>
					<button className="primary" disabled={busy || docs.isPending || docs.isError || !title.trim()}>
						{t(set ? "Save document set" : "Create document set")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

/** Adds the chosen documents to a set, or starts a new set from them. */
export function AddToSet({ ids, sets, done, create }: { ids: string[]; sets: api.Collection[]; done(message: string): void; create(): void }) {
	const { t } = useI18n();
	const [busy, setBusy] = useState("");
	async function add(set: api.Collection) {
		setBusy(set.id);
		try {
			await api.changeMembership(set.id, ids);
			done(t("Added to {title}.", { title: set.title }));
		} catch (e) {
			done(t(api.message(e)));
		} finally {
			setBusy("");
		}
	}
	return (
		<>
			{sets.map((set) => (
				<button key={set.id} type="button" disabled={busy !== ""} onClick={() => void add(set)}>
					{set.title}
				</button>
			))}
			<button type="button" disabled={busy !== ""} onClick={create}>
				<FolderPlus size={15} aria-hidden="true" />
				{t("New set from selection")}
			</button>
		</>
	);
}
