import { ApiError, postJSON, request } from "../../lib/api.ts";
import type { Page } from "../../lib/paged.tsx";
export const root = "/api/modules/knowledge";
export type Base = { id: string; title: string };
export type Doc = {
	id: string;
	base_id: string;
	title: string;
	state: string;
	revision: number;
	published_version: number;
	latest_version: number;
	processing: string;
	updated_at: string;
};
export type Version = {
	version: number;
	filename: string;
	media_type: string;
	bytes: number;
	sha256: string;
	change_note: string;
	created_by: string;
	created_at: string;
	state: string;
	error_code: string;
	ever_published: boolean;
	text?: string;
};
export type Hit = { id: string; title: string; version: number; text: string };
const page = <T,>(items: T[], next?: string): Page<T> => ({ items, ...(next ? { next } : {}) });
export const basesPage = async (cursor: string) => {
	const p = await request<{ bases: Base[]; next_cursor?: string }>(`${root}/bases?limit=50&cursor=${encodeURIComponent(cursor)}`);
	return page(p.bases, p.next_cursor);
};
export const createBase = (title: string) => postJSON<Base>(`${root}/admin/bases`, { title });
type ListFilter = { base?: string; state?: string; collection?: string; title?: string };
export const documentsPage = async (admin: boolean, { base = "", state = "", collection = "", title = "" }: ListFilter, cursor: string) => {
	const p = await request<{ documents: Doc[]; next_cursor?: string }>(
		`${root}/${admin ? "admin/" : ""}documents?base_id=${encodeURIComponent(base)}&state=${state}&cursor=${encodeURIComponent(cursor)}&collection_id=${encodeURIComponent(collection)}&q=${encodeURIComponent(title)}`,
	);
	return page(p.documents, p.next_cursor);
};
export const detail = (id: string) => request<Doc>(`${root}/admin/documents/${id}`);
export const versions = (id: string) => request<{ versions: Version[] }>(`${root}/admin/documents/${id}/versions`);
export const version = (id: string, n: number, admin: boolean) => request<Version>(`${root}/${admin ? "admin/" : ""}documents/${id}/versions/${n}`);
export const source = (id: string, n: number, admin: boolean) => `${root}/${admin ? "admin/" : ""}documents/${id}/versions/${n}/source`;
export const change = (d: Doc, action: string, n = 0, title?: string) => {
	const path = action === "delete" || action === "rename" ? "" : action === "retry" || action === "discard" ? `/versions/${n}/${action}` : `/${action}`;
	return request<Doc>(`${root}/admin/documents/${d.id}${path}`, {
		method: action === "delete" ? "DELETE" : action === "rename" ? "PATCH" : "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ revision: d.revision, version: n, ...(title === undefined ? {} : { title }) }),
	});
};
export const upload = (data: FormData, key: string, id?: string) =>
	request<{ id: string; version: number; duplicate: boolean }>(`${root}/admin/documents${id ? `/${id}/versions` : ""}`, {
		method: "POST",
		headers: { "Idempotency-Key": key },
		body: data,
	});
export const search = (query: string, base_id: string, collection: string = "") =>
	postJSON<{ results: Hit[] }>(`${root}/search`, { query, base_id, ...(collection ? { collection_ids: [collection] } : {}) });
export function message(e: unknown) {
	if (e instanceof ApiError) {
		if (e.status === 409) return "This item changed. Refresh and review it before trying again.";
		if (e.status === 413) return "Each file must be no larger than 10 MiB.";
		if (e.status === 415) return "Use a valid UTF-8 text, Markdown, PDF, or DOCX file.";
		if (e.status === 403) return "Your account no longer has permission for this action.";
		if (e.status === 404) return "This document, version, or set is no longer available.";
		if (e.status === 400 && e.code === "too_many") return "A document set can hold up to 200 documents.";
	}
	return "The operation could not be completed. Refresh or try again.";
}

export type Collection = { id: string; title: string; description: string; revision: number; document_ids: string[] };
export const collectionsPage = async (admin: boolean, cursor: string) => {
	const p = await request<{ collections: Collection[]; next_cursor?: string }>(`${root}/${admin ? "admin/" : ""}collections?cursor=${encodeURIComponent(cursor)}`);
	return page(p.collections, p.next_cursor);
};
export const collection = (admin: boolean, id: string) => request<Collection>(`${root}/${admin ? "admin/" : ""}collections/${encodeURIComponent(id)}`);
export const saveCollection = (id: string, body: Omit<Collection, "id">) =>
	request<Collection>(`${root}/admin/collections${id ? `/${id}` : ""}`, {
		method: id ? "PUT" : "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
export const deleteCollection = (set: Collection) =>
	request<void>(`${root}/admin/collections/${set.id}`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ revision: set.revision }),
	});
/** Every document of one set: bounded, since a set holds at most 200. */
export async function setDocuments(id: string) {
	const all: Doc[] = [];
	let cursor = "";
	do {
		const p = await documentsPage(true, { collection: id }, cursor);
		all.push(...p.items);
		cursor = p.next ?? "";
	} while (cursor);
	return all;
}

/** Changes one set's membership from its latest revision, so a stale list in the page can't drop other edits. */
export async function changeMembership(setId: string, add: string[], remove: string[] = []) {
	const current = await collection(true, setId);
	const ids = new Set(current.document_ids);
	add.forEach((id) => ids.add(id));
	remove.forEach((id) => ids.delete(id));
	if (ids.size > 200) throw new ApiError(400, "too_many", "too_many");
	return saveCollection(current.id, { title: current.title, description: current.description, revision: current.revision, document_ids: [...ids] });
}

/** A tenant admin's limit on one agent. An agent with none may use every set. */
export type AgentLimit = { agent: string; set_ids: string[]; revision: number };
export const agentLimits = () => request<{ agents: AgentLimit[] }>(`${root}/admin/agent-access`).then((body) => body.agents);
export const saveAgentLimit = (agent: string, setIds: string[], revision: number) =>
	request<AgentLimit>(`${root}/admin/agent-access/${encodeURIComponent(agent)}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ set_ids: setIds, revision }),
	});
export const clearAgentLimit = (limit: AgentLimit) =>
	request<void>(`${root}/admin/agent-access/${encodeURIComponent(limit.agent)}`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ revision: limit.revision }),
	});
