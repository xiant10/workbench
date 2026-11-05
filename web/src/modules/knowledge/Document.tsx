import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronLeft, Download, FilePen, FileUp, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { request } from "../../lib/api.ts";
import { navigateOptions } from "../../lib/layout.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore } from "../../lib/paged.tsx";
import { Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import * as api from "./api.ts";
import { ingestionErrorLabel, processingLabel } from "./labels.ts";
import { Problem, StatusPill, useLibrary } from "./shared.tsx";
import { AskAgent } from "./AskAgent.tsx";
import { UploadDialog } from "./Upload.tsx";

type Tab = "content" | "versions" | "sets";

export function Document({ id, admin, back }: { id: string; admin: boolean; back(): void }) {
	const { confirm, toast } = useFeedback();
	const { t, dateTime } = useI18n();
	const { tenant } = useWorkspace();
	const client = useQueryClient();
	const { sets, setsOf, baseName } = useLibrary(admin);
	const [tab, setTab] = useState<Tab>("content");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [replace, setReplace] = useState(false);
	const [preview, setPreview] = useState(0);
	const [compare, setCompare] = useState(0);
	const [rename, setRename] = useState<string | null>(null);
	const [asking, setAsking] = useState(false);
	const d = useQuery({ gcTime: 0, queryKey: ["knowledge", tenant, "doc", id], queryFn: () => api.detail(id), enabled: admin, refetchInterval: 3000 });
	// Member metadata contains only the current publication.
	const member = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "member-doc", id],
		queryFn: () => request<api.Doc>(`${api.root}/documents/${id}`),
		enabled: !admin,
	});
	const doc = admin ? d.data : member.data;
	const vs = useQuery({ gcTime: 0, queryKey: ["knowledge", tenant, "versions", id], queryFn: () => api.versions(id), enabled: admin, refetchInterval: 3000 });
	const selected = preview || doc?.published_version || doc?.latest_version || 0;
	const v = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "version", id, selected, admin],
		queryFn: () => api.version(id, selected, admin),
		enabled: selected > 0,
		refetchInterval: (q) => (admin && (q.state.data?.state === "queued" || q.state.data?.state === "processing") ? 3000 : false),
	});
	const other = useQuery({ gcTime: 0, queryKey: ["knowledge", tenant, "version", id, compare, admin], queryFn: () => api.version(id, compare, admin), enabled: compare > 0 });
	const refresh = () => client.invalidateQueries({ queryKey: ["knowledge", tenant] });
	async function act(action: string, n = 0, title?: string) {
		if (!doc) return;
		const dangerous = action === "delete" || action === "discard";
		if (
			dangerous &&
			!(await confirm({
				title: t(action === "delete" ? "Move to trash" : "Discard draft"),
				body: t(
					action === "delete"
						? "Move this document to trash? It will immediately disappear from member search, agents and source access."
						: "Discard this unpublished version?",
				),
				action: t(action === "delete" ? "Move to trash" : "Discard draft"),
				danger: true,
			}))
		)
			return;
		setBusy(true);
		setError("");
		try {
			await api.change(doc, action, n, title);
			setRename(null);
			if (action === "publish" || action === "rollback") setPreview(0);
		} catch (e) {
			setError(api.message(e));
		} finally {
			await refresh();
			setBusy(false);
		}
	}
	async function toggleSet(set: api.Collection, on: boolean) {
		setBusy(true);
		setError("");
		try {
			await api.changeMembership(set.id, on ? [id] : [], on ? [] : [id]);
			toast(t(on ? "Added to {title}." : "Removed from {title}.", { title: set.title }));
			await refresh();
		} catch (e) {
			setError(api.message(e));
		} finally {
			setBusy(false);
		}
	}
	const failed = d.isError || member.isError || vs.isError;
	const tabs: Tab[] = admin ? ["content", "versions", "sets"] : ["content"];
	const memberOf = setsOf.get(id) ?? [];
	// The newest version waiting for its first publication, if any.
	const draft = vs.data?.versions.find((x) => x.version === doc?.latest_version && x.state === "ready" && !x.ever_published && x.version !== doc?.published_version);
	return (
		<section className="kn-detail">
			<button type="button" className="crumb link-reset" onClick={back}>
				<ChevronLeft size={15} aria-hidden="true" />
				{t("All documents")}
			</button>
			<Problem text={error || (failed ? "Document unavailable. Refresh or return to the list." : "")} />
			{!doc ? (
				!failed && <Skeleton rows={4} />
			) : (
				<>
					<header className="kn-detail-head">
						<div className="kn-detail-title">
							{rename === null ? (
								<h1>{doc.title}</h1>
							) : (
								<form
									className="add-row"
									onSubmit={(e) => {
										e.preventDefault();
										void act("rename", 0, rename);
									}}
								>
									<input required maxLength={200} value={rename} aria-label={t("New title")} onChange={(e) => setRename(e.target.value)} autoFocus />
									<button className="primary" disabled={busy}>
										{t("Save")}
									</button>
									<button type="button" className="ghost" onClick={() => setRename(null)}>
										{t("Cancel")}
									</button>
								</form>
							)}
							<div className="kn-meta">
								<StatusPill doc={doc} admin={admin} />
								<span>{baseName(doc.base_id)}</span>
								<span>{t("Updated {when}", { when: dateTime(doc.updated_at) })}</span>
								{memberOf.map((s) => (
									<span key={s.id} className="chip muted">
										{s.title}
									</span>
								))}
							</div>
						</div>
						{!admin && doc.state !== "deleted" && (
							<div className="kn-actions">
								<button type="button" className="primary" onClick={() => setAsking(true)}>
									<Bot size={15} aria-hidden="true" />
									{t("Ask an agent")}
								</button>
							</div>
						)}
						{admin && (
							<div className="kn-actions">
								{doc.state === "deleted" ? (
									<button type="button" className="primary" disabled={busy} onClick={() => void act("restore")}>
										<Undo2 size={15} aria-hidden="true" />
										{t("Restore as unpublished")}
									</button>
								) : (
									<>
										{doc.published_version > 0 && (
											<button type="button" className="ghost" onClick={() => setAsking(true)}>
												<Bot size={15} aria-hidden="true" />
												{t("Ask an agent")}
											</button>
										)}
										<button type="button" className="primary" onClick={() => setReplace(true)}>
											<FileUp size={15} aria-hidden="true" />
											{t("Upload new version")}
										</button>
										<button type="button" className="ghost" onClick={() => setRename(doc.title)}>
											<FilePen size={15} aria-hidden="true" />
											{t("Rename")}
										</button>
										{doc.published_version > 0 && (
											<button type="button" className="ghost" disabled={busy} onClick={() => void act("unpublish")}>
												{t("Unpublish")}
											</button>
										)}
										<button type="button" className="ghost danger-text" disabled={busy} onClick={() => void act("delete")}>
											<Trash2 size={15} aria-hidden="true" />
											{t("Move to trash")}
										</button>
									</>
								)}
							</div>
						)}
					</header>
					{admin && doc.state !== "deleted" && draft && (
						<div className="banner card-banner">
							{t("Version {version} is ready and not yet published.", { version: draft.version })}
							<button type="button" className="link" disabled={busy} onClick={() => void act("publish", draft.version)}>
								{t("Publish v{version}", { version: draft.version })}
							</button>
						</div>
					)}
					{doc.state !== "deleted" && memberOf.length === 0 && sets.isSuccess && (
						<p className="kn-agent-note">
							<Bot size={15} aria-hidden="true" />
							{t("This document isn't in a document set. Agents still find it through its knowledge base, unless an admin limited them to chosen sets.")}
						</p>
					)}
					{asking && <AskAgent scope={{ kind: "document", doc, sets: memberOf }} close={() => setAsking(false)} />}
					{tabs.length > 1 && (
						<div className="tabs" role="tablist" onKeyDown={navigateOptions}>
							{tabs.map((name) => (
								<button key={name} type="button" role="tab" tabIndex={tab === name ? 0 : -1} aria-selected={tab === name} className={tab === name ? "tab active" : "tab"} onClick={() => setTab(name)}>
									{t({ content: "Content", versions: "Versions", sets: "Document sets" }[name])}
									{name === "versions" && vs.data ? <span className="kn-count">{vs.data.versions.length}</span> : null}
									{name === "sets" ? <span className="kn-count">{memberOf.length}</span> : null}
								</button>
							))}
						</div>
					)}
					{tab === "content" && selected > 0 && (
						<div className="kn-content">
							<div className="kn-content-bar">
								<strong>
									{t("Version {version}", { version: selected })}
									{doc.published_version !== selected ? t(" · not the current publication") : ""}
								</strong>
								{admin && (
									<label className="kn-inline">
										{t("Compare with")}
										<select value={compare} onChange={(e) => setCompare(Number(e.target.value))}>
											<option value={0}>{t("No comparison")}</option>
											{vs.data?.versions
												.filter((x) => x.state === "ready" && x.version !== selected)
												.map((x) => (
													<option key={x.version} value={x.version}>
														{t("Version {version}", { version: x.version })}
													</option>
												))}
										</select>
									</label>
								)}
								<span className="spacer" />
								{v.data && (
									<a className="button ghost small" href={api.source(id, selected, admin)} download>
										<Download size={14} aria-hidden="true" />
										{t("Download original ({filename})", { filename: v.data.filename })}
									</a>
								)}
							</div>
							<Problem text={v.isError ? "This version is unavailable." : ""} />
							{v.data && v.data.state !== "ready" && (
								<p className="banner card-banner">
									{t("Processing: {state}.", { state: t(processingLabel(v.data.state)) })} {t(ingestionErrorLabel(v.data.error_code))}
								</p>
							)}
							{v.isPending ? (
								<Skeleton rows={6} />
							) : (
								<div className={compare ? "kn-compare" : ""}>
									<pre className="kn-text">{v.data?.text || t("No extracted text available.")}</pre>
									{compare > 0 && (
										<div>
											<p className="quiet">{t("Version {version}", { version: compare })}</p>
											<Problem text={other.isError ? "Comparison unavailable." : ""} />
											<pre className="kn-text">{other.data?.text ?? t("Loading…")}</pre>
										</div>
									)}
								</div>
							)}
							{compare > 0 && <p className="quiet">{t("Side-by-side extracted text. Download originals to review layout and table changes.")}</p>}
						</div>
					)}
					{tab === "versions" && admin && (
						<ul className="rows">
							{vs.data?.versions.map((x) => (
								<li key={x.version} className="row">
									<div className="row-main">
										<span className="kn-row-title">
											{t("Version {version}", { version: x.version })}
											{doc.published_version === x.version && <span className="pill kn-live">{t("Published")}</span>}
											{doc.published_version !== x.version && x.ever_published && <span className="pill">{t("Previously published")}</span>}
											{x.state !== "ready" && <span className={x.state === "failed" ? "pill kn-failed" : "pill kn-busy"}>{t(processingLabel(x.state))}</span>}
										</span>
										<span className="quiet">
											{t("{filename} · uploaded {when}", { filename: x.filename, when: dateTime(x.created_at) })}
											{x.change_note ? ` · ${x.change_note}` : ""}
										</span>
										{x.error_code && <span className="inline-error">{t(ingestionErrorLabel(x.error_code))}</span>}
									</div>
									<div className="row-actions">
										{x.state !== "discarded" && (
											<button
												type="button"
												className="ghost small"
												onClick={() => {
													setPreview(x.version);
													setTab("content");
												}}
											>
												{t("Preview v{version}", { version: x.version })}
											</button>
										)}
										{doc.state !== "deleted" && (
											<>
												{x.state === "ready" && doc.published_version !== x.version && (
													<button type="button" className="primary small" disabled={busy} onClick={() => void act(x.ever_published ? "rollback" : "publish", x.version)}>
														{x.ever_published && <RotateCcw size={13} aria-hidden="true" />}
														{t(x.ever_published ? "Roll back v{version}" : "Publish v{version}", { version: x.version })}
													</button>
												)}
												{x.state === "failed" && (
													<button type="button" className="ghost small" disabled={busy} onClick={() => void act("retry", x.version)}>
														{t("Retry v{version}", { version: x.version })}
													</button>
												)}
												{!x.ever_published && x.state !== "discarded" && doc.published_version !== x.version && (
													<button type="button" className="ghost small danger-text" disabled={busy} onClick={() => void act("discard", x.version)}>
														{t("Discard v{version}", { version: x.version })}
													</button>
												)}
											</>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
					{tab === "sets" && admin && (
						<div className="card kn-card">
							<p className="quiet">{t("Agents search one or more sets at a time. Add this document to every set where it should be found.")}</p>
							{sets.data?.length === 0 && <p>{t("No document sets yet. Create one from the Knowledge sidebar.")}</p>}
							<ul className="kn-set-toggles">
								{sets.data?.map((s) => (
									<li key={s.id}>
										<label className="kn-inline">
											<input type="checkbox" checked={s.document_ids.includes(id)} disabled={busy} onChange={(e) => void toggleSet(s, e.target.checked)} />
											<span className="kn-picker-name">
												{s.title}
												{s.description && <small>{s.description}</small>}
											</span>
										</label>
									</li>
								))}
							</ul>
							<LoadMore list={sets} label="Show more sets" className="link" />
						</div>
					)}
					{replace && doc.state !== "deleted" && (
						<UploadDialog
							defaultBase={doc.base_id}
							doc={doc}
							done={(uploaded) => {
								setReplace(false);
								if (uploaded) toast(t("New version uploaded. It's processing now."));
								void refresh();
							}}
						/>
					)}
				</>
			)}
		</section>
	);
}
