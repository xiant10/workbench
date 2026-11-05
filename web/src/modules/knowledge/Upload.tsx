import { CheckCircle2, FileUp, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore } from "../../lib/paged.tsx";
import { Dialog, Segmented } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import * as api from "./api.ts";
import { Problem, useLibrary } from "./shared.tsx";

type Result = { name: string; id?: string; version?: number; duplicate?: boolean; error?: string };
const MAX_FILE = 10 * 1024 * 1024;

/** Uploads new documents, or a new version of doc, and files new ones into sets. */
export function UploadDialog({ defaultBase, defaultSet, doc, done }: { defaultBase: string; defaultSet?: string; doc?: api.Doc; done(uploaded: boolean): void }) {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const { bases, sets, baseName } = useLibrary(true);
	const [base, setBase] = useState(defaultBase);
	const [into, setInto] = useState(new Set(defaultSet ? [defaultSet] : []));
	const [mode, setMode] = useState<"files" | "text">("files");
	const [title, setTitle] = useState(doc?.title ?? "");
	const [files, setFiles] = useState<File[]>([]);
	const [text, setText] = useState("");
	const [note, setNote] = useState("");
	const [publish, setPublish] = useState(true);
	const [dragging, setDragging] = useState(false);
	const [busy, setBusy] = useState(false);
	const [results, setResults] = useState<Result[]>([]);
	const [error, setError] = useState("");
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	useEffect(() => {
		const first = bases.data?.[0];
		if (!base && first) setBase(first.id);
	}, [base, bases.data]);
	const keys = useRef(new Map<File, { key: string; data: FormData }>());
	const fileInput = useRef<HTMLInputElement>(null);
	const pasted = useRef<{ text: string; file: File }>();
	// A changed form is a new request; retrying an unchanged one reuses its keys.
	const changed = () => keys.current.clear();
	const pick = (list: File[]) => {
		changed();
		setFiles(doc ? list.slice(0, 1) : list);
	};
	const drop = (e: DragEvent) => {
		e.preventDefault();
		setDragging(false);
		pick(Array.from(e.dataTransfer.files));
	};
	async function submit(e: FormEvent) {
		e.preventDefault();
		setError("");
		setResults([]);
		let batch = mode === "files" ? files : [];
		if (mode === "text" && text.trim()) {
			if (pasted.current?.text !== text) pasted.current = { text, file: new File([text], "document.md", { type: "text/plain" }) };
			batch = [pasted.current.file];
		}
		if (!batch.length) {
			setError(mode === "files" ? "Choose at least one file." : "Paste some text first.");
			return;
		}
		if (batch.some((f) => f.size === 0 || f.size > MAX_FILE)) {
			setError("Choose nonempty files up to 10 MiB each.");
			return;
		}
		setBusy(true);
		const accepted: string[] = [];
		for (const file of batch) {
			if (!alive.current) break;
			const data = new FormData();
			data.set("file", file);
			data.set("expected_tenant", tenant);
			data.set("base_id", doc?.base_id ?? base);
			data.set("title", (batch.length === 1 && title.trim()) || file.name.replace(/\.[^.]+$/, "") || file.name);
			data.set("change_note", note);
			data.set("publish_when_ready", String(publish));
			if (doc) data.set("revision", String(doc.revision));
			const attempt = keys.current.get(file) ?? { key: crypto.randomUUID(), data };
			keys.current.set(file, attempt);
			try {
				const r = await api.upload(attempt.data, attempt.key, doc?.id);
				accepted.push(r.id);
				if (alive.current) setResults((all) => [...all, { name: file.name, id: r.id, version: r.version, duplicate: r.duplicate }]);
			} catch (e) {
				if (alive.current) setResults((all) => [...all, { name: file.name, error: api.message(e) }]);
			}
		}
		let filingFailed = false;
		if (!doc && accepted.length) {
			for (const id of into) {
				try {
					await api.changeMembership(id, accepted);
				} catch {
					filingFailed = true;
				}
			}
		}
		if (!alive.current) return;
		setBusy(false);
		if (filingFailed) setError("Uploaded, but some documents couldn't be added to the chosen sets. Add them from the document list.");
		else if (accepted.length < batch.length) setError("Some uploads failed. Review the results below.");
		else done(true);
	}
	const heading = doc ? t("Upload a new version of {title}", { title: doc.title }) : t("Upload documents");
	return (
		<Dialog label={heading} onClose={busy ? undefined : () => done(results.some((r) => !r.error))} className="dialog kn-dialog">
			<form className="kn-form" onSubmit={submit} onChange={changed}>
				<h2>{heading}</h2>
				<Segmented
					label={t("Source")}
					value={mode}
					options={[
						{ value: "files", label: t("Files") },
						{ value: "text", label: t("Paste text") },
					]}
					onChange={(v) => {
						changed();
						setMode(v);
					}}
				/>
				<fieldset disabled={busy} className="kn-form">
					{mode === "files" ? (
						<div
							className={dragging ? "kn-drop active" : "kn-drop"}
							onDragOver={(e) => {
								e.preventDefault();
								setDragging(true);
							}}
							onDragLeave={() => setDragging(false)}
							onDrop={drop}
						>
							<FileUp size={26} aria-hidden="true" />
							<p>
								<button type="button" className="link" onClick={() => fileInput.current?.click()}>
									{t(doc ? "Choose a file" : "Choose files")}
								</button>{" "}
								{t("or drag them here")}
							</p>
							<p className="quiet">{t("TXT, Markdown, PDF with selectable text, or DOCX · up to 10 MiB each")}</p>
							<input
								ref={fileInput}
								className="sr-only"
								type="file"
								aria-label={t("Files")}
								accept=".txt,.md,.markdown,.pdf,.docx"
								multiple={!doc}
								onChange={(e) => pick(Array.from(e.target.files ?? []))}
							/>
							{files.length > 0 && (
								<ul className="kn-file-list">
									{files.map((f) => (
										<li key={f.name + f.size}>
											{f.name} <span className="quiet">{t("{size} KB", { size: Math.max(1, Math.round(f.size / 1024)) })}</span>
										</li>
									))}
								</ul>
							)}
						</div>
					) : (
						<label>
							{t("Text")}
							<textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Paste or write Markdown")} />
						</label>
					)}
					<div className="kn-form-row">
						{(!doc && (mode === "text" || files.length <= 1)) || doc ? (
							<label>
								{t("Title")}
								<input readOnly={Boolean(doc)} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("Defaults to the file name")} />
							</label>
						) : null}
						{!doc && (
							<label>
								{t("Knowledge base")}
								<select value={base} onChange={(e) => setBase(e.target.value)} required>
									{bases.data?.map((b) => (
										<option key={b.id} value={b.id}>
											{baseName(b.id)}
										</option>
									))}
								</select>
							</label>
						)}
					</div>
					{!doc && (sets.data?.length ?? 0) > 0 && (
						<div className="kn-field">
							<span className="kn-field-label">{t("Add to document sets")}</span>
							<div className="kn-toggles">
								{sets.data?.map((s) => (
									<label key={s.id} className={into.has(s.id) ? "day-pick on" : "day-pick"}>
										<input
											type="checkbox"
											checked={into.has(s.id)}
											onChange={(e) => {
												const next = new Set(into);
												if (e.target.checked) next.add(s.id);
												else next.delete(s.id);
												setInto(next);
											}}
										/>
										{s.title}
									</label>
								))}
							</div>
							<LoadMore list={sets} label="Show more sets" className="link" />
						</div>
					)}
					<label>
						{t("Change note")}
						<input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={t("Optional: what's new in this upload")} />
					</label>
					<div className="setting">
						<div className="setting-text">
							<span>{t("Publish when ready")}</span>
							<span className="quiet">
								{t(publish ? "Everyone in this tenant, and their agents, can read it once processing finishes." : "Saved as a draft. Only admins see it until you publish.")}
							</span>
						</div>
						<label className="switch">
							<input type="checkbox" aria-label={t("Publish when ready")} checked={publish} onChange={(e) => setPublish(e.target.checked)} />
							<span />
						</label>
					</div>
				</fieldset>
				<Problem text={error} />
				{results.length > 0 && (
					<ul className="kn-results" aria-live="polite">
						{results.map((r, i) => (
							<li key={i} className={r.error ? "danger-text" : ""}>
								{r.error ? <XCircle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
								{r.error
									? t("{name}: {error}", { name: r.name, error: t(r.error) })
									: t(r.duplicate ? "{name}: already uploaded as v{version}." : "{name}: accepted for processing as v{version}.", { name: r.name, version: r.version ?? 0 })}
							</li>
						))}
					</ul>
				)}
				<div className="dialog-actions">
					<button type="button" className="ghost" disabled={busy} onClick={() => done(results.some((r) => !r.error))}>
						{t(results.length ? "Close" : "Cancel")}
					</button>
					<button className="primary" disabled={busy || (!doc && !base)}>
						{t(busy ? "Uploading…" : "Upload")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
