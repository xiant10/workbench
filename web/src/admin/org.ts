import type { Member, Placement, Unit } from "./api.ts";

/**
 * The org chart as the Organization tab reads it: units by ID, their children, and each member's place. Everything
 * here is worked out in the browser from the two lists the auth service gives an admin.
 */
export type Org = {
	units: Map<string, Unit>;
	children: Map<string, Unit[]>;
	members: Map<string, Member>;
	/** Members still in the tenant with an active account, the only ones a lead or manager can be. */
	active: Member[];
};

export const TOP = "";

export function buildOrg(units: Unit[], members: Member[]): Org {
	const byId = new Map(units.map((unit) => [unit.id, unit]));
	const children = new Map<string, Unit[]>();
	for (const unit of units) {
		const parent = unit.parent_id !== undefined && byId.has(unit.parent_id) ? unit.parent_id : TOP;
		children.set(parent, [...(children.get(parent) ?? []), unit]);
	}
	for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	return { units: byId, children, members: new Map(members.map((member) => [member.user_id, member])), active: members.filter(isActive) };
}

export const isActive = (member: Member | undefined): member is Member => member !== undefined && member.status === "active" && member.user_status === "active";

/** What a person is called: their own name, else their sign-in name. */
export const nameOf = (member: Member | undefined, fallback = "") => member?.display_name || member?.name || member?.user_id || fallback;

/** The sign-in name, when it differs from what they're called, to tell two people with one name apart. */
export const loginOf = (member: Member) => (member.name !== "" && member.name !== nameOf(member) ? member.name : undefined);

/** Whether a search finds someone, by their own name, sign-in name or user ID. */
export const matches = (member: Member, q: string) => [member.display_name ?? "", member.name, member.user_id].some((text) => text.toLowerCase().includes(q));

/** The unit and those above it, nearest first. */
export function ancestry(org: Org, unitId: string | undefined): Unit[] {
	const out: Unit[] = [];
	for (let unit = unitId === undefined ? undefined : org.units.get(unitId); unit !== undefined && !out.includes(unit); unit = unit.parent_id === undefined ? undefined : org.units.get(unit.parent_id)) out.push(unit);
	return out;
}

/** The unit and every unit beneath it. */
export function subtree(org: Org, unitId: string): Set<string> {
	const out = new Set<string>();
	const visit = (id: string) => {
		if (out.has(id)) return;
		out.add(id);
		for (const child of org.children.get(id) ?? []) visit(child.id);
	};
	visit(unitId);
	return out;
}

/** Active members in the unit and the units beneath it. */
export function headcount(org: Org, unitId: string): number {
	const ids = subtree(org, unitId);
	return org.active.filter((member) => member.org_unit_id !== undefined && ids.has(member.org_unit_id)).length;
}

export const membersOf = (org: Org, unitId: string) => [...org.members.values()].filter((member) => (member.org_unit_id ?? TOP) === unitId && (unitId !== TOP || isActive(member)));

/**
 * Who someone placed in a unit reports to by default: the nearest active lead up from that unit who isn't them. A
 * unit's own lead reports to the lead of the unit above.
 */
export function defaultManager(org: Org, unitId: string, userId: string): Member | undefined {
	for (const unit of ancestry(org, unitId)) {
		const lead = unit.lead_user_id === undefined ? undefined : org.members.get(unit.lead_user_id);
		if (isActive(lead) && lead.user_id !== userId) return lead;
	}
	return undefined;
}

export const placementOf = (member: Member): Placement => ({ user_id: member.user_id, manager_user_id: member.manager_user_id ?? "", org_unit_id: member.org_unit_id ?? "" });

/** Whether making `managerId` someone's manager would put them under themselves. */
export function wouldLoop(org: Org, userId: string, managerId: string): boolean {
	const seen = new Set<string>();
	for (let at: string | undefined = managerId; at !== undefined && at !== "" && !seen.has(at); at = org.members.get(at)?.manager_user_id) {
		if (at === userId) return true;
		seen.add(at);
	}
	return false;
}

/**
 * The placements that move people into a unit. With `toLead`, each one reports to the unit's default manager, when
 * there is one and it makes no loop; otherwise they keep their manager.
 */
export function moveInto(org: Org, userIds: string[], unitId: string, toLead: boolean): Placement[] {
	return userIds.flatMap((id) => {
		const member = org.members.get(id);
		if (member === undefined) return [];
		const lead = toLead && unitId !== TOP ? defaultManager(org, unitId, id) : undefined;
		const manager = lead !== undefined && !wouldLoop(org, id, lead.user_id) ? lead.user_id : (member.manager_user_id ?? "");
		return [{ user_id: id, manager_user_id: manager, org_unit_id: unitId }];
	});
}

/**
 * The placements that follow a new lead: the lead goes into the unit if they have no unit yet, and with `report`, the
 * unit's other active members report to them. The lead comes first, and moves up to the lead above if they'd report
 * to someone who will report to them.
 */
export function followLead(org: Org, unitId: string, leadId: string, report: boolean): Placement[] {
	const lead = org.members.get(leadId);
	if (lead === undefined) return [];
	const others = report ? membersOf(org, unitId).filter((member) => isActive(member) && member.user_id !== leadId) : [];
	const reporting = new Set(others.map((member) => member.user_id));
	const out: Placement[] = [];
	const unit = lead.org_unit_id ?? TOP;
	const loops = lead.manager_user_id !== undefined && reporting.has(lead.manager_user_id);
	if (unit === TOP || loops) {
		const above = loops ? defaultManager(org, org.units.get(unitId)?.parent_id ?? TOP, leadId) : undefined;
		out.push({ user_id: leadId, manager_user_id: loops ? (above?.user_id ?? "") : (lead.manager_user_id ?? ""), org_unit_id: unit === TOP ? unitId : unit });
	}
	for (const member of others) if (member.manager_user_id !== leadId) out.push({ ...placementOf(member), manager_user_id: leadId });
	return out;
}

export type Warning = "manager_left" | "outside_unit";

/**
 * What looks wrong about someone's reporting line: their manager left, or sits outside the units above theirs. A
 * manager in a unit above, or beside them in theirs, is the usual case and isn't flagged.
 */
export function warningOf(org: Org, member: Member): Warning | undefined {
	if (member.manager_user_id === undefined || member.manager_user_id === "") return undefined;
	const manager = org.members.get(member.manager_user_id);
	if (!isActive(manager)) return "manager_left";
	if (member.org_unit_id === undefined || manager.org_unit_id === undefined) return undefined;
	if (ancestry(org, member.org_unit_id).some((unit) => unit.id === manager.org_unit_id)) return undefined;
	// A lead's manager often sits in the unit above, but so does the lead of a unit beside theirs.
	if (ancestry(org, manager.org_unit_id).some((unit) => unit.id === member.org_unit_id && unit.lead_user_id === manager.user_id)) return undefined;
	return "outside_unit";
}

/** The nearest active manager up the chain, as the auth service tells modules, so someone leaving cuts no one off. */
export function activeManager(org: Org, member: Member): Member | undefined {
	const seen = new Set([member.user_id]);
	for (let at = member.manager_user_id; at !== undefined && at !== "" && !seen.has(at); at = org.members.get(at)?.manager_user_id) {
		const manager = org.members.get(at);
		if (isActive(manager)) return manager;
		seen.add(at);
	}
	return undefined;
}

/** The reporting lines: people with no active manager at the top, each with their direct reports. */
export function reportingForest(org: Org): { roots: Member[]; reports: Map<string, Member[]> } {
	const reports = new Map<string, Member[]>();
	const roots: Member[] = [];
	for (const member of org.active) {
		const manager = activeManager(org, member);
		if (manager !== undefined) reports.set(manager.user_id, [...(reports.get(manager.user_id) ?? []), member]);
		else roots.push(member);
	}
	const byName = (a: Member, b: Member) => nameOf(a).localeCompare(nameOf(b));
	roots.sort((a, b) => (reports.get(b.user_id)?.length ?? 0) - (reports.get(a.user_id)?.length ?? 0) || byName(a, b));
	for (const list of reports.values()) list.sort(byName);
	return { roots, reports };
}

/** How many people are beneath someone, all the way down. */
export function teamSize(reports: Map<string, Member[]>, userId: string, seen = new Set<string>()): number {
	if (seen.has(userId)) return 0;
	seen.add(userId);
	return (reports.get(userId) ?? []).reduce((sum, member) => sum + 1 + teamSize(reports, member.user_id, seen), 0);
}
