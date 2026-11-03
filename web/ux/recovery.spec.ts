import { expect, test, type Page } from "@playwright/test";

async function mock(page: Page) {
	const state = { configFails: false, meFails: false, createFails: true, createCount: 0, payloadFails: false, payloadCalls: 0, collaborationFails: false };
	await page.route("**/api/**", async route => {
		const url = new URL(route.request().url());
		const fail = () => route.fulfill({ status: 503, json: { error: "unavailable" } });
		let result: unknown = {};
		if (url.pathname === "/api/me") {
			if (state.meFails) return fail();
			result = { user_id: "u1", display_name: "Felix", active_tenant: "demo", tenants: [{ id: "demo", name: "Demo", role: "member" }] };
		} else if (url.pathname === "/api/config") {
			if (state.configFails) return fail();
			result = { agents: ["assistant"], profiles: ["chat"], modules: [{ id: "collab", api_version: 1 }], voice: false, account_url: "/account" };
		} else if (url.pathname.includes("/agents/")) {
			if (route.request().method() === "GET") return route.fulfill({ contentType: "text/event-stream", body: 'data: {"params":{"type":"snapshot","busy":false,"inbox":[],"tasks":[]}}\n\n' });
			const body = route.request().postDataJSON();
			let value: unknown = {};
			switch (body.method) {
				case "agents.list": value = { agents: [{ name: "assistant", title: "Assistant" }, { name: "research", title: "Research" }] }; break;
				case "session.list": value = { sessions: [] }; break;
				case "skills.list": value = { skills: [] }; break;
				case "session.create":
					state.createCount++;
					await new Promise(resolve => setTimeout(resolve, 150));
					if (state.createFails) return fail();
					value = { sessionId: "c1" }; break;
				case "session.get": value = { usage: {}, tasks: [], parked: 0 }; break;
				case "session.messages": value = { messages: [{ id: 1, role: "tool", callId: "call1", name: "crm_lookup", isError: false }, { id: 2, role: "assistant", text: "# Brief\n\n" + "Customer details. ".repeat(110), stopReason: "stop" }] }; break;
				case "session.tool":
					state.payloadCalls++;
					if (state.payloadFails) return fail();
					value = { request: { name: "crm_lookup", arguments: { customer: "Acme" } }, response: { content: [{ type: "text", text: "<script>unsafe()</script>" }], isError: false } }; break;
			}
			result = { jsonrpc: "2.0", id: body.id, result: value };
		} else if (url.pathname.endsWith("/notifications")) result = { notifications: [], cursor: "" };
		else if (url.pathname.endsWith("/offers")) {
			if (state.collaborationFails) return fail();
			result = { offers: [] };
		} else if (url.pathname.endsWith("/work-items")) result = { items: [
			{ id: "task1", title: "Review proposal", status: "todo", priority: "normal", due_at: "2020-01-01T00:00:00Z", owners: ["u1"], collaborators: [] },
			{ id: "task2", title: "Completed proposal", status: "done", priority: "normal", due_at: null, owners: ["u1"], collaborators: [] },
		] };
		else if (url.pathname.endsWith("/people")) result = { people: [] };
		else if (url.pathname.endsWith("/units")) result = { units: [] };
		else if (url.pathname.endsWith("/settings")) result = { manager_visibility: "none" };
		await route.fulfill({ json: result });
	});
	return state;
}

test("failed first sends retain the draft and attachments, and retry succeeds", async ({ page }) => {
	const state = await mock(page);
	await page.goto("/t/demo/");
	await page.locator("textarea").fill("Keep this important draft");
	await page.locator('input[type=file]').setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("image") });
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Sending…", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
	await expect(page.locator("textarea")).toHaveValue("Keep this important draft");
	await expect(page.locator(".attachments li")).toHaveCount(1);
	expect(await page.evaluate(() => localStorage.getItem("wb:draft:home"))).toBe("Keep this important draft");
	expect(state.createCount).toBe(1);
	state.createFails = false;
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(page).toHaveURL(/\/c\/c1/);
	expect(await page.evaluate(() => localStorage.getItem("wb:draft:home"))).toBeNull();
});

for (const mode of ["configFails", "meFails"] as const) test(`${mode} shows a working retry`, async ({ page }) => {
	const state = await mock(page); state[mode] = true;
	await page.goto(mode === "meFails" ? "/" : "/t/demo/");
	await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
	state[mode] = false;
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(page.locator("textarea")).toBeVisible();
});

test("suggestions preserve text and images; unsupported files explain the alternative", async ({ page }) => {
	await mock(page); await page.goto("/t/demo/");
	await page.locator("textarea").fill("My existing draft");
	await page.locator('input[type=file]').setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("image") });
	await page.getByRole("button", { name: "Plan my week", exact: true }).click();
	await expect(page.locator("textarea")).toHaveValue(/My existing draft\n\nHelp me plan/);
	await expect(page.locator(".attachments li")).toHaveCount(1);
	await page.locator('input[type=file]').setInputFiles({ name: "brief.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") });
	await expect(page.getByText("brief.pdf isn't an image. Paste document text into the message instead.")).toBeVisible();
});

test("search keeps focus inside and returns it to its trigger", async ({ page }) => {
	await mock(page); await page.goto("/t/demo/");
	const trigger = page.getByRole("button", { name: /^Search/ });
	await trigger.click();
	await page.keyboard.press("Tab");
	await expect(page.getByRole("combobox", { name: "Search conversations" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

test("first-time users see tasks, and collaboration errors never say caught up", async ({ page }) => {
	const state = await mock(page); await page.goto("/t/demo/");
	await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Review proposal" })).toBeVisible();
	state.collaborationFails = true; await page.reload();
	await expect(page.getByRole("alert")).toBeVisible();
});

test("task filters find overdue work and include completed work on demand", async ({ page }) => {
	await mock(page); await page.goto("/t/demo/tasks");
	await expect(page.getByRole("link", { name: "Review proposal" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Completed proposal" })).toHaveCount(0);
	await page.getByRole("checkbox", { name: "Show completed work" }).check();
	await expect(page.getByRole("link", { name: "Completed proposal" })).toBeVisible();
	await page.getByRole("combobox", { name: "Due date" }).selectOption("overdue");
	await expect(page.getByRole("link", { name: "Completed proposal" })).toHaveCount(0);
	await page.getByRole("searchbox").fill("missing");
	await expect(page.getByText("No tasks match these filters.")).toBeVisible();
});

test("results offer task handoff and fetch escaped tool payloads only on expansion", async ({ page }) => {
	const state = await mock(page); await page.goto("/t/demo/c/c1");
	await expect(page.locator(".results").getByRole("button", { name: "Send as task" })).toBeVisible();
	await page.getByRole("tab", { name: "Activity", exact: true }).click();
	expect(state.payloadCalls).toBe(0);
	state.payloadFails = true;
	await page.locator(".tool-activity summary").click();
	await expect(page.locator(".tool-activity").getByRole("button", { name: "Retry" })).toBeVisible();
	state.payloadFails = false;
	await page.locator(".tool-activity").getByRole("button", { name: "Retry" }).click();
	await expect(page.locator(".tool-payload pre").first()).toContainText('"customer": "Acme"');
	await expect(page.locator(".tool-payload pre").last()).toContainText("<script>unsafe()</script>");
	expect(await page.locator(".tool-activity script").count()).toBe(0);
	await page.reload();
	await page.getByRole("tab", { name: "Activity", exact: true }).click();
	await page.locator(".tool-activity summary").click();
	await expect(page.locator(".tool-payload pre").first()).toContainText("Acme");
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
