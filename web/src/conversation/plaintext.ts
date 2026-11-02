/** Tasks render no Markdown, so a reply becomes readable plain text before it's sent to a teammate. */
export function toPlainText(markdown: string): string {
	return markdown
		.replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
		.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
		.replace(/^[ \t]*\|?[ \t:|-]*-{2,}[ \t:|-]*\|?[ \t]*(\n|$)/gm, "")
		.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) => row.split("|").map((cell) => cell.trim()).join("  "))
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, "$1$2")
		.replace(/`([^`\n]+)`/g, "$1")
		.replace(/^[ \t]*[-*+][ \t]+/gm, "• ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** A person's own edit decides the rest. */
export function suggestTitle(text: string): string {
	const line = toPlainText(text).split("\n").find((candidate) => candidate.trim() !== "") ?? "";
	return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
