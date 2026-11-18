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
	/** A send the person's assistant suggested. Only owners get it. */
	suggestion?: { to: string; note: string; at: string };
	/** Offers on it nobody has answered. Only a single read has it. */
	pending_offers?: Offer[];
	/** Agent teammates told about it lately that haven't acted since. Only a single read has it. */
	working?: { user_id: string; since: string }[];
	/** The latest comment that mentioned the reader, if they've done nothing on it since. Only a single read has it. */
	mention?: { from: string; body: string; at: string };
	/** Where its work happens elsewhere, such as the pull request an agent teammate opened. */
	links?: ItemLink[];
	/** Its stage on its list's workflow; left out off it. */
	stage?: string;
	/** Times it went back since it was started or put at a stage. */
	rounds?: number;
	/** Where it stands on its list's workflow. Only a single read of an item on a list with one has it. */
	workflow?: Place;
	/** A module's item type, or collab.task. See t10-collab's docs/types.md. */
	type?: string;
	/** The type's values, including any an earlier version declared, which are read-only. */
	fields?: Record<string, unknown>;
	/** Where it is in its type's lifecycle, when the type has states. Status is then the state's phase. */
	state?: string;
	/** The record it's about, `<module>:<type>:<id>`. */
	subject_ref?: string;
	/** `participants`: only its creator, owners and whoever it's offered to read it. */
	visibility?: "team" | "participants";
	/** The type's transitions the reader may take now. Only a single read has it. */
	moves?: Move[];
};

/** A field a type declares: a small part of JSON Schema, so any type can be drawn. */
export type TypeField = { type: "string" | "integer" | "number" | "boolean"; title?: string; maxLength?: number; enum?: (string | number | boolean)[] };
/** A module's item type, as collab resolves it for the tenant. Labels are the module's own words. */
export type ItemType = {
	id: string;
	owner_module: string;
	version: number;
	label: string;
	fields: { properties: Record<string, TypeField>; order: string[] };
	visibility: "team" | "participants";
	states?: Record<string, { phase: Status; label: string }>;
	state_order?: string[];
};
/** A move the reader may take: what it asks for, and where it goes. */
export type Move = { id: string; label?: string; to: string; requires?: string[]; payload?: ("reply" | "links")[]; note?: "required" };
export type MoveResult = { reply?: string; links?: { url: string; title: string }[] };

/**
 * A step of a list's workflow. The item goes to one of `holders` (`holder` is the first): the one that held it before, or else the least busy.
 * `on_changes` is the earlier stage an item goes back to when its holder finds something; `skip_when` says when the holder before may pass over it.
 */
export type Stage = { id?: string; name: string; holders: string[]; holder: string; on_changes?: string; guide?: string; skip_when?: string };
export type Workflow = { list_id: string; version: number; stages: Stage[]; rounds: number; lead: string; auto_start: boolean; updated_by: string; updated_at: string };
/** Where a result takes an item: a stage and its holder (or holders, one picked at the move), done, or the lead when it went back too often. */
export type Step = { stage?: string; name?: string; to?: string; holders?: string[]; skips?: string[]; done?: boolean; reason?: "rounds" | "holder_gone" };
export type Place = { workflow: Workflow; stage: Stage | null; pass?: Step; changes?: Step; skip?: Step[]; rounds: number };

export type LinkKind = "pull_request" | "commit" | "build" | "document" | "other";
export type ItemLink = { id: string; url: string; title: string; kind: LinkKind; added_by: string; created_at: string };

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
	/** `holds`: a plain member who agreed to hold stages of the list's workflow; owners and agents need not. */
	members?: { user_id: string; role: ListRole; source: "manual" | "org"; holds?: boolean }[];
	/** Only on a page of lists. */
	counts?: { open: number; unclaimed: number; members: number };
	/** Only on a page of lists. */
	has_workflow?: boolean;
	/** Only on a single read, when the list has one. */
	workflow?: Workflow;
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
export const listTypes = async () => (await request<{ types: ItemType[] }>(`${base}/types`)).types;
/** Take one of a typed item's moves, with its note and result. */
export const transitionItem = (id: string, body: { transition: string; note?: string; payload?: MoveResult; version?: number }) => postJSON<Item>(`${base}/work-items/${id}/transition`, body);
/** Agree to hold stages of a list's workflow, or stop. */
export const setHolding = (id: string, agree: boolean) => send<void>(agree ? "PUT" : "DELETE", `/lists/${id}/holding`);
/** Put a task you own on a shared list you're on, or take it off with "". */
export const setItemList = (id: string, list: string) => send<Item>("PUT", `/work-items/${id}/list`, { list_id: list });
export const claimItem = (id: string) => postJSON<Item>(`${base}/work-items/${id}/claim`, {});
export const stopOwning = (id: string) => send<void>("DELETE", `/work-items/${id}/owners/me`);
export const addCollaborator = (id: string, user: string) => send<void>("PUT", `/work-items/${id}/collaborators/${user}`);
export const removeCollaborator = (id: string, user: string) => send<void>("DELETE", `/work-items/${id}/collaborators/${user}`);
export const addComment = (id: string, body: string, mentions: string[] = []) => postJSON<Comment>(`${base}/work-items/${id}/comments`, { body, mentions });
/** Collab takes the title and kind from the URL when they're left out. */
export const addLink = (id: string, link: { url: string; title?: string; kind?: LinkKind }) => postJSON<ItemLink>(`${base}/work-items/${id}/links`, link);
export const removeLink = (id: string, link: string) => send<void>("DELETE", `/work-items/${id}/links/${link}`);
export const dismissSuggestion = (id: string) => send<void>("DELETE", `/work-items/${id}/suggestion`);
export const sendItem = (id: string, body: Record<string, unknown>) => postJSON<Offer>(`${base}/work-items/${id}/send`, body);
/** Finish the caller's stage: pass to the next, or send back with what to fix. */
export const advanceItem = (id: string, result: "pass" | "changes", note: string, to?: string) => postJSON<Item>(`${base}/work-items/${id}/advance`, { result, note, to });
/** Start an item on its list's workflow, the first stage when `stage` is left out, or put it at a stage. */
export const putAtStage = (id: string, stage?: string, note = "") => postJSON<Item>(`${base}/work-items/${id}/stage`, { stage, note });

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
export const setWorkflow = (id: string, workflow: { stages: Omit<Stage, "holder">[]; rounds: number; lead: string; auto_start: boolean }) => send<Workflow>("PUT", `/lists/${id}/workflow`, workflow);
export const removeWorkflow = (id: string) => send<void>("DELETE", `/lists/${id}/workflow`);

/** A task whose owners left or are suspended, as an admin sees it: its title and owners, never the work. */
export type QueuedItem = { id: string; title: string; status: Status; owners: string[]; reason: "no_successor" | "owner_suspended"; queued_at: string };
/** A shared list nobody active can manage, or with open tasks and nobody active on it. */
export type QueuedList = { id: string; name: string; reason: "no_active_owner" | "no_active_members"; queued_at: string };
export const queuedItemsPage = (cursor: string) => page<QueuedItem>("/admin/departures", "items", cursor);
export const queuedListsPage = (cursor: string) => page<QueuedList>("/admin/departures/lists", "lists", cursor);
/** Give a waiting task to someone, who owns it at once. */
export const reassignItem = (id: string, to: string) => postJSON<unknown>(`${base}/admin/departures/${id}/reassign`, { to });
/** Make someone the owner of a waiting list. */
export const setListOwner = (id: string, to: string) => send<void>("POST", `/admin/departures/lists/${id}/owner`, { to });

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
