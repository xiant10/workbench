import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Hourglass, LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { listApprovals } from "../agents/api.ts";
import { ApprovalCard, approvalItem } from "../agents/ApprovalCard.tsx";
import { dismissSuggestion, type Item, withdrawOffer } from "./api.ts";
import { SendDialog } from "./SendDialog.tsx";
import { usePeople } from "./usePeople.ts";

/**
 * Where the work stands, above the task: a send the person's assistant suggested, a comment waiting for their answer,
 * offers nobody has answered, teammates working on it, and approvals waiting for this person. Nothing shows when
 * nothing is waiting.
 */
export function TaskStatus({ item, onReply }: { item: Item; onReply(): void }) {
	const { t, ago, describe } = useI18n();
	const { toast } = useFeedback();
	const { me } = useWorkspace();
	const { name, named } = usePeople();
	const client = useQueryClient();
	const [sending, setSending] = useState(false);
	// Only those who decide approvals get any, and a workbench without the agents module gets none.
	const approvals = useQuery({ queryKey: ["approvals"], queryFn: listApprovals, refetchInterval: 15_000, retry: false });
	const refresh = () => void client.invalidateQueries({ queryKey: ["item", item.id] });
	const dismiss = useMutation({ mutationFn: () => dismissSuggestion(item.id), onSuccess: refresh, onError: (error) => toast(describe(error)) });
	const withdraw = useMutation({
		mutationFn: withdrawOffer,
		onSuccess: () => {
			refresh();
			void client.invalidateQueries({ queryKey: ["offers"] });
		},
		onError: (error) => toast(describe(error)),
	});
	const pending = item.pending_offers ?? [];
	const working = item.working ?? [];
	const busy = (user: string) => working.some((entry) => entry.user_id === user);
	const workingOwners = working.filter((entry) => !pending.some((offer) => offer.to_user_id === entry.user_id));
	const held = (approvals.data ?? []).filter((approval) => approvalItem(approval) === item.id);
	const suggestion = item.suggestion;
	if (suggestion === undefined && item.mention === undefined && pending.length === 0 && working.length === 0 && held.length === 0) return null;
	return (
		<>
		<ul className="rows task-status" aria-label={t("Where this task stands")}>
			{suggestion !== undefined && (
				<li className="row">
					<span className="row-icon accent">
						<Sparkles size={16} aria-hidden="true" />
					</span>
					<div className="row-main">
						<strong>{t("Your assistant suggests sending this to {name}", { name: name(suggestion.to) })}</strong>
						{suggestion.note !== "" && <span className="plain quiet">{suggestion.note}</span>}
					</div>
					<div className="row-actions">
						<button type="button" className="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
							{t("Dismiss")}
						</button>
						<button type="button" className="primary" onClick={() => setSending(true)}>
							{t("Review and send")}
						</button>
					</div>
				</li>
			)}
			{item.mention !== undefined && (
				<li className="row">
					<span className="row-icon accent">
						<AtSign size={16} aria-hidden="true" />
					</span>
					<div className="row-main">
						<strong>{t("{name} mentioned you", { name: name(item.mention.from) })}</strong>
						<span className="plain quiet">{named(item.mention.body)}</span>
					</div>
					<div className="row-actions">
						<button type="button" className="primary" onClick={onReply}>
							{t("Reply")}
						</button>
					</div>
				</li>
			)}
			{pending.map((offer) => (
				<li key={offer.id} className="row">
					<span className="row-icon">
						<Hourglass size={16} aria-hidden="true" />
					</span>
					<div className="row-main">
						<span>{t(offer.mode === "share" ? "Waiting for {name} to accept sharing it" : "Waiting for {name} to accept it", { name: name(offer.to_user_id) })}</span>
						<span className="quiet">
							{busy(offer.to_user_id) ? t("{name} is looking at it now", { name: name(offer.to_user_id) }) : t("Sent by {name} {when}", { name: name(offer.from_user_id), when: ago(Date.parse(offer.created_at)) })}
						</span>
					</div>
					{(offer.from_user_id === me.user_id || item.can?.send === true) && (
						<div className="row-actions">
							<button type="button" className="ghost" disabled={withdraw.isPending} onClick={() => withdraw.mutate(offer.id)}>
								{t("Withdraw")}
							</button>
						</div>
					)}
				</li>
			))}
			{workingOwners.map((entry) => (
				<li key={entry.user_id} className="row">
					<span className="row-icon accent">
						<LoaderCircle size={16} className="spin" aria-hidden="true" />
					</span>
					<div className="row-main">
						<span>{t("{name} is working on this", { name: name(entry.user_id) })}</span>
						<span className="quiet">{t("Since {when}", { when: ago(Date.parse(entry.since)) })}</span>
					</div>
				</li>
			))}
			{held.map((approval) => (
				<ApprovalCard key={approval.id} approval={approval} onTask />
			))}
		</ul>
		{sending && suggestion !== undefined && <SendDialog item={item} suggested={{ to: { id: suggestion.to, name: name(suggestion.to) }, note: suggestion.note }} onClose={() => setSending(false)} />}
		</>
	);
}
