import { describe, expect, it } from "vitest";
import { suggestTitle, toPlainText } from "../conversation/plaintext.ts";
import { outputFilename, outputsOf } from "./outputs.ts";

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
