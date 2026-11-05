import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { startConversation, titleOf } from "../../lib/agent.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog } from "../../lib/ui.tsx";
import { useRefreshSessions, useWorkspace } from "../../shell/workspace.ts";
import type * as api from "./api.ts";

export type AskScope = { kind: "set"; set: api.Collection } | { kind: "document"; doc: api.Doc; sets: api.Collection[] };

/**
 * The scope goes in as a module record: names are written by tenant admins, so
 * the agent reads them as data, and the instruction outside it is the person's.
 */
export function scopePrompt(scope: AskScope, question: string): string {
	const escape = (text: string) => text.replaceAll("</module_record", "<\\/module_record");
	const sets = scope.kind === "set" ? [scope.set] : scope.sets;
	const lines = sets.map((s) => `Document set ${s.id}: ${escape(s.title)}`);
	if (scope.kind === "document") {
		lines.unshift(`Document ${scope.doc.id}: ${escape(scope.doc.title)}`);
		lines.push(`Knowledge base ${scope.doc.base_id}`);
	}
	const ref = scope.kind === "set" ? `knowledge:set:${scope.set.id}` : `knowledge:document:${scope.doc.id}`;
	const rule =
		scope.kind === "set"
			? "Answer from company knowledge, searching only this document set. Cite the documents you use."
			: "Answer from this document only, searching it within the document sets or knowledge base listed. Cite it.";
	return `<module_record ref="${ref}">\n${lines.join("\n")}\n</module_record>\n${rule}\n\n${question}`;
}

export function AskAgent({ scope, close }: { scope: AskScope; close(): void }) {
	const { t } = useI18n();
	const { agent, profile, path } = useWorkspace();
	const navigate = useNavigate();
	const refresh = useRefreshSessions();
	const [question, setQuestion] = useState("");
	const name = scope.kind === "set" ? scope.set.title : scope.doc.title;
	const ask = useMutation({
		mutationFn: () =>
			startConversation(agent, profile, scopePrompt(scope, question.trim()), titleOf(question.trim()), {
				ref: scope.kind === "set" ? `knowledge:set:${scope.set.id}` : `knowledge:document:${scope.doc.id}`,
			}),
		onSuccess: (sessionId) => {
			refresh();
			navigate(path(`c/${sessionId}`));
		},
	});
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (question.trim()) ask.mutate();
	};
	return (
		<Dialog label={t("Ask an agent")} onClose={ask.isPending ? undefined : close}>
			<form className="kn-form" onSubmit={submit}>
				<h2>{t("Ask an agent about {name}", { name })}</h2>
				<p className="dialog-body">
					{t(scope.kind === "set" ? "The agent searches only this document set and cites what it uses." : "The agent answers from this document and cites it.")}
				</p>
				<label>
					{t("Question")}
					<textarea rows={4} value={question} autoFocus maxLength={4000} onChange={(e) => setQuestion(e.target.value)} placeholder={t("e.g. How many days of annual leave do new employees get?")} />
				</label>
				{ask.isError && (
					<p className="inline-error" role="alert">
						{t("The conversation couldn't start. Try again.")}
					</p>
				)}
				<div className="dialog-actions">
					<button type="button" className="ghost" disabled={ask.isPending} onClick={close}>
						{t("Cancel")}
					</button>
					<button className="primary" disabled={ask.isPending || !question.trim()}>
						{t(ask.isPending ? "Starting…" : "Ask")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
