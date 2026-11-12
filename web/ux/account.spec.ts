import { expect, test } from "@playwright/test";
import { mock } from "./fixtures.ts";

for (const width of [320, 390, 1440]) test(`profile and settings keep navigation at ${width}px`, async ({ page }) => {
 await mock(page);
 await page.setViewportSize({ width, height: 900 });
 await page.goto('/t/demo/');
 if (width < 600) await page.getByRole('button', { name: 'Menu', exact: true }).click();
 await page.getByRole('button', { name: 'Account', exact: true }).click();
 await page.getByRole('link', { name: 'Profile', exact: true }).click();
 await expect(page).toHaveURL(/\/profile$/);
 await expect(page.getByRole('heading', { name: 'Felix' })).toBeVisible();
 await expect(page.getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/account');
 await page.getByRole('navigation', { name: 'Account', exact: true }).getByRole('link', { name: 'Settings' }).click();
 await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
 await expect(page.getByRole('link', { name: 'Manage account' })).not.toHaveAttribute('target', '_blank');
 await page.goBack();
 await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: `test-results/profile-${width}.png`, fullPage: true });
});

test('collapsed navigation leaves space for the settings heading', async ({ page }) => {
 await mock(page);
 await page.goto('/t/demo/settings');
 await page.getByRole('button', { name: 'Hide sidebar' }).click();
 const menu = await page.getByRole('button', { name: 'Menu', exact: true }).boundingBox();
 const heading = await page.getByRole('heading', { name: 'Settings', exact: true }).boundingBox();
 expect(heading!.x).toBeGreaterThanOrEqual(menu!.x + menu!.width);
 await page.getByRole('button', { name: 'Menu', exact: true }).click();
 await expect(page.getByRole('navigation', { name: 'Workbench', exact: true })).toBeVisible();
});

test('profile labels missing details without implying an email or security status', async ({ page }) => {
 await mock(page);
 await page.goto('/t/demo/profile');
 await expect(page.getByText('Not available', { exact: true })).toBeVisible();
 await expect(page.getByRole('link', { name: 'Manage security' })).toHaveAttribute('href', '/account');
 await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
 await page.getByRole('button', { name: 'Copy user ID' }).click();
 await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
 expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('u1');
 await page.getByRole('link', { name: 'Customize Workbench' }).click();
 await expect(page).toHaveURL(/\/settings$/);
});

test('long account details fit in dark mode on a narrow screen', async ({ page }) => {
 await mock(page);
 await page.setViewportSize({ width: 320, height: 900 });
 await page.addInitScript(() => localStorage.setItem('wb:theme', 'dark'));
 await page.route('**/api/me', route => route.fulfill({ json: {
  user_id: 'user_' + 'a'.repeat(80), display_name: 'Alexandra '.repeat(8),
  sign_in_name: 'alexandra.long.signin.name@organization.example', active_tenant: 'demo',
  tenants: [{ id: 'demo', name: 'International research and development workspace', role: 'admin' }],
 } }));
 await page.goto('/t/demo/profile');
 await expect(page.getByRole('heading', { name: 'Personal information' })).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: 'test-results/profile-dark-320.png', fullPage: true });
 await page.getByRole('link', { name: 'Manage security' }).scrollIntoViewIfNeeded();
 await expect(page.getByRole('link', { name: 'Manage security' })).toBeVisible();
 await page.screenshot({ path: 'test-results/profile-dark-controls-320.png', fullPage: true });
});
