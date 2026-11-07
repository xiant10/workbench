import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ZH } from "../../lib/zh.ts";
import { SERVER_MESSAGES } from "./api.ts";

const paths = readdirSync(import.meta.dirname).filter((name) => name.endsWith(".tsx") || name === "api.ts");
const prose = (text: string) => /[a-z]/i.test(text.replaceAll("m²", ""));
const parsed = (file: string) => ts.createSourceFile(file, readFileSync(join(import.meta.dirname, file), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

describe("Property localization", () => {
	it("doesn't bypass translation in JSX text, labels or display expressions", () => {
		const missing: string[] = [];
		for (const file of paths) {
			const source = parsed(file);
			const display = (n: ts.Expression) => {
				if (ts.isStringLiteralLike(n) && prose(n.text)) missing.push(`${file}: ${n.text}`);
				else if (ts.isTemplateExpression(n) && prose([n.head.text, ...n.templateSpans.map((span) => span.literal.text)].join(""))) missing.push(`${file}: ${n.getText(source)}`);
				else if (ts.isConditionalExpression(n)) {
					display(n.whenTrue);
					display(n.whenFalse);
				} else if (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) display(n.right);
			};
			const visit = (n: ts.Node) => {
				if (ts.isJsxText(n) && prose(n.text)) missing.push(`${file}: ${n.text.trim()}`);
				if (ts.isJsxAttribute(n) && ["label", "placeholder", "aria-label", "title", "alt"].includes(n.name.getText(source)) && n.initializer !== undefined) {
					if (ts.isStringLiteral(n.initializer) && prose(n.initializer.text)) missing.push(`${file}: ${n.initializer.text}`);
					else if (ts.isJsxExpression(n.initializer) && n.initializer.expression !== undefined) display(n.initializer.expression);
				}
				if (ts.isJsxExpression(n) && n.expression !== undefined && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) display(n.expression);
				ts.forEachChild(n, visit);
			};
			visit(source);
		}
		expect(missing).toEqual([]);
	});

	/** These reach t() through a variable, which the app-wide scan of `t(` can't see. */
	it("has Chinese for every label table, failure message and service message", () => {
		const keys: string[] = [...SERVER_MESSAGES, "Duplicate account/charge/period (also row {row})"];
		for (const file of paths) {
			const source = parsed(file);
			const visit = (n: ts.Node) => {
				if (ts.isVariableDeclaration(n) && n.initializer !== undefined && ts.isObjectLiteralExpression(n.initializer) && n.type?.getText(source).startsWith("Record<")) {
					for (const property of n.initializer.properties) if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) keys.push(property.initializer.text);
				}
				if (ts.isCallExpression(n) && /^set(Error|PreviewError|UploadError)$/.test(n.expression.getText(source))) for (const argument of n.arguments) if (ts.isStringLiteral(argument) && argument.text !== "") keys.push(argument.text);
				if (ts.isFunctionDeclaration(n) && /^(errorText|errorMessage|message|followupTitle)$/.test(n.name?.text ?? "")) {
					const inner = (m: ts.Node) => {
						if (ts.isReturnStatement(m) && m.expression !== undefined && ts.isStringLiteral(m.expression)) keys.push(m.expression.text);
						ts.forEachChild(m, inner);
					};
					inner(n);
				}
				if (ts.isVariableDeclaration(n) && n.name.getText(source) === "eventLabel" && n.initializer !== undefined) {
					const inner = (m: ts.Node) => {
						if (ts.isConditionalExpression(m) && ts.isStringLiteral(m.whenTrue)) keys.push(m.whenTrue.text);
						ts.forEachChild(m, inner);
					};
					inner(n.initializer);
				}
				ts.forEachChild(n, visit);
			};
			visit(source);
		}
		expect([...new Set(keys)].filter((key) => prose(key) && ZH[key] === undefined).sort()).toEqual([]);
	});
});
