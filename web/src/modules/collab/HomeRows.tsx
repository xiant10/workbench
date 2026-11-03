import { useQuery } from "@tanstack/react-query";
import { Clock, UserCheck, UserX } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { dueDay, listItems, listOffers, today } from "./api.ts";
import { OfferRow, WaitingRow } from "./offers.tsx";
import { usePeople } from "./usePeople.ts";

export function HomeRows() {
	const { t, day } = useI18n();
	const { path, me } = useWorkspace();
	const { name } = usePeople();
	const inbox = useQuery({ queryKey: ["offers", "inbox"], queryFn: () => listOffers("inbox") });
	const sent = useQuery({ queryKey: ["offers", "sent"], queryFn: () => listOffers("sent") });
	const owned = useQuery({ queryKey: ["items", "owned"], queryFn: () => listItems("view=owned") });
	const pending = inbox.data?.filter((offer) => offer.state === "pending") ?? [];
	const assigned = inbox.data?.filter((offer) => offer.state === "assigned" && offer.to_user_id === me.user_id) ?? [];
	const declined = sent.data?.filter((offer) => offer.state === "declined") ?? [];
	const waiting = sent.data?.filter((offer) => offer.state === "pending") ?? [];
	const due = owned.data?.filter((item) => item.due_at !== null && dueDay(item.due_at) <= today() && (item.status === "todo" || item.status === "doing")) ?? [];
	return (
		<>
			{[inbox, sent, owned].some((query) => query.isPending) && <li className="row" role="status">{t("Loading…")}</li>}
			{[inbox, sent, owned].some((query) => query.isError) && <li className="row" role="alert">
				{t("Couldn't load this. Try again.")} <button type="button" className="link" onClick={() => { void inbox.refetch(); void sent.refetch(); void owned.refetch(); }}>{t("Retry")}</button>
			</li>}
			{pending.map((offer) => (
				<OfferRow key={offer.id} offer={offer} />
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
			{waiting.length > 0 && (
				<li className="rows-heading">
					<h2>{t("Waiting on others")}</h2>
				</li>
			)}
			{waiting.map((offer) => (
				<WaitingRow key={offer.id} offer={offer} />
			))}
		</>
	);
}
