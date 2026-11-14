import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { getItem, type Item } from "../collab/api.ts";
import { usePeople } from "../collab/usePeople.ts";
import { type Approval, decideApproval } from "./api.ts";

/** Fields a task edit can change, in the order a person reads them, with their labels. */
const FIELDS = [
	["title", "Title"],
	["description", "Description"],
	["status", "Status"],
	["priority", "Priority"],
	["due_at", "Due"],
] as const;

const VALUES: Record<string, string> = { todo: "To do", doing: "In progress", done: "Done", cancelled: "Cancelled", low: "Low", normal: "Normal", high: "High" };

/** The task an approval is about: collab's tools name it as `id`. */
export function approvalItem(approval: Approval): string | undefined {
	const id = approval.summary.id;
	return approval.server === "collab" && typeof id === "string" && id.startsWith("wi_") ? id : undefined;
}

/**
 * One held tool call, said in words: who wants to do what to which task, and what would change. Approving lets that
 * exact call run once. `onTask` leaves out the task's name and link, for a card shown on the task itself.
 */
export function ApprovalCard({ approval, onTask = false }: { approval: Approval; onTask?: boolean }) {
	const { t, ago, describe } = useI18n();
	const { toast } = useFeedback();
	const { me, path } = useWorkspace();
	const { name } = usePeople();
	const client = useQueryClient();
	const itemId = approvalItem(approval);
	const item = useQuery({ queryKey: ["item", itemId], queryFn: () => getItem(itemId as string), enabled: itemId !== undefined, retry: false });
	const decide = useMutation({
		mutationFn: (grant: boolean) => decideApproval(approval.id, grant),
		onSuccess: (_, grant) => {
			toast(grant ? t("Approved. The run is told to make the call again, and it can, once.") : t("Refused. The run is told not to make the call."));
			void client.invalidateQueries({ queryKey: ["approvals"] });
		},
		onError: (error) => toast(describe(error)),
	});
	const who = approval.principal === me.user_id ? t("Your assistant") : name(approval.principal);
	const title = item.data?.title ?? t("a task");
	const values = approval.summary;
	const text = (value: unknown) => (typeof value === "string" ? t(VALUES[value] ?? value) : String(value ?? ""));
	const asked = (() => {
		switch (itemId === undefined ? "" : approval.tool) {
			case "work_update": return t("{who} wants to change {title}", { who, title });
			case "work_comment": return t("{who} wants to comment on {title}", { who, title });
			case "work_send": return t("{who} wants to send {title} to {name}", { who, title, name: name(String(values.to ?? "")) });
			case "work_suggest": return t("{who} wants to suggest sending {title} to {name}", { who, title, name: name(String(values.to ?? "")) });
			default: return t("{who} wants to use {tool}", { who, tool: `${approval.server}/${approval.tool}` });
		}
	})();
	const changes = approval.tool === "work_update" ? FIELDS.filter(([field]) => field in values) : [];
	const before = (field: (typeof FIELDS)[number][0]) => (item.data === undefined ? undefined : (item.data[field as keyof Item] as unknown));
	// The words above say which task, and to whom. What a comment or a note says is shown as text.
	const quoted = itemId === undefined ? undefined : approval.tool === "work_comment" ? values.body : approval.tool === "work_send" || approval.tool === "work_suggest" ? values.note : undefined;
	const said = new Set(itemId === undefined ? [] : ["id", "version", "to", "body", "note", ...changes.map(([field]) => field)]);
	const others = Object.entries(values).filter(([key]) => !said.has(key));
	return (
		<li className="row approval">
			<span className="row-icon warn">
				<ShieldCheck size={16} aria-hidden="true" />
			</span>
			<div className="row-main">
				<strong>{asked}</strong>
				{changes.length > 0 && (
					<dl className="approval-changes">
						{changes.map(([field, label]) => (
							<div key={field}>
								<dt>{t(label)}</dt>
								<dd>
									{before(field) !== undefined && before(field) !== null && before(field) !== "" && <span className="plain was">{text(before(field))}</span>}
									<span className="plain">{values[field] === "" ? t("(empty)") : text(values[field])}</span>
								</dd>
							</div>
						))}
					</dl>
				)}
				{typeof quoted === "string" && quoted !== "" && <span className="plain approval-quote">{quoted}</span>}
				{others.length > 0 && (
					<span>
						{others.map(([key, value]) => (
							<span key={key} className="pill">
								{key}: {String(value)}
							</span>
						))}
					</span>
				)}
				<span className="quiet">
					{!onTask && itemId !== undefined && item.data !== undefined && (
						<>
							<Link to={path(`tasks/${itemId}`)}>{t("Open task")}</Link> ·{" "}
						</>
					)}
					{approval.agent}
					{approval.automation !== undefined && approval.automation !== "" && <> · {approval.automation}</>} · {t("rule {rule}", { rule: approval.rule })} · {ago(Date.parse(approval.created_at))}
				</span>
			</div>
			<div className="row-actions">
				<button type="button" className="ghost" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
					{t("Refuse")}
				</button>
				<button type="button" className="primary" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
					{t("Approve")}
				</button>
			</div>
		</li>
	);
}
