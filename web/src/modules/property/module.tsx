import type { QueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import { request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import type { WorkbenchModule } from "../types.ts";
import { Account } from "./Account.tsx";
import { PropertyAdmin } from "./Admin.tsx";
import { eventLabel, useAccess } from "./api.ts";
import { Billing } from "./Billing.tsx";
import { Collections } from "./Collections.tsx";
import { Communications } from "./Communications.tsx";
import { HomeRows } from "./HomeRows.tsx";
import { Imports } from "./Imports.tsx";
import { PropertyLayout } from "./Layout.tsx";
import { Messages } from "./Messages.tsx";
import { MyDay } from "./MyDay.tsx";
import { Opening } from "./Opening.tsx";
import { MyAccess, Rooms } from "./Property.tsx";
import { RegistryImports } from "./RegistryImports.tsx";
import { Reports } from "./Reports.tsx";
import { WorkOrderPage } from "./WorkOrder.tsx";
import { WorkOrders } from "./WorkOrders.tsx";

/** Keyed by tenant, so nothing typed or chosen survives a switch to another. */
function Page({ children }: { children: ReactNode }) {
	const { tenant } = useWorkspace();
	return <PropertyLayout key={tenant}>{children}</PropertyLayout>;
}

function BillsPage() {
	const { t } = useI18n();
	const access = useAccess();
	if (access.isPending) return <div className="property-empty" role="status">{t("Loading…")}</div>;
	return <Billing scopes={access.data?.scopes ?? {}} />;
}

function ReportsPage() {
	const access = useAccess();
	return <Reports canExport={access.data?.tenant_admin === true || access.data?.scopes["property:export"] !== undefined} />;
}

/** Each job has its own address, so a notification or an agent's citation opens the record itself. */
export const property: WorkbenchModule = {
	id: "property",
	apiVersion: 1,
	access: "role",
	routes: [
		{ path: "property", element: <Page><MyDay /></Page> },
		{ path: "property/collections", element: <Page><Collections /></Page> },
		{ path: "property/accounts/:id", element: <Page><Account /></Page> },
		{ path: "property/work-orders", element: <Page><WorkOrders /></Page> },
		{ path: "property/work-orders/:id", element: <Page><WorkOrderPage /></Page> },
		{ path: "property/messages", element: <Page><Messages /></Page> },
		{ path: "property/rooms", element: <Page><Rooms /></Page> },
		{ path: "property/bills", element: <Page><BillsPage /></Page> },
		{ path: "property/communications", element: <Page><Communications /></Page> },
		{ path: "property/registry-imports", element: <Page><RegistryImports /></Page> },
		{ path: "property/opening", element: <Page><Opening /></Page> },
		{ path: "property/receipt-imports", element: <Page><Imports /></Page> },
		{ path: "property/reports", element: <Page><ReportsPage /></Page> },
		{ path: "property/access", element: <Page><MyAccess /></Page> },
	],
	nav: [{ key: "property", label: "Property", to: "property", icon: Building2, unread: true }],
	admin: { label: "Property", icon: Building2, Settings: PropertyAdmin },
	setup: [{ key: "property-project", label: "Create your property project", to: "admin?tab=property", check: async () => (await request<{ project: unknown }>("/api/modules/property/settings")).project !== null }],
	eventLabel,
	onNotifications: (client: QueryClient) => void client.invalidateQueries({ queryKey: ["property"] }),
	HomeRows,
};
