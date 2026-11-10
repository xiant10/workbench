import { describe, expect, it } from "vitest";
import type { Member, Unit } from "./api.ts";
import { buildOrg, defaultManager, followLead, headcount, loginOf, matches, moveInto, nameOf, reportingForest, teamSize, warningOf, wouldLoop } from "./org.ts";

const member = (user_id: string, extra: Partial<Member> = {}): Member => ({ user_id, name: user_id, role: "member", status: "active", user_status: "active", ...extra });

const units: Unit[] = [
	{ id: "sales", name: "Sales", kind: "department", lead_user_id: "boss" },
	{ id: "east", parent_id: "sales", name: "East", kind: "team", lead_user_id: "eve" },
	{ id: "west", parent_id: "sales", name: "West", kind: "team" },
	{ id: "eng", name: "Engineering", kind: "department" },
];

const people = [
	member("boss", { org_unit_id: "sales" }),
	member("eve", { org_unit_id: "east", manager_user_id: "boss" }),
	member("ann", { org_unit_id: "east", manager_user_id: "eve" }),
	member("bob", { org_unit_id: "west" }),
	member("gone", { status: "inactive", org_unit_id: "eng" }),
	member("cat", { org_unit_id: "eng", manager_user_id: "gone" }),
	member("new"),
];

describe("org chart", () => {
	const org = buildOrg(units, people);

	it("counts the active people in a unit and beneath it", () => {
		expect(headcount(org, "sales")).toBe(4);
		expect(headcount(org, "eng")).toBe(1);
	});

	it("defaults to the nearest lead above who isn't the person", () => {
		expect(defaultManager(org, "east", "ann")?.user_id).toBe("eve");
		expect(defaultManager(org, "east", "eve")?.user_id).toBe("boss");
		expect(defaultManager(org, "west", "bob")?.user_id).toBe("boss");
		expect(defaultManager(org, "eng", "cat")).toBeUndefined();
	});

	it("moves people in, reporting to the lead, or keeping their manager", () => {
		expect(moveInto(org, ["new", "cat"], "west", true)).toEqual([
			{ user_id: "new", manager_user_id: "boss", org_unit_id: "west" },
			{ user_id: "cat", manager_user_id: "boss", org_unit_id: "west" },
		]);
		expect(moveInto(org, ["cat"], "west", false)).toEqual([{ user_id: "cat", manager_user_id: "gone", org_unit_id: "west" }]);
		// The boss can't report to someone who reports to them.
		expect(moveInto(org, ["boss"], "east", true)).toEqual([{ user_id: "boss", manager_user_id: "", org_unit_id: "east" }]);
	});

	it("spots a loop", () => {
		expect(wouldLoop(org, "boss", "ann")).toBe(true);
		expect(wouldLoop(org, "ann", "boss")).toBe(false);
	});

	it("follows a new lead, moving the lead up when they'd report to their own report", () => {
		const after = buildOrg(
			units.map((unit) => (unit.id === "east" ? { ...unit, lead_user_id: "ann" } : unit)),
			people,
		);
		expect(followLead(after, "east", "ann", true)).toEqual([
			{ user_id: "ann", manager_user_id: "boss", org_unit_id: "east" },
			{ user_id: "eve", manager_user_id: "ann", org_unit_id: "east" },
		]);
		const placed = buildOrg(units, people);
		expect(followLead(placed, "west", "new", false)).toEqual([{ user_id: "new", manager_user_id: "", org_unit_id: "west" }]);
	});

	it("flags a manager who left, or one outside the units above", () => {
		const odd = buildOrg(units, [...people, member("dan", { org_unit_id: "west", manager_user_id: "eve" })]);
		expect(warningOf(odd, odd.members.get("cat") as Member)).toBe("manager_left");
		expect(warningOf(odd, odd.members.get("dan") as Member)).toBe("outside_unit");
		expect(warningOf(odd, odd.members.get("eve") as Member)).toBeUndefined();
		expect(warningOf(odd, odd.members.get("ann") as Member)).toBeUndefined();
	});

	it("draws reporting lines through someone who left", () => {
		const chain = buildOrg(units, [member("top"), member("mid", { status: "inactive", manager_user_id: "top" }), member("low", { manager_user_id: "mid" })]);
		const { roots, reports } = reportingForest(chain);
		expect(roots.map((root) => root.user_id)).toEqual(["top"]);
		expect(reports.get("top")?.map((report) => report.user_id)).toEqual(["low"]);
		expect(teamSize(reportingForest(org).reports, "boss")).toBe(2);
	});

	it("calls people by their own name, keeping the sign-in name to tell them apart", () => {
		const named = member("u1", { name: "+8613900000001", display_name: "王丽娟" });
		expect(nameOf(named)).toBe("王丽娟");
		expect(loginOf(named)).toBe("+8613900000001");
		expect(nameOf(member("u2", { name: "grace" }))).toBe("grace");
		expect(loginOf(member("u3", { name: "grace", display_name: "grace" }))).toBeUndefined();
		expect(matches(named, "王丽")).toBe(true);
		expect(matches(named, "8613900000001")).toBe(true);
	});
});
