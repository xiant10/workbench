import { describe, expect, it } from "vitest";
import { suggestTitle, toPlainText } from "../conversation/plaintext.ts";
import { outputFilename, outputsOf } from "./outputs.ts";
import { computeFlowLayers, createWorkflowFromTemplate, deleteFlowNode, insertNodeAfter, validateFlowGraph } from "./WorkflowView.tsx";

describe("outputsOf", () => {
	it("leaves a short reply in the transcript", () => {
		expect(outputsOf("l", "Hello\n\n```js\nx\n```")).toEqual([]);
	});

	it("opens a long code block", () => {
		const code = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
		const [output] = outputsOf("l", `Here:\n\n\`\`\`go\n${code}\n\`\`\``);
		expect(output).toMatchObject({ kind: "code", language: "go" });
		expect(outputFilename(output!)).toBe("go.go");
	});

	it("opens a table, and not one inside a code block", () => {
		const table = ["| a | b |", "| - | - |", "| 1 | 2 |", "| 3 | 4 |", "| 5 | 6 |"].join("\n");
		expect(outputsOf("l", table).map((o) => o.kind)).toEqual(["table"]);
		expect(outputsOf("l", `\`\`\`\n${table}\n\`\`\``)).toEqual([]);
	});

	it("keeps a long reply whole", () => {
		const outputs = outputsOf("l", `# Customer brief\n\n${"word ".repeat(400)}`);
		expect(outputs).toMatchObject([{ kind: "document", title: "Customer brief" }]);
		expect(outputFilename(outputs[0]!)).toBe("customer-brief.md");
	});
});

describe("toPlainText", () => {
	it("strips Markdown and keeps the words", () => {
		const text = "# Brief\n\n**Bold** and *soft* and `code`.\n\n- one\n- two\n\n[site](https://a.example)";
		expect(toPlainText(text)).toBe("Brief\n\nBold and soft and code.\n\n• one\n• two\n\nsite (https://a.example)");
	});

	it("keeps a table readable", () => {
		expect(toPlainText("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe("a  b\n1  2");
	});

	it("keeps code", () => {
		expect(toPlainText("```js\nconst x = 1;\n```")).toBe("const x = 1;");
	});

	it("suggests a title from the first line", () => {
		expect(suggestTitle("\n## The plan\nmore")).toBe("The plan");
	});
});

describe("computeFlowLayers", () => {
	it("places branching switch targets in the same horizontal layer and join nodes after all branches", () => {
		const layers = computeFlowLayers({
			id: "visit",
			title: "Visit",
			mode: "deterministic",
			nodes: [
				{ id: "start", kind: "start", label: "Start" },
				{ id: "switch", kind: "switch", label: "Switch" },
				{ id: "ask", kind: "ask_user", label: "Ask" },
				{ id: "crm", kind: "parallel", label: "CRM" },
				{ id: "join", kind: "llm_reply", label: "Reply" },
			],
			edges: [
				{ id: "e1", source: "start", target: "switch" },
				{ id: "e2", source: "switch", target: "ask" },
				{ id: "e3", source: "switch", target: "crm" },
				{ id: "e4", source: "crm", target: "join" },
			],
		});
		expect(layers.map((layer) => layer.map((n) => n.id))).toEqual([
			["start"],
			["switch"],
			["ask", "crm"],
			["join"],
		]);
	});

	it("splices inserted nodes inline, heals edges on deletion, and validates DAG cycles", () => {
		const base = {
			id: "sales-reports",
			title: "Reports",
			mode: "deterministic" as const,
			nodes: [
				{ id: "start", kind: "start" as const, label: "Start" },
				{ id: "reply", kind: "llm_reply" as const, label: "Reply" },
			],
			edges: [{ id: "e1", source: "start", target: "reply" }],
		};
		const withTool = insertNodeAfter(base, "start", {
			id: "fetch_daily",
			kind: "tool",
			label: "Fetch Daily",
			tools: ["get_daily_sales_brief"],
		});
		expect(withTool.nodes.map((n) => n.id)).toEqual(["start", "fetch_daily", "reply"]);
		expect(withTool.edges.map((e) => `${e.source}->${e.target}`)).toEqual(["start->fetch_daily", "fetch_daily->reply"]);
		expect(validateFlowGraph(withTool).valid).toBe(true);

		const healed = deleteFlowNode(withTool, "fetch_daily");
		expect(healed.nodes.map((n) => n.id)).toEqual(["start", "reply"]);
		expect(healed.edges.map((e) => `${e.source}->${e.target}`)).toEqual(["start->reply"]);

		const cyclic = {
			...withTool,
			edges: [...withTool.edges, { id: "e_cycle", source: "reply", target: "start" }],
		};
		const check = validateFlowGraph(cyclic);
		expect(check.valid).toBe(false);
		expect(check.errors.some((err) => err.includes("Cycle detected"))).toBe(true);
	});

	it("generates valid acyclic DAGs for all starter workflow templates", () => {
		for (const template of ["parallel", "branching", "minimal"] as const) {
			const flow = createWorkflowFromTemplate({
				id: `new_${template}`,
				title: `Template ${template}`,
				mode: "deterministic",
				triggerKeywords: ["test"],
				template,
				defaultTool: "crm_search_companies",
			});
			expect(validateFlowGraph(flow).valid).toBe(true);
		}
	});
});
