import type { Page } from "@playwright/test";

export async function mock(page: Page) {
	const state = { configFails: false, meFails: false, createFails: true, createCount: 0, payloadFails: false, payloadCalls: 0, collaborationFails: false };
	await page.route("**/api/**", async route => {
		const url = new URL(route.request().url());
		const fail = () => route.fulfill({ status: 503, json: { error: "unavailable" } });
		let result: unknown = {};
		if (url.pathname === "/api/me") {
			if (state.meFails) return fail();
			result = { user_id: "u1", display_name: "Felix", active_tenant: "demo", tenants: [{ id: "demo", name: "Demo", role: "member" }] };
		} else if (url.pathname === "/api/config") {
			if (state.configFails) return fail();
			result = { agents: ["assistant"], profiles: ["chat"], modules: [{ id: "collab", api_version: 1 }], unavailable_modules: [], voice: false, account_url: "/account" };
		} else if (url.pathname.includes("/agents/")) {
			if (route.request().method() === "GET") return route.fulfill({ contentType: "text/event-stream", body: 'data: {"params":{"type":"snapshot","busy":false,"inbox":[],"tasks":[]}}\n\n' });
			const body = route.request().postDataJSON();
			let value: unknown = {};
			switch (body.method) {
				case "agents.list": value = { agents: [{ name: "assistant", title: "Assistant" }, { name: "research", title: "Research" }] }; break;
				case "session.list": value = { sessions: [] }; break;
				case "skills.list": value = { skills: [] }; break;
				case "session.create":
					state.createCount++;
					await new Promise(resolve => setTimeout(resolve, 150));
					if (state.createFails) return fail();
					value = { sessionId: "c1" }; break;
				case "session.get": value = { usage: {}, tasks: [], parked: 0 }; break;
				case "session.messages": value = { messages: [{ id: 1, role: "tool", callId: "call1", name: "crm_lookup", isError: false }, { id: 2, role: "assistant", text: "# Brief\n\n" + "Customer details. ".repeat(110), stopReason: "stop" }] }; break;
				case "session.tool":
					state.payloadCalls++;
					if (state.payloadFails) return fail();
					value = { request: { name: "crm_lookup", arguments: { customer: "Acme" } }, response: { content: [{ type: "text", text: "<script>unsafe()</script>" }], isError: false } }; break;
			}
			result = { jsonrpc: "2.0", id: body.id, result: value };
		} else if (url.pathname.endsWith("/notifications")) result = { notifications: [], cursor: "" };
		else if (url.pathname.endsWith("/offers")) {
			if (state.collaborationFails) return fail();
			result = { offers: [] };
		} else if (url.pathname.endsWith("/work-items")) result = { items: [
			{ id: "task1", title: "Review proposal", status: "todo", priority: "normal", due_at: "2020-01-01T00:00:00Z", owners: ["u1"], collaborators: [] },
			{ id: "task2", title: "Completed proposal", status: "done", priority: "normal", due_at: null, owners: ["u1"], collaborators: [] },
		] };
		else if (url.pathname.endsWith("/people")) result = { people: [] };
		else if (url.pathname.endsWith("/units")) result = { units: [] };
		else if (url.pathname.endsWith("/settings")) result = { manager_visibility: "none" };
		await route.fulfill({ json: result });
	});
	return state;
}
