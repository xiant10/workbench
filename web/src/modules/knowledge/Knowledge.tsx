import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { request } from "../../lib/api.ts";
import { useWorkspace } from "../../shell/workspace.ts";
import * as api from "./api.ts";
import "./knowledge.css";

export function KnowledgeAdmin() {
	const { tenant } = useWorkspace();
	return <Library key={tenant} admin />;
}
export function KnowledgePage() {
	const { tenant } = useWorkspace();
	return (
		<div className="page">
			<h1>Knowledge</h1>
			<Library key={tenant} admin={false} />
		</div>
	);
}
function Problem({ text }: { text: string }) {
	return text ? (
		<p role="alert" className="knowledge-error">
			{text}
		</p>
	) : null;
}
function Library({ admin }: { admin: boolean }) {
	const { tenant, isAdmin } = useWorkspace();
	const client = useQueryClient();
	const [base, setBase] = useState("");
	const [trash, setTrash] = useState(false);
	const [cursor, setCursor] = useState("");
	const [selected, setSelected] = useState("");
	const [uploading, setUploading] = useState(false);
	const [newBase, setNewBase] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const [query, setQuery] = useState("");
	const [term, setTerm] = useState("");
	const b = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "bases"],
		queryFn: api.bases,
	});
	const docs = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "list", admin, base, trash, cursor],
		queryFn: () => api.list(admin, base, trash ? "deleted" : "active", cursor),
		refetchInterval: admin ? 3000 : false,
	});
	const hits = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "search", term, base],
		queryFn: () => api.search(term, base),
		enabled: term.length > 0,
	});
	const refresh = () => void client.invalidateQueries({ queryKey: ["knowledge", tenant] });
	async function addBase(e: FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError("");
		try {
			const created = await api.createBase(newBase);
			setNewBase("");
			setBase(created.id);
			setCursor("");
			refresh();
		} catch (e) {
			setError(api.message(e));
		} finally {
			setSaving(false);
		}
	}
	if (selected)
		return (
			<Document
				key={selected}
				id={selected}
				admin={admin}
				back={() => {
					setSelected("");
					refresh();
				}}
			/>
		);
	return (
		<section className="knowledge">
			<div className="knowledge-toolbar">
				<div>
					<h2>{admin ? "Knowledge documents" : "Company knowledge"}</h2>
					<p className="quiet">Published documents are visible to everyone in this tenant.</p>
				</div>
				{!admin && isAdmin && <Link to={`/t/${tenant}/admin?tab=knowledge`}>Manage documents</Link>}
			</div>
			<Problem text={error || (b.isError || docs.isError ? "Knowledge could not be loaded. Try refreshing the page." : "")} />
			{admin && (
				<form className="knowledge-toolbar" onSubmit={addBase}>
					<label>
						New knowledge base{" "}
						<input value={newBase} maxLength={200} onChange={(e) => setNewBase(e.target.value)} placeholder="e.g. Company knowledge" required />
					</label>
					<button disabled={saving || !newBase.trim()} type="submit">
						Create base
					</button>
				</form>
			)}
			<div className="knowledge-toolbar">
				<label>
					Knowledge base{" "}
					<select
						value={base}
						onChange={(e) => {
							setBase(e.target.value);
							setCursor("");
						}}
					>
						<option value="">All bases</option>
						{b.data?.map((x) => (
							<option key={x.id} value={x.id}>
								{x.title}
							</option>
						))}
					</select>
				</label>
				{admin && (
					<>
						<label>
							<input
								type="checkbox"
								checked={trash}
								onChange={(e) => {
									setTrash(e.target.checked);
									setCursor("");
								}}
							/>{" "}
							Show trash
						</label>
						<button className="primary" disabled={!b.data?.length} onClick={() => setUploading(!uploading)}>
							Upload documents
						</button>
					</>
				)}
			</div>
			{uploading && (
				<Upload
					bases={b.data ?? []}
					defaultBase={base}
					done={() => {
						setUploading(false);
						refresh();
					}}
				/>
			)}
			{!admin && (
				<form
					className="knowledge-toolbar"
					onSubmit={(e) => {
						e.preventDefault();
						if (query.trim() === term && term) void hits.refetch();
						setTerm(query.trim());
					}}
				>
					<label>
						Search published text <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={500} />
					</label>
					<button>Search</button>
					{term && (
						<button
							type="button"
							onClick={() => {
								setTerm("");
								setQuery("");
							}}
						>
							Clear search
						</button>
					)}
				</form>
			)}
			{term ? (
				<>
					<Problem text={hits.isError ? "Search is unavailable. Try again." : ""} />
					{hits.isPending ? (
						<p>Searching…</p>
					) : hits.data?.results.length === 0 ? (
						<p>No matching passages.</p>
					) : (
						hits.data?.results.map((h) => (
							<article className="knowledge-card" key={h.id}>
								<button className="ghost" onClick={() => setSelected(h.id)}>
									{h.title} · v{h.version}
								</button>
								<p className="knowledge-excerpt">{h.text}</p>
							</article>
						))
					)}
				</>
			) : (
				<>
					{docs.isPending ? (
						<p>Loading documents…</p>
					) : docs.data?.documents.length === 0 ? (
						<p>{trash ? "Trash is empty." : admin ? "No documents yet. Create a base, then upload your first document." : "No published documents yet."}</p>
					) : (
						<div className="knowledge-table">
							<table>
								<thead>
									<tr>
										<th>Document</th>
										<th>Published</th>
										{admin && (
											<>
												<th>Newest version</th>
												<th>Processing</th>
											</>
										)}
										<th>Updated</th>
									</tr>
								</thead>
								<tbody>
									{docs.data?.documents.map((d) => (
										<tr key={d.id}>
											<td>
												<button className="ghost" onClick={() => setSelected(d.id)}>
													{d.title}
												</button>
											</td>
											<td>{d.published_version ? `v${d.published_version}` : "Unpublished"}</td>
											{admin && (
												<>
													<td>v{d.latest_version}</td>
													<td>{d.processing}</td>
												</>
											)}
											<td>{new Date(d.updated_at).toLocaleString()}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<div className="knowledge-toolbar">
						{cursor && <button onClick={() => setCursor("")}>First page</button>}
						{docs.data?.next_cursor && <button onClick={() => setCursor(docs.data!.next_cursor!)}>Next page</button>}
					</div>
				</>
			)}
			{admin && <Activity />}
		</section>
	);
}
function Upload({ bases, defaultBase, doc, done }: { bases: api.Base[]; defaultBase: string; doc?: api.Doc; done(): void }) {
	const { tenant } = useWorkspace();
	const [base, setBase] = useState(defaultBase || bases[0]?.id || "");
	const [title, setTitle] = useState(doc?.title ?? "");
	const [files, setFiles] = useState<File[]>([]);
	const [text, setText] = useState("");
	const [note, setNote] = useState("");
	const [publish, setPublish] = useState(true);
	const [busy, setBusy] = useState(false);
	const [results, setResults] = useState<string[]>([]);
	const [error, setError] = useState("");
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const keys = useRef(new Map<File, { key: string; data: FormData }>());
	const pasted = useRef<{ text: string; file: File }>();
	async function submit(e: FormEvent) {
		e.preventDefault();
		setError("");
		setResults([]);
		if (files.length && text.trim()) {
			setError("Choose files or pasted text for each upload.");
			return;
		}
		let batch = files;
		if (!files.length && text.trim()) {
			if (pasted.current?.text !== text) pasted.current = { text, file: new File([text], "document.md", { type: "text/plain" }) };
			batch = [pasted.current.file];
		}
		if (!batch.length || batch.some((f) => f.size === 0 || f.size > 10 * 1024 * 1024)) {
			setError("Choose nonempty files up to 10 MiB each.");
			return;
		}
		setBusy(true);
		for (const file of batch) {
			if (!alive.current) break;
			const data = new FormData();
			data.set("file", file);
			data.set("expected_tenant", tenant);
			data.set("base_id", doc?.base_id ?? base);
			data.set("title", title.trim() || file.name);
			data.set("change_note", note);
			data.set("publish_when_ready", String(publish));
			if (doc) data.set("revision", String(doc.revision));
			const attempt = keys.current.get(file) ?? { key: crypto.randomUUID(), data };
			keys.current.set(file, attempt);
			try {
				const result = await api.upload(attempt.data, attempt.key, doc?.id);
				if (alive.current)
					setResults((r) => [...r, `${file.name}: ${result.duplicate ? "already uploaded" : "accepted for processing"} as v${result.version}.`]);
			} catch (e) {
				if (alive.current) {
					setResults((r) => [...r, `${file.name}: ${api.message(e)}`]);
					setError("Some uploads failed. Review the per-file results below.");
				}
			}
		}
		if (alive.current) setBusy(false);
	}
	// A changed form represents a new request; retries of an unchanged form reuse keys.
	const changed = () => keys.current.clear();
	return (
		<form className="knowledge-card knowledge-upload" onSubmit={submit} onChange={changed}>
			<h3>{doc ? "Upload new version" : "Upload documents"}</h3>
			<p>TXT, Markdown, PDF with text, or DOCX. Up to 10 MiB per file. Scanned PDFs require OCR and cannot be published here.</p>
			<fieldset disabled={busy}>
				{!doc && (
					<label>
						Destination base{" "}
						<select value={base} onChange={(e) => setBase(e.target.value)} required>
							{bases.map((b) => (
								<option key={b.id} value={b.id}>
									{b.title}
								</option>
							))}
						</select>
					</label>
				)}
				<label>
					Document title{" "}
					<input readOnly={Boolean(doc)} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Defaults to filename" />
				</label>
				<label>
					Files <input type="file" accept=".txt,.md,.markdown,.pdf,.docx" multiple={!doc} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
				</label>
				<label>
					Or paste text <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
				</label>
				<label>
					Change note <input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
				</label>
				<label>
					Publication{" "}
					<select value={String(publish)} onChange={(e) => setPublish(e.target.value === "true")}>
						<option value="true">Publish automatically when ready</option>
						<option value="false">Save as draft for review</option>
					</select>
				</label>
				<p className="quiet">
					Published content is shared with everyone in this tenant. Replacements keep the current version available until the new version is published.
				</p>
			</fieldset>
			<Problem text={error} />
			<ul aria-live="polite">
				{results.map((r, i) => (
					<li key={i}>{r}</li>
				))}
			</ul>
			<div className="knowledge-toolbar">
				<button className="primary" disabled={busy || !base}>
					{busy ? "Uploading…" : "Upload"}
				</button>
				<button type="button" disabled={busy} onClick={done}>
					Done
				</button>
			</div>
		</form>
	);
}
function Document({ id, admin, back }: { id: string; admin: boolean; back(): void }) {
	const { tenant } = useWorkspace();
	const client = useQueryClient();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [replace, setReplace] = useState(false);
	const [preview, setPreview] = useState(0);
	const [compare, setCompare] = useState(0);
	const [rename, setRename] = useState<string | null>(null);
	const d = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "doc", id],
		queryFn: () => api.detail(id),
		enabled: admin,
		refetchInterval: 3000,
	});
	// Member metadata contains only the current publication.
	const member = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "member-doc", id],
		queryFn: () => request<api.Doc>(`${api.root}/documents/${id}`),
		enabled: !admin,
	});
	const doc = admin ? d.data : member.data;
	const vs = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "versions", id],
		queryFn: () => api.versions(id),
		enabled: admin,
		refetchInterval: 3000,
	});
	const selected = preview || doc?.published_version || doc?.latest_version || 0;
	const v = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "version", id, selected, admin],
		queryFn: () => api.version(id, selected, admin),
		enabled: selected > 0,
		refetchInterval: (q) => (admin && (q.state.data?.state === "queued" || q.state.data?.state === "processing") ? 3000 : false),
	});
	const other = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "version", id, compare, admin],
		queryFn: () => api.version(id, compare, admin),
		enabled: compare > 0,
	});
	async function act(action: string, n = 0, title?: string) {
		if (!doc) return;
		if (
			(action === "delete" || action === "discard") &&
			!window.confirm(
				action === "delete"
					? "Move this document to trash? It will immediately disappear from member search and source access."
					: "Discard this unpublished version?",
			)
		)
			return;
		setBusy(true);
		setError("");
		try {
			await api.change(doc, action, n, title);
			setRename(null);
			await client.invalidateQueries({ queryKey: ["knowledge", tenant] });
		} catch (e) {
			setError(api.message(e));
			await client.invalidateQueries({ queryKey: ["knowledge", tenant] });
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="knowledge">
			<button className="ghost" onClick={back}>
				← All documents
			</button>
			<Problem text={error || (d.isError || member.isError || vs.isError ? "Document unavailable. Refresh or return to the list." : "")} />
			{!doc ? (
				<p>Loading document…</p>
			) : (
				<>
					<h2>{doc.title}</h2>
					<p>
						{doc.state === "deleted" ? "In trash" : doc.published_version ? `Published v${doc.published_version}` : "Unpublished"}
						{admin && ` · Newest v${doc.latest_version}: ${doc.processing}`}
					</p>
					{admin && (
						<div className="knowledge-toolbar">
							{doc.state === "deleted" ? (
								<button disabled={busy} onClick={() => act("restore")}>
									Restore as unpublished
								</button>
							) : (
								<>
									<button onClick={() => setReplace(!replace)}>Upload new version</button>
									<button onClick={() => setRename(doc.title)}>Rename</button>
									{doc.published_version > 0 && (
										<button disabled={busy} onClick={() => act("unpublish")}>
											Unpublish
										</button>
									)}
									<button disabled={busy} onClick={() => act("delete")}>
										Move to trash
									</button>
								</>
							)}
						</div>
					)}
					{rename !== null && (
						<form
							className="knowledge-toolbar"
							onSubmit={(e) => {
								e.preventDefault();
								void act("rename", 0, rename);
							}}
						>
							<label>
								New title <input required maxLength={200} value={rename} onChange={(e) => setRename(e.target.value)} />
							</label>
							<button disabled={busy}>Save title</button>
						</form>
					)}
					{replace && doc.state !== "deleted" && (
						<Upload
							bases={[]}
							defaultBase={doc.base_id}
							doc={doc}
							done={() => {
								setReplace(false);
								void client.invalidateQueries({ queryKey: ["knowledge", tenant] });
							}}
						/>
					)}
					{admin && (
						<div className="knowledge-table">
							<table>
								<thead>
									<tr>
										<th>Version</th>
										<th>Processing</th>
										<th>Uploaded</th>
										<th>Change note</th>
										<th>Actions</th>
									</tr>
								</thead>
								<tbody>
									{vs.data?.versions.map((x) => (
										<tr key={x.version}>
											<td>
												v{x.version}
												{doc.published_version === x.version ? " · Published" : x.ever_published ? " · Previously published" : ""}
											</td>
											<td>
												{x.state}
												{x.error_code && <p role="status">{x.error_code.replaceAll("_", " ")}</p>}
											</td>
											<td>
												{new Date(x.created_at).toLocaleString()}
												<br />
												{x.created_by}
											</td>
											<td>{x.change_note}</td>
											<td>
												<div className="knowledge-toolbar">
													{x.state !== "discarded" && <button onClick={() => setPreview(x.version)}>Preview v{x.version}</button>}
													{doc.state !== "deleted" && (
														<>
															{x.state === "ready" && doc.published_version !== x.version && (
																<button disabled={busy} onClick={() => act(x.ever_published ? "rollback" : "publish", x.version)}>
																	{x.ever_published ? "Roll back" : "Publish"} v{x.version}
																</button>
															)}
															{x.state === "failed" && (
																<button disabled={busy} onClick={() => act("retry", x.version)}>
																	Retry v{x.version}
																</button>
															)}
															{!x.ever_published && x.state !== "discarded" && (
																<button disabled={busy} onClick={() => act("discard", x.version)}>
																	Discard v{x.version}
																</button>
															)}
														</>
													)}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					{selected > 0 && (
						<div className="knowledge-card">
							<h3>
								Preview v{selected}
								{doc.published_version !== selected ? " · Not current publication" : ""}
							</h3>
							<Problem text={v.isError ? "This version is unavailable." : ""} />
							{v.data && !v.isError && (
								<>
									<a href={api.source(id, selected, admin)} download>
										Download original ({v.data.filename})
									</a>
									{v.data.state !== "ready" && (
										<p>
											Processing: {v.data.state}. {v.data.error_code.replaceAll("_", " ")}
										</p>
									)}
									{admin && (
										<label>
											Compare with{" "}
											<select value={compare} onChange={(e) => setCompare(Number(e.target.value))}>
												<option value={0}>No comparison</option>
												{vs.data?.versions
													.filter((x) => x.state === "ready" && x.version !== selected)
													.map((x) => (
														<option key={x.version} value={x.version}>
															v{x.version}
														</option>
													))}
											</select>
										</label>
									)}
									<div className={compare ? "knowledge-compare" : ""}>
										<pre>{v.data.text || "No extracted text available."}</pre>
										{compare > 0 && (
											<div>
												<h4>v{compare}</h4>
												<Problem text={other.isError ? "Comparison unavailable." : ""} />
												<pre>{other.data?.text ?? "Loading…"}</pre>
											</div>
										)}
									</div>
									{compare > 0 && <p className="quiet">Side-by-side extracted text. Download originals to review layout and table changes.</p>}
								</>
							)}
						</div>
					)}
				</>
			)}
		</section>
	);
}
function Activity() {
	const { tenant } = useWorkspace();
	const q = useQuery({
		gcTime: 0,
		queryKey: ["knowledge", tenant, "activity"],
		queryFn: () => request<{ activity: { id: string; actor: string; action: string; target: string; at: string }[] }>(`${api.root}/admin/activity`),
		refetchInterval: 10000,
	});
	return (
		<details>
			<summary>Recent knowledge activity</summary>
			<Problem text={q.isError ? "Activity could not be loaded." : ""} />
			<ul>
				{q.data?.activity.map((a) => (
					<li key={a.id}>
						{new Date(a.at).toLocaleString()} · {a.actor} · {a.action} · {a.target}
					</li>
				))}
			</ul>
		</details>
	);
}
