import {expect,test} from '@playwright/test';
import {xlsx} from './property-xlsx.ts';
test('receipt workbook validates before posting and exact duplicates stay out of the ledger',async({page})=>{
 await page.goto('/');await page.locator('#name').fill('property-finance');await page.locator('#password').fill('t10-sample-password');await page.locator('#password').press('Enter');await page.waitForURL(/\/t\//);
 const marker='Synthetic import '+Date.now();const amount=1234700+Math.floor(Math.random()*100000);const yuan=(amount/100).toFixed(2);
 const bill=await page.evaluate(async({marker,amount})=>{
  const call=async(path:string,body:unknown)=>{const r=await fetch('/api/modules/property/'+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});if(!r.ok)throw new Error(path+' '+r.status);return r.json()};
  const c=await call('charge',{name:marker,basis:'fixed',price_fen:String(amount)});const preview=await call('bill-preview',{account_id:'account_101',charge_id:c.id,period_start:'2026-11-01',period_end:'2026-11-30',due_on:'2026-11-01'});return call('bill',preview);
 },{marker,amount});
 await page.goto('/t/ten_sample-acme/property');await page.getByRole('tab',{name:'Receipt imports'}).click();
 const original=await page.evaluate(async()=> (await(await fetch('/api/modules/property/receipt-imports')).json()).imports.length);
 const stamp=new Date(Date.now()-86400000).toISOString().slice(0,19).replace('T',' ');
 await page.getByLabel('Receipt workbook').setInputFiles({name:'invalid.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:xlsx([[stamp,yuan,'DEMO-101','transfer'],[stamp,'1.001','DEMO-101','cash']])});await page.getByRole('button',{name:'Validate and preview'}).click();await expect(page.getByText('Nothing was staged.',{exact:false})).toBeVisible();await expect(page.getByText('Row 3:',{exact:false})).toBeVisible();
 expect(await page.evaluate(async()=> (await(await fetch('/api/modules/property/receipt-imports')).json()).imports.length)).toBe(original);
 const data=xlsx([[stamp,yuan,'DEMO-101','transfer'],[stamp,'1.00','UNKNOWN-'+marker,'cash']]);
 await page.getByLabel('Receipt workbook').setInputFiles({name:'receipts.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:data});await page.getByRole('button',{name:'Validate and preview'}).click();await expect(page.getByRole('heading',{name:'Receipt preview'})).toBeVisible();
 await expect(page.getByText('1 ready · 0 posted · 1 for review · 0 duplicate')).toBeVisible();
 const id=await page.getByLabel('Saved receipt import').inputValue();
 expect(await page.evaluate(async(bill)=>{const r=await fetch('/api/modules/property/billing');const v=await r.json();return v.bills.find((b:{id:string})=>b.id===bill)?.paid??false},bill.id)).toBe(false);
 await page.getByRole('button',{name:'Review row 3'}).click();await page.getByRole('button',{name:'Suspend for later'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Review posting'}).click();await page.getByRole('button',{name:'Confirm posting',exact:true}).click();await expect(page.getByText('0 ready · 1 posted · 1 for review · 0 duplicate')).toBeVisible();
 const posted=await page.evaluate(async(id)=>(await(await fetch('/api/modules/property/receipt-imports/'+id)).json()).rows,id);expect(posted[0].settlement_id).toBeTruthy();expect(posted[1].state).toBe('suspended');
 await page.getByLabel('Receipt workbook').setInputFiles({name:'same-receipt-new-file.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:xlsx([[stamp,yuan,'DEMO-101','transfer']])});await page.getByRole('button',{name:'Validate and preview'}).click();await expect(page.getByText('0 ready · 0 posted · 0 for review · 1 duplicate')).toBeVisible();
 await page.screenshot({path:'test-results/property-receipt-import.png',fullPage:true});
 await page.context().clearCookies();await page.goto('/');await page.locator('#name').fill('sample-acme-admin');await page.locator('#password').fill('t10-sample-password');await page.locator('#password').press('Enter');await page.waitForURL(/\/t\//);
 expect(await page.evaluate(async(id)=>(await fetch('/api/modules/property/receipt-imports/'+id)).status,id)).toBe(403);
});
