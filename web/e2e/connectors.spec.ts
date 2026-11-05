import { expect, test, type Page } from "@playwright/test";

// Tenant connectors end to end on the local cluster: an admin adds the mcp-fixture server with per-person OAuth, signs
// in through its consent page, discovers and publishes tools, and the agent calls them through ai-gateway-tools as that
// person. See t10-agent-control/docs/tenant-connectors.md. Needs deploy/k8s/overlays/local's mcp-fixture.
test.skip(process.env.CONNECTORS_E2E !== "1", "Requires the local cluster with mcp-fixture, and the sample accounts");

const FIXTURE = "http://mcp-fixture.t10.svc.cluster.local:18099";

async function login(page: Page, user: string) {
	await page.goto("/");
	await page.locator("#name").fill(user);
	await page.locator("#password").fill("t10-sample-password");
	await page.locator("#password").press("Enter");
	await page.waitForURL(/\/t\//);
}

function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; text: string; body: Record<string, unknown> }> {
	return page.evaluate(
		async ({ method, path, body }) => {
			const response = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
			const text = await response.text();
			let parsed: Record<string, unknown> = {};
			try {
				parsed = JSON.parse(text) as Record<string, unknown>;
			} catch {}
			return { status: response.status, text, body: parsed };
		},
		{ method, path, body },
	);
}

/** Deletes what an earlier run left with these names. */
async function clean(page: Page, names: string[]) {
	const listed = await call(page, "GET", "/api/modules/agents/admin/connectors");
	for (const c of listed.body.connectors as { id: string; name: string; version: number }[]) {
		if (names.includes(c.name)) expect((await call(page, "POST", `/api/modules/agents/admin/connectors/${c.id}/remove`, { version: c.version })).status).toBe(200);
	}
}

/** The tools skills.tools lists for the signed-in person's tenant. */
async function agentTools(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const response = await fetch("/api/agents/assistant/agent", {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json", "agent-method": "skills.tools" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "skills.tools", params: {} }),
		});
		return ((await response.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
	});
}

async function ask(page: Page, text: string) {
	await page.goto(page.url().replace(/\/t\/([^/]+)\/.*$/, "/t/$1/"));
	await page.locator(".composer textarea").fill(text);
	await page.locator(".composer textarea").press("Enter");
}

test("an admin connects a per-person OAuth server, and the agent calls it as each person, or tells them to connect", async ({ browser }) => {
	test.setTimeout(300_000);
	const admin = await (await browser.newContext()).newPage();
	await login(admin, "sample-acme-admin");
	await clean(admin, ["fixture-notes", "fixture-key"]);

	// Add it in the UI.
	await admin.getByTestId("nav-connectors").click();
	await admin.getByTestId("connectors-new").click();
	await admin.getByTestId("connector-title").fill("Fixture notes");
	await admin.getByTestId("connector-name").fill("fixture-notes");
	await admin.getByTestId("connector-url").fill(`${FIXTURE}/oauth/mcp`);
	await admin.getByTestId("connector-create").click();
	await expect(admin.getByTestId("connector-page")).toBeVisible();
	await expect(admin.getByTestId("connector-state")).toContainText(/Draft|草稿/);

	// Discovery needs the admin's own sign-in first.
	await admin.getByTestId("connector-discover").click();
	await expect(admin.getByTestId("connector-discover-problem")).toContainText("Connect your own account");

	// Sign in at the fixture's consent page, which sends the browser back to Connections.
	await admin.getByTestId("connector-connect").click();
	await admin.waitForURL(/127\.0\.0\.1:18099\/authorize/);
	await admin.locator("input[name=user]").fill("acme-admin-at-fixture");
	await admin.getByRole("button", { name: "Allow" }).click();
	await admin.waitForURL(/\/connections/);
	await expect(admin.locator(".toast")).toContainText(/Connected|已连接/);

	await admin.getByTestId("nav-connectors").click();
	await admin.getByTestId("connector-row-fixture-notes").click();
	await admin.getByTestId("connector-discover").click();
	await expect(admin.getByTestId("connector-tool-whoami")).toBeVisible();
	await expect(admin.getByText("bad name!")).toHaveCount(0);
	await admin.getByTestId("connector-tool-whoami").check();
	await admin.getByTestId("connector-tool-echo").check();
	await admin.getByTestId("connector-agent-assistant").check();
	await admin.getByTestId("connector-publish").click();
	await expect(admin.getByTestId("connector-state")).toContainText(/Live|已生效/);

	// The agent offers the tools to this tenant, on its next turn, without a restart.
	await expect.poll(() => agentTools(admin), { timeout: 15_000 }).toContain("fixture-notes_whoami");
	const globex = await (await browser.newContext()).newPage();
	await login(globex, "sample-globex-admin");
	expect(await agentTools(globex)).not.toContain("fixture-notes_whoami");

	// The admin's run calls it as the admin's own account.
	await ask(admin, "Call the fixture-notes_whoami tool now and tell me exactly what it returned.");
	await expect(admin.locator(".transcript")).toContainText("acme-admin-at-fixture", { timeout: 120_000 });

	// A member who hasn't connected is told to, and sees it under Connectors.
	const member = await (await browser.newContext()).newPage();
	await login(member, "sample-member");
	await expect(member.getByTestId("nav-connectors")).toBeVisible();
	expect((await call(member, "GET", "/api/modules/agents/admin/connectors")).status).toBe(403);
	await ask(member, "Call the fixture-notes_whoami tool now and tell me exactly what it returned.");
	// The gateway's tool error says where to connect; the model passes it on in its own words.
	await expect(member.locator(".transcript")).toContainText(/connect|连接/i, { timeout: 120_000 });
	await expect(member.locator(".transcript")).not.toContainText("acme-admin-at-fixture");
	await member.getByTestId("nav-connectors").click();
	await expect(member.getByTestId("connection-fixture-notes")).toContainText(/Not connected|未连接/);

	// A shared key is stored and never read back.
	const created = await call(admin, "POST", "/api/modules/agents/admin/connectors", {
		name: "fixture-key", title: "Fixture key", url: `${FIXTURE}/key/mcp`, auth: { kind: "api_key", header: "X-API-Key" },
	});
	expect(created.status).toBe(201);
	const id = (created.body.connector as { id: string }).id;
	await admin.goto(admin.url().replace(/\/t\/([^/]+)\/.*$/, `/t/$1/connectors/${id}`));
	await admin.getByTestId("connector-secret").fill("fixture-key");
	await admin.getByTestId("connector-save-secret").click();
	await expect(admin.locator(".toast")).toContainText(/Credential saved|凭据已保存/);
	await admin.getByTestId("connector-discover").click();
	await admin.getByTestId("connector-tool-add_numbers").check();
	await admin.getByTestId("connector-agent-assistant").check();
	await admin.getByTestId("connector-publish").click();
	await expect(admin.getByTestId("connector-state")).toContainText(/Live|已生效/);
	const listed = await call(admin, "GET", "/api/modules/agents/admin/connectors");
	// The key's value is also the connector's name here, so look everywhere but the name.
	const rows = (listed.body.connectors as Record<string, unknown>[]).map(({ name: _name, ...rest }) => rest);
	expect(JSON.stringify(rows)).not.toContain("fixture-key");
	expect(listed.text).toContain('"credential":true');

	await clean(admin, ["fixture-notes", "fixture-key"]);
	await expect.poll(() => agentTools(admin), { timeout: 15_000 }).not.toContain("fixture-notes_whoami");
});
