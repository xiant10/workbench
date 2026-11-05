import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ZH } from "../../lib/zh.ts";
import { ApiError } from "../../lib/api.ts";
import { message } from "./api.ts";
import { activityLabel, ingestionErrorLabel, processingLabel } from "./labels.ts";

const paths = ["Knowledge.tsx", "DocumentSets.tsx", "Document.tsx", "Upload.tsx", "shared.tsx", "AskAgent.tsx", "AgentAccess.tsx"];
const prose = (text: string) => /[a-z]/i.test(text) && !/^(?:v|· v)$/.test(text.trim());

describe("Knowledge localization", () => {
	it("does not bypass translation in JSX text, labels, or display expressions", () => {
		const missing: string[] = [];
		for (const file of paths) {
			const source = ts.createSourceFile(file, readFileSync(join(import.meta.dirname, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
			function display(n: ts.Expression) {
				if (ts.isStringLiteral(n) && prose(n.text)) missing.push(`${file}: ${n.text}`);
				else if (ts.isTemplateExpression(n) && prose([n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join("")))
					missing.push(`${file}: ${n.getText(source)}`);
				else if (ts.isConditionalExpression(n)) {
					display(n.whenTrue);
					display(n.whenFalse);
				} else if (
					ts.isBinaryExpression(n) &&
					[ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)
				) {
					display(n.right);
				}
			}
			function visit(n: ts.Node) {
				if (ts.isJsxText(n) && prose(n.text)) missing.push(`${file}: ${n.text.trim()}`);
				if (
					ts.isJsxAttribute(n) &&
					["placeholder", "aria-label", "title"].includes(n.name.getText(source)) &&
					n.initializer &&
					ts.isStringLiteral(n.initializer) &&
					prose(n.initializer.text)
				)
					missing.push(`${file}: ${n.initializer.text}`);
				if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) display(n.expression);
				ts.forEachChild(n, visit);
			}
			visit(source);
		}
		expect(missing).toEqual([]);
	});
	it("translates API failures, processing states, parser errors and activity", () => {
		const keys = [
			...[400, 403, 404, 409, 413, 415, 500].map((status) => message(new ApiError(status, "test", "test"))),
			message(new Error("offline")),
			...["queued", "processing", "ready", "failed", "discarded", "cancelled", "unknown"].map(processingLabel),
			...[
				"invalid_file",
				"parser_unavailable",
				"pdf_extraction_failed",
				"page_limit_exceeded",
				"invalid_docx",
				"docx_expansion_limit",
				"macros_not_supported",
				"extracted_text_too_large",
				"cancelled",
				"empty_document",
				"invalid_encoding",
				"ocr_required",
				"unknown",
			].map(ingestionErrorLabel),
			...[
				"base_created",
				"uploaded",
				"publish",
				"ready",
				"failed",
				"unpublish",
				"rename",
				"retry",
				"discard",
				"delete",
				"restore",
				"rollback",
				"collection_saved",
				"collection_deleted",
				"agent_access_saved",
				"agent_access_cleared",
				"unknown",
			].map((code) => activityLabel(`knowledge.${code}`)),
		];
		expect(keys.filter((key) => !ZH[key])).toEqual([]);
	});
	it("uses the app's locale for dates and confirmations", () => {
		const sources = paths.map((file) => readFileSync(join(import.meta.dirname, file), "utf8")).join("\n");
		expect(sources).not.toMatch(/\.toLocaleString\(|window\.confirm\(/);
	});
});
