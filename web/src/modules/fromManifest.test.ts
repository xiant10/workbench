import { describe, expect, it } from "vitest";
import { AppWindow, Building2 } from "lucide-react";
import { appHref, appUrl, iconOf, moduleFromManifest, type ModuleManifest } from "./fromManifest.tsx";

const manifest: ModuleManifest = {
	id: "property",
	api_version: 1,
	features: [],
	app: { url: "https://property.example/", label: "Property", label_zh: "物业", icon: "building" },
	events: { "work_order.overdue": { label: "A work order is overdue", label_zh: "工单已逾期" }, "work_order.*": { label: "A work order changed", label_zh: "工单有更新" } },
};

describe("a module described by its manifest", () => {
	it("becomes a menu entry that links out, in the reader's language", () => {
		const module = moduleFromManifest(manifest, "zh");
		expect(module?.nav[0]).toMatchObject({ label: "物业", href: "https://property.example" });
		expect(module?.routes).toEqual([]);
		expect(module?.access).toBe("role");
		expect(module?.eventLabel("work_order.overdue")).toBe("工单已逾期");
		expect(module?.eventLabel("work_order.transfer")).toBe("工单有更新");
		expect(module?.eventLabel("something.new")).toBe("something.new");
	});

	it("refuses an address that isn't http or https", () => {
		for (const url of ["javascript:alert(1)", "data:text/html,x", "not a url", "//evil.example"]) {
			expect(appUrl({ app: { url, label: "x", label_zh: "x" } })).toBeUndefined();
		}
		expect(moduleFromManifest({ ...manifest, app: { url: "javascript:alert(1)", label: "x", label_zh: "x" } }, "en")).toBeUndefined();
	});

	it("uses the module's own icon, or a named one, or a generic one", () => {
		const app = { url: "https://f.example", label: "Facilities", label_zh: "设施" };
		expect(iconOf({ ...app, icon: "building" })).toBe(Building2);
		expect(iconOf({ ...app, icon: "unknown" })).toBe(AppWindow);
		expect(iconOf({ ...app, icon: "building", icon_svg: '<svg viewBox="0 0 24 24"><path d="M3 3h18"/></svg>' })).not.toBe(Building2);
		expect(iconOf({ ...app, icon_svg: "<script>alert(1)</script>" })).toBe(AppWindow);
		expect(iconOf({ ...app, icon_svg: `<svg>${"x".repeat(9000)}</svg>` })).toBe(AppWindow);
	});

	it("asks for a role unless the module says every member can use it", () => {
		expect(moduleFromManifest({ ...manifest, app: { url: "https://f.example", label: "F", label_zh: "F", access: "member" } }, "en")?.access).toBeUndefined();
		expect(moduleFromManifest({ ...manifest, app: { url: "https://f.example", label: "F", label_zh: "F", access: "role" } }, "en")?.access).toBe("role");
	});

	it("keeps a tenant in the address it links to", () => {
		expect(appHref("https://p.example", "ten a", "/work-orders?mine=1")).toBe("https://p.example/t/ten%20a/work-orders?mine=1");
	});
});
