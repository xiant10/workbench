import { expect, test } from "@playwright/test";

// Real local-platform integration, including the provider configured behind the
// LLM gateway. Opt in after deploying and registering Ti Assistant.
test.skip(process.env.AGENT_TI_E2E !== "1", "Requires the local agent-ti deployment and routing entry");

test("a member picks Ti Assistant, chats, and reopens its saved conversation", async ({ page }) => {
    test.setTimeout(150_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto("/");
    await page.locator("#name").fill("sample-member");
    await page.locator("#password").fill("t10-sample-password");
    await page.locator("#password").press("Enter");
    await page.waitForURL(/\/t\/ten_sample-acme\//);
    await expect(page.locator(".home-agent select option[value=ti]")).toHaveText("Ti Assistant");
    await page.locator(".home-agent select").selectOption("ti");
    const first = "Reply with exactly: Ti UI ready.";
    await page.locator(".composer textarea").fill(first);
    await page.locator(".composer textarea").press("Enter");
    await page.waitForURL(/\/c\/ti\.agent-ti-0\./);
    await expect(page.locator(".transcript .line.assistant").filter({ hasText: "Ti UI ready." })).toHaveCount(1, { timeout: 90_000 });
    await expect(page.locator(".transcript").getByText(first, { exact: true })).toHaveCount(1);
    await expect(page.locator(".composer textarea")).toHaveAttribute("placeholder", "Ask your agent");
    const second = "Reply with exactly: Ti followup ready.";
    await page.locator(".composer textarea").fill(second);
    await page.locator(".composer textarea").press("Enter");
    await expect(page.locator(".transcript .line.assistant").filter({ hasText: "Ti followup ready." })).toHaveCount(1, { timeout: 90_000 });
    await page.reload();
    await expect(page.locator(".transcript .line.assistant").filter({ hasText: "Ti UI ready." })).toHaveCount(1);
    await expect(page.locator(".transcript .line.assistant").filter({ hasText: "Ti followup ready." })).toHaveCount(1);
    await expect(page.locator(".transcript").getByText(first, { exact: true })).toHaveCount(1);
    await expect(page.locator(".transcript").getByText(second, { exact: true })).toHaveCount(1);
    expect(pageErrors).toEqual([]);
});
