import { useQuery } from "@tanstack/react-query";
import { Search, WalletCards } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Empty } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { type CollectionPage, GROUPS, money, reaches, root, STAGES, useAccess } from "./api.ts";
import { Pager } from "./Layout.tsx";

/** Who to contact next, oldest debt first. Finance reads the same rows as its arrears ledger. */
export function Collections() {
	const { t, dateTime } = useI18n();
	const { tenant, path } = useWorkspace();
	const access = useAccess();
	const [group, setGroup] = useState("");
	const [stage, setStage] = useState("");
	const [search, setSearch] = useState("");
	const [q, setQ] = useState("");
	const [cursor, setCursor] = useState("");
	const [history, setHistory] = useState<string[]>([]);
	const reset = () => {
		setCursor("");
		setHistory([]);
	};
	const list = useQuery({
		queryKey: ["property", tenant, "collections", group, stage, q, cursor],
		queryFn: () => request<CollectionPage>(`${root}/collections?${new URLSearchParams({ group, stage, q, cursor })}`),
		retry: false,
		gcTime: 0,
	});
	const collecting = reaches(access.data, "collection.read");
	return (
		<>
			<header className="property-header">
				<div>
					<h1>{t(collecting ? "Collections" : "Arrears ledger")}</h1>
					<p>{t("Overdue households, oldest debt first. Open one to contact them or see its bills.")}</p>
				</div>
			</header>
			<section className="property-card">
				<form
					className="property-filters property-filters-top"
					onSubmit={(event: FormEvent) => {
						event.preventDefault();
						setQ(search.trim());
						reset();
					}}
				>
					<label className="property-search">
						<Search size={16} aria-hidden="true" />
						<input aria-label={t("Search room or account")} placeholder={t("Search room or account")} value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} />
					</label>
					<select aria-label={t("Group")} value={group} onChange={(event) => { setGroup(event.target.value); reset(); }}>
						<option value="">{t("All groups")}</option>
						{Object.entries(GROUPS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
					</select>
					<select aria-label={t("Contact status")} value={stage} onChange={(event) => { setStage(event.target.value); reset(); }}>
						<option value="">{t("Any contact status")}</option>
						{Object.entries(STAGES).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
					</select>
					<button type="submit">{t("Search")}</button>
				</form>
				{list.data !== undefined && (
					<p className="property-summary" role="status">{t("{count} households owe {amount}", { count: list.data.totals.accounts, amount: money(list.data.totals.amount_fen) })}</p>
				)}
				{list.isPending && <div className="property-empty" role="status">{t("Loading…")}</div>}
				{list.isError && <div className="property-empty" role="alert">{t("Couldn't load this. Try again.")}</div>}
				{list.data?.collections.length === 0 && <Empty icon={WalletCards} title={t("No overdue households match")} />}
				<ul className="property-items">
					{list.data?.collections.map((row) => (
						<li key={row.account_id} className="property-item">
							<div>
								<Link to={path(`property/accounts/${encodeURIComponent(row.account_id)}`)}><strong>{row.room_no}</strong></Link>
								<span className="property-quiet"> {row.building} · {row.account_no}</span>
								<p>
									<span className={`property-status group-${row.group}`}>{t(GROUPS[row.group])}</span>{" "}
									<span className="property-status">{t(STAGES[row.stage])}</span>
								</p>
								<p className="property-quiet">
									{row.last_touch_at === null ? t("Not contacted yet") : t("Last contact {time}", { time: dateTime(row.last_touch_at) })}
									{row.last_settled_at !== null && ` · ${t("Last payment {time}", { time: dateTime(row.last_settled_at) })}`}
								</p>
							</div>
							<div className="property-amount">
								<strong>{money(row.amount_fen)}</strong>
								<small>{t("{days} days · {from} to {to}", { days: row.age_days, from: row.period_start, to: row.period_end })}</small>
							</div>
						</li>
					))}
				</ul>
				<Pager next={list.data?.next_cursor ?? ""} cursor={cursor} history={history} busy={list.isFetching} onChange={(next, past) => { setCursor(next); setHistory(past); }} />
			</section>
		</>
	);
}
