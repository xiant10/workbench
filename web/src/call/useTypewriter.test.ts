import { describe, expect, it } from "vitest";
import { nextShown } from "./useTypewriter.ts";

describe("nextShown", () => {
	it("advances at speech pace", () => {
		expect(nextShown(0, 20, 1)).toBe(18);
	});
	it("always moves at least one character", () => {
		expect(nextShown(0, 100, 0.001)).toBe(1);
	});
	it("catches up when far behind", () => {
		expect(nextShown(0, 300, 1)).toBe(200);
	});
	it("stops at the end", () => {
		expect(nextShown(98, 100, 1)).toBe(100);
		expect(nextShown(100, 100, 1)).toBe(100);
	});
});
