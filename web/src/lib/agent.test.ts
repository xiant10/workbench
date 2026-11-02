import { afterEach, describe, expect, it, vi } from "vitest";
import { listAgents, supports } from "./agent.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Answers each agent's `agents.list` from a table. An agent not in it fails, as an older harness does. */
function answering(lists: Record<string, object>) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) => {
			const agent = decodeURIComponent(path.split("/")[3] ?? "");
			const list = lists[agent];
			if (list === undefined) return new Response(JSON.stringify({ error: { code: -32601, message: "unknown method" } }), { status: 404 });
			return new Response(JSON.stringify({ result: list }), { status: 200 });
		}),
	);
}

describe("supports", () => {
	it("counts unknown as yes, so a page keeps its controls while loading and on older harnesses", () => {
		expect(supports(undefined, "voice")).toBe(true);
		expect(supports({}, "voice")).toBe(true);
	});

	it("follows what a session declares", () => {
		expect(supports({ capabilities: ["steer"] }, "steer")).toBe(true);
		expect(supports({ capabilities: ["steer"] }, "voice")).toBe(false);
	});
});

describe("listAgents", () => {
	it("takes a gateway's list and default", async () => {
		answering({ assistant: { agents: [{ name: "assistant" }, { name: "sales", title: "Sales" }], defaultAgent: "sales" } });
		expect(await listAgents(["assistant"])).toEqual({ agents: [{ name: "assistant" }, { name: "sales", title: "Sales" }], defaultAgent: "sales" });
	});

	it("merges harnesses that each answer for themselves", async () => {
		answering({ assistant: { agents: [{ name: "assistant" }] }, sales: { agents: [{ name: "sales" }] } });
		expect((await listAgents(["assistant", "sales"])).agents.map((agent) => agent.name)).toEqual(["assistant", "sales"]);
	});

	it("keeps a configured agent that can't answer yet", async () => {
		answering({});
		expect(await listAgents(["assistant"])).toEqual({ agents: [{ name: "assistant" }] });
	});

	it("treats an empty default as none, for a tenant with nothing allowed", async () => {
		answering({ assistant: { agents: [], defaultAgent: "" } });
		expect(await listAgents(["assistant"])).toEqual({ agents: [] });
	});
});
