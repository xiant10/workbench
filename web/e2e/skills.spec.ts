import { expect, test, type Page } from "@playwright/test";

// Tenant skills end to end, through the Skills pages: an admin publishes at t10-agent-control and the agent reads it on
// its next turn, for that tenant only. See workbench/docs/skills-ui.md and t10-agent-control/docs/tenant-skills.md.
test.skip(process.env.SKILLS_E2E !== "1", "Requires a running Workbench, t10-agent-control and agents with AGENT_CONTROL_URL, and the sample accounts");

const AGENT = "assistant";
const SKILL = "weather";

async function login(page: Page, user: string) {
	await page.goto("/");
	await page.locator("#name").fill(user);
	await page.locator("#password").fill("t10-sample-password");
	await page.locator("#password").press("Enter");
	await page.waitForURL(/\/t\//);
}

type Listed = { name: string; flow?: { title: string; triggerKeywords?: string[] }; source?: { kind: string; version: number } };

/** skills.list as the signed-in user. */
function skills(page: Page): Promise<Listed[]> {
	return page.evaluate(async (agent) => {
		const response = await fetch(`/api/agents/${agent}/agent`, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json", "agent-method": "skills.list" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "skills.list", params: {} }),
		});
		return ((await response.json()) as { result: { skills: Listed[] } }).result.skills;
	}, AGENT);
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

const weatherOn = async (page: Page) => (await skills(page)).find((skill) => skill.name === SKILL);

async function openSkills(page: Page) {
	await page.getByTestId("nav-skills").click();
	await page.getByTestId(`skills-agent-${AGENT}`).click().catch(() => undefined);
}

test("customizing a built-in workflow reaches this tenant only, and Restore built-in undoes it", async ({ browser }) => {
	test.setTimeout(120_000);
	const acme = await (await browser.newContext()).newPage();
	await login(acme, "sample-acme-admin");
	// Start from the built-in, turning off what an earlier failed run left.
	const before = await call(acme, "GET", `/api/modules/agents/admin/skills?agent=${AGENT}`);
	const left = (before.body.skills as { name: string; state: string; version: number }[]).find((s) => s.name === SKILL && s.state === "published");
	if (left !== undefined) {
		expect((await call(acme, "DELETE", `/api/modules/agents/admin/skills/${AGENT}/${SKILL}?version=${left.version}`)).status).toBe(200);
		await expect.poll(async () => (await weatherOn(acme))?.source, { timeout: 15_000 }).toBeUndefined();
	}
	const builtin = await weatherOn(acme);
	expect(builtin?.source).toBeUndefined();

	// A built-in skill: instructions are read only, the workflow is editable, and publishing makes the override.
	await openSkills(acme);
	await acme.getByTestId(`skill-row-${SKILL}`).click();
	await expect(acme.getByTestId("skill-publish")).toBeDisabled();
	await acme.getByTestId("skill-tab-instructions").click();
	await expect(acme.getByTestId("skill-body")).toHaveCount(0);
	await acme.getByTestId("skill-tab-workflow").click();
	await acme.getByLabel(/Triggers|触发词/).fill("weather, e2e-trigger");
	await acme.getByTestId("skill-publish").click();
	await expect(acme.getByText(/Published version \d+|已发布第 \d+ 版/)).toBeVisible();

	// The change feed brings it to the agent within seconds, well inside the 10-second cache.
	await expect.poll(async () => (await weatherOn(acme))?.flow?.triggerKeywords, { timeout: 5_000 }).toContain("e2e-trigger");
	expect((await weatherOn(acme))?.source).toMatchObject({ kind: "override" });

	// Globex sees the built-in and none of Acme's records.
	const globex = await (await browser.newContext()).newPage();
	await login(globex, "sample-globex-admin");
	expect((await weatherOn(globex))?.flow?.triggerKeywords ?? []).not.toContain("e2e-trigger");
	expect((await weatherOn(globex))?.source).toBeUndefined();
	expect((await call(globex, "GET", `/api/modules/agents/admin/skills?agent=${AGENT}`)).body.skills).toEqual([]);

	// An Acme member doesn't get the page and can't publish.
	const member = await (await browser.newContext()).newPage();
	await login(member, "sample-member");
	await expect(member.getByTestId("nav-skills")).toHaveCount(0);
	const refused = await call(member, "PUT", `/api/modules/agents/admin/skills/${AGENT}/${SKILL}`, { kind: "override", version: 0, content: { flow: builtin?.flow } });
	expect(refused.status).toBe(403);

	await acme.getByTestId("skill-tab-history").click();
	await expect(acme.getByTestId("skill-history")).toContainText(/Live|已生效/);
	await acme.getByTestId("skill-turn-off").click();
	await acme.getByRole("dialog").getByRole("button", { name: /Restore built-in|恢复内置/ }).click();
	await expect.poll(async () => (await weatherOn(acme))?.source, { timeout: 5_000 }).toBeUndefined();
});

test("a tenant admin makes a skill with instructions, files and tools, then restores an earlier version", async ({ browser }) => {
	test.setTimeout(240_000);
	// One name every run: a rerun deletes it first, and its versions go on.
	const name = "e2e-intake";
	const acme = await (await browser.newContext()).newPage();
	await login(acme, "sample-acme-admin");
	const before = await call(acme, "GET", `/api/modules/agents/admin/skills/${AGENT}/${name}`);
	const earlier = before.status === 200 ? (before.body.skill as { version: number; state: string }) : undefined;
	// A deleted skill's versions go on from where they were when its name is used again.
	const first = (earlier?.version ?? 0) + 1;
	if (earlier !== undefined && earlier.state !== "deleted") {
		expect((await call(acme, "POST", `/api/modules/agents/admin/skills/${AGENT}/${name}/remove`, { version: earlier.version })).status).toBe(200);
	}
	await call(acme, "DELETE", `/api/modules/agents/admin/skills/${AGENT}/${name}/draft`);
	await openSkills(acme);
	{
		await acme.getByTestId("skills-new").click();
		await acme.getByTestId("new-skill-name").fill(name);
		await acme.getByTestId("new-skill-description").fill("Intake for e2e accounts");
		await acme.getByTestId("new-skill-create").click();
	}
	await expect(acme.getByTestId("skill-page")).toBeVisible();

	// Files: one created and written here, one uploaded; a script is refused.
	await acme.getByTestId("skill-tab-files").click();
	await acme.getByTestId("skill-new-file").fill("refs/tiers.md");
	await acme.getByTestId("skill-new-file").press("Enter");
	await acme.getByTestId("skill-file-editor").fill("Tier A: over 1M ARR.");
	await acme.getByTestId("skill-files-input").setInputFiles([
		{ name: "faq.txt", mimeType: "text/plain", buffer: Buffer.from("Q: who? A: VIPs.") },
		{ name: "run.sh", mimeType: "text/x-sh", buffer: Buffer.from("echo no") },
	]);
	await expect(acme.getByText(/run\.sh: only \.md|run\.sh：仅支持/)).toBeVisible();
	await expect(acme.getByText(/Not mentioned|未被引用/).first()).toBeVisible();

	// Instructions point at a file through the picker.
	await acme.getByTestId("skill-tab-instructions").click();
	await acme.getByTestId("skill-body").fill("Read ");
	await acme.getByLabel(/Insert file reference|插入文件引用/).selectOption("refs/tiers.md");
	await expect(acme.getByTestId("skill-body")).toHaveValue("Read `refs/tiers.md`");

	// Edits are a draft on the server: it's in the library as yours, and a reload brings it back.
	await expect(acme.getByTestId("skill-draft-saved")).toBeVisible();
	await acme.reload();
	await acme.getByTestId("skill-tab-instructions").click();
	await expect(acme.getByTestId("skill-body")).toHaveValue("Read `refs/tiers.md`");
	await acme.getByTestId("skill-tab-files").click();
	await expect(acme.getByText("refs/tiers.md").first()).toBeVisible();

	// The private test chat answers from the draft, and stays out of the sidebar.
	await acme.getByTestId("skill-test-toggle").click();
	await acme.getByTestId("skill-test-input").fill("Which skills can you use? Answer with their names only.");
	await acme.getByTestId("skill-test-send").click();
	await expect(acme.locator(".skill-test-agent:not(.quiet)").first()).toBeVisible({ timeout: 120_000 });
	await expect(acme.locator(".sidebar, nav").getByText(`Test: ${name}`)).toHaveCount(0);
	await acme.getByTestId("skill-test").getByRole("button", { name: /^Close$|^关闭$/ }).click();

	// Tools come from the agent's own catalog.
	await acme.getByTestId("skill-tab-tools").click();
	await acme.locator('[data-testid^="skill-tool-"]:not([disabled])').first().check();
	await acme.getByTestId("skill-publish").click();
	await expect(acme.getByText(new RegExp(`Published version ${first}\\b|已发布第 ${first} 版`))).toBeVisible();

	const stored = await call(acme, "GET", `/api/modules/agents/admin/skills/${AGENT}/${name}`);
	const skill = stored.body.skill as { kind: string; content: { description: string; body: string; tools: string[]; files: Record<string, string> } };
	expect(skill.kind).toBe("custom");
	expect(skill.content.description).toBe("Intake for e2e accounts");
	expect(skill.content.body).toBe("Read `refs/tiers.md`");
	expect(skill.content.files).toEqual({ "refs/tiers.md": "Tier A: over 1M ARR.", "faq.txt": "Q: who? A: VIPs." });
	expect(skill.content.tools).toHaveLength(1);
	await expect.poll(async () => (await skills(acme)).find((s) => s.name === name)?.source, { timeout: 5_000 }).toMatchObject({ kind: "custom", version: first });

	// A second version, then the first restored from History as a third.
	await acme.getByTestId("skill-tab-overview").click();
	await acme.getByTestId("skill-description").fill("Intake for e2e accounts, second try");
	await acme.getByTestId("skill-publish").click();
	await expect(acme.getByText(new RegExp(`Published version ${first + 1}\\b|已发布第 ${first + 1} 版`))).toBeVisible();
	await acme.getByTestId("skill-tab-history").click();
	await acme.getByTestId(`skill-restore-${first}`).click();
	await expect(acme.getByText(new RegExp(`Published version ${first + 2}\\b|已发布第 ${first + 2} 版`))).toBeVisible();
	const restored = await call(acme, "GET", `/api/modules/agents/admin/skills/${AGENT}/${name}`);
	expect((restored.body.skill as { content: { description: string } }).content.description).toBe("Intake for e2e accounts");

	// Delete: gone from the agent and the library.
	await acme.getByTestId("skill-delete").click();
	await acme.getByRole("dialog").getByRole("button", { name: /^Delete$|^删除$/ }).click();
	await expect(acme.getByTestId("skills-library")).toBeVisible();
	await expect(acme.getByTestId(`skill-row-${name}`)).toHaveCount(0);
	await expect.poll(async () => (await skills(acme)).some((s) => s.name === name), { timeout: 5_000 }).toBe(false);
});
