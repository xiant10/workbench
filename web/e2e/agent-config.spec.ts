import { expect, test, type Page } from "@playwright/test";

// A tenant's customization of an agent end to end, through its page in Administration: edit as a draft, test it in a
// private chat, publish with a reason, see it in History, and reset. See t10-agent-control/docs/tenant-agents.md, step A4.
test.skip(process.env.AGENT_CONFIG_E2E !== "1", "Requires a running Workbench, t10-agent-control and agent-ti with ti customizable, and the sample accounts");

const AGENT = "ti";
const OFF = "property:property_collection_list";

async function login(page: Page, user: string) {
	await page.goto("/");
	await page.locator("#name").fill(user);
	await page.locator("#password").fill("t10-sample-password");
	await page.locator("#password").press("Enter");
	await page.waitForURL(/\/t\//);
}

function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
	return page.evaluate(
		async ({ method, path, body }) => {
			const response = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
			return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
		},
		{ method, path, body },
	);
}

const configPath = `/api/modules/agents/admin/agents/${AGENT}/config`;
type View = { config: { version: number; content: Record<string, unknown> }; draft: unknown };

/** Puts the agent back as the platform ships it, and drops this admin's draft, so a failed run leaves nothing behind. */
async function startClean(page: Page) {
	await call(page, "DELETE", `${configPath}/draft`);
	const view = (await call(page, "GET", configPath)).body as View;
	if (Object.keys(view.config.content).length > 0) {
		expect((await call(page, "PUT", configPath, { content: {}, version: view.config.version, reason: "e2e: start clean" })).status).toBe(200);
	}
}

test("an admin customizes an agent, tests it, publishes it, and resets it", async ({ browser }) => {
	test.setTimeout(240_000);
	const page = await (await browser.newContext()).newPage();
	await login(page, "sample-acme-admin");
	await startClean(page);
	const marker = `E2E-${Date.now().toString(36).toUpperCase()}`;

	// Administration, Agents lists it, and opens its page.
	const tenant = new URL(page.url()).pathname.split("/")[2]!;
	await page.goto(`/t/${tenant}/admin?tab=agents`);
	await page.getByTestId(`agent-open-${AGENT}`).click();
	await expect(page.getByTestId("agent-customize")).toBeVisible();

	// Instructions save as a draft only this admin sees.
	await page.getByTestId("agent-instructions").fill(`End every answer with the exact marker ${marker} on its own last line.`);
	await expect(page.getByTestId("agent-draft-saved")).toBeVisible({ timeout: 10_000 });
	const draft = (await call(page, "GET", configPath)).body as View;
	expect(draft.draft).not.toBeNull();

	// A tool turned off, by its owner.
	await page.getByTestId("agent-tab-tools").click();
	const tool = page.getByTestId(`agent-tool-${OFF}`);
	await expect(tool).toBeChecked();
	await tool.click();
	await expect(tool).not.toBeChecked();

	// The private test chat uses the draft.
	await page.getByTestId("agent-test-toggle").click();
	await page.getByTestId("skill-test-input").fill("In one short sentence, what can you help me with?");
	await page.getByTestId("skill-test-send").click();
	await expect(page.getByTestId("skill-test-log")).toContainText(marker, { timeout: 120_000 });

	// Publish asks why, and History shows the version with the reason.
	await page.getByTestId("agent-publish").click();
	await page.getByTestId("agent-publish-reason").fill("e2e: front desk marker");
	await page.getByTestId("agent-publish-confirm").click();
	await expect(page.locator(".toast")).toContainText(/Published version \d+|已发布第 \d+ 版/, { timeout: 15_000 });
	const live = (await call(page, "GET", configPath)).body as View;
	expect(live.draft).toBeNull();
	expect(live.config.content).toMatchObject({ instructions: expect.stringContaining(marker), tools: { off: [OFF] } });
	await page.getByTestId("agent-tab-history").click();
	await expect(page.getByTestId("agent-history")).toContainText("e2e: front desk marker");

	// Another tenant's admin sees none of it.
	const other = await (await browser.newContext()).newPage();
	await login(other, "sample-globex-admin");
	const theirs = (await call(other, "GET", configPath)).body as View;
	expect(JSON.stringify(theirs.config.content)).not.toContain(marker);

	// Reset publishes an empty version; History keeps the one before.
	await page.getByTestId("agent-reset").click();
	await page.getByRole("button", { name: /^(Reset|重置)$/ }).last().click();
	await expect.poll(async () => ((await call(page, "GET", configPath)).body as View).config.content, { timeout: 15_000 }).toEqual({});
	await expect(page.getByTestId("agent-history")).toContainText(/Reset to the platform's agent|重置为平台默认的智能体/);
});
