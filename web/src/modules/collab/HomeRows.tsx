import { useQuery } from "@tanstack/react-query";
import { Clock, Sparkles, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { usePaged } from "../../lib/paged.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { dueDay, type Item, itemsPage, listOffers, today } from "./api.ts";
import { OfferRow, WaitingRow } from "./offers.tsx";
import { SendDialog } from "./SendDialog.tsx";
import { usePeople } from "./usePeople.ts";

export function HomeRows() {
	const { t, day } = useI18n();
	const { path, me } = useWorkspace();
	const { name } = usePeople();
	const inbox = useQuery({ queryKey: ["offers", "inbox"], queryFn: () => listOffers("inbox") });
	const sent = useQuery({ queryKey: ["offers", "sent"], queryFn: () => listOffers("sent") });
	const owned = usePaged(["items", "owned"], (cursor) => itemsPage("view=owned", cursor));
	const pending = (Array.isArray(inbox.data) ? inbox.data : []).filter((offer) => offer.state === "pending");
	const assigned = (Array.isArray(inbox.data) ? inbox.data : []).filter((offer) => offer.state === "assigned" && offer.to_user_id === me.user_id);
	const declined = (Array.isArray(sent.data) ? sent.data : []).filter((offer) => offer.state === "declined");
	const suggested = (Array.isArray(owned.data) ? owned.data : []).filter((item) => item.suggestion !== undefined);
	const due = (Array.isArray(owned.data) ? owned.data : []).filter((item) => item.due_at !== null && dueDay(item.due_at) <= today() && (item.status === "todo" || item.status === "doing"));
	return (
		<>
			{[inbox, sent, owned].some((query) => query.isPending) && <li className="row" role="status">{t("Loading…")}</li>}
			{[inbox, sent, owned].some((query) => query.isError) && <li className="row" role="alert">
				{t("Couldn't load this. Try again.")} <button type="button" className="link" onClick={() => { void inbox.refetch(); void sent.refetch(); void owned.refetch(); }}>{t("Retry")}</button>
			</li>}
			{pending.map((offer) => (
				<OfferRow key={offer.id} offer={offer} />
			))}
			{suggested.map((item) => (
				<SuggestionRow key={item.id} item={item} />
			))}
			{assigned.map((offer) => (
				<li key={offer.id} className="row">
					<span className="row-icon accent">
						<UserCheck size={16} aria-hidden="true" />
					</span>
					<div className="row-main">
						<Link to={path(`tasks/${offer.item_id}`)}>{t("{name} assigned you {title}", { name: name(offer.from_user_id), title: offer.item_title })}</Link>
					</div>
				</li>
			))}
			{declined.map((offer) => (
				<li key={offer.id} className="row">
					<span className="row-icon danger">
						<UserX size={16} aria-hidden="true" />
					</span>
					<div className="row-main">
						<Link to={path(`tasks/${offer.item_id}`)}>{t("{name} declined {title}", { name: name(offer.to_user_id), title: offer.item_title })}</Link>
						{offer.response_note !== "" && <span className="plain quiet">{offer.response_note}</span>}
					</div>
				</li>
			))}
			{due.map((item) => (
				<li key={item.id} className="row">
					<span className="row-icon warn">
						<Clock size={16} aria-hidden="true" />
					</span>
					<div className="row-main">
						<Link to={path(`tasks/${item.id}`)}>{item.title}</Link>
					</div>
					<span className="quiet">{day(item.due_at as string)}</span>
				</li>
			))}
		</>
	);
}

/** Offers this person sent that nobody has answered. They come last, under their own heading, after every module's rows. */
export function WaitingRows() {
	const { t } = useI18n();
	const sent = useQuery({ queryKey: ["offers", "sent"], queryFn: () => listOffers("sent") });
	const waiting = (Array.isArray(sent.data) ? sent.data : []).filter((offer) => offer.state === "pending");
	if (waiting.length === 0) return null;
	return (
		<>
			<li className="rows-heading">
				<h2>{t("Waiting on others")}</h2>
			</li>
			{waiting.map((offer) => (
				<WaitingRow key={offer.id} offer={offer} />
			))}
		</>
	);
}

/** A task the person's assistant drafted for someone, ready for the person to check and send. */
function SuggestionRow({ item }: { item: Item }) {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const { name } = usePeople();
	const [sending, setSending] = useState(false);
	const suggestion = item.suggestion;
	if (suggestion === undefined) return null;
	return (
		<li className="row">
			<span className="row-icon accent">
				<Sparkles size={16} aria-hidden="true" />
			</span>
			<div className="row-main">
				<Link to={path(`tasks/${item.id}`)}>{t("Ready to send: {title} to {name}", { title: item.title, name: name(suggestion.to) })}</Link>
				{suggestion.note !== "" && <span className="plain quiet">{suggestion.note}</span>}
			</div>
			<div className="row-actions">
				<button type="button" className="primary" onClick={() => setSending(true)}>
					{t("Review and send")}
				</button>
			</div>
			{sending && <SendDialog item={item} suggested={{ to: { id: suggestion.to, name: name(suggestion.to) }, note: suggestion.note }} onClose={() => setSending(false)} />}
		</li>
	);
}
