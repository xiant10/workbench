import { ApiError, postJSON, request } from "../../lib/api.ts";
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
export async function bases() {
	const all: Base[] = [];
	let cursor = "";
	do {
		const p = await request<{ bases: Base[]; next_cursor?: string }>(`${root}/bases?limit=200&cursor=${encodeURIComponent(cursor)}`);
		all.push(...p.bases);
		cursor = p.next_cursor ?? "";
	} while (cursor);
	return all;
}
export const createBase = (title: string) => postJSON<Base>(`${root}/admin/bases`, { title });
export const list = (admin: boolean, base: string, state: string, cursor = "") =>
	request<{ documents: Doc[]; next_cursor?: string }>(
		`${root}/${admin ? "admin/" : ""}documents?base_id=${encodeURIComponent(base)}&state=${state}&cursor=${encodeURIComponent(cursor)}`,
	);
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
export const search = (query: string, base_id: string) => postJSON<{ results: Hit[] }>(`${root}/search`, { query, base_id });
export function message(e: unknown) {
	if (e instanceof ApiError) {
		if (e.status === 409) return "This document changed. Refresh and review it before trying again.";
		if (e.status === 413) return "Each file must be no larger than 10 MiB.";
		if (e.status === 415) return "Use a valid UTF-8 text, Markdown, PDF, or DOCX file.";
		if (e.status === 403) return "Your account no longer has permission for this action.";
		if (e.status === 404) return "This document or version is no longer available.";
	}
	return "The operation could not be completed. Refresh or try again.";
}
