import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";

/** Every call goes through this module's API, whichever page makes it. */
export const root = "/api/modules/property";

export type Scope = { all: boolean; buildings: Record<string, boolean>; assigned_work: boolean };
export type Access = { tenant_admin: boolean; user_id: string; scopes: Record<string, Scope> };

export type Attention = {
	followups_overdue: number;
	followups_today: number;
	work_orders: number;
	tasks_open: number;
	notices_unread: number;
	adjustments_to_approve: number;
	adjustments_to_execute: number;
};

export type Followup = {
	id: string;
	account_id: string;
	room_no: string;
	title: string;
	due_at: string;
	state: string;
	bucket: "overdue" | "today" | "upcoming" | "closed";
	revision: number;
	source_kind: string;
	source_id: string;
};

export type WorkOrder = {
	id: string;
	account_id: string;
	room_no: string;
	building: string;
	title: string;
	description: string;
	category: "repair" | "complaint" | "alarm";
	priority: "normal" | "urgent";
	reporter_id: string;
	assignee_id: string;
	state: "pending" | "processing" | "acceptance" | "completed" | "withdrawn";
	deadline: string;
	revision: number;
	supervised: boolean;
	created_at: string;
};

export type WorkOrderDetail = {
	work_order: WorkOrder;
	history: {
		transitions: { action: string; from_state: string; to_state: string; reason: string; actor_id: string; at: string }[];
		attachment_ids: string[];
	};
	actions: string[];
};

export type Collection = {
	account_id: string;
	account_no: string;
	room_no: string;
	building_id: string;
	building: string;
	amount_fen: number;
	age_days: number;
	period_start: string;
	period_end: string;
	group: "dispute_hold" | "serious" | "gentle" | "focused";
	stage: "untouched" | "unreached" | "reached" | "promise";
	hold: boolean;
	last_touch_at: string | null;
	last_settled_at: string | null;
};
export type CollectionPage = { collections: Collection[]; totals: { accounts: number; amount_fen: number }; next_cursor: string };

export type Resident = {
	id: string;
	name: string;
	relation: string;
	main_contact: boolean;
	phone: string;
	contactable: boolean;
	consent: string;
	revision: number;
	identity: string;
	plate: string;
};

export type Bill = {
	id: string;
	account_id: string;
	account_no: string;
	room_no: string;
	charge: string;
	period_start: string;
	period_end: string;
	due_on: string;
	amount_fen: number;
	waiver_fen: number;
	paid: boolean;
	source: string;
	settlement_id: string;
};

export type ContactOption = { channel: "phone" | "sms" | "wechat" | "visit"; allowed: boolean; reason?: string; next_allowed_at?: string };
export type Touch = { id: string; channel: string; result: string; actor_id: string; recorded_at: string };
export type Communication = { id: string; account_id: string; author_id: string; channel: string; revision: number; text: string; created_at: string; room_no: string; building: string };

/** A section is null when this reader may not see it. */
export type Overview = {
	account: { id: string; account_no: string; room_no: string; building: string; unit: string; area: string; occupancy_status: string };
	residents: Resident[] | null;
	balance: { unpaid_fen: number; overdue_fen: number; bills: Bill[] } | null;
	collection: { collection: Collection | null; consented: boolean; channels: ContactOption[]; touches: Touch[] } | null;
	work_orders: WorkOrder[] | null;
	communications: Communication[] | null;
	followups: Followup[] | null;
	/** The project's calendar day. The browser's can differ, and dates are checked against this one. */
	today: string;
};

export type Publication = {
	id: string;
	kind: "announcement" | "assigned_task";
	creator_id: string;
	title: string;
	text: string;
	pinned: boolean;
	expires_at: string | null;
	due_at: string | null;
	created_at: string;
	read_at: string | null;
	completed_at: string | null;
	recipient_revision: number | null;
	recipient_count?: number;
	completed_count?: number;
	read_count?: number;
};
export type Recipient = { user_id: string; read_at: string | null; completed_at: string | null; explanation: string; available: boolean };

export const money = (fen: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "CNY" }).format(fen / 100);

/** Whether a role grants this permission over any building. A hint for menus: the module still decides. */
export function reaches(access: Access | undefined, key: string): boolean {
	const scope = access?.scopes[`property:${key}`];
	return scope !== undefined && (scope.all || Object.keys(scope.buildings).length > 0);
}

/** Also true for someone who only holds it for work assigned to them. */
export function holds(access: Access | undefined, key: string): boolean {
	const scope = access?.scopes[`property:${key}`];
	return scope !== undefined && (scope.all || scope.assigned_work || Object.keys(scope.buildings).length > 0);
}

export function useAccess() {
	const { tenant } = useWorkspace();
	return useQuery({ queryKey: ["property", tenant, "access"], queryFn: () => request<Access>(`${root}/access`), retry: false });
}

/** Names for the IDs records carry. Records hold IDs, so a name is only ever read, never stored. */
export function usePeople() {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const people = useQuery({ queryKey: ["property", tenant, "people"], queryFn: () => request<{ people: { user_id: string; name: string }[] }>(`${root}/people`), retry: false, staleTime: 60_000 });
	return {
		people: people.data?.people ?? [],
		name: (id: string) => people.data?.people.find((person) => person.user_id === id)?.name || t("Teammate"),
	};
}

/** Where a record reference opens, on this client. */
export function recordPath(target: string): string {
	const [, kind, id] = target.split(":");
	if (kind === undefined || id === undefined) return "property";
	if (kind === "account") return `property/accounts/${encodeURIComponent(id)}`;
	if (kind === "work_order") return `property/work-orders/${encodeURIComponent(id)}`;
	if (kind === "announcement" || kind === "assigned_task") return "property/messages";
	return "property";
}

export const eventLabel = (kind: string) =>
	kind === "announcement.created" ? "A new property announcement is available"
	: kind === "assigned_task.created" ? "A property task was assigned to you"
	: kind === "assigned_task.due" ? "A property task is due soon"
	: kind === "followup.overdue" ? "A property follow-up is overdue"
	: kind === "work_order.overdue" ? "A property work order is overdue"
	: kind.startsWith("work_order.") ? "A property work order was updated"
	: kind;

/** What the service says about an upload, in English, which a page shows in the reader's language. */
export const SERVER_MESSAGES = [
	"Use an XLSX file up to 4 MiB", "Invalid or oversized XLSX package", "Expanded workbook exceeds 32 MiB", "Macros and external data are not supported",
	"Invalid workbook", "Invalid worksheet XML", "Formulas are not allowed; paste values into the template", "Workbook could not be read",
	"Use a positive amount with at most two decimal places", "Amount must be positive", "Invalid account number",
	"Channel must be cash, transfer, pos or other (现金/转账/POS/其他)", "Use a past transaction time: YYYY-MM-DD HH:MM:SS (project timezone)",
	"Five populated columns are required", "Invalid room number", "Invalid charge name", "Billing period must be YYYY-MM", "Billing period must end before the opening cutoff",
	"Due date must be before cutoff (YYYY-MM-DD)", "Use a past or current month start for the opening cutoff",
	"Use a nonempty value of at most 160 bytes without control characters", "Use a valid phone number with 7–15 digits", "Area may be blank, or a positive number with up to four decimal places",
	"Use owner, tenant, family or other (业主/租户/家属/其他)", "Use vacant, owner_occupied or rented (空置/业主自住/出租), or leave blank", "Use a nonempty identity value of 5–80 characters, or leave blank",
	"Use a plate of at most 40 bytes without control characters", "ID details require registered granted consent; use a separate file or remove this value", "Vehicle details require registered granted consent; use a separate file or remove this value",
	"Use only the ten template columns", "A room appears more than once", "A room appears more than once; use one row per room and add other occupants after import", "Format ID values as text to preserve their exact characters",
	"Use 1–500 rows and a supported consent decision with required offline evidence", "Invalid source row number", "Room already exists; this import creates new rooms only",
	"Room or active billing account is unavailable in your bill-issue scope", "Charge name must match exactly one existing charge item", "An existing bill overlaps this account, charge and period",
	"No unique whole-bill match; select an account and bills or suspend", "Unique whole-bill match", "Exact duplicate receipt; not eligible for import",
];

/** Several messages can arrive joined, and an unknown one still reads, in English. */
export function serverText(t: (text: string, vars?: Record<string, string | number>) => string, message: string): string {
	if (SERVER_MESSAGES.includes(message)) return t(message);
	return message
		.split("; ")
		.map((part) => {
			const duplicate = /^Duplicate account\/charge\/period \(also row (\d+)\)$/.exec(part);
			if (duplicate !== null) return t("Duplicate account/charge/period (also row {row})", { row: duplicate[1] as string });
			return SERVER_MESSAGES.includes(part) ? t(part) : part;
		})
		.join("; ");
}

export const GROUPS: Record<Collection["group"], string> = { dispute_hold: "Dispute hold", serious: "High balance", gentle: "Light reminder", focused: "Focused" };
export const STAGES: Record<Collection["stage"], string> = { untouched: "Not contacted", unreached: "Not reached", reached: "Reached", promise: "Promised" };
export const CHANNELS: Record<string, string> = { phone: "Phone", sms: "SMS", wechat: "WeChat", visit: "Visit" };
export const CATEGORIES: Record<WorkOrder["category"], string> = { repair: "Repair", complaint: "Complaint", alarm: "Alarm" };
export const STATES: Record<WorkOrder["state"], string> = { pending: "Pending", processing: "In progress", acceptance: "Awaiting acceptance", completed: "Completed", withdrawn: "Withdrawn" };
export const REASONS: Record<string, string> = {
	no_permission: "Your role doesn't record contact",
	not_overdue: "Nothing is overdue",
	dispute_hold: "On hold for an open complaint",
	contact_cap: "Already contacted on this channel in the last 7 days",
	no_consent: "No consent on file, so use a visit or existing WeChat",
};
