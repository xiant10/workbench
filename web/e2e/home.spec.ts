import { expect, test, type Page } from "@playwright/test";

// What Home shows, from each module's answers. Everything under /api is mocked, so this needs only the page.
const now = Date.now();
const session = (id: string, title: string, minutes: number) => ({ sessionId: id, busy: false, lastActiveAt: now - minutes * 60_000, metadata: { title } });

type Mocks = {
	sessions?: unknown[];
	approvals?: unknown[] | number;
	automations?: unknown[];
	waiting?: unknown[];
	role?: "member" | "admin";
	modules?: string[];
	members?: number | "fail";
	catalog?: string[];
	roles?: number;
	documents?: number;
	project?: boolean;
	asked?: string[];
};

async function open(page: Page, { sessions = [], approvals = [], automations = [], waiting = [], role = "member", modules = ["collab", "agents", "automations"], members = 1, catalog = [], roles = 0, documents = 0, project = false, asked }: Mocks, language?: string) {
	if (language !== undefined) await page.addInitScript((value) => localStorage.setItem("wb:language", value), language);
	await page.route("**/api/**", (route) => {
		const { pathname, searchParams } = new URL(route.request().url());
		const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
		if (pathname === "/api/me") return json({ user_id: "usr_a", display_name: "Wei", sign_in_name: "wei", active_tenant: "ten_a", tenants: [{ id: "ten_a", name: "Acme", role }] });
		if (pathname === "/api/config") {
			return json({ agents: ["assistant"], profiles: ["chat"], voice: false, account_url: "http://auth.test/v1/account", unavailable_modules: [], modules: modules.map((id) => ({ id, api_version: 1, features: [] })) });
		}
		if (pathname.startsWith("/api/org/")) {
			asked?.push(pathname);
			if (pathname.endsWith("/members")) return members === "fail" ? json({ error: "unavailable" }, 503) : json({ members: Array.from({ length: members }, (_, i) => ({ user_id: `u${i}`, status: "active" })) });
			if (pathname.endsWith("/permission-catalog")) return json({ modules: catalog.map((id) => ({ id })), unavailable: [] });
			if (pathname.endsWith("/roles")) return json({ roles: Array.from({ length: roles }, (_, i) => ({ id: `r${i}` })) });
		}
		if (pathname === "/api/modules/knowledge/admin/documents") return json({ documents: Array.from({ length: documents }, (_, i) => ({ id: `d${i}` })) });
		if (pathname === "/api/modules/property/settings") return json({ project: project ? { id: "p1" } : null, scopes: [] });
		if (pathname === "/api/modules/agents/approvals") return typeof approvals === "number" ? json({ error: "unavailable" }, approvals) : json({ approvals });
		if (pathname === "/api/modules/automations/automations") return json({ automations });
		if (pathname.startsWith("/api/modules/collab/offers")) return json({ offers: searchParams.get("box") === "sent" ? waiting : [] });
		if (pathname.endsWith("/notifications")) return json({ notifications: [], cursor: "" });
		if (pathname.startsWith("/api/modules/")) return json({ items: [], people: [], units: [] });
		const method = route.request().headers()["agent-method"];
		return json({ jsonrpc: "2.0", id: 1, result: method === "session.list" ? { sessions } : method === "agents.list" ? { agents: [{ name: "assistant" }] } : {} });
	});
	await page.goto("/t/ten_a/");
}

const approval = { id: "apr_1", principal: "Dana", agent: "assistant", server: "crm", tool: "delete_account", rule: "r1", summary: {}, created_at: new Date(now).toISOString(), expires_at: new Date(now + 3_600_000).toISOString() };
const automation = (id: string, name: string, state: string, failures: number) => ({ id, name, agent: "assistant", instruction: "x", cron: "0 9 * * *", timezone: "UTC", state, next_fire_at: null, failures });

test("Needs you holds what waits on a person, from every module", async ({ page }) => {
	await open(page, {
		approvals: [approval],
		automations: [automation("a1", "Morning brief", "failing", 3), automation("a2", "Old report", "revoked", 0), automation("a3", "Flaky", "active", 1), automation("a4", "Fine", "active", 0), automation("a5", "Paused", "paused", 2)],
	});
	const needs = page.locator("section", { has: page.getByRole("heading", { name: "Needs you" }) });
	await expect(needs.getByRole("link", { name: "Approve or refuse crm/delete_account" })).toHaveAttribute("href", "/t/ten_a/approvals");
	await expect(needs.getByRole("link", { name: "Morning brief stopped after failures" })).toBeVisible();
	await expect(needs.getByRole("link", { name: "Old report stopped: your consent ended" })).toBeVisible();
	await expect(needs.getByRole("link", { name: "Flaky's last run failed" })).toBeVisible();
	await expect(needs.getByText("Fine")).toHaveCount(0);
	await expect(needs.getByText("Paused")).toHaveCount(0);
});

test("finished conversations sit with recent ones, first and capped, and can still be sent as a task", async ({ page }) => {
	await page.addInitScript((seen) => localStorage.setItem("wb:seen:seen", seen), String(now));
	await open(page, { sessions: [session("seen", "Already read", 1), ...[2, 3, 4, 5, 6].map((n) => session(`new${n}`, `Fresh ${n}`, n))] });
	await expect(page.locator("section.always ul.rows")).toBeEmpty();
	const recent = page.locator("section", { has: page.getByRole("heading", { name: "Pick up where you left off" }) }).locator(".row");
	await expect(recent).toHaveCount(4);
	await expect(recent.first()).toContainText("Fresh 2");
	await expect(recent.first()).toContainText(/Finished/);
	await expect(recent.first().getByRole("button", { name: "Send as task" })).toBeVisible();
	await expect(recent.filter({ hasText: "Already read" })).toHaveCount(0);
});

test("a read conversation has no finished mark", async ({ page }) => {
	await page.addInitScript((seen) => localStorage.setItem("wb:seen:seen", seen), String(now));
	await open(page, { sessions: [session("seen", "Already read", 1)] });
	const row = page.locator("section", { has: page.getByRole("heading", { name: "Pick up where you left off" }) }).locator(".row");
	await expect(row).toContainText("Already read");
	await expect(row).not.toContainText("Finished");
	await expect(row.getByRole("button")).toHaveCount(0);
});

test("one failing module doesn't take the others with it", async ({ page }) => {
	await open(page, { approvals: 503, automations: [automation("a1", "Morning brief", "failing", 3)] });
	const needs = page.locator("section", { has: page.getByRole("heading", { name: "Needs you" }) });
	await expect(needs.getByRole("button", { name: "Retry" })).toBeVisible();
	await expect(needs.getByRole("link", { name: "Morning brief stopped after failures" })).toBeVisible();
});

test("a new person isn't shown text written for the model", async ({ page }) => {
	await open(page, {});
	await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "What can I do?" })).toHaveCount(0);
	await expect(page.locator("section.always ul.rows")).toBeEmpty();
});

test("waiting on others comes after every module's rows", async ({ page }) => {
	await open(page, { approvals: [approval], waiting: [{ id: "of_1", state: "pending", item_id: "wi_1", item_title: "Review", from_user_id: "usr_a", to_user_id: "usr_b", response_note: "" }] });
	const rows = page.locator("section.always ul.rows > li");
	await expect(page.getByRole("heading", { name: "Waiting on others" })).toBeVisible();
	const texts = await rows.allInnerTexts();
	expect(texts.findIndex((text) => text.includes("Approve or refuse"))).toBeLessThan(texts.findIndex((text) => text.includes("Waiting on others")));
});

test("the new rows are translated", async ({ page }) => {
	await open(page, { approvals: [approval], automations: [automation("a1", "晨报", "failing", 3)] }, "zh");
	await expect(page.getByRole("link", { name: "批准或拒绝 crm/delete_account" })).toBeVisible();
	await expect(page.getByRole("link", { name: "晨报 因多次失败已停止" })).toBeVisible();
});

const setup = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Set up Acme" }) });

test("a new admin sees what's left, worked out from each module", async ({ page }) => {
	await open(page, { role: "admin", modules: ["knowledge", "property"], catalog: ["property"], documents: 1 });
	const list = setup(page);
	await expect(list).toContainText("1 of 4 done");
	await expect(list.getByRole("link", { name: "Invite your team" })).toHaveAttribute("href", "/t/ten_a/admin?tab=people");
	await expect(list.getByRole("link", { name: "Create your property project" })).toHaveAttribute("href", "/t/ten_a/admin?tab=property");
	await expect(list.getByRole("link", { name: "Create roles for your team" })).toHaveAttribute("href", "/t/ten_a/admin?tab=roles");
	await expect(list.getByText("Add your first document")).toBeVisible();
	await expect(list.getByRole("link", { name: "Add your first document" })).toHaveCount(0);
	const headings = await page.locator(".page h2").allInnerTexts();
	expect(headings.indexOf("Set up Acme")).toBeLessThan(headings.indexOf("Needs you"));
});

test("a member sees no setup, and nothing is asked on their behalf", async ({ page }) => {
	const asked: string[] = [];
	await open(page, { role: "member", modules: ["knowledge", "property"], asked });
	await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
	await expect(setup(page)).toHaveCount(0);
	expect(asked).toEqual([]);
});

test("setup goes away when everything is done", async ({ page }) => {
	await open(page, { role: "admin", modules: ["knowledge", "property"], catalog: ["property"], members: 2, roles: 1, documents: 1, project: true });
	await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
	await expect(setup(page)).toHaveCount(0);
});

test("a step that can't answer is left out", async ({ page }) => {
	await open(page, { role: "admin", modules: ["knowledge"], members: "fail" });
	const list = setup(page);
	await expect(list).toContainText("0 of 1 done");
	await expect(list.getByText("Invite your team")).toHaveCount(0);
});

test("roles are asked for only when a module here uses them", async ({ page }) => {
	await open(page, { role: "admin", modules: ["knowledge"], catalog: ["demo"] });
	await expect(setup(page).getByRole("link", { name: "Invite your team" })).toBeVisible();
	await expect(setup(page).getByText("Create roles for your team")).toHaveCount(0);
});

test("hidden setup stays hidden, until a new step needs attention", async ({ page }) => {
	await open(page, { role: "admin", modules: ["knowledge"], documents: 1 });
	await setup(page).getByRole("button", { name: "Hide setup" }).click();
	await expect(setup(page)).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
	await expect(setup(page)).toHaveCount(0);
	await page.unrouteAll();
	await open(page, { role: "admin", modules: ["knowledge", "property"], documents: 1 });
	await expect(setup(page).getByRole("link", { name: "Create your property project" })).toBeVisible();
});

test("setup is translated", async ({ page }) => {
	await open(page, { role: "admin", modules: ["knowledge"] }, "zh");
	await expect(page.getByRole("link", { name: "邀请团队成员" })).toBeVisible();
	await expect(page.getByRole("link", { name: "添加第一份文档" })).toBeVisible();
});
