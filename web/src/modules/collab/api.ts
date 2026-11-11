import { postJSON, request } from "../../lib/api.ts";
import type { Page } from "../../lib/paged.tsx";

export type Status = "todo" | "doing" | "done" | "cancelled";
export type Priority = "low" | "normal" | "high";

export type Item = {
	id: string;
	title: string;
	description: string;
	status: Status;
	priority: Priority;
	due_at: string | null;
	creator_id: string;
	list_id?: string;
	version: number;
	owners: string[];
	collaborators: string[];
	created_at: string;
	updated_at: string;
	/** What the caller may do to it. Only a single read has it. */
	can?: Can;
};

export type Can = { edit: boolean; cancel: boolean; claim: boolean; send: boolean; delete: boolean; manage_people: boolean };

/**
 * A due date is a day, kept as midnight UTC. Collab answers in its own time zone, so the string's first ten characters
 * can be the day before, and this reads the instant instead.
 */
export function dueDay(dueAt: string): string {
	return new Date(dueAt).toISOString().slice(0, 10);
}

/** Today where the person is, in the same form. */
export function today(): string {
	return new Date().toLocaleDateString("en-CA");
}

export type Offer = {
	id: string;
	item_id: string;
	item_title: string;
	from_user_id: string;
	to_user_id: string;
	mode: "transfer" | "share";
	note: string;
	state: "pending" | "assigned" | "accepted" | "declined" | "withdrawn" | "voided";
	response_note: string;
	created_at: string;
};

export type Comment = { id: string; author_id: string; body: string; created_at: string };
export type ItemEvent = { id: string; item_id: string; actor_user_id: string; kind: string; detail: Record<string, unknown>; at: string };
/** `agent` marks an agent teammate. */
export type Person = { user_id: string; display_name: string; org_unit_id: string; agent?: boolean };
export type Unit = { id: string; name: string };
export type ListRole = "owner" | "member";
export type TaskList = {
	id: string;
	name: string;
	org_unit_id?: string;
	archived_at?: string | null;
	members?: { user_id: string; role: ListRole; source: "manual" | "org" }[];
	/** Only on a page of lists. */
	counts?: { open: number; unclaimed: number; members: number };
};
export type Visibility = "none" | "direct_reports" | "all_reports";

const base = "/api/modules/collab";
const send = <T>(method: string, path: string, body?: unknown) =>
	request<T>(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });

/** One page of a collab list, newest first except comments and history, which run oldest first. */
async function page<T>(path: string, key: string, cursor: string): Promise<Page<T>> {
	const body = await request<Record<string, unknown>>(`${base}${path}${path.includes("?") ? "&" : "?"}limit=50${cursor === "" ? "" : `&cursor=${encodeURIComponent(cursor)}`}`);
	return { items: (body[key] ?? []) as T[], ...(typeof body.next_cursor === "string" ? { next: body.next_cursor } : {}) };
}
export const itemsPage = (query: string, cursor: string) => page<Item>(`/work-items?${query}`, "items", cursor);
export const commentsPage = (id: string, cursor: string) => page<Comment>(`/work-items/${id}/comments`, "comments", cursor);
export const eventsPage = (id: string, cursor: string) => page<ItemEvent>(`/work-items/${id}/events`, "events", cursor);
export const listsPage = (cursor: string, archived = false) => page<TaskList>(`/lists${archived ? "?archived=true" : ""}`, "lists", cursor);
/** A summary's first page: Home shows only a few of these. */
export const listItems = async (query: string) => (await request<{ items: Item[] }>(`${base}/work-items?${query}&limit=100`)).items;
export const getItem = (id: string) => request<Item>(`${base}/work-items/${id}`);
export const createItem = (body: Record<string, unknown>) => postJSON<Item>(`${base}/work-items`, body);
export const updateItem = (id: string, body: Record<string, unknown>) => send<Item>("PATCH", `/work-items/${id}`, body);
export const deleteItem = (id: string) => send<void>("DELETE", `/work-items/${id}`);
export const claimItem = (id: string) => postJSON<Item>(`${base}/work-items/${id}/claim`, {});
export const stopOwning = (id: string) => send<void>("DELETE", `/work-items/${id}/owners/me`);
export const addCollaborator = (id: string, user: string) => send<void>("PUT", `/work-items/${id}/collaborators/${user}`);
export const removeCollaborator = (id: string, user: string) => send<void>("DELETE", `/work-items/${id}/collaborators/${user}`);
export const addComment = (id: string, body: string) => postJSON<Comment>(`${base}/work-items/${id}/comments`, { body });
export const sendItem = (id: string, body: Record<string, unknown>) => postJSON<Offer>(`${base}/work-items/${id}/send`, body);

export const listOffers = async (box: "inbox" | "sent") => (await request<{ offers: Offer[] }>(`${base}/offers?box=${box}&limit=100`)).offers;
export const acceptOffer = (id: string) => postJSON<Offer>(`${base}/offers/${id}/accept`, {});
export const declineOffer = (id: string, note: string) => postJSON<Offer>(`${base}/offers/${id}/decline`, { note });
export const withdrawOffer = (id: string) => postJSON<Offer>(`${base}/offers/${id}/withdraw`, {});

export const findPeople = async (q: string) => (await request<{ people: Person[] }>(`${base}/people?q=${encodeURIComponent(q)}&limit=200`)).people;
export const listUnits = async () => (await request<{ units: Unit[] }>(`${base}/units`)).units;

export const getList = (id: string) => request<TaskList>(`${base}/lists/${id}`);
export const createList = (name: string) => postJSON<TaskList>(`${base}/lists`, { name });
export const putListMember = (id: string, user: string, role: ListRole = "member") => send<void>("PUT", `/lists/${id}/members/${user}`, { role });
/** Rename, archive, or link a team. An empty `org_unit_id` clears the link. */
export const updateList = (id: string, patch: { name?: string; archived?: boolean; org_unit_id?: string }) => send<TaskList>("PATCH", `/lists/${id}`, patch);
export const removeListMember = (id: string, user: string) => send<void>("DELETE", `/lists/${id}/members/${user}`);

export const getSettings = () => request<{ manager_visibility: Visibility }>(`${base}/settings`);
export const putSettings = (manager_visibility: Visibility) => send<{ manager_visibility: Visibility }>("PUT", "/admin/settings", { manager_visibility });


const REF_PREFIX = "collab:work_item:";

/** The reference to a work item, as other modules and agent sessions hold it. */
export const workItemRef = (id: string) => `${REF_PREFIX}${id}`;

/** The work item a reference names, if it names one. */
export const workItemOf = (ref: string | undefined) => (ref?.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : undefined);

/** Text from a teammate becomes data for the agent, and a closing tag in it can't end that. */
export function workItemPrompt(item: Pick<Item, "id" | "title" | "description">): string {
	const escape = (text: string) => text.replaceAll("</module_record", "<\\/module_record");
	return `<module_record ref="${workItemRef(item.id)}">\nTitle: ${escape(item.title)}\n\n${escape(item.description)}\n</module_record>`;
}
