import { expect, test, type Page } from "@playwright/test";
async function login(page:Page,user:string){
 await page.goto("/");
 await page.locator("#name").fill(user);
 await page.locator("#password").fill("t10-sample-password");
 await page.locator("#password").press("Enter");
 await page.waitForURL(/\/t\//);
 await page.goto("/t/ten_sample-acme/property");
}
test("steward browses only assigned rooms, searches and opens details",async({page})=>{
 await login(page,"property-steward");
 await expect(page.getByRole("heading",{name:"Rooms & accounts"})).toBeVisible();
 await expect(page.getByRole("button",{name:"A-101",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"B-101",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"A-101",exact:true}).click();
 await expect(page.getByRole("region",{name:"Room details"})).toContainText("DEMO-101");
 await page.getByLabel("Search room number").fill("not-a-room");
 await page.getByRole("button",{name:"Search",exact:true}).click();
 await expect(page.getByRole("heading",{name:"No rooms found"})).toBeVisible();
 await page.getByRole("button",{name:"Clear",exact:true}).click();
 await expect(page.getByRole("button",{name:"A-101",exact:true})).toBeVisible();
 await page.locator(".property-page").evaluate(el=>{el.scrollTop=0});
 await page.screenshot({path:"/tmp/t10-property-steward.png",fullPage:true});
 await page.getByRole("tab",{name:"My access"}).click();
 await expect(page.getByText("Record collection contact",{exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{const r=await fetch('/api/modules/property/registry?building=building_b');return {status:r.status,body:await r.json()}});
 expect(result.status).toBe(200);expect(result.body.rooms).toEqual([]);expect(result.body.total).toBe(0);
});
test("manager sees both buildings",async({page})=>{
 await login(page,"property-manager");
 await expect(page.getByRole("button",{name:"A-101",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"B-101",exact:true})).toBeVisible();
 await page.getByLabel("Filter by building").selectOption("building_b");
 await expect(page.getByRole("button",{name:"A-101",exact:true})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"B-101",exact:true})).toBeVisible();
});
test("finance receives an access explanation and cannot browse registry",async({page})=>{
 await login(page,"property-finance");
 await expect(page.getByRole("heading",{name:"Registry access is not assigned"})).toBeVisible();
 expect(await page.evaluate(async()=>(await fetch('/api/modules/property/registry')).status)).toBe(403);
 await page.getByRole("tab",{name:"My access"}).click();
 await expect(page.getByText("Post settlements",{exact:true})).toBeVisible();
});

test("registry remains usable on a narrow screen",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await login(page,"property-steward");
 await expect(page.getByRole("heading",{name:"Rooms & accounts"})).toBeVisible();
 await page.getByLabel("Search room number").fill("A-101");
 await page.getByRole("button",{name:"Search",exact:true}).click();
 await expect(page.getByRole("button",{name:"A-101",exact:true})).toBeVisible();
 expect(await page.locator('.property-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
