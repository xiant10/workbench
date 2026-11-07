import { expect, type Page, test } from "@playwright/test";

const base = "/t/ten_sample-acme";
const PASSWORD = "t10-sample-password";

async function login(page: Page, user: string) {
	await page.context().clearCookies();
	await page.goto("/");
	await page.locator("#name").fill(user);
	await page.locator("#password").fill(PASSWORD);
	await page.locator("#password").press("Enter");
	await page.waitForURL(/\/t\//);
}

async function call(page: Page, path: string, body?: unknown) {
	return page.evaluate(
		async ({ path, body }) => {
			const init = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) };
			const response = await fetch(`/api/modules/property/${path}`, init);
			return { status: response.status, body: await response.json().catch(() => ({})) };
		},
		{ path, body },
	);
}

/** No page may scroll sideways at phone width, where stewards work. */
async function fitsThePhone(page: Page) {
	const overflow = await page.evaluate(() => {
		const main = document.querySelector(".property-page") as HTMLElement;
		return { page: document.documentElement.scrollWidth - window.innerWidth, content: main.scrollWidth - main.clientWidth };
	});
	expect(overflow.page).toBeLessThanOrEqual(0);
	expect(overflow.content).toBeLessThanOrEqual(0);
}

test("a steward works a household on a phone, through a complaint hold, to a payment", async ({ page, context }) => {
	test.setTimeout(240_000);
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const suffix = Date.now().toString();
	const room = `Loop-${suffix}`;

	// Setup through the API: this test is about the daily work that follows it.
	await login(page, "sample-acme-admin");
	const created = await call(page, "admin/room", { building_id: "building_a", room_no: room, area: "80", occupancy_status: "owner_occupied" });
	expect(created.status).toBe(200);
	const account = await call(page, "admin/account", { room_id: created.body.id, account_no: `L${suffix}` });
	expect(account.status).toBe(200);
	const accountId: string = account.body.id;
	const resident = await call(page, "resident", { account_id: accountId, resident_name: "Synthetic Owner", relation: "owner", main_contact: true, phone: "13800138000" });
	expect(resident.status).toBe(200);
	await page.goto(`${base}/property/accounts/${accountId}`);
	await expect(page.getByText("••••8000")).toBeVisible();
	await expect(page.getByRole("button", { name: "Call", exact: true })).toHaveCount(0);
	expect((await call(page, "consent", { account_id: accountId, id: resident.body.id, revision: 1, consent: "granted", evidence_ref: "synthetic-form" })).status).toBe(200);
	await page.reload();
	// Tenant administration alone keeps it masked, even with consent.
	await expect(page.getByText("••••8000")).toBeVisible();
	await expect(page.getByRole("button", { name: "Call", exact: true })).toHaveCount(0);

	await login(page, "property-finance");
	const charge = await call(page, "charge", { name: `Fee ${suffix}`, basis: "fixed", price_fen: "12000" });
	expect(charge.status).toBe(200);
	const preview = await call(page, "bill-preview", { account_id: accountId, charge_id: charge.body.id, period_start: "2026-01-01", period_end: "2026-01-31", due_on: "2026-02-01" });
	expect(preview.status).toBe(200);
	const bill = await call(page, "bill", preview.body);
	expect(bill.status).toBe(200);
	// Finance has contact.full, so sees the number whatever the consent, and no conversations.
	await page.goto(`${base}/property/accounts/${accountId}`);
	await expect(page.getByText("13800138000")).toBeVisible();
	await expect(page.getByRole("region", { name: "Conversations" })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Collections" })).toHaveCount(0);
	await page.goto(`${base}/property/collections`);
	await expect(page.getByRole("heading", { name: "Arrears ledger" })).toBeVisible();

	// The steward's day, at phone width.
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page, "property-steward");
	await page.goto(`${base}/property/collections`);
	await page.getByLabel("Search room or account").fill(room);
	await page.getByRole("button", { name: "Search" }).click();
	await expect(page.getByText(/1 households owe/)).toBeVisible();
	await fitsThePhone(page);
	await page.getByRole("link", { name: room }).click();
	await expect(page.getByRole("heading", { name: room })).toBeVisible();
	await fitsThePhone(page);

	// Consent granted: the number shows, and copying it is recorded.
	await expect(page.getByText("13800138000")).toBeVisible();
	await page.getByRole("button", { name: "Copy" }).click();
	await expect(page.getByText("Number copied")).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("13800138000");

	// A promise closes the phone channel for seven days and becomes a follow-up.
	await page.getByRole("button", { name: "Report contact" }).click();
	const report = page.getByRole("dialog", { name: "Report contact" });
	await report.getByLabel("Channel").selectOption("phone");
	await report.getByLabel("Result").selectOption("promise");
	await report.getByRole("button", { name: "Confirm" }).click();
	await expect(report).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Collections" }).getByText("Already contacted on this channel in the last 7 days")).toBeVisible();
	await page.goto(`${base}/property`);
	await expect(page.getByRole("region", { name: "Follow-ups" }).getByRole("link", { name: room })).toBeVisible();
	await fitsThePhone(page);

	// Home no longer says caught up.
	await page.goto(`${base}/`);
	await expect(page.getByRole("link", { name: /Property follow-ups due|Property work orders to handle/ }).first()).toBeVisible();

	// Customer service reports a complaint, which holds the account.
	await page.setViewportSize({ width: 1280, height: 900 });
	await login(page, "property-customer-service");
	await page.goto(`${base}/property/work-orders?new=1&account=${accountId}`);
	const reporting = page.getByRole("dialog", { name: "Report a problem" });
	await reporting.getByLabel("Category").selectOption("complaint");
	await reporting.getByLabel("Title").fill(`Noise ${suffix}`);
	await expect(reporting.getByLabel("Handler").locator("option", { hasText: "property-maintenance" })).toHaveCount(1);
	await reporting.getByLabel("Handler").selectOption({ label: "property-maintenance" });
	await reporting.getByRole("button", { name: "Report", exact: true }).click();
	await page.waitForURL(/work-orders\/order_/);
	const orderUrl = page.url();
	await expect(page.getByRole("heading", { name: `Noise ${suffix}` })).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	await login(page, "property-steward");
	await page.goto(`${base}/property/accounts/${accountId}`);
	await expect(page.getByText("Contact is on hold while a complaint is open.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Report contact" })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Go to the complaint" })).toBeVisible();

	// Maintenance is offered only what it may do, and can't browse the household.
	await login(page, "property-maintenance");
	await page.goto(orderUrl);
	await expect(page.getByRole("button", { name: "Withdraw" })).toHaveCount(0);
	await page.getByRole("button", { name: "Accept the work" }).click();
	await expect(page.getByText("In progress").first()).toBeVisible();
	await fitsThePhone(page);
	await page.getByRole("button", { name: "Submit the result" }).click();
	const result = page.getByRole("dialog", { name: "Submit the result" });
	await result.getByLabel("What was done").fill("Synthetic resolution");
	await expect(result.getByRole("button", { name: "Confirm" })).toBeDisabled();
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAwElEQVR4nNXOQREAAAyDMKRX+kTw4BYFYc9RByzqgEUdsKgDFnXAog5Y1AGLOmBRByzqgEUdsKgDFnXAog5Y1AGLOmBRByzqgEUdsKgDFnXAog5Y1AGLOmBRByzqgEUdsKgDFnXAog5Y1AGLOmBRByzqgEUdsKgDFnXAog5Y1AGLOmBRByzqgEUdsKgDFnXAog5Y1AGLOmBRByzqgEUdsKgDFnXAog5Y1AGLOmBRByzqgEUdsKgDFnXAog5Y1AHrAB8+AWlViFU0AAAAAElFTkSuQmCC", "base64");
	await result.locator('input[type="file"]').setInputFiles({ name: "evidence.png", mimeType: "image/png", buffer: png });
	await expect(result.getByText("Photos added: 1")).toBeVisible();
	await result.getByRole("button", { name: "Confirm" }).click();
	await expect(result).toHaveCount(0);
	await expect(page.getByRole("img", { name: "Work order photo" })).toBeVisible();
	await page.goto(`${base}/property/accounts/${accountId}`);
	await expect(page.getByRole("heading", { name: "This household isn't available" })).toBeVisible();

	// The reporter accepts it, and the hold lifts.
	await page.setViewportSize({ width: 1280, height: 900 });
	await login(page, "property-customer-service");
	await page.goto(orderUrl);
	await page.getByRole("button", { name: "Accept as complete" }).click();
	const accepting = page.getByRole("dialog", { name: "Accept as complete" });
	await accepting.getByLabel("Satisfaction, if given").selectOption("5");
	await accepting.getByRole("button", { name: "Confirm" }).click();
	await expect(accepting).toHaveCount(0);
	await expect(page.getByText("Completed").first()).toBeVisible();

	// The steward marks the whole bill paid; the promise closes itself.
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page, "property-steward");
	await page.goto(`${base}/property/accounts/${accountId}`);
	await expect(page.getByText("Contact is on hold while a complaint is open.")).toHaveCount(0);
	await page.getByLabel(`Include Fee ${suffix}`).check();
	await page.getByRole("button", { name: /Record payment of/ }).click();
	const payment = page.getByRole("dialog", { name: "Record payment" });
	await payment.getByRole("button", { name: "Confirm" }).click();
	await expect(payment).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Bills" }).getByText("Paid", { exact: true })).toBeVisible();
	const followups = await call(page, "followups");
	expect(followups.body.followups.find((task: { account_id: string; source_kind: string }) => task.account_id === accountId && task.source_kind === "promise").state).toBe("completed");

	// Every action says how it arrived.
	await page.setViewportSize({ width: 1280, height: 900 });
	await login(page, "sample-acme-admin");
	const activity = await call(page, "admin/activity");
	const records: { action: string; via: string }[] = activity.body.records;
	const copied = records.find((record) => record.action === "resident.contact.copy");
	expect(copied?.via).toBe("workbench");
});

test("a manager publishes a notice from the page and sees who read it", async ({ page }) => {
	test.setTimeout(120_000);
	const title = `Water off ${Date.now()}`;
	await login(page, "property-manager");
	await page.goto(`${base}/property/messages`);
	await page.getByRole("button", { name: "Publish a notice" }).click();
	const compose = page.getByRole("dialog", { name: "Publish a notice" });
	await compose.getByLabel("Title").fill(title);
	await compose.getByLabel("Notice", { exact: true }).fill("Synthetic notice");
	await compose.getByLabel("Send to").selectOption("users");
	await compose.getByLabel("property-steward").check();
	await compose.getByRole("button", { name: "Publish" }).click();
	await expect(compose).toHaveCount(0);
	await expect(page.getByText(title)).toBeVisible();
	await expect(page.locator(".property-item", { hasText: title }).getByText("0 of 1 read")).toBeVisible();

	await login(page, "property-steward");
	await page.goto(`${base}/property/messages`);
	const row = page.locator(".property-item", { hasText: title });
	await row.getByRole("button", { name: "Mark as read" }).click();
	await expect(row.getByRole("button", { name: "Mark as read" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Publish a notice" })).toHaveCount(0);

	await login(page, "property-manager");
	await page.goto(`${base}/property/messages`);
	await expect(page.locator(".property-item", { hasText: title }).getByText("1 of 1 read")).toBeVisible();
});
