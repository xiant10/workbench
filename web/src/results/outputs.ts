/** A part of a reply worth opening on its own. Until a file service exists, outputs are parts of messages, not files. */
export type Output = { key: string; kind: "code" | "table" | "document"; title: string; language?: string; body: string; lineKey: string };

const MIN_CODE_LINES = 12;
const MIN_TABLE_ROWS = 5;
const MIN_DOCUMENT_CHARS = 1500;

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;
const TABLE = /(?:^\|.*\|[ \t]*$\n?){3,}/gm;

/** The first heading or line, without Markdown. */
function firstLine(text: string): string {
	const line = text.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
	return line.replace(/^#+\s*/, "").replace(/[*_`|]/g, "").trim().slice(0, 80);
}

/** Long code blocks, tables and documents in one reply. A reply that's a document stays whole. */
export function outputsOf(lineKey: string, text: string): Output[] {
	if (text.length >= MIN_DOCUMENT_CHARS) return [{ key: `${lineKey}:doc`, kind: "document", title: firstLine(text), body: text, lineKey }];
	const outputs: Output[] = [];
	for (const match of text.matchAll(FENCE)) {
		const body = match[2] ?? "";
		if (body.split("\n").length < MIN_CODE_LINES) continue;
		const language = (match[1] ?? "").trim();
		outputs.push({ key: `${lineKey}:c${match.index}`, kind: "code", title: language === "" ? "Code" : language, ...(language === "" ? {} : { language }), body, lineKey });
	}
	const prose = text.replace(FENCE, "");
	for (const match of prose.matchAll(TABLE)) {
		if (match[0].trim().split("\n").length < MIN_TABLE_ROWS) continue;
		outputs.push({ key: `${lineKey}:t${match.index}`, kind: "table", title: firstLine(match[0]), body: match[0].trim(), lineKey });
	}
	return outputs;
}

export function outputFilename(output: Output): string {
	const base = output.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "output";
	const extension = output.kind === "code" ? (output.language ?? "txt") : "md";
	return `${base}.${extension}`;
}
