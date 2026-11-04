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

test("admin manages versions; members see only current tenant publications", async ({ page, browser }) => {
	test.setTimeout(180_000);
	const title = `Knowledge lifecycle ${Date.now()}`;
	await login(page, "sample-acme-admin");
	await page.getByRole("link", { name: "Administration", exact: true }).click();
	await page.getByRole("tab", { name: "Knowledge", exact: true }).click();
	await page.getByLabel("New knowledge base").fill(title);
	await page.getByRole("button", { name: "Create base", exact: true }).click();
	await expect(page.getByLabel("Knowledge base", { exact: true })).not.toHaveValue("");
	await page.getByRole("button", { name: "Upload documents", exact: true }).click();
	await page.getByLabel("Document title", { exact: true }).fill(title);
	await page.getByLabel("Or paste text").fill("Vacation allowance: 20 days. <script>window.knowledgeInjected=true</script>");
	await page.getByLabel("Publication", { exact: true }).selectOption("false");
	await page.getByRole("button", { name: "Upload", exact: true }).click();
	await expect(page.getByText(/accepted for processing as v1/)).toBeVisible();
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await page.getByRole("button", { name: title, exact: true }).click();
	await expect(page.getByRole("button", { name: "Publish v1", exact: true })).toBeVisible({ timeout: 20000 });
	await expect(page.locator("pre")).toContainText("20 days");
	expect(await page.evaluate(() => Object.hasOwn(window, "knowledgeInjected"))).toBe(false);
	const memberContext = await browser.newContext();
	const member = await memberContext.newPage();
	const foreignContext = await browser.newContext();
	const foreign = await foreignContext.newPage();
	try {
		await login(member, "sample-member");
		await member.getByRole("link", { name: "Knowledge", exact: true }).click();
		await expect(member.getByRole("button", { name: title, exact: true })).toHaveCount(0);
		const forbidden = await member.evaluate(async () => {
			const r = await fetch("/api/modules/knowledge/admin/documents");
			return r.status;
		});
		expect(forbidden).toBe(403);
		await page.getByRole("button", { name: "Publish v1", exact: true }).click();
		await expect(page.getByText(/Published v1 · Newest/)).toBeVisible();
		await member.reload();
		await member.getByRole("button", { name: title, exact: true }).click();
		await expect(member.locator("pre")).toContainText("20 days");
		const sourceURL = await member.getByRole("link", { name: /Download original/ }).getAttribute("href");
		expect(sourceURL).toBeTruthy();
		const download = await member.request.get(sourceURL!);
		expect(download.status()).toBe(200);
		expect(download.headers()["content-disposition"]).toContain("attachment");
		await login(foreign, "sample-globex-admin");
		expect((await foreign.request.get(sourceURL!)).status()).toBe(404);
		await page.getByRole("button", { name: "Upload new version", exact: true }).click();
		await page.getByLabel("Or paste text").fill("Vacation allowance: 25 days.");
		await page.getByRole("button", { name: "Upload", exact: true }).click();
		await expect(page.getByText(/accepted for processing as v2/)).toBeVisible();
		await page.getByRole("button", { name: "Done", exact: true }).click();
		await expect(page.getByText(/Published v2 · Newest/)).toBeVisible({ timeout: 20000 });
		await member.reload();
		await member.getByRole("button", { name: title, exact: true }).click();
		await expect(member.locator("pre")).toContainText("25 days");
		await page.getByRole("button", { name: "Roll back v1", exact: true }).click();
		await expect(page.getByText(/Published v1 · Newest/)).toBeVisible();
		await page.getByRole("button", { name: "Unpublish", exact: true }).click();
		await expect(page.getByText(/Unpublished · Newest/)).toBeVisible();
		expect((await member.request.get(sourceURL!)).status()).toBe(404);
		page.once("dialog", (d) => d.accept());
		await page.getByRole("button", { name: "Move to trash", exact: true }).click();
		await expect(page.getByRole("button", { name: "Restore as unpublished" })).toBeVisible();
		await page.getByRole("button", { name: "Restore as unpublished" }).click();
		await expect(page.getByText(/Unpublished · Newest/)).toBeVisible();
		expect((await member.request.get(sourceURL!)).status()).toBe(404);
		page.once("dialog", (d) => d.accept());
		await page.getByRole("button", { name: "Move to trash", exact: true }).click();
		await page.getByRole("button", { name: "← All documents" }).click();
		await page.getByLabel("Show trash").check();
		await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
		await page.screenshot({ path: "test-results/knowledge-admin.png", fullPage: true });
	} finally {
		await memberContext.close();
		await foreignContext.close();
	}
});

test("PDF files ingest and publish through the browser", async ({ page }) => {
	const title = `Knowledge PDF ${Date.now()}`;
	await login(page, "sample-acme-admin");
	await page.getByRole("link", { name: "Administration", exact: true }).click();
	await page.getByRole("tab", { name: "Knowledge", exact: true }).click();
	await page.getByRole("button", { name: "Upload documents", exact: true }).click();
	await page.getByLabel("Document title", { exact: true }).fill(title);
	await page.getByLabel("Files", { exact: true }).setInputFiles({ name: "policy.pdf", mimeType: "application/pdf", buffer: pdf("PDF ingestion works") });
	await page.getByRole("button", { name: "Upload", exact: true }).click();
	await expect(page.getByText(/accepted for processing as v1/)).toBeVisible();
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await page.getByRole("button", { name: title, exact: true }).click();
	await expect(page.getByText(/Published v1 · Newest/)).toBeVisible({ timeout: 30000 });
	await expect(page.locator("pre")).toContainText("PDF ingestion works");
	page.once("dialog", (d) => d.accept());
	await page.getByRole("button", { name: "Move to trash", exact: true }).click();
});
