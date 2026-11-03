import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZH } from "./zh.ts";

const SOURCE = join(import.meta.dirname, "..");

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") && name !== "zh.ts" ? [path] : [];
	});
}

/** The text between each `t(` and its closing bracket, which covers a ternary or a lookup table inside the call. */
function calls(code: string): string[] {
	const found: string[] = [];
	for (const match of code.matchAll(/(?<![\w.])t\(/g)) {
		let depth = 1;
		let at = match.index + match[0].length;
		let quote = "";
		const start = at;
		for (; at < code.length && depth > 0; at++) {
			const char = code[at];
			if (quote !== "") {
				if (char === "\\") at++;
				else if (char === quote) quote = "";
			} else if (char === '"' || char === "`") quote = char;
			else if (char === "(") depth++;
			else if (char === ")") depth--;
		}
		found.push(code.slice(start, at));
	}
	return found;
}

/** Skips the other side of a comparison, as in `mode === "share" ? ... : ...`. */
function literals(code: string): string[] {
	return [...code.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
		.filter((match) => !/[=!]== $/.test(code.slice(0, match.index)) && code[match.index + match[0].length] !== ":")
		.map((match) => (match[1] as string).replaceAll('\\"', '"').replaceAll("\\n", "\n"));
}

/** Tables read through a variable, which a scan of `t(` can't see. */
function tables(code: string): string[] {
	return [...code.matchAll(/^const (?:LABELS|VISIBILITY|EVENTS|STARTERS|TASK_STATUS|TABS|REASONS)\b[\s\S]*?[\]}];$/gm)].flatMap((match) => literals(match[0]));
}

const sources = files(SOURCE).map((path) => readFileSync(path, "utf8"));
const shown = new Set(sources.flatMap((code) => [...calls(code).flatMap(literals), ...tables(code)]).filter((text) => /[a-z]/i.test(text)));

describe("Chinese translation", () => {
	it("covers every string the app shows", () => {
		expect([...shown].filter((text) => ZH[text] === undefined).sort()).toEqual([]);
	});

	it("has no entry nothing uses", () => {
		const everything = sources.join("\n");
		expect(Object.keys(ZH).filter((key) => !shown.has(key) && !everything.includes(key)).sort()).toEqual([]);
	});

	it("keeps every placeholder", () => {
		const vars = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
		for (const [english, chinese] of Object.entries(ZH)) expect(vars(chinese), english).toEqual(vars(english));
	});

	it("uses Chinese punctuation in Chinese sentences", () => {
		const halfWidth = Object.entries(ZH).filter(([, chinese]) => /[一-鿿][,.!?:;]|[,!?;]$/.test(chinese.replaceAll("t10", "")));
		expect(halfWidth).toEqual([]);
	});

	it("holds the design's words", () => {
		expect(ZH).toMatchObject({ Task: "任务", Tasks: "任务", "Background work": "后台工作", "Hand over": "转交", Share: "共享", Assign: "指派", Owner: "负责人", Collaborator: "协作者", Claim: "认领" });
	});
});
