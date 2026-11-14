import { describe, expect, it } from "vitest";
import { insertMention, mentionedIds, mentionQuery } from "./CommentBox.tsx";

describe("mentions in a comment", () => {
	it("finds the name being typed after an @", () => {
		expect(mentionQuery("Thanks @Me", 10)).toBe("Me");
		expect(mentionQuery("@", 1)).toBe("");
		expect(mentionQuery("mail@example", 12)).toBeUndefined();
		expect(mentionQuery("@Mei done", 9)).toBeUndefined();
	});

	it("writes the picked name in place of what was typed", () => {
		expect(insertMention("Thanks @Me, see", 10, "Mei Lin")).toEqual({ text: "Thanks @Mei Lin , see", caret: 16 });
	});

	it("tells only those still mentioned, once each", () => {
		const picks = [{ id: "usr_1", name: "Mei Lin" }, { id: "acc_2", name: "Quote desk" }, { id: "usr_1", name: "Mei Lin" }];
		expect(mentionedIds("@Mei Lin which tier?", picks)).toEqual(["usr_1"]);
	});
});
