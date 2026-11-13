import { describe, expect, it } from "vitest";
import type { WorkbenchModule } from "./types.ts";
import { recordPage } from "./useNotifications.ts";

const collab = { id: "collab", records: { work_item: "tasks/:id", list: "lists/:id" } } as unknown as WorkbenchModule;
const automations = { id: "automations" } as unknown as WorkbenchModule;

describe("recordPage", () => {
	it("opens a record the module that owns it has a page for, whichever module notified", () => {
		expect(recordPage([automations, collab], "collab:work_item:wi_1")).toBe("tasks/wi_1");
		expect(recordPage([automations, collab], "collab:list:li_1")).toBe("lists/li_1");
	});
	it("has no page for a record nobody shows, an unknown module, or a malformed target", () => {
		expect(recordPage([automations, collab], "automations:automation:au_1")).toBeUndefined();
		expect(recordPage([automations], "collab:work_item:wi_1")).toBeUndefined();
		expect(recordPage([collab], "collab:work_item:")).toBeUndefined();
		expect(recordPage([collab], "collab:work_item:a:b")).toBeUndefined();
		expect(recordPage([collab], undefined)).toBeUndefined();
	});
});
