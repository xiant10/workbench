import { describe, expect, it } from "vitest";
import { fromCron, toCron } from "./api.ts";

describe("schedules the form writes", () => {
	it("round-trips a time on chosen days", () => {
		expect(toCron({ hour: 8, minute: 0, days: [5, 1, 2, 3, 4] })).toBe("0 8 * * 1-5");
		expect(toCron({ hour: 7, minute: 30, days: [0, 1, 2, 3, 4, 5, 6] })).toBe("30 7 * * *");
		expect(toCron({ hour: 18, minute: 5, days: [6, 0] })).toBe("5 18 * * 0,6");
		expect(fromCron("0 8 * * 1-5")).toEqual({ hour: 8, minute: 0, days: [1, 2, 3, 4, 5] });
		expect(fromCron("5 18 * * 0,6")).toEqual({ hour: 18, minute: 5, days: [0, 6] });
	});

	it("leaves anything else as written", () => {
		expect(fromCron("*/15 9-17 * * 1-5")).toBeUndefined();
		expect(fromCron("0 8 1 * *")).toBeUndefined();
		expect(fromCron("")).toBeUndefined();
		expect(fromCron("60 8 * * *")).toBeUndefined();
		expect(fromCron("0 24 * * *")).toBeUndefined();
		expect(fromCron("0 8 * * 1,1")).toBeUndefined();
	});
});
