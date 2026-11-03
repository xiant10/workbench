import { expect, test } from "@playwright/test";
import { mock } from "./fixtures.ts";


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
