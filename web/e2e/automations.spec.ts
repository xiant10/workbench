import { expect, test } from "@playwright/test";

// Exercise the editor against the module API shape, including PATCH preserving
// a custom schedule and never attempting to change the consent's agent.
test("create on demand, edit custom timing, and recover from validation errors", async ({ page }) => {
	let task: Record<string, unknown> | undefined;
	let firings: Record<string, unknown>[] = [];
	let rejectSave = false;
	let lastPatch: Record<string, unknown> | undefined;
	await page.route("**/api/**", (route) => {
		const { pathname } = new URL(route.request().url());
		const method = route.request().method();
		const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
		if (pathname === "/api/me") return json({ user_id: "usr_a", display_name: "Alice", sign_in_name: "alice", active_tenant: "ten_a", tenants: [{ id: "ten_a", name: "Acme", role: "member" }] });
		if (pathname === "/api/config") return json({ agents: ["assistant"], profiles: ["chat"], voice: false, account_url: "http://auth.test/account", modules: [{ id: "automations", api_version: 1, features: [] }], unavailable_modules: [] });
		if (pathname.endsWith("/notifications")) return json({ notifications: [], cursor: "" });
		if (pathname === "/api/modules/automations/automations") {
			if (method === "GET") return json({ automations: task ? [task] : [] });
			task = { ...route.request().postDataJSON(), id: "a1", state: "active", next_fire_at: null, failures: 0 };
			return json(task, 201);
		}
		if (pathname.endsWith("/automations/a1/run")) {
			firings = [{ id: "f1", state: "running", session_id: "session1", scheduled_for: new Date().toISOString(), finished_at: null }];
			return json(firings[0], 202);
		}
		if (pathname === "/api/modules/automations/automations/a1") {
			if (method === "GET") return json({ automation: task, firings });
			lastPatch = route.request().postDataJSON();
			if (rejectSave) return json({ error: "invalid_request", message: "unknown timezone" }, 400);
			task = { ...task, ...lastPatch };
			return json(task);
		}
		return json({ jsonrpc: "2.0", id: 1, result: { agents: [{ name: "assistant", title: "Assistant" }], sessions: [] } });
	});
	await page.goto("/t/ten_a/automations");
	await expect(page.locator("form")).toHaveCount(0);
	await page.getByRole("button", { name: "New automation", exact: true }).click();
	const create = page.locator("form").filter({ has: page.getByRole("heading", { name: "New automation" }) });
	await create.getByLabel("Start from an example").selectOption("0");
	await create.getByLabel("When to run").selectOption("manual");
	await create.getByText("Run limits", { exact: true }).click();
	await create.getByLabel("Maximum runs in 24 hours").fill("2");
	await create.getByRole("button", { name: "Create automation" }).click();
	const row = page.locator(".automation-row");
	await expect(row).toContainText("On demand");
	expect(task?.cron).toBe("");
	expect(task?.runs_per_day).toBe(2);
	await expect(create).toHaveCount(0);
	await row.getByRole("button", { name: "Edit automation" }).click();
	const edit = row.locator("form");
	await edit.getByLabel("When to run").selectOption("cron");
	await edit.getByLabel("Cron expression").fill("*/15 9-17 * * 1-5");
	await edit.locator("summary").filter({ hasText: "Timezone" }).click();
	await edit.getByLabel("Timezone").fill("Mars/Olympus");
	await expect(edit.getByText("Enter a valid timezone, such as America/Chicago.")).toBeVisible();
	await expect(edit.getByRole("button", { name: "Save changes" })).toBeDisabled();
	await edit.getByLabel("Timezone").fill("America/Chicago");
	rejectSave = true;
	await edit.getByRole("button", { name: "Save changes" }).click();
	await expect(edit.getByRole("alert")).toBeVisible();
	await expect(edit.getByLabel("Cron expression")).toHaveValue("*/15 9-17 * * 1-5");
	rejectSave = false;
	await edit.getByLabel("Timezone").fill("America/Chicago");
	await edit.getByLabel("Instruction").fill("Review work and give me a report with sources.");
	await edit.getByRole("button", { name: "Save changes" }).click();
	await expect(row.locator("form")).toHaveCount(0);
	expect(lastPatch).toMatchObject({ cron: "*/15 9-17 * * 1-5", timezone: "America/Chicago", runs_per_day: 2 });
	expect(lastPatch).not.toHaveProperty("agent");
	await row.getByRole("button", { name: "Edit automation" }).click();
	await expect(row.getByLabel("Cron expression")).toHaveValue("*/15 9-17 * * 1-5");
	await expect(row.getByLabel("Instruction")).toHaveValue("Review work and give me a report with sources.");
	await row.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "New automation", exact: true }).click();
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	const fresh = page.locator("form");
	await fresh.getByLabel("Name", { exact: true }).fill("Daily review");
	await fresh.getByLabel("Instruction", { exact: true }).fill("Summarize my work.");
	await fresh.getByLabel("Repeat", { exact: true }).selectOption("daily");
	await expect(fresh.getByRole("status")).toContainText("every day");
	for (const day of await fresh.locator(".day-pick").all()) await day.click();
	await expect(fresh.getByRole("alert")).toHaveText("Choose at least one day.");
	await expect(fresh.getByRole("button", { name: "Create automation" })).toBeDisabled();
	await fresh.getByLabel("Repeat", { exact: true }).selectOption("weekdays");
	await expect(fresh.getByRole("button", { name: "Create automation" })).toBeEnabled();
	await page.screenshot({ path: "/tmp/t10-automation-create-mobile.png", fullPage: true });
	await page.locator("form").getByRole("button", { name: "Cancel", exact: true }).click();
	await row.getByRole("button", { name: "Run now", exact: true }).click();
	await expect(row.getByRole("heading", { name: "Recent runs" })).toBeVisible();
	await expect(row.getByRole("button", { name: "Running", exact: true })).toBeDisabled();
	await expect(row.getByRole("link", { name: "Open conversation" })).toHaveAttribute("href", /session1/);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.screenshot({ path: "/tmp/t10-automation-list-desktop.png", fullPage: true });
});
