import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.KNOWLEDGE_E2E !== "1", "Requires a running Workbench + Knowledge + auth sample accounts");
async function login(page: Page, user: string) {
	await page.goto("/");
	await page.locator("#name").fill(user);
	await page.locator("#password").fill("t10-sample-password");
	await page.locator("#password").press("Enter");
	await page.waitForURL(/\/t\//);
}
function pdf(text: string) {
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
	objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	let content = "%PDF-1.4\n";
	const offsets = [0];
	for (let i = 0; i < objects.length; i++) {
		offsets.push(Buffer.byteLength(content));
		content += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
	}
	const xref = Buffer.byteLength(content);
	content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) content += `${String(offset).padStart(10, "0")} 00000 n \n`;
	content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(content);
}

async function openAdmin(page: Page) {
	await page.getByRole("link", { name: "Administration", exact: true }).click();
	await page.getByRole("tab", { name: "Knowledge", exact: true }).click();
}
async function confirmDialog(page: Page, action: string) {
	await page.getByRole("dialog").getByRole("button", { name: action, exact: true }).click();
}
const row = (page: Page, title: string) => page.locator(".kn-row").filter({ hasText: title }).getByRole("button", { name: new RegExp(`^${title}`) });
const pill = (page: Page) => page.locator(".kn-detail-head .pill").first();

test("admin manages versions; members see only current tenant publications", async ({ page, browser }) => {
	test.setTimeout(180_000);
	const title = `Knowledge lifecycle ${Date.now()}`;
	await login(page, "sample-acme-admin");
	await openAdmin(page);
	await page.getByRole("button", { name: "New knowledge base", exact: true }).click();
	await page.getByRole("dialog").getByLabel("Name").fill(title);
	await confirmDialog(page, "Create base");
	await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Upload", exact: true }).click();
	const upload = page.getByRole("dialog");
	await upload.getByRole("radio", { name: "Paste text" }).click();
	await upload.getByLabel("Text", { exact: true }).fill("Vacation allowance: 20 days. <script>window.knowledgeInjected=true</script>");
	await upload.getByLabel("Title", { exact: true }).fill(title);
	await upload.getByLabel("Publish when ready").uncheck();
	await upload.getByRole("button", { name: "Upload", exact: true }).click();
	await expect(upload).toHaveCount(0);
	await row(page, title).click();
	await expect(page.getByRole("button", { name: "Publish v1", exact: true })).toBeVisible({ timeout: 20000 });
	await expect(pill(page)).toHaveText("Draft");
	await expect(page.locator("pre")).toContainText("20 days");
	expect(await page.evaluate(() => Object.hasOwn(window, "knowledgeInjected"))).toBe(false);
	const memberContext = await browser.newContext();
	const member = await memberContext.newPage();
	const foreignContext = await browser.newContext();
	const foreign = await foreignContext.newPage();
	try {
		await login(member, "sample-member");
		await member.getByRole("link", { name: "Knowledge", exact: true }).click();
		await expect(row(member, title)).toHaveCount(0);
		const forbidden = await member.evaluate(async () => (await fetch("/api/modules/knowledge/admin/documents")).status);
		expect(forbidden).toBe(403);
		await page.getByRole("button", { name: "Publish v1", exact: true }).click();
		await expect(pill(page)).toHaveText("Published v1");
		await member.reload();
		await row(member, title).click();
		await expect(member.locator("pre")).toContainText("20 days");
		const sourceURL = await member.getByRole("link", { name: /Download original/ }).getAttribute("href");
		expect(sourceURL).toBeTruthy();
		const download = await member.request.get(sourceURL!);
		expect(download.status()).toBe(200);
		expect(download.headers()["content-disposition"]).toContain("attachment");
		await login(foreign, "sample-globex-admin");
		expect((await foreign.request.get(sourceURL!)).status()).toBe(404);
		await page.getByRole("button", { name: "Upload new version", exact: true }).click();
		await upload.getByRole("radio", { name: "Paste text" }).click();
		await upload.getByLabel("Text", { exact: true }).fill("Vacation allowance: 25 days.");
		await upload.getByRole("button", { name: "Upload", exact: true }).click();
		await expect(upload).toHaveCount(0);
		await expect(pill(page)).toHaveText("Published v2", { timeout: 20000 });
		// The open document is in the address, so a reload keeps it open.
		await member.reload();
		await expect(member.locator("pre")).toContainText("25 days");
		await page.getByRole("tab", { name: /^Versions/ }).click();
		await page.getByRole("button", { name: "Roll back v1", exact: true }).click();
		await expect(pill(page)).toHaveText("Published v1");
		await page.getByRole("button", { name: "Unpublish", exact: true }).click();
		await expect(pill(page)).toHaveText("Draft");
		expect((await member.request.get(sourceURL!)).status()).toBe(404);
		await page.getByRole("button", { name: "Move to trash", exact: true }).click();
		await confirmDialog(page, "Move to trash");
		await page.getByRole("button", { name: "Restore as unpublished" }).click();
		await expect(pill(page)).toHaveText("Draft");
		expect((await member.request.get(sourceURL!)).status()).toBe(404);
		await page.getByRole("button", { name: "Move to trash", exact: true }).click();
		await confirmDialog(page, "Move to trash");
		await expect(pill(page)).toHaveText("In trash");
		await page.getByRole("button", { name: "All documents", exact: true }).click();
		await page.getByRole("navigation", { name: "Knowledge library" }).getByRole("button", { name: "Trash" }).click();
		await expect(row(page, title)).toBeVisible();
		await page.screenshot({ path: "test-results/knowledge-admin.png", fullPage: true });
	} finally {
		await memberContext.close();
		await foreignContext.close();
	}
});

test("PDF files ingest and publish through the browser", async ({ page }) => {
	const title = `Knowledge PDF ${Date.now()}`;
	await login(page, "sample-acme-admin");
	await openAdmin(page);
	await page.getByRole("button", { name: "Upload", exact: true }).click();
	const upload = page.getByRole("dialog");
	await upload.getByLabel("Files", { exact: true }).setInputFiles({ name: "policy.pdf", mimeType: "application/pdf", buffer: pdf("PDF ingestion works") });
	await upload.getByLabel("Title", { exact: true }).fill(title);
	await upload.getByRole("button", { name: "Upload", exact: true }).click();
	await expect(upload).toHaveCount(0);
	await row(page, title).click();
	await expect(pill(page)).toHaveText("Published v1", { timeout: 30000 });
	await expect(page.locator("pre")).toContainText("PDF ingestion works");
	await page.getByRole("button", { name: "Move to trash", exact: true }).click();
	await confirmDialog(page, "Move to trash");
});

test("document sets narrow queries across bases without copying documents", async ({ page, browser }) => {
	test.setTimeout(120_000);
	const stamp = String(Date.now());
	const setTitle = `Focused docs ${stamp}`;
	const firstTitle = `Scope A ${stamp}`;
	const secondTitle = `Scope B ${stamp}`;
	const query = `scope${stamp}`;
	await login(page, "sample-acme-admin");
	const documents = await page.evaluate(
		async ({ firstTitle, secondTitle, query }) => {
			const root = "/api/modules/knowledge";
			const ids: string[] = [];
			for (const title of [firstTitle, secondTitle]) {
				const baseResponse = await fetch(`${root}/admin/bases`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title }),
				});
				if (!baseResponse.ok) throw new Error("Base failed");
				const base = await baseResponse.json();
				const data = new FormData();
				data.set("file", new File([`${query} ${title}`], "scope.txt"));
				data.set("title", title);
				data.set("base_id", base.id);
				data.set("publish_when_ready", "true");
				const response = await fetch(`${root}/admin/documents`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: data });
				if (!response.ok) throw new Error(`Upload ${response.status}`);
				ids.push((await response.json()).id);
			}
			return ids;
		},
		{ firstTitle, secondTitle, query },
	);
	const memberContext = await browser.newContext();
	const member = await memberContext.newPage();
	const searchIn = async (title: string) => {
		await member.getByRole("navigation", { name: "Knowledge library" }).getByRole("button", { name: new RegExp(`^${title}`) }).click();
		await member.getByRole("searchbox", { name: "Search published text" }).fill(query);
		await member.getByRole("button", { name: "Search", exact: true }).click();
	};
	const hit = (title: string) => member.locator(".kn-hit").filter({ hasText: title });
	try {
		await expect
			.poll(
				() =>
					page.evaluate(async (query) => {
						const r = await fetch("/api/modules/knowledge/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
						return (await r.json()).results.length;
					}, query),
				{ timeout: 20000 },
			)
			.toBe(2);
		await openAdmin(page);
		await page.getByRole("button", { name: "New document set", exact: true }).click();
		const editor = page.getByRole("dialog");
		await editor.getByLabel("Name", { exact: true }).fill(setTitle);
		await editor.getByLabel("What it covers").fill("Scope test documents");
		await editor.getByPlaceholder("Find documents").fill(stamp);
		await editor.getByRole("checkbox", { name: `Include ${firstTitle}`, exact: true }).check();
		await editor.getByRole("button", { name: "Create document set", exact: true }).click();
		await expect(page.getByRole("heading", { name: setTitle, exact: true })).toBeVisible();
		await expect(page.getByText("Scope test documents")).toBeVisible();
		await expect(row(page, firstTitle)).toBeVisible();
		await login(member, "sample-member");
		await member.getByRole("link", { name: "Knowledge", exact: true }).click();
		await searchIn(setTitle);
		await expect(hit(firstTitle)).toBeVisible();
		await expect(hit(secondTitle)).toHaveCount(0);
		const setID = await page.evaluate(async (title) => {
			const r = await fetch("/api/modules/knowledge/collections");
			return (await r.json()).collections.find((s: { title: string }) => s.title === title).id as string;
		}, setTitle);
		const outcomes = await member.evaluate(
			async ({ setID, documents, query }) => {
				const results = [];
				for (const scope of [{ collection_ids: [setID], document_ids: [documents[1]] }, { collection_ids: [] }, { collection_ids: null }, { collection_ids: ["set_missing"] }]) {
					const r = await fetch("/api/modules/knowledge/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, ...scope }) });
					const body = await r.json();
					results.push({ status: r.status, count: body.results?.length });
				}
				return results;
			},
			{ setID, documents, query },
		);
		expect(outcomes).toEqual([
			{ status: 200, count: 0 },
			{ status: 200, count: 0 },
			{ status: 400, count: undefined },
			{ status: 404, count: undefined },
		]);
		// Bulk-add the second document from the list, then remove the first.
		await page.getByRole("navigation", { name: "Knowledge library" }).getByRole("button", { name: "All documents" }).click();
		await page.getByRole("checkbox", { name: `Select ${secondTitle}`, exact: true }).check();
		await page.getByRole("button", { name: "Add to set", exact: true }).click();
		await page.locator(".menu").getByRole("button", { name: setTitle, exact: true }).click();
		await expect(page.getByText(`Added to ${setTitle}.`)).toBeVisible();
		await page.getByRole("navigation", { name: "Knowledge library" }).getByRole("button", { name: new RegExp(`^${setTitle}`) }).click();
		await page.getByRole("checkbox", { name: `Select ${firstTitle}`, exact: true }).check();
		await page.getByRole("button", { name: "Remove from this set", exact: true }).click();
		await expect(row(page, firstTitle)).toHaveCount(0);
		await expect(row(page, secondTitle)).toBeVisible();
		await member.getByRole("button", { name: "Search", exact: true }).click();
		await expect(hit(secondTitle)).toBeVisible();
		await expect(hit(firstTitle)).toHaveCount(0);
		await page.screenshot({ path: "test-results/knowledge-document-sets.png", fullPage: true });
		await page.getByRole("button", { name: "Edit set", exact: true }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Delete set", exact: true }).click();
		await page.getByRole("dialog", { name: `Delete ${setTitle}` }).getByRole("button", { name: "Delete set", exact: true }).click();
		await expect(page.getByRole("navigation", { name: "Knowledge library" }).getByRole("button", { name: new RegExp(`^${setTitle}`) })).toHaveCount(0);
		await member.getByRole("button", { name: "Search", exact: true }).click();
		await expect(member.getByRole("alert")).toContainText("Search scope is unavailable");
		await expect(hit(secondTitle)).toHaveCount(0);
		const surviving = await member.evaluate(async (query) => {
			const r = await fetch("/api/modules/knowledge/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
			return (await r.json()).results.length;
		}, query);
		expect(surviving).toBe(2);
	} finally {
		await memberContext.close();
		await page.evaluate(async (ids) => {
			for (const id of ids) {
				const r = await fetch(`/api/modules/knowledge/admin/documents/${id}`);
				if (!r.ok) continue;
				const d = await r.json();
				await fetch(`/api/modules/knowledge/admin/documents/${id}`, {
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ revision: d.revision }),
				});
			}
		}, documents);
	}
});

test("admins limit agents to sets; people ask an agent about a set; citations open documents", async ({ page }) => {
	test.setTimeout(120_000);
	const stamp = String(Date.now());
	const setTitle = `Agent scope ${stamp}`;
	await login(page, "sample-acme-admin");
	const { doc, set } = await page.evaluate(async ({ stamp, setTitle }) => {
		const root = "/api/modules/knowledge";
		const base = await (await fetch(`${root}/admin/bases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Agent base ${stamp}` }) })).json();
		const data = new FormData();
		data.set("file", new File([`Expense limit ${stamp}`], "expenses.txt"));
		data.set("title", `Expenses ${stamp}`);
		data.set("base_id", base.id);
		data.set("publish_when_ready", "true");
		const doc = (await (await fetch(`${root}/admin/documents`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: data })).json()).id as string;
		const set = await (await fetch(`${root}/admin/collections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: setTitle, description: "Expense rules", document_ids: [doc] }) })).json();
		return { doc, set: set.id as string };
	}, { stamp, setTitle });
	const limits = () => page.evaluate(async () => (await (await fetch("/api/modules/knowledge/admin/agent-access")).json()).agents as { agent: string; set_ids: string[]; revision: number }[]);
	try {
		await page.getByRole("link", { name: "Knowledge", exact: true }).click();
		const nav = page.getByRole("navigation", { name: "Knowledge library" });
		await nav.getByRole("button", { name: "Agent access" }).click();
		const card = page.locator("section.kn-card").first();
		const agent = (await card.getAttribute("aria-label")) ?? "";
		await card.getByRole("radio", { name: "Only chosen sets" }).click();
		await expect(card.getByText("With no sets chosen")).toBeVisible();
		await card.locator("label", { hasText: setTitle }).click();
		await card.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByText(`Saved access for ${agent}.`)).toBeVisible();
		await expect.poll(async () => (await limits()).some((l) => l.set_ids.includes(set))).toBe(true);
		await page.screenshot({ path: "test-results/knowledge-agent-access.png" });

		// A citation link is the Knowledge page with ?doc=, which opens the document.
		await page.goto(page.url().replace(/knowledge.*$/, `knowledge?doc=${doc}`));
		await expect(page.getByRole("heading", { name: `Expenses ${stamp}` })).toBeVisible();
		await page.getByRole("button", { name: "All documents", exact: true }).click();
		await expect(page).not.toHaveURL(/doc=/);

		await nav.getByRole("button", { name: new RegExp(`^${setTitle}`) }).click();
		await page.getByRole("button", { name: "Ask an agent", exact: true }).click();
		await page.getByRole("dialog").getByLabel("Question").fill("What is the expense limit?");
		await page.getByRole("dialog").getByRole("button", { name: "Ask", exact: true }).click();
		await page.waitForURL(/\/c\//);
		await expect(page.locator(".line.user").first()).toContainText("What is the expense limit?");
	} finally {
		await page.evaluate(async ({ doc, set }) => {
			const root = "/api/modules/knowledge";
			const all = (await (await fetch(`${root}/admin/agent-access`)).json()).agents as { agent: string; set_ids: string[]; revision: number }[];
			for (const l of all.filter((l) => l.set_ids.includes(set)))
				await fetch(`${root}/admin/agent-access/${l.agent}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: l.revision }) });
			const s = await (await fetch(`${root}/admin/collections/${set}`)).json();
			await fetch(`${root}/admin/collections/${set}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: s.revision }) });
			const d = await (await fetch(`${root}/admin/documents/${doc}`)).json();
			await fetch(`${root}/admin/documents/${doc}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: d.revision }) });
		}, { doc, set });
	}
});
