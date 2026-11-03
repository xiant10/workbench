import { ApiError, postJSON, request } from "../lib/api.ts";

/**
 * The auth service's tenant routes, through `/api/org/<tenant>/`. The auth service decides every call: that the
 * token's tenant is this one, and that its holder administers it.
 */

export type Role = "member" | "admin";
export type MemberStatus = "active" | "inactive";

export type Tenant = { id: string; name: string; status: string; require_mfa: boolean };

export type Member = {
	user_id: string;
	name: string;
	role: Role;
	status: MemberStatus;
	/** The account's own status, which a platform admin sets for every tenant at once. */
	user_status: string;
	/** The manager as an admin set them, who may have left since. Saving it back keeps the link. */
	manager_user_id?: string;
	manager_name?: string;
	org_unit_id?: string;
	org_unit_name?: string;
};

export type UnitKind = "department" | "team";
export type Unit = { id: string; parent_id?: string; name: string; kind: UnitKind };

export type Grant = { id: string; parent_id?: string; runtime_id: string; user_id: string; who: string; actions: string[]; created_at: string; expires_at: string; running: boolean };

export type AuditRecord = { at: string; actor: string; action: string; target: string; outcome: string };

const base = (tenant: string, rest = "") => `/api/org/${encodeURIComponent(tenant)}${rest === "" ? "" : `/${rest}`}`;

function send<T>(method: string, path: string, body?: unknown): Promise<T> {
	return request<T>(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

export const getTenant = (tenant: string) => request<Tenant>(base(tenant));
export const setRequireMFA = (tenant: string, required: boolean) => send<Tenant>("PATCH", base(tenant), { require_mfa: required });

export const listMembers = (tenant: string) => request<{ members: Member[] }>(base(tenant, "members")).then((body) => body.members);
export const updateMember = (tenant: string, user: string, change: { role?: Role; status?: MemberStatus }) => send<unknown>("PATCH", base(tenant, `members/${encodeURIComponent(user)}`), change);
export const setPlacement = (tenant: string, user: string, placement: { manager_user_id: string; org_unit_id: string }) =>
	send<unknown>("PUT", base(tenant, `members/${encodeURIComponent(user)}/placement`), placement);
export const resetLink = (tenant: string, user: string) => postJSON<{ reset_url: string }>(base(tenant, `members/${encodeURIComponent(user)}/reset-link`), {}).then((body) => body.reset_url);
export const invite = (tenant: string, role: Role) => postJSON<{ invite_url: string; join_url: string }>(base(tenant, "invitations"), { role });

export const listUnits = (tenant: string) => request<{ units: Unit[] }>(base(tenant, "units")).then((body) => body.units);
export const createUnit = (tenant: string, unit: Omit<Unit, "id">) => postJSON<Unit>(base(tenant, "units"), unit);
export const updateUnit = (tenant: string, unit: Unit) => send<Unit>("PUT", base(tenant, `units/${encodeURIComponent(unit.id)}`), { name: unit.name, kind: unit.kind, parent_id: unit.parent_id ?? "" });
export const deleteUnit = (tenant: string, id: string) => send<void>("DELETE", base(tenant, `units/${encodeURIComponent(id)}`));

export const listGrants = (tenant: string) => request<{ grants: Grant[] }>(base(tenant, "grants")).then((body) => body.grants);
export const revokeGrant = (tenant: string, id: string) => postJSON<unknown>(base(tenant, `grants/${encodeURIComponent(id)}/revoke`), {});

export const listAudit = (tenant: string) => request<{ records: AuditRecord[] }>(base(tenant, "audit")).then((body) => body.records);

/** The auth service's own reasons, in English like every string here. Anything else falls back to the usual text. */
const REASONS: Record<string, string> = {
	last_admin: "A tenant needs at least one active admin. Make someone else an admin first.",
	cycle: "That would put someone, or a unit, under itself.",
	unit_in_use: "Move this unit's members and child units out first.",
	conflict: "That already exists.",
	invalid_request: "That value isn't valid.",
	mfa_needed: "Sign in with an authenticator before requiring one, or you'd lock yourself out.",
	forbidden: "Only a platform admin can do that for an admin, or for someone in another tenant.",
};

/** What went wrong, in words a tenant admin can act on. */
export function reason(error: Error): string | undefined {
	return error instanceof ApiError ? REASONS[error.code] : undefined;
}

/** Units in tree order, each with its depth, for lists and pickers. */
export function unitTree(units: Unit[]): { unit: Unit; depth: number }[] {
	const out: { unit: Unit; depth: number }[] = [];
	const ids = new Set(units.map((unit) => unit.id));
	const visit = (parent: string | undefined, depth: number) => {
		for (const unit of units.filter((candidate) => (candidate.parent_id !== undefined && ids.has(candidate.parent_id) ? candidate.parent_id : undefined) === parent).sort((a, b) => a.name.localeCompare(b.name))) {
			out.push({ unit, depth });
			visit(unit.id, depth + 1);
		}
	};
	visit(undefined, 0);
	return out;
}
