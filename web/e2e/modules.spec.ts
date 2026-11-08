import { expect, test, type Page } from "@playwright/test";

// Which modules a person sees: deployed, down, or held back by business roles. Everything under /api is mocked, so this
// needs only the page. See docs/module-visibility.md.
type Config = { modules?: (string | { id: string; api_version: number; [key: string]: unknown })[]; unavailable?: string[]; access?: { modules: string[]; module_admin: string[] } };
type State = Config & { role?: "member" | "admin"; asked: string[]; configFails?: boolean };

// Facilities, a made-up app, has its own app, so this build knows it only from its manifest.
const FACILITIES = { id: "facilities", api_version: 1, app: { url: "http://facilities.test", label: "Facilities", label_zh: "设施" } };
const ALL = ["collab", "automations", "knowledge", FACILITIES, "agents"];

async function open(page: Page, state: State, path = "/t/ten_a/") {
	await page.clock.install();
	await page.route("**/api/**", (route) => {
		const { pathname } = new URL(route.request().url());
		const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
		if (pathname === "/api/me") return json({ user_id: "usr_a", display_name: "Wei", sign_in_name: "wei", active_tenant: "ten_a", tenants: [{ id: "ten_a", name: "Acme", role: state.role ?? "member" }] });
		if (pathname === "/api/config") {
			if (state.configFails === true) return json({ error: "unavailable" }, 503);
			return json({
				agents: ["assistant"], profiles: ["chat"], voice: false, account_url: "http://auth.test/v1/account", unavailable_modules: state.unavailable ?? [],
				modules: (state.modules ?? ALL).map((entry) => (typeof entry === "string" ? { id: entry, api_version: 1, features: [] } : { ...entry, features: [] })),
				...(state.access === undefined ? {} : { access: state.access }),
			});
		}
		if (pathname.startsWith("/api/modules/")) {
			state.asked.push(pathname);
			const id = pathname.split("/")[3] ?? "";
			const listed = [...(state.modules ?? ALL).map((entry) => (typeof entry === "string" ? entry : entry.id)), ...(state.unavailable ?? [])];
			if (!listed.includes(id)) return json({ error: "unknown_module", message: "that module isn't available here" }, 404);
			if (pathname === "/api/modules/deals/notifications") return json({ notifications: dealsNotifications, cursor: "c1" });
			if (pathname.endsWith("/notifications")) return json({ notifications: [], cursor: "" });
			if (pathname === "/api/modules/deals/attention") return json({ open: 2, late: 1 });
			if (pathname === "/api/modules/deals/me/nav") return json({ sections: dealsSections });
			if (pathname === "/api/modules/knowledge/bases") return json({ bases: [] });
			if (pathname === "/api/modules/knowledge/admin/collections" || pathname === "/api/modules/knowledge/collections") return json({ collections: [] });
			return json({ offers: [], items: [], people: [], units: [], approvals: [], automations: [], connectors: [], connections: [], skills: [], drafts: [], documents: [], project: { id: "p" }, scopes: [] });
		}
		if (pathname.startsWith("/api/org/")) return json({ members: [], roles: [], units: [], modules: [], unavailable: [], records: [] });
		const method = route.request().headers()["agent-method"];
		return json({ jsonrpc: "2.0", id: 1, result: method === "session.list" ? { sessions: [] } : method === "agents.list" ? { agents: [{ name: "assistant" }] } : {} });
	});
	await page.goto(path);
	await expect(page.getByRole("link", { name: "New conversation" })).toBeVisible();
}

const refresh = (page: Page) => page.clock.fastForward("05:01");
const entry = (page: Page, name: string) => page.locator(".nav-links .nav-link", { hasText: name });

test.describe("not deployed", () => {
	test("Skills and Connectors go with the agents module", async ({ page }) => {
		await open(page, { role: "admin", asked: [], modules: ["collab"] });
		for (const name of ["Skills", "Connectors", "Approvals", "Automations", "Knowledge", "Facilities"]) await expect(entry(page, name)).toHaveCount(0);
		await expect(entry(page, "Tasks")).toBeVisible();
		await expect(entry(page, "Administration")).toBeVisible();
	});

	test("the palette offers only what's deployed", async ({ page }) => {
		await open(page, { role: "admin", asked: [], modules: ["collab"] });
		await page.locator(".search-button").click();
		await page.getByRole("combobox", { name: "Search", exact: true }).fill("Skills");
		await expect(page.locator("#palette-list").getByRole("option")).toHaveCount(0);
	});

	for (const path of ["/t/ten_a/skills", "/t/ten_a/connectors", "/t/ten_a/connections", "/t/ten_a/approvals"]) {
		test(`a direct link to ${path} goes Home, asking nothing of the module`, async ({ page }) => {
			const asked: string[] = [];
			await open(page, { role: "admin", asked, modules: ["collab"] }, path);
			await expect(page).toHaveURL(/\/t\/ten_a$/);
			expect(asked.filter((call) => call.startsWith("/api/modules/agents"))).toEqual([]);
		});
	}

	test("Administration loses the module's tabs", async ({ page }) => {
		await open(page, { role: "admin", asked: [], modules: ["collab"] }, "/t/ten_a/admin?tab=skills");
		await expect(page.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "true");
		await expect(page.getByRole("tab", { name: "Skills" })).toHaveCount(0);
		await expect(page.getByRole("tab", { name: "Facilities" })).toHaveCount(0);
	});

	test("a version this build doesn't know is hidden", async ({ page }) => {
		await open(page, { asked: [], modules: ["collab", { id: "knowledge", api_version: 2 }] });
		await expect(entry(page, "Knowledge")).toHaveCount(0);
	});
});

test.describe("deployed", () => {
	test("an admin gets Skills in the sidebar, palette and Administration; a member gets Connectors only", async ({ page, browser }) => {
		await open(page, { role: "admin", asked: [] });
		await expect(page.getByTestId("nav-skills")).toBeVisible();
		await expect(page.getByTestId("nav-connectors")).toBeVisible();
		await page.locator(".search-button").click();
		await page.getByRole("combobox", { name: "Search", exact: true }).fill("Skills");
		await expect(page.locator("#palette-list").getByRole("option", { name: "Skills" })).toBeVisible();
		await page.goto("/t/ten_a/admin?tab=skills");
		await expect(page.getByRole("tab", { name: "Skills" })).toHaveAttribute("aria-selected", "true");

		const member = await (await browser.newContext()).newPage();
		await open(member, { role: "member", asked: [] });
		await expect(member.getByTestId("nav-connectors")).toBeVisible();
		await expect(member.getByTestId("nav-skills")).toHaveCount(0);
		await member.locator(".search-button").click();
		await member.getByRole("combobox", { name: "Search", exact: true }).fill("Skills");
		await expect(member.locator("#palette-list").getByRole("option")).toHaveCount(0);
	});

	test("the routes still open", async ({ page }) => {
		await open(page, { role: "admin", asked: [] }, "/t/ten_a/connectors");
		await expect(page).toHaveURL(/\/connectors$/);
		await expect(page.getByRole("heading", { name: "Connectors", exact: true })).toBeVisible();
	});
});

test.describe("deployed but down", () => {
	test("keeps its menu entry, without polling, and its page offers Retry", async ({ page }) => {
		const state: State = { asked: [], unavailable: ["automations"], modules: ["collab", "agents"] };
		await open(page, state, "/t/ten_a/automations");
		await expect(page).toHaveURL(/\/automations$/);
		await expect(entry(page, "Automations")).toHaveClass(/unavailable/);
		await expect(page.getByText("Automations is unavailable right now.")).toBeVisible();
		await page.waitForTimeout(300);
		expect(state.asked.filter((call) => call.includes("automations"))).toEqual([]);

		state.unavailable = [];
		state.modules = ["collab", "agents", "automations"];
		await page.getByRole("button", { name: "Retry" }).click();
		await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();
		await expect(entry(page, "Automations")).not.toHaveClass(/unavailable/);
	});

	test("a page already open stays open, with what was typed", async ({ page }) => {
		const state: State = { asked: [] };
		await open(page, state, "/t/ten_a/automations");
		const box = page.getByLabel("Name").first();
		await box.fill("Morning brief");
		state.unavailable = ["automations"];
		state.modules = ALL.filter((id) => id !== "automations");
		await refresh(page);
		await expect(entry(page, "Automations")).toHaveClass(/unavailable/);
		await expect(box).toHaveValue("Morning brief");
	});

	test("Administration's tab for it says so", async ({ page }) => {
		await open(page, { role: "admin", asked: [], unavailable: ["knowledge"], modules: ["collab"] }, "/t/ten_a/admin?tab=knowledge");
		await expect(page.getByRole("tab", { name: "Knowledge" })).toHaveAttribute("aria-selected", "true");
		await expect(page.getByText("Knowledge is unavailable right now.")).toBeVisible();
	});
});

test.describe("an open tab keeps up", () => {
	test("a module removed from the deployment leaves the menu", async ({ page }) => {
		const state: State = { asked: [] };
		await open(page, state);
		await expect(entry(page, "Knowledge")).toBeVisible();
		state.modules = ALL.filter((id) => id !== "knowledge");
		await refresh(page);
		await expect(entry(page, "Knowledge")).toHaveCount(0);
	});

	test("a call answered unknown_module refreshes at once", async ({ page }) => {
		const state: State = { asked: [] };
		await open(page, state);
		state.modules = ALL.filter((id) => id !== "knowledge");
		await page.getByTestId("nav-knowledge").click();
		await expect(entry(page, "Knowledge")).toHaveCount(0);
		await expect(page).toHaveURL(/\/t\/ten_a$/);
	});

	test("a failed refresh keeps the app up", async ({ page }) => {
		const state: State = { asked: [] };
		await open(page, state);
		state.configFails = true;
		await refresh(page);
		await page.waitForTimeout(300);
		await expect(entry(page, "Knowledge")).toBeVisible();
		await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
	});
});

test.describe("business roles", () => {
	const none = { modules: [], module_admin: [] };
	const holds = { modules: ["facilities"], module_admin: [] };

	test("no role: no menu entry, and a direct link explains", async ({ page }) => {
		const state: State = { asked: [], access: none };
		await open(page, state);
		await expect(entry(page, "Facilities")).toHaveCount(0);
		await expect(entry(page, "Knowledge")).toBeVisible();
		expect(state.asked.filter((call) => call.includes("facilities"))).toEqual([]);
		// The app is what says so.
		await page.route("http://facilities.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>the app</h1>" }));
		await page.goto("/t/ten_a/facilities");
		await page.waitForURL("http://facilities.test/t/ten_a/");
	});

	test("a role shows it", async ({ page }) => {
		await open(page, { asked: [], access: holds });
		await expect(entry(page, "Facilities")).toBeVisible();
	});

	test("a tenant admin always sees it", async ({ page }) => {
		await open(page, { role: "admin", asked: [], access: none });
		await expect(entry(page, "Facilities")).toBeVisible();
	});

	test("when access isn't known, the module is shown, and it refuses for itself", async ({ page }) => {
		await open(page, { asked: [] });
		await expect(entry(page, "Facilities")).toBeVisible();
	});

	test("a role doesn't bring back a module that isn't deployed", async ({ page }) => {
		await open(page, { asked: [], access: holds, modules: ["collab"] });
		await expect(entry(page, "Facilities")).toHaveCount(0);
	});

	test("no role and down: still hidden", async ({ page }) => {
		await open(page, { asked: [], access: none, unavailable: ["facilities"], modules: ["collab"] });
		await expect(entry(page, "Facilities")).toHaveCount(0);
	});

	test("modules without roles stay with every member", async ({ page }) => {
		await open(page, { asked: [], access: none });
		for (const name of ["Tasks", "Automations", "Knowledge", "Approvals", "Connectors"]) await expect(entry(page, name)).toBeVisible();
	});

	test("a role lost while the tab is open leaves the menu", async ({ page }) => {
		const state: State = { asked: [], access: holds };
		await open(page, state);
		await expect(entry(page, "Facilities")).toBeVisible();
		state.access = none;
		await refresh(page);
		await expect(entry(page, "Facilities")).toHaveCount(0);
	});
});

// What Deals says this person can use: its manifest lists more, and the per-person read narrows them.
const dealsSections = [
	{ key: "queue", to: "queue", label: "Queue", label_zh: "队列", group: "daily", keys: ["open", "late"] },
	{ key: "pipeline", to: "pipeline", label: "Pipeline", label_zh: "管道", group: "daily" },
	{ key: "terms", to: "settings/terms", label: "Terms", label_zh: "条款", group: "setup" },
	{ key: "broken", label: "No address" },
];

// What Deals has to say. `to` is where each leads in its app.
const dealsNotifications = [
	{ id: "n1", read_at: null, target: "deals:deal:7", to: "records/7", event: { kind: "deal.won" } },
	{ id: "n2", read_at: null, target: "deals:deal:7", to: "records/7", event: { kind: "deal.won" } },
];

// A module with its own app has no folder in this build: the shell works from its manifest.
const deals = { id: "deals", api_version: 1, app: { url: "http://deals.test", label: "Deals", label_zh: "交易" }, attention: [{ keys: ["open", "late"], label: "Deals waiting: {count}", label_zh: "待处理交易：{count}", to: "queue" }], events: { "deal.won": { label: "A deal was won", label_zh: "赢得一笔交易" } } };

test.describe("a module with its own app", () => {
	test("a role holder gets a link out, and Home rows from its counts", async ({ page }) => {
		const state: State = { modules: ["collab", deals], access: { modules: ["deals"], module_admin: [] }, asked: [] };
		await open(page, state);
		await expect(page.getByTestId("app-deals")).toHaveAttribute("href", "http://deals.test/t/ten_a/");
		await expect(page.getByRole("link", { name: "Deals waiting: 3" })).toHaveAttribute("href", "http://deals.test/t/ten_a/queue");
	});

	test("someone with no role sees nothing of it, and a tenant admin does", async ({ page }) => {
		await open(page, { modules: ["collab", deals], access: { modules: [], module_admin: [] }, asked: [] });
		await expect(page.getByTestId("nav-tasks")).toBeVisible();
		await expect(page.getByTestId("app-deals")).toHaveCount(0);
		await page.unrouteAll();
		await open(page, { role: "admin", modules: ["collab", deals], access: { modules: [], module_admin: [] }, asked: [] });
		await expect(page.getByTestId("app-deals")).toBeVisible();
	});

	test("an old link goes to the same place in the app", async ({ page }) => {
		await page.route("http://deals.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>the app</h1>" }));
		await open(page, { modules: ["collab", deals], access: { modules: ["deals"], module_admin: [] }, asked: [] }, "/t/ten_a/deals/records/7?x=1");
		await page.waitForURL("http://deals.test/t/ten_a/records/7?x=1");
	});

	test("its sections open under its entry, from the per-person read, and stay open", async ({ page }) => {
		const withNav = { ...deals, app: { ...deals.app, nav: [...dealsSections.slice(0, 3), { key: "admin", to: "admin", label: "Admin", label_zh: "管理", group: "setup" }] } };
		const state: State = { modules: ["collab", withNav], access: { modules: ["deals"], module_admin: [] }, asked: [] };
		await open(page, state);
		await expect(page.getByTestId("app-deals-sections")).toHaveCount(0);
		expect(state.asked).not.toContain("/api/modules/deals/me/nav");
		await page.getByTestId("app-deals-toggle").click();
		await expect(page.getByTestId("section-queue")).toHaveAttribute("href", "http://deals.test/t/ten_a/queue");
		await expect(page.getByTestId("section-queue")).toContainText("3");
		await expect(page.getByTestId("section-pipeline")).toBeVisible();
		await expect(page.getByTestId("section-terms")).toHaveCount(0);
		await expect(page.getByTestId("section-broken")).toHaveCount(0);
		await page.getByRole("button", { name: "More" }).click();
		await expect(page.getByTestId("section-terms")).toHaveAttribute("href", "http://deals.test/t/ten_a/settings/terms");
		await expect(page.getByTestId("section-admin")).toHaveCount(0);
		await page.reload();
		await expect(page.getByTestId("section-queue")).toBeVisible();
	});

	test("the bell lists its notifications, leads where each happened, and marks them read there", async ({ page }) => {
		await page.route("http://deals.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>the app</h1>" }));
		const state: State = { modules: ["collab", deals], access: { modules: ["deals"], module_admin: [] }, asked: [] };
		await open(page, state);
		await expect(page.getByTestId("bell-count")).toHaveText("2");
		const bell = page.getByRole("button", { name: "Notifications: 2 unread" });
		await bell.click();
		await expect(page.getByTestId("bell-item")).toHaveCount(2);
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("bell-item")).toHaveCount(0);
		await expect(bell).toBeFocused();
		await bell.click();
		await page.keyboard.press("ControlOrMeta+k");
		await expect(page.getByRole("combobox", { name: "Search", exact: true })).toBeFocused();
		await expect(page.getByTestId("bell-item")).toHaveCount(0);
		await page.keyboard.press("Escape");
		await bell.click();
		await expect(page.getByTestId("bell-item").first()).toContainText("A deal was won");
		await expect(page.getByTestId("bell-item").first()).toContainText("Deals");
		await expect(page.getByTestId("bell-item").first()).toHaveAttribute("href", "http://deals.test/t/ten_a/records/7");
		const read = page.waitForRequest((request) => request.url().endsWith("/api/modules/deals/notifications/read"));
		await page.getByTestId("bell-item").first().click();
		expect((await read).postDataJSON()).toEqual({ ids: ["n1", "n2"] });
		await page.waitForURL("http://deals.test/t/ten_a/records/7");
	});

	test("search finds another app's sections by name, and opens them there", async ({ page }) => {
		await page.route("http://deals.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>the app</h1>" }));
		const withNav = { ...deals, app: { ...deals.app, nav: dealsSections.slice(0, 3) } };
		await open(page, { modules: ["collab", withNav], access: { modules: ["deals"], module_admin: [] }, asked: [] });
		await page.locator(".search-button").click();
		await expect(page.locator("#palette-list").getByRole("option", { name: /Pipeline/ })).toHaveCount(0);
		await page.getByRole("combobox", { name: "Search", exact: true }).fill("pipe");
		const option = page.locator("#palette-list").getByRole("option", { name: /Pipeline/ });
		await expect(option).toContainText("Deals");
		await option.click();
		await page.waitForURL("http://deals.test/t/ten_a/pipeline");
	});

	test("an app whose manifest lists no sections has nothing to open", async ({ page }) => {
		await open(page, { modules: ["collab", deals], access: { modules: ["deals"], module_admin: [] }, asked: [] });
		await expect(page.getByTestId("app-deals")).toBeVisible();
		await expect(page.getByTestId("app-deals-toggle")).toHaveCount(0);
	});

	test("a link to a module nobody knows goes Home", async ({ page }) => {
		await open(page, { modules: ["collab"], asked: [] }, "/t/ten_a/nothing/here");
		await expect(page).toHaveURL(/\/t\/ten_a\/?$/);
	});

	test("it keeps its entry through an outage, once seen", async ({ page }) => {
		const state: State = { modules: ["collab", deals], access: { modules: ["deals"], module_admin: [] }, asked: [] };
		await open(page, state);
		await expect(page.getByTestId("app-deals")).toBeVisible();
		await page.unrouteAll();
		await open(page, { modules: ["collab"], unavailable: ["deals"], access: { modules: ["deals"], module_admin: [] }, asked: [] });
		await expect(page.getByTestId("app-deals")).toBeVisible();
	});

	test("an address that isn't http or https gives no link", async ({ page }) => {
		await open(page, { modules: ["collab", { ...deals, app: { ...deals.app, url: "javascript:alert(1)" } }], access: { modules: ["deals"], module_admin: [] }, asked: [] });
		await expect(page.getByTestId("nav-tasks")).toBeVisible();
		await expect(page.getByTestId("app-deals")).toHaveCount(0);
	});
});
