import { describe, expect, it } from "vitest";
import { withNames } from "./usePeople.ts";

describe("withNames", () => {
	const names: Record<string, string> = { usr_76d4: "Mei Lin", acc_1855: "Quote desk" };
	const nameOf = (id: string) => names[id];

	it("writes a known member's ID as their name", () => {
		expect(withNames("@usr_76d4 Is Contoso on partner tier? cc @acc_1855", nameOf)).toBe("@Mei Lin Is Contoso on partner tier? cc @Quote desk");
	});

	it("leaves an unknown ID and other text alone", () => {
		expect(withNames("@usr_beef and mail@example.com and @Mei", nameOf)).toBe("@usr_beef and mail@example.com and @Mei");
	});
});
