import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, BookOpen, Bot, ChevronDown, Database, FileText, FolderOpen, Layers, Library as LibraryIcon, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore, usePaged } from "../../lib/paged.tsx";
import { Dialog, Empty, Menu, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import * as api from "./api.ts";
import { Document } from "./Document.tsx";
import { AgentAccess } from "./AgentAccess.tsx";
import { AskAgent } from "./AskAgent.tsx";
import { AddToSet, SetDialog } from "./DocumentSets.tsx";
import { activityLabel } from "./labels.ts";
import { Highlight, Problem, StatusPill, useLibrary } from "./shared.tsx";
import { UploadDialog } from "./Upload.tsx";
import "./knowledge.css";

const BASES_SHOWN = 5;

type View = { kind: "all" } | { kind: "set"; id: string } | { kind: "base"; id: string } | { kind: "trash" } | { kind: "activity" } | { kind: "agents" };

export function KnowledgeAdmin() {
	const { tenant } = useWorkspace();
	return <Library key={tenant} admin />;
}
export function KnowledgePage() {
	const { tenant, isAdmin } = useWorkspace();
	return (
		<div className="page kn-page">
			<Library key={tenant} admin={isAdmin} />
		</div>
	);
}

function Library({ admin }: { admin: boolean }) {
	const { t } = useI18n();
	const { toast } = useFeedback();
	const { tenant } = useWorkspace();
	const client = useQueryClient();
	const { bases, sets, baseName } = useLibrary(admin);
	const [view, setView] = useState<View>({ kind: "all" });
	// The open document is in the address, so an agent's citation can link to it and Back returns to the list.
	const [params, setParams] = useSearchParams();
	const open = params.get("doc") ?? "";
	const setOpen = (id: string) =>
		setParams((current) => {
			const next = new URLSearchParams(current);
			if (id) next.set("doc", id);
			else next.delete("doc");
			return next;
		});
	const [editing, setEditing] = useState<{ set?: api.Collection; preselected?: api.Doc[] }>();
	const [uploading, setUploading] = useState(false);
	const [addingBase, setAddingBase] = useState(false);
	const refresh = () => client.invalidateQueries({ queryKey: ["knowledge", tenant] });
	const go = (next: View) => {
		setView(next);
		setOpen("");
	};
	// Read on its own: a set just created may sit on a page the sidebar hasn't loaded.
	const current = useQuery({
		queryKey: ["knowledge", tenant, "set", admin, view.kind === "set" ? view.id : ""],
		queryFn: () => api.collection(admin, view.kind === "set" ? view.id : ""),
		enabled: view.kind === "set",
		retry: false,
		gcTime: 0,
	});
	const set = view.kind === "set" ? current.data : undefined;
	const [allBases, setAllBases] = useState(false);
	// Bases are storage; sets are how people find things, so bases stay compact.
	const shownBases = (bases.data ?? []).filter((b, i) => allBases || i < BASES_SHOWN || (view.kind === "base" && view.id === b.id));
	if (open)
		return (
			<Document
				key={open}
				id={open}
				admin={admin}
				back={() => {
					setOpen("");
					void refresh();
				}}
			/>
		);
	const navItem = (key: string, label: string, Icon: typeof BookOpen, next: View, count?: number) => {
		const active = JSON.stringify(view) === JSON.stringify(next);
		return (
			<li key={key}>
				<button type="button" className={active ? "kn-nav-item active" : "kn-nav-item"} title={label} aria-current={active ? "page" : undefined} onClick={() => go(next)}>
					<Icon size={15} aria-hidden="true" />
					<span className="kn-nav-label">{label}</span>
					{count !== undefined && <span className="kn-count">{count}</span>}
				</button>
			</li>
		);
	};
	return (
		<div className="kn-layout">
			<nav className="kn-nav" aria-label={t("Knowledge library")}>
				<ul>{navItem("all", t("All documents"), LibraryIcon, { kind: "all" })}</ul>
				<div className="kn-nav-head">
					<h2>{t("Document sets")}</h2>
					{admin && (
						<button type="button" className="icon-button" aria-label={t("New document set")} title={t("New document set")} onClick={() => setEditing({})}>
							<Plus size={15} aria-hidden="true" />
						</button>
					)}
				</div>
				<ul>
					{sets.data?.map((s) => navItem(s.id, s.title, Layers, { kind: "set", id: s.id }, s.document_ids.length))}
					<li>
						<LoadMore list={sets} label="Show more sets" className="link kn-nav-more" />
					</li>
					{sets.isSuccess && sets.data?.length === 0 && (
						<li className="kn-nav-empty quiet">
							{t(admin ? "Group documents so people and agents can search just what's relevant." : "No document sets yet.")}
						</li>
					)}
				</ul>
				<div className="kn-nav-head">
					<h2>{t("Knowledge bases")}</h2>
					{admin && (
						<button type="button" className="icon-button" aria-label={t("New knowledge base")} title={t("New knowledge base")} onClick={() => setAddingBase(true)}>
							<Plus size={15} aria-hidden="true" />
						</button>
					)}
				</div>
				<ul>
					{shownBases.map((b) => navItem(b.id, baseName(b.id), Database, { kind: "base", id: b.id }))}
					{allBases && (
						<li>
							<LoadMore list={bases} label="Show more bases" className="link kn-nav-more" />
						</li>
					)}
					{((bases.data?.length ?? 0) > BASES_SHOWN || bases.hasMore) && (
						<li>
							<button type="button" className="link kn-nav-more" onClick={() => setAllBases(!allBases)}>
								{t(allBases ? "Show fewer" : "Show all bases")}
							</button>
						</li>
					)}
				</ul>
				{admin && (
					<>
						<div className="kn-nav-head">
							<h2>{t("Manage")}</h2>
						</div>
						<ul>
							{navItem("agents", t("Agent access"), Bot, { kind: "agents" })}
							{navItem("trash", t("Trash"), Trash2, { kind: "trash" })}
							{navItem("activity", t("Activity"), ActivityIcon, { kind: "activity" })}
						</ul>
					</>
				)}
			</nav>
			<div className="kn-main">
				<Problem text={bases.isError || sets.isError ? "Knowledge could not be loaded. Try refreshing the page." : ""} />
				{view.kind === "activity" ? (
					<Activity />
				) : view.kind === "agents" ? (
					<AgentAccess />
				) : (
					<Documents
						key={JSON.stringify(view)}
						admin={admin}
						view={view}
						set={set}
						setMissing={current.isError}
						sets={sets.data ?? []}
						baseName={baseName}
						open={setOpen}
						upload={() => setUploading(true)}
						editSet={(s, preselected) => setEditing({ set: s, preselected })}
						canUpload={(bases.data?.length ?? 0) > 0}
					/>
				)}
			</div>
			{editing && (
				<SetDialog
					set={editing.set}
					preselected={editing.preselected}
					close={() => setEditing(undefined)}
					saved={(saved) => {
						setEditing(undefined);
						void refresh();
						if (saved) {
							toast(t("Saved {title}.", { title: saved.title }));
							go({ kind: "set", id: saved.id });
						} else go({ kind: "all" });
					}}
				/>
			)}
			{uploading && (
				<UploadDialog
					defaultBase={view.kind === "base" ? view.id : ""}
					defaultSet={view.kind === "set" ? view.id : undefined}
					done={(uploaded) => {
						setUploading(false);
						if (uploaded) toast(t("Uploaded. Documents appear here as processing finishes."));
						void refresh();
					}}
				/>
			)}
			{addingBase && (
				<NewBase
					close={(id) => {
						setAddingBase(false);
						void refresh();
						if (id) go({ kind: "base", id });
					}}
				/>
			)}
		</div>
	);
}

type DocumentsProps = {
	admin: boolean;
	view: View;
	set?: api.Collection;
	setMissing: boolean;
	sets: api.Collection[];
	baseName(id: string): string;
	open(id: string): void;
	upload(): void;
	editSet(set: api.Collection | undefined, preselected?: api.Doc[]): void;
	canUpload: boolean;
};

function Documents({ admin, view, set, setMissing, sets, baseName, open, upload, editSet, canUpload }: DocumentsProps) {
	const { t, dateTime } = useI18n();
	const { toast } = useFeedback();
	const { tenant } = useWorkspace();
	const client = useQueryClient();
	const { setsOf } = useLibrary(admin);
	const [query, setQuery] = useState("");
	const [term, setTerm] = useState("");
	const [checked, setChecked] = useState(new Set<string>());
	const [asking, setAsking] = useState(false);
	const trash = view.kind === "trash";
	const base = view.kind === "base" ? view.id : "";
	const collection = view.kind === "set" ? view.id : "";
	// Polls fast only while something is processing, since every loaded page is re-read.
	const docs = usePaged(
		["knowledge", tenant, "list", admin, base, trash, collection],
		(cursor) => api.documentsPage(admin, { base, collection, state: trash ? "deleted" : "active" }, cursor),
		{ gcTime: 0, refetchInterval: (items) => (!admin ? false : items?.some((d) => d.processing === "queued" || d.processing === "processing") ? 3000 : 30000) },
	);
	const hits = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "search", term, base, collection],
		queryFn: () => api.search(term, base, collection),
		enabled: term.length > 0,
	});
	const scopeName = set?.title ?? (base ? baseName(base) : t("all documents"));
	const search = (e: FormEvent) => {
		e.preventDefault();
		if (query.trim() === term && term) void hits.refetch();
		setTerm(query.trim());
	};
	const select = (id: string, on: boolean) => {
		const next = new Set(checked);
		if (on) next.add(id);
		else next.delete(id);
		setChecked(next);
	};
	async function removeFromSet() {
		if (!set) return;
		try {
			await api.changeMembership(set.id, [], [...checked]);
			toast(t("Removed from {title}.", { title: set.title }));
			setChecked(new Set());
		} catch (e) {
			toast(t(api.message(e)));
		}
		void client.invalidateQueries({ queryKey: ["knowledge", tenant] });
	}
	const list = docs.data ?? [];
	const heading = trash ? t("Trash") : set ? set.title : base ? baseName(base) : t("All documents");
	const missingSet = setMissing;
	return (
		<>
			<header className="kn-head">
				<div className="kn-head-text">
					<h1>{heading}</h1>
					{set ? (
						<p className="quiet">{set.description || t(admin ? "No description yet. Add one so agents know when to use this set." : "A document set.")}</p>
					) : (
						<p className="quiet">
							{t(trash ? "Trashed documents are hidden from everyone. Restore one to manage it again." : "Published documents are visible to everyone in this tenant.")}
						</p>
					)}
				</div>
				{admin && !trash && (
					<div className="kn-actions">
						{set && (
							<button type="button" className="ghost" onClick={() => editSet(set)}>
								<Pencil size={15} aria-hidden="true" />
								{t("Edit set")}
							</button>
						)}
						<button type="button" className="primary" disabled={!canUpload} onClick={upload}>
							<Upload size={15} aria-hidden="true" />
							{t("Upload")}
						</button>
					</div>
				)}
			</header>
			{set && (
				<div className="kn-agent-note">
					<Bot size={15} aria-hidden="true" />
					<span>{t("Agents search this set when a question fits its description, or when you ask them to use “{title}”.", { title: set.title })}</span>
					<button type="button" className="primary small" onClick={() => setAsking(true)}>
						{t("Ask an agent")}
					</button>
				</div>
			)}
			{missingSet && <Problem text="This document set is no longer available." />}
			{asking && set && <AskAgent scope={{ kind: "set", set }} close={() => setAsking(false)} />}
			{!trash && !missingSet && (
				<form className="kn-search" onSubmit={search} role="search">
					<Search size={17} aria-hidden="true" />
					<input
						type="search"
						value={query}
						maxLength={500}
						onChange={(e) => {
							setQuery(e.target.value);
							if (!e.target.value) setTerm("");
						}}
						placeholder={t("Search in {scope}", { scope: scopeName })}
						aria-label={t("Search published text")}
					/>
					{term && (
						<button
							type="button"
							className="icon-button"
							aria-label={t("Clear search")}
							onClick={() => {
								setTerm("");
								setQuery("");
							}}
						>
							<X size={15} aria-hidden="true" />
						</button>
					)}
					<button className="primary small">{t("Search")}</button>
				</form>
			)}
			{term ? (
				<section className="kn-hits" aria-label={t("Search results")}>
					<p className="quiet">{t("Matches for “{term}” in {scope}. Only published content is searched.", { term, scope: scopeName })}</p>
					<Problem text={hits.isError ? "Search scope is unavailable. Check the selected set or try again." : ""} />
					{hits.isPending && <Skeleton rows={4} />}
					{hits.data?.results.length === 0 && <Empty icon={Search} title={t("No matching passages.")} />}
					<ul className="kn-hit-list">
						{!hits.isError &&
							hits.data?.results.map((h) => (
								<li key={h.id}>
									<button type="button" className="kn-hit" onClick={() => open(h.id)}>
										<span className="kn-row-title">
											<FileText size={15} aria-hidden="true" />
											{h.title}
											<span className="quiet">{t("v{version}", { version: h.version })}</span>
										</span>
										<span className="kn-excerpt">
											<Highlight text={h.text} term={term} />
										</span>
									</button>
								</li>
							))}
					</ul>
				</section>
			) : (
				!missingSet && (
					<section aria-label={t("Documents")}>
						{admin && checked.size > 0 && (
							<div className="kn-bulk" role="toolbar" aria-label={t("Selected documents")}>
								<strong>{t("{count} selected", { count: checked.size })}</strong>
								<Menu
									label={t("Add to set")}
									triggerClass="ghost small"
									trigger={
										<>
											<FolderOpen size={14} aria-hidden="true" />
											{t("Add to set")}
											<ChevronDown size={14} aria-hidden="true" />
										</>
									}
								>
									{(close) => (
										<AddToSet
											ids={[...checked]}
											sets={sets.filter((s) => s.id !== set?.id)}
											done={(message) => {
												close();
												toast(message);
												setChecked(new Set());
												void client.invalidateQueries({ queryKey: ["knowledge", tenant] });
											}}
											create={() => {
												close();
												editSet(undefined, list.filter((d) => checked.has(d.id)));
											}}
										/>
									)}
								</Menu>
								{set && (
									<button type="button" className="ghost small" onClick={() => void removeFromSet()}>
										{t("Remove from this set")}
									</button>
								)}
								<span className="spacer" />
								<button type="button" className="link" onClick={() => setChecked(new Set())}>
									{t("Clear selection")}
								</button>
							</div>
						)}
						{docs.isPending && <Skeleton rows={5} />}
						{docs.isError && <Problem text="Documents could not be loaded. Try again." />}
						{docs.isSuccess && list.length === 0 && (
							<Empty icon={trash ? Trash2 : set ? Layers : BookOpen} title={t(trash ? "Trash is empty." : set ? "This set has no documents yet." : admin ? "No documents yet." : "No published documents yet.")}>
								{admin && !trash && (
									<div className="kn-actions">
										{set ? (
											<button type="button" className="ghost" onClick={() => editSet(set)}>
												{t("Choose documents")}
											</button>
										) : null}
										<button type="button" className="primary" disabled={!canUpload} onClick={upload}>
											<Upload size={15} aria-hidden="true" />
											{t("Upload documents")}
										</button>
									</div>
								)}
							</Empty>
						)}
						{list.length > 0 && (
							<ul className="rows kn-rows">
								{list.map((d) => (
									<li key={d.id} className={checked.has(d.id) ? "row kn-row checked" : "row kn-row"}>
										{admin && !trash && (
											<input type="checkbox" className="kn-check" aria-label={t("Select {title}", { title: d.title })} checked={checked.has(d.id)} onChange={(e) => select(d.id, e.target.checked)} />
										)}
										<span className="row-icon">
											<FileText size={15} aria-hidden="true" />
										</span>
										<button type="button" className="row-main as-button" onClick={() => open(d.id)}>
											<span className="kn-row-title">{d.title}</span>
											<span className="kn-row-meta">
												{!base && <span>{baseName(d.base_id)}</span>}
												{(setsOf.get(d.id) ?? [])
													.filter((s) => s.id !== set?.id)
													.map((s) => (
														<span key={s.id} className="chip muted">
															{s.title}
														</span>
													))}
											</span>
										</button>
										<div className="row-actions">
											<StatusPill doc={d} admin={admin} />
											<span className="due">{dateTime(d.updated_at)}</span>
										</div>
									</li>
								))}
							</ul>
						)}
						<LoadMore list={docs} label="Show more documents" />
					</section>
				)
			)}
		</>
	);
}

function NewBase({ close }: { close(id?: string): void }) {
	const { t } = useI18n();
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	async function submit(e: FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError("");
		try {
			close((await api.createBase(title)).id);
		} catch (e) {
			setError(api.message(e));
			setBusy(false);
		}
	}
	return (
		<Dialog label={t("New knowledge base")} onClose={busy ? undefined : () => close()}>
			<form className="kn-form" onSubmit={submit}>
				<h2>{t("New knowledge base")}</h2>
				<p className="dialog-body">{t("A base is where documents are stored. To group documents for search and agents, use document sets instead.")}</p>
				<label>
					{t("Name")}
					<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Company knowledge")} required autoFocus />
				</label>
				<Problem text={error} />
				<div className="dialog-actions">
					<button type="button" className="ghost" disabled={busy} onClick={() => close()}>
						{t("Cancel")}
					</button>
					<button className="primary" disabled={busy || !title.trim()}>
						{t("Create base")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

function Activity() {
	const { t, dateTime } = useI18n();
	const { tenant } = useWorkspace();
	const q = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "activity"],
		queryFn: () => request<{ activity: { id: string; actor: string; action: string; target: string; at: string }[] }>(`${api.root}/admin/activity`),
		refetchInterval: 10000,
	});
	return (
		<>
			<header className="kn-head">
				<div className="kn-head-text">
					<h1>{t("Activity")}</h1>
					<p className="quiet">{t("The latest 100 changes to knowledge in this tenant.")}</p>
				</div>
			</header>
			<Problem text={q.isError ? "Activity could not be loaded." : ""} />
			{q.isPending && <Skeleton rows={5} />}
			<ul className="rows">
				{q.data?.activity.map((a) => (
					<li key={a.id} className="row">
						<div className="row-main">
							<span>{t(activityLabel(a.action))}</span>
							<span className="quiet">
								{a.actor} · {a.target}
							</span>
						</div>
						<span className="due">{dateTime(a.at)}</span>
					</li>
				))}
			</ul>
		</>
	);
}
