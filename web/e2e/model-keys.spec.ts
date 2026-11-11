import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

// Tenants' model keys end to end on the local cluster: the platform lets Acme bring a key, Acme's admin adds one that
// ai-gateway-llm checks with the real provider, chooses "only our keys", and a turn on Ti is paid by that key, as the
// gateway's audit records. A key the provider refuses is never stored, and Globex sees nothing of Acme's. See
// t10-agent-control/docs/model-keys.md. MODEL_KEYS_SECRET is a real key for the gateway's "openai" provider.
test.skip(process.env.MODEL_KEYS_E2E !== "1" || !process.env.MODEL_KEYS_SECRET, "Requires the local cluster with model keys, and MODEL_KEYS_SECRET");

const TENANT = process.env.MODEL_KEYS_TENANT ?? "ten_acme";
const AGENT = "ti";

function kubectl(...args: string[]): string {
	return execFileSync("kubectl", ["-n", "t10", ...args], { encoding: "utf8" });
}

/** The platform's leave, as the console would set it, written straight into control's database for the test. */
function platformPolicy(sql: string) {
	kubectl("exec", "deploy/postgres", "--", "psql", "-U", "postgres", "-d", "agent_control", "-qc", sql);
}

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

/** One turn on the agent, waiting for its reply, and the turn's ID. */
function turn(page: Page, text: string): Promise<{ turnId: string; status: string }> {
	return page.evaluate(
		async ({ agent, text }) => {
			const rpc = async (method: string, params: Record<string, unknown>) => {
				const response = await fetch(`/api/agents/${agent}/agent`, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json", "agent-method": method },
					body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
				});
				return ((await response.json()) as { result: Record<string, unknown> }).result;
			};
			const { sessionId } = (await rpc("session.create", { metadata: { title: "model keys e2e" } })) as { sessionId: string };
			const result = await rpc("session.prompt", { sessionId, input: text });
			return { turnId: String(result.turnId), status: String(result.status) };
		},
		{ agent: AGENT, text },
	);
}

/** The gateway's audit records for a turn. */
function audited(turnId: string): Record<string, unknown>[] {
	const lines = kubectl("exec", "ai-gateway-llm-0", "--", "sh", "-c", "tail -n 400 /var/lib/ai-gateway/audit.jsonl");
	return lines
		.split("\n")
		.filter((line) => line.includes(turnId))
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("a tenant's own key pays for its agents' calls, and only after the provider accepts it", async ({ browser }) => {
	test.setTimeout(180_000);
	platformPolicy(
		`INSERT INTO agent_model_keys.platform_policies (tenant_id, capability, byok_providers, updated_by) VALUES ('${TENANT}', 'llm', '{openai}', 'e2e')
		 ON CONFLICT (tenant_id, capability) DO UPDATE SET byok_providers = '{openai}'`,
	);
	const acme = await (await browser.newContext()).newPage();
	await login(acme, "sample-acme-admin");
	const base = "/api/modules/agents/admin";
	const before = await call(acme, "GET", `${base}/model-keys`);
	for (const c of before.body.credentials as { id: string; label: string }[]) {
		if (c.label.startsWith("e2e ")) await call(acme, "DELETE", `${base}/model-keys/${c.id}`);
	}
	expect(before.body.sealing).toBe(true);

	const refused = await call(acme, "POST", `${base}/model-keys`, { provider: "openai", label: "e2e bad", secret: "sk-not-a-real-key-0000" });
	expect(refused.status, JSON.stringify(refused.body)).toBe(422);
	expect(refused.body.error).toBe("rejected");

	const added = await call(acme, "POST", `${base}/model-keys`, { provider: "openai", label: "e2e own", secret: process.env.MODEL_KEYS_SECRET });
	expect(added.status, JSON.stringify(added.body)).toBe(201);
	const id = (added.body.credential as { id: string }).id;
	expect(JSON.stringify(added.body)).not.toContain(process.env.MODEL_KEYS_SECRET);

	try {
		expect((await call(acme, "PUT", `${base}/model-key-policy/llm`, { mode: "strict" })).status).toBe(204);
		// The gateway polls the feed every 10 seconds.
		await acme.waitForTimeout(12_000);
		const { turnId, status } = await turn(acme, "Say hello in five words.");
		expect(status).toBe("done");
		const records = audited(turnId);
		expect(records.length, `audit for ${turnId}`).toBeGreaterThan(0);
		for (const record of records) {
			expect(record.source).toBe("own");
			expect(record.credential_id).toBe(id);
			expect(record.tenant_name).toBe(TENANT);
			expect(String(record.runtime)).toContain("agent-ti");
		}

		// The tab shows it, and never the key.
		await acme.goto(`${new URL(acme.url()).pathname.replace(/\/t\/([^/]+).*/, "/t/$1")}/admin?tab=model-keys`);
		await expect(acme.getByTestId("model-keys")).toBeVisible();
		await expect(acme.getByTestId("model-key-e2e own")).toBeVisible();
		await acme.screenshot({ path: "test-results/model-keys.png", fullPage: true });

		// Another tenant sees nothing of it.
		const globex = await (await browser.newContext()).newPage();
		await login(globex, "sample-globex-admin");
		const theirs = await call(globex, "GET", `${base}/model-keys`);
		expect(JSON.stringify(theirs.body)).not.toContain(id);
		expect((await call(globex, "DELETE", `${base}/model-keys/${id}`)).status).toBe(404);
	} finally {
		await call(acme, "DELETE", `${base}/model-key-policy/llm`);
		await call(acme, "DELETE", `${base}/model-keys/${id}`);
		platformPolicy(`DELETE FROM agent_model_keys.platform_policies WHERE tenant_id = '${TENANT}' AND updated_by = 'e2e'`);
	}
});
