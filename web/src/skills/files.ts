// Reading picked files and folders into a skill, with the limits t10-agent-control checks.

/** A custom skill's text: what picked files can fill in. */
export type SkillText = {
	description: string;
	body: string;
	files: Record<string, string>;
};

// The same limits t10-agent-control checks, so a mistake shows before publishing.
const MAX_FILES = 50;
const MAX_FILE_BYTES = 256 << 10;
const FILE_TYPES = [".md", ".txt", ".json", ".csv"];
const FILE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
/** Packaging junk a zip or a Mac folder carries, skipped rather than refused. */
const JUNK = /(^|\/)(__MACOSX|\.DS_Store)(\/|$)/;

/** Split a SKILL.md into its description and its instructions, reading the frontmatter's `description:` only. */
export function readSkillMd(text: string): { description?: string; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (match === null) return { body: text.trim() };
	const line = /^description:\s*(.+)$/m.exec(match[1]!);
	const description = line?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
	return { ...(description ? { description } : {}), body: text.slice(match[0].length).trim() };
}

/**
 * Read picked files into a skill: a folder's SKILL.md becomes its instructions and description, other files its
 * reference files. Returns the new value and what was refused, with the same limits t10-agent-control checks.
 */
export async function addFiles(list: FileList | readonly File[], folder: boolean, value: SkillText, isZh: boolean): Promise<{ next: SkillText; problems: string[] }> {
	const files = { ...value.files };
	let next = value;
	const problems: string[] = [];
	for (const file of [...list]) {
		// A folder's files are named from inside it, so one enclosing folder is dropped.
		const relative = folder ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
		if (JUNK.test(relative)) continue;
		if (relative.toLowerCase() === "skill.md") {
			const skill = readSkillMd(await file.text());
			next = { ...next, body: skill.body, ...(skill.description ? { description: skill.description } : {}) };
			continue;
		}
		const ext = relative.slice(relative.lastIndexOf(".")).toLowerCase();
		if (!FILE_PATH.test(relative)) problems.push(isZh ? `${relative}：路径不可用` : `${relative}: not a usable path`);
		else if (!FILE_TYPES.includes(ext)) problems.push(isZh ? `${relative}：仅支持 .md .txt .json .csv` : `${relative}: only .md, .txt, .json and .csv`);
		else if (file.size > MAX_FILE_BYTES) problems.push(isZh ? `${relative}：超过 256 KiB` : `${relative}: over 256 KiB`);
		else files[relative] = await file.text();
	}
	if (Object.keys(files).length > MAX_FILES) problems.push(isZh ? `最多 ${MAX_FILES} 个参考文件` : `At most ${MAX_FILES} reference files`);
	else next = { ...next, files };
	return { next, problems };
}

/** Whether a reference file path is one control accepts. */
export function usableFilePath(path: string): boolean {
	return FILE_PATH.test(path) && FILE_TYPES.includes(path.slice(path.lastIndexOf(".")).toLowerCase()) && path.toLowerCase() !== "skill.md";
}

export const FILE_ACCEPT = FILE_TYPES.join(",");
