import { expect, type Page, test } from "@playwright/test";

// Business roles through Administration: an admin makes a role from the demo module's template that scripts/e2e-stack.sh
// gives auth-server, edits it, gives it to a member on People and takes it back. See auth-server/docs/service-api.md,
// "Business roles".

async function login(page: Page, user: string) {
	await page.goto("/");
	await page.locator("#name").fill(user);
	await page.locator("#password").fill("t10-sample-password");
	await page.locator("#password").press("Enter");
	await page.waitForURL(/\/t\//);
}

/** One person's row on People, by their own name rather than the manager lists every row holds. */
function memberRow(page: Page, name: string) {
	return page.locator(".member-row").filter({ has: page.locator(".row-main", { hasText: name }) });
}

test("an admin makes a role from a template, gives it to a member and takes it back", async ({ page }) => {
	await login(page, "sample-acme-admin");
	await page.goto("/t/ten_sample-acme/admin?tab=roles");
	const name = `Editors ${Date.now()}`;
	await page.getByLabel("New role").fill(name);
	await page.getByLabel("Start from").selectOption("demo/editor");
	await page.getByRole("button", { name: "Add" }).click();

	// A new role opens for editing, holding its template's permissions.
	const editor = page.getByRole("dialog", { name: "Edit role" });
	await expect(editor.getByRole("checkbox", { name: /demo:read/ })).toBeChecked();
	await expect(editor.getByRole("checkbox", { name: /demo:write/ })).toBeChecked();
	await expect(editor.getByRole("checkbox", { name: /demo:admin/ })).not.toBeChecked();
	await editor.getByRole("checkbox", { name: /demo:admin/ }).check();
	await editor.getByRole("button", { name: "Save" }).click();
	const row = page.locator(".row").filter({ hasText: name });
	await expect(row).toContainText("Permissions: 3");
	await expect(row).toContainText("Held by: 0");

	await page.getByRole("tab", { name: "People" }).click();
	await memberRow(page, "sample-member").getByRole("button", { name: "Roles" }).click();
	const roles = page.getByRole("dialog", { name: "Roles for sample-member" });
	await roles.getByLabel("Role").selectOption({ label: name });
	await roles.getByRole("button", { name: "Give role" }).click();
	await expect(roles.locator(".row").filter({ hasText: name })).toBeVisible();
	await roles.getByRole("button", { name: "Done" }).click();

	await page.getByRole("tab", { name: "Roles" }).click();
	await expect(row).toContainText("Held by: 1");

	await page.getByRole("tab", { name: "People" }).click();
	await memberRow(page, "sample-member").getByRole("button", { name: "Roles" }).click();
	await roles.getByRole("button", { name: `Remove ${name}` }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
	await expect(roles.locator(".row").filter({ hasText: name })).toHaveCount(0);
	await roles.getByRole("button", { name: "Done" }).click();
	await page.getByRole("tab", { name: "Roles" }).click();
	await expect(row).toContainText("Held by: 0");
});

test("a member doesn't see Roles, and its routes refuse them", async ({ page }) => {
	await login(page, "sample-member");
	await page.goto("/t/ten_sample-acme/admin?tab=roles");
	await expect(page.getByText("Only this tenant's admins can open this page.")).toBeVisible();
	const status = await page.evaluate(async () => (await fetch("/api/org/ten_sample-acme/roles")).status);
	expect(status).toBe(403);
});
