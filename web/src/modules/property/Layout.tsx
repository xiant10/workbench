import { Building2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../../lib/i18n.tsx";
import { displayName, useWorkspace } from "../../shell/workspace.ts";
import { holds, reaches, useAccess } from "./api.ts";
import "./property.css";

const WORK_PERMISSIONS = ["work_order.create", "work_order.process", "work_order.accept", "work_order.transfer", "work_order.supervise"];

/** The operator and time over every page of resident data (PRD ch. 6.4). */
function Watermark() {
	const { me } = useWorkspace();
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(timer);
	}, []);
	const text = `${displayName(me)} ${now.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`;
	const label = text.replace(/[<>&"']/g, "");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><text x="20" y="100" transform="rotate(-20 160 90)" font-family="sans-serif" font-size="13" fill="currentColor" fill-opacity="0.07">${label}</text></svg>`;
	return <div className="property-watermark" aria-hidden="true" data-testid="property-watermark" style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` }} />;
}

/** Each page's frame: the module's menu, by what this person's roles allow. */
export function PropertyLayout({ children }: { children: ReactNode }) {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const access = useAccess();
	const data = access.data;
	const admin = data?.tenant_admin === true;
	const tabs = [
		{ to: "property", label: "My day", end: true, show: true },
		{ to: "property/collections", label: reaches(data, "collection.read") ? "Collections" : "Arrears ledger", show: reaches(data, "collection.read") || reaches(data, "settlement.post") || reaches(data, "bill.issue") },
		{ to: "property/work-orders", label: "Work orders", show: admin || WORK_PERMISSIONS.some((key) => holds(data, key)) },
		{ to: "property/messages", label: "Notices & tasks", show: true },
		{ to: "property/rooms", label: "Property registry", show: admin || reaches(data, "resident.read") },
		{ to: "property/bills", label: "Bills & receipts", show: reaches(data, "bill.issue") || reaches(data, "settlement.post") || reaches(data, "collection.read") || reaches(data, "adjustment.request") },
		{ to: "property/communications", label: "Communication center", show: admin || data?.scopes["property:communication.note"] !== undefined },
		{ to: "property/registry-imports", label: "Registry imports", show: admin },
		{ to: "property/opening", label: "Opening balances", show: data?.scopes["property:bill.issue"] !== undefined },
		{ to: "property/receipt-imports", label: "Receipt imports", show: data?.scopes["property:settlement.post"] !== undefined },
		{ to: "property/reports", label: "Financial reports", show: admin || data?.scopes["property:report.read"] !== undefined },
		{ to: "property/access", label: "My access", show: true },
	];
	return (
		<div className="page property-page">
			<Watermark />
			<nav className="property-tabs" aria-label={t("Property views")}>
				<span className="property-tabs-mark" aria-hidden="true"><Building2 size={16} /></span>
				{tabs.filter((tab) => tab.show).map((tab) => (
					<NavLink key={tab.to} to={path(tab.to)} end={tab.end === true}>{t(tab.label)}</NavLink>
				))}
			</nav>
			{children}
		</div>
	);
}

/** A list's previous and next, for a server's opaque cursors. */
export function Pager({ next, cursor, history, onChange, busy }: { next: string; cursor: string; history: string[]; onChange(cursor: string, history: string[]): void; busy: boolean }) {
	const { t } = useI18n();
	if (history.length === 0 && next === "") return null;
	return (
		<footer className="property-pagination">
			<span />
			<div>
				<button type="button" disabled={history.length === 0 || busy} onClick={() => onChange(history.at(-1) ?? "", history.slice(0, -1))}>{t("Previous")}</button>
				<button type="button" disabled={next === "" || busy} onClick={() => onChange(next, [...history, cursor])}>{t("Next")}</button>
			</div>
		</footer>
	);
}
