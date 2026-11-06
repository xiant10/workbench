import {expect,test} from '@playwright/test';
test('finance can read period reports and employees without report access are denied',async({page})=>{
 await page.goto('/');await page.locator('#name').fill('property-finance');await page.locator('#password').fill('t10-sample-password');await page.locator('#password').press('Enter');await page.waitForURL(/\/t\//);
 await page.goto('/t/ten_sample-acme/property');await page.getByRole('tab',{name:'Financial reports'}).click();
 await expect(page.getByText('Cash collection rate',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Balance age'})).toBeVisible();
 expect((await page.getByLabel('Report building').boundingBox())!.height).toBeLessThan(60);
 await page.screenshot({path:'test-results/property-financial-report.png',fullPage:true});
 const period=await page.getByLabel('Report month').inputValue();
 const report=await page.evaluate(async(period)=>{const r=await fetch('/api/modules/property/reports/finance?'+new URLSearchParams({period}));if(!r.ok)throw new Error('report '+r.status);return r.json()},period);
 expect(report.definition_version).toBe('property-finance-v2');expect(report.timezone).toBe('Asia/Shanghai');expect(report.totals.net_cash_fen).toEqual(expect.any(Number));
 const repeat=await page.evaluate(async({period,asof})=>(await fetch('/api/modules/property/reports/finance?'+new URLSearchParams({period,as_of:asof}))).json(),{period,asof:report.as_of});expect(repeat.totals).toEqual(report.totals);
 await page.getByLabel('Period type').selectOption('year');await expect(page.getByLabel('Report year')).toBeVisible();await expect(page.getByRole('heading',{name:'Balance age'})).toBeVisible();
 await page.context().clearCookies();await page.goto('/');await page.locator('#name').fill('property-maintenance');await page.locator('#password').fill('t10-sample-password');await page.locator('#password').press('Enter');await page.waitForURL(/\/t\//);
 await page.goto('/t/ten_sample-acme/property');await expect(page.getByRole('tab',{name:'Financial reports'})).toHaveCount(0);
 expect(await page.evaluate(async(period)=>(await fetch('/api/modules/property/reports/finance?'+new URLSearchParams({period}))).status,period)).toBe(403);
});
