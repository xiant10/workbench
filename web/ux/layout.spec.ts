import { expect, test, type Page } from "@playwright/test";
import { mock } from "./fixtures.ts";

async function taskFixture(page: Page) {
	const state = await mock(page);
	state.createFails = false;
	let item = { id: "task1", title: "Prepare the enterprise customer renewal proposal for Acme, including pricing, rollout, and security", description: "Original description", status: "todo", priority: "normal", due_at: null, owners: ["u1"], collaborators: [], version: 1 };
	const calls = { prompt: "", failSave: false, changeRemoteTitle: (title: string) => { item = { ...item, title, version: item.version + 1 }; } };
	await page.route("**/api/**", async route => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith("/work-items/task1")) {
			if (route.request().method() === "PATCH") {
				if (calls.failSave) return route.fulfill({ status: 503, json: { error: "unavailable" } });
				if (route.request().postDataJSON().version !== item.version) return route.fulfill({ status: 409, json: { error: "version_conflict" } });
				item = { ...item, ...route.request().postDataJSON(), version: item.version + 1 };
			}
			return route.fulfill({ json: item });
		}
		if (url.pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [] } });
		if (url.pathname.endsWith("/events")) return route.fulfill({ json: { events: [] } });
		if (url.pathname.includes("/agents/") && route.request().method() === "POST") {
			const body = route.request().postDataJSON();
			if (body.method === "session.prompt") calls.prompt = JSON.stringify(body.params.input);
		}
		return route.fallback();
	});
	return calls;
}

test("mobile navigation is absent when closed, traps focus, and restores its trigger", async ({ page }) => {
	await mock(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/t/demo/");
	const menu = page.getByRole("button", { name: "Menu", exact: true });
	await menu.focus(); await page.keyboard.press("Tab");
	expect(await page.evaluate(() => !!document.activeElement?.closest(".sidebar"))).toBe(false);
	await menu.click();
	await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Account", exact: true }).focus();
	await page.keyboard.press("Tab");
	expect(await page.evaluate(() => !!document.activeElement?.closest(".sidebar"))).toBe(true);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0); await expect(menu).toBeFocused();
	expect(await page.locator("#root").evaluate(e => (e as HTMLElement).inert)).toBe(false);
	await menu.click();
	await page.getByRole("button", { name: /^Search/ }).click();
	await expect(page.getByRole("dialog", { name: "Search", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(menu).toBeFocused();
});

for (const width of [320, 1024]) test(`results fit at ${width}px and close with Escape`, async ({ page }) => {
	await mock(page); await page.setViewportSize({ width, height: 844 }); await page.goto("/t/demo/c/c1");
	const trigger = page.getByRole("button", { name: "Results", exact: true });
	await trigger.click();
	await expect(page.getByRole("dialog", { name: "Results", exact: true })).toBeVisible();
	const close = await page.getByRole("button", { name: "Hide results" }).boundingBox();
	expect(close!.x + close!.width).toBeLessThanOrEqual(width);
	expect(await page.locator(".conversation-main").evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThan(width === 320 ? 300 : 700);
	await page.getByRole("tab", { name: "Outputs", exact: true }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByRole("tab", { name: "Background work", exact: true })).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0); await expect(trigger).toBeFocused();
});

test("desktop results resize by keyboard and expand to a reading view", async ({ page }) => {
	await mock(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/t/demo/c/c1");
	const handle = page.getByRole("separator", { name: "Resize results" });
	await handle.focus(); const before = await page.locator(".results").evaluate(e => e.getBoundingClientRect().width);
	await page.keyboard.press("ArrowLeft");
	expect(await page.locator(".results").evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThan(before);
	await page.getByRole("button", { name: "Expand results" }).click();
	await expect(page.getByRole("dialog", { name: "Results", exact: true })).toBeVisible();
	expect(await page.locator(".results").evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThan(900);
	await page.getByRole("dialog", { name: "Results", exact: true }).getByRole("button", { name: "Send as task", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Send as task", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Results", exact: true })).toBeVisible();
	expect(await page.locator("#root").evaluate(e => (e as HTMLElement).inert)).toBe(true);
	await page.keyboard.press("Escape");
	expect(await page.locator("#root").evaluate(e => (e as HTMLElement).inert)).toBe(false);
});

test("task drafts survive navigation and reload, then save before reaching the agent", async ({ page }) => {
	const calls = await taskFixture(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/t/demo/tasks/task1");
	const title = page.getByRole("textbox", { name: "Title", exact: true });
	expect((await title.boundingBox())!.height).toBeGreaterThan(50);
	await expect.poll(() => title.evaluate(e => e.scrollHeight <= e.clientHeight)).toBe(true);
	await title.fill("My revised proposal");
	await page.getByRole("textbox", { name: "Description", exact: true }).fill("Updated scope for the agent");
	await page.getByRole("link", { name: "Tasks", exact: true }).click(); await page.goBack();
	await expect(title).toHaveValue("My revised proposal"); await page.reload();
	await expect(title).toHaveValue("My revised proposal");
	await expect(page.getByText("Unsaved changes · Draft kept on this device")).toBeVisible();
	await page.getByRole("button", { name: "Work on this with my agent", exact: true }).click();
	await expect(page.locator(".preview")).toContainText("Updated scope for the agent");
	calls.failSave = true;
	await page.getByRole("button", { name: "Save and start", exact: true }).click();
	await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
	expect(calls.prompt).toBe("");
	calls.failSave = false;
	await page.getByRole("button", { name: "Save and start", exact: true }).click();
	await expect(page).toHaveURL(/\/c\/c1/);
	expect(calls.prompt).toContain("My revised proposal"); expect(calls.prompt).toContain("Updated scope for the agent");
	expect(await page.evaluate(() => localStorage.getItem("wb:task-draft:demo:u1:task1"))).toBeNull();
});

test("theme options support arrow keys", async ({ page }) => {
	await mock(page); await page.goto("/t/demo/settings");
	await page.getByRole("radio", { name: "System", exact: true }).focus(); await page.keyboard.press("ArrowRight");
	await expect(page.getByRole("radio", { name: "Light", exact: true })).toHaveAttribute("aria-checked", "true");
});


test("restored drafts still detect teammate conflicts and Keep mine uses the latest version", async ({ page }) => {
	const calls = await taskFixture(page); await page.goto("/t/demo/tasks/task1");
	await page.getByRole("textbox", { name: "Title", exact: true }).fill("My local title");
	calls.changeRemoteTitle("Teammate's newer title");
	await page.reload();
	await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("My local title");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByText("Someone else changed this task. Yours is kept below.")).toBeVisible();
	await page.getByRole("button", { name: "Keep mine", exact: true }).click();
	await expect(page.getByText("Someone else changed this task. Yours is kept below.")).toHaveCount(0);
	await expect(page.locator(".draft-status")).toHaveText("Saved");
	await page.reload();
	await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("My local title");
});
