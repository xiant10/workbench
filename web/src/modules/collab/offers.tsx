import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Hourglass, Inbox } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { acceptOffer, declineOffer, type Offer, withdrawOffer } from "./api.ts";
import { usePeople } from "./usePeople.ts";

export function daysSince(iso: string): number {
	return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** An offer to answer. An assignment isn't an offer: it has no decline, by design. */
export function OfferRow({ offer }: { offer: Offer }) {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const { name } = usePeople();
	const client = useQueryClient();
	const [declining, setDeclining] = useState(false);
	const [reason, setReason] = useState("");
	const refresh = () => void client.invalidateQueries();
	const accept = useMutation({ mutationFn: () => acceptOffer(offer.id), onSuccess: refresh });
	const decline = useMutation({ mutationFn: () => declineOffer(offer.id, reason), onSuccess: refresh });
	const from = name(offer.from_user_id);
	return (
		<li className="row">
			<span className="row-icon accent">
				<Inbox size={16} aria-hidden="true" />
			</span>
			<div className="row-main">
				<span>{t(offer.mode === "share" ? "{name} wants to share {title}" : "{name} wants to hand over {title}", { name: from, title: offer.item_title })}</span>
				{offer.note !== "" && <span className="plain quiet">{offer.note}</span>}
				{offer.mode === "share" && <span className="quiet">{t("You stay an owner too.")}</span>}
			</div>
			{declining ? (
				<div className="row-actions">
					<span className="quiet">{t("Declining ends your access to this task.")}</span>
					<input value={reason} placeholder={t("Note")} aria-label={t("Note")} maxLength={2000} onChange={(event) => setReason(event.target.value)} />
					<button type="button" className="danger" onClick={() => decline.mutate()}>
						{t("Decline")}
					</button>
					<button type="button" className="ghost" onClick={() => setDeclining(false)}>
						{t("Cancel")}
					</button>
				</div>
			) : (
				<div className="row-actions">
					<button type="button" className="primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
						{t("Accept")}
					</button>
					<button type="button" className="ghost" onClick={() => setDeclining(true)}>
						{t("Decline")}
					</button>
					<Link className="button ghost" to={path(`tasks/${offer.item_id}`)}>
						{t("Ask a question")}
					</Link>
				</div>
			)}
		</li>
	);
}

/** Shows how long it has waited, with no read receipts. */
export function WaitingRow({ offer }: { offer: Offer }) {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const { name } = usePeople();
	const client = useQueryClient();
	const withdraw = useMutation({ mutationFn: () => withdrawOffer(offer.id), onSuccess: () => void client.invalidateQueries() });
	const days = daysSince(offer.created_at);
	return (
		<li className="row">
			<span className="row-icon">
				<Hourglass size={16} aria-hidden="true" />
			</span>
			<div className="row-main">
				<Link to={path(`tasks/${offer.item_id}`)}>{t("{name} has not answered {title}", { name: name(offer.to_user_id), title: offer.item_title })}</Link>
			</div>
			<div className="row-actions">
				<span className="quiet">{days === 0 ? t("today") : t("{n} days", { n: days })}</span>
				<button type="button" className="ghost" onClick={() => withdraw.mutate()}>
					{t("Withdraw")}
				</button>
			</div>
		</li>
	);
}
