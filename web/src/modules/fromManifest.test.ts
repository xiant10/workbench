import { describe, expect, it } from "vitest";
import { appHref, appUrl, moduleFromManifest, type ModuleManifest } from "./fromManifest.tsx";

const manifest: ModuleManifest = {
	id: "property",
	api_version: 1,
	features: [],
	app: { url: "https://property.example/", label: "Property", label_zh: "物业", icon: "building" },
	events: { "work_order.overdue": { label: "A work order is overdue", label_zh: "工单已逾期" } },
};

describe("a module described by its manifest", () => {
	it("becomes a menu entry that links out, in the reader's language", () => {
		const module = moduleFromManifest(manifest, "zh");
		expect(module?.nav[0]).toMatchObject({ label: "物业", href: "https://property.example" });
		expect(module?.routes).toEqual([]);
		expect(module?.access).toBe("role");
		expect(module?.eventLabel("work_order.overdue")).toBe("工单已逾期");
		expect(module?.eventLabel("something.new")).toBe("something.new");
	});

	it("refuses an address that isn't http or https", () => {
		for (const url of ["javascript:alert(1)", "data:text/html,x", "not a url", "//evil.example"]) {
			expect(appUrl({ app: { url, label: "x", label_zh: "x" } })).toBeUndefined();
		}
		expect(moduleFromManifest({ ...manifest, app: { url: "javascript:alert(1)", label: "x", label_zh: "x" } }, "en")).toBeUndefined();
	});

	it("keeps a tenant in the address it links to", () => {
		expect(appHref("https://p.example", "ten a", "/work-orders?mine=1")).toBe("https://p.example/t/ten%20a/work-orders?mine=1");
	});
});
