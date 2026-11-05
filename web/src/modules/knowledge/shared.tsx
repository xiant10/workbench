import { useMemo } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { usePaged } from "../../lib/paged.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import * as api from "./api.ts";
import { processingLabel } from "./labels.ts";

/** Bases and sets every Knowledge screen names documents by, a page at a time. */
export function useLibrary(admin: boolean) {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const bases = usePaged(["knowledge", tenant, "bases"], api.basesPage, { gcTime: 0 });
	const sets = usePaged(["knowledge", tenant, "sets", admin], (cursor) => api.collectionsPage(admin, cursor), { gcTime: 0 });
	const setsOf = useMemo(() => {
		const map = new Map<string, api.Collection[]>();
		for (const set of sets.data ?? []) for (const id of set.document_ids) map.set(id, [...(map.get(id) ?? []), set]);
		return map;
	}, [sets.data]);
	const baseName = (id: string) => (id === "kb_company" ? t("Company knowledge") : (bases.data?.find((b) => b.id === id)?.title ?? t("Knowledge base")));
	return { bases, sets, setsOf, baseName };
}

export function Problem({ text }: { text: string }) {
	const { t } = useI18n();
	return text ? (
		<p role="alert" className="inline-error">
			{t(text)}
		</p>
	) : null;
}

/** One pill that says what a reader most needs to know about a document. */
export function StatusPill({ doc, admin }: { doc: api.Doc; admin: boolean }) {
	const { t } = useI18n();
	if (doc.state === "deleted") return <span className="pill kn-muted">{t("In trash")}</span>;
	const pending = admin && doc.latest_version !== doc.published_version;
	if (pending && (doc.processing === "queued" || doc.processing === "processing")) return <span className="pill kn-busy">{t(processingLabel(doc.processing))}</span>;
	if (pending && doc.processing === "failed") return <span className="pill kn-failed">{t("Failed")}</span>;
	if (doc.published_version === 0) return <span className="pill kn-draft">{t("Draft")}</span>;
	return <span className="pill kn-live">{t("Published v{version}", { version: doc.published_version })}</span>;
}

/** Marks each case-insensitive match of term, as text: excerpts are never HTML. */
export function Highlight({ text, term }: { text: string; term: string }) {
	const needle = term.trim().toLowerCase();
	if (!needle) return <>{text}</>;
	const parts: { text: string; hit: boolean }[] = [];
	const lower = text.toLowerCase();
	let at = 0;
	for (let i = lower.indexOf(needle); i >= 0 && lower.length === text.length; i = lower.indexOf(needle, at)) {
		if (i > at) parts.push({ text: text.slice(at, i), hit: false });
		parts.push({ text: text.slice(i, i + needle.length), hit: true });
		at = i + needle.length;
	}
	parts.push({ text: text.slice(at), hit: false });
	return (
		<>
			{parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
		</>
	);
}
