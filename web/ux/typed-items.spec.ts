import { expect, type Page, test } from "@playwright/test";
import { mock } from "./fixtures.ts";

// A module's typed item, drawn from its type alone. The type is a fixture, as a module would declare it.
const TYPE = {
	id: "sales.presales", owner_module: "sales", version: 1, label: "Presales", visibility: "participants",
	fields: { properties: { when: { type: "string", maxLength: 200, title: "When" }, what: { type: "string", maxLength: 2000, title: "What" }, for_whom: { type: "string", enum: ["buyer", "boss"], title: "For whom" } }, order: ["when", "what", "for_whom"] },
	states: { draft: { phase: "todo", label: "Draft" }, accepted: { phase: "doing", label: "Accepted" }, delivered: { phase: "doing", label: "Delivered" }, reviewed: { phase: "done", label: "Reviewed" } },
	state_order: ["draft", "accepted", "delivered", "reviewed"],
};

async function typedItem(page: Page) {
	const seen = { patches: [] as unknown[], moves: [] as unknown[] };
	const item = {
		id: "ask1", title: "Deck for Acme", description: "", status: "doing", priority: "normal", due_at: null, creator_id: "u2",
		version: 3, owners: ["u1"], collaborators: ["u2"], created_at: "2026-11-17T08:00:00Z", updated_at: "2026-11-17T08:00:00Z",
		type: "sales.presales", type_version: 1, state: "accepted", visibility: "participants", subject_ref: "sales:deal:d_12",
		fields: { what: "A deck", for_whom: "boss", old_field: "kept from v0" } as Record<string, unknown>,
		can: { edit: true, cancel: true, claim: false, send: true, delete: true, manage_people: true },
		moves: [{ id: "deliver", label: "Deliver", to: "delivered", payload: ["reply", "links"], requires: ["reply"] }] as unknown[],
		pending_offers: [], working: [], links: [],
	};
	const events: unknown[] = [];
	await page.route("**/api/modules/collab/**", async (route) => {
		const url = new URL(route.request().url());
		const method = route.request().method();
		const path = url.pathname.replace("/api/modules/collab", "");
		if (path === "/types") return route.fulfill({ json: { types: [TYPE] } });
		if (path === "/work-items/ask1" && method === "GET") return route.fulfill({ json: item });
		if (path === "/work-items/ask1" && method === "PATCH") {
			const body = route.request().postDataJSON();
			seen.patches.push(body);
			Object.assign(item.fields, body.fields);
			item.version++;
			return route.fulfill({ json: item });
		}
		if (path === "/work-items/ask1/transition") {
			const body = route.request().postDataJSON();
			seen.moves.push(body);
			item.state = "delivered";
			item.version++;
			item.moves = [];
			events.push({ id: "e1", item_id: "ask1", actor_user_id: "u1", kind: "item.state_changed", at: "2026-11-17T09:00:00Z", detail: { from_state: "accepted", to_state: "delivered", transition: "deliver", payload: body.payload } });
			return route.fulfill({ json: item });
		}
		if (path === "/work-items/ask1/events") return route.fulfill({ json: { events, next_cursor: "" } });
		if (path === "/work-items/ask1/comments") return route.fulfill({ json: { comments: [], next_cursor: "" } });
		if (path === "/people") return route.fulfill({ json: { people: [{ user_id: "u1", display_name: "Felix", org_unit_id: "" }, { user_id: "u2", display_name: "Mei", org_unit_id: "" }] } });
		return route.fallback();
	});
	return seen;
}

for (const width of [390, 1440]) test(`a typed item shows its state, fields and moves at ${width}px`, async ({ page }) => {
	await mock(page);
	const seen = await typedItem(page);
	await page.setViewportSize({ width, height: 900 });
	await page.goto("/t/demo/tasks/ask1");

	// The state replaces the status picker, and a participants item takes no list or collaborators.
	await expect(page.getByLabel("State")).toHaveText("Accepted");
	await expect(page.getByText("Presales", { exact: true })).toBeVisible();
	await expect(page.getByRole("combobox", { name: "Status" })).toHaveCount(0);
	await expect(page.getByRole("combobox", { name: "Shared list" })).toHaveCount(0);
	await expect(page.getByText("Add collaborator")).toHaveCount(0);

	// Fields in the type's order, an old version's value read-only, and a save of just what changed.
	await expect(page.getByRole("combobox", { name: "For whom" })).toHaveValue("1");
	await expect(page.getByText("kept from v0")).toBeVisible();
	await page.getByRole("textbox", { name: "When", exact: true }).fill("Friday");
	await page.getByRole("button", { name: "Save details" }).click();
	await expect(page.getByRole("button", { name: "Save details" })).toHaveCount(0);
	expect(seen.patches).toEqual([{ version: 3, fields: { when: "Friday" } }]);

	// A move that needs a result asks for it.
	await page.getByRole("group", { name: "Moves" }).getByRole("button", { name: "Deliver" }).click();
	const dialog = page.getByRole("dialog");
	const take = dialog.getByRole("button", { name: "Deliver" });
	await expect(take).toBeDisabled();
	await dialog.getByRole("textbox", { name: "Result", exact: true }).fill("Deck attached");
	await dialog.getByRole("button", { name: "Add a link" }).click();
	await dialog.getByRole("textbox", { name: "Link", exact: true }).fill("http://insecure.example");
	await expect(take).toBeDisabled();
	await dialog.getByRole("textbox", { name: "Link", exact: true }).fill("https://docs.example/deck");
	await dialog.getByRole("textbox", { name: "Link title" }).fill("Deck");
	if (width < 600) await page.screenshot({ path: `test-results/typed-move-${width}.png`, fullPage: true });
	await take.click();
	await expect(dialog).toHaveCount(0);
	expect(seen.moves).toEqual([{ transition: "deliver", note: "", payload: { reply: "Deck attached", links: [{ url: "https://docs.example/deck", title: "Deck" }] }, version: 4 }]);
	await expect(page.getByLabel("State")).toHaveText("Delivered");

	// The history says where it moved, and what it carried.
	await page.getByText("History", { exact: true }).click();
	await expect(page.getByText("Moved it · Accepted → Delivered")).toBeVisible();
	await expect(page.getByRole("link", { name: "Deck", exact: true })).toHaveAttribute("href", "https://docs.example/deck");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: `test-results/typed-item-${width}.png`, fullPage: true });
});
