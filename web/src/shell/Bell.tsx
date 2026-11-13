import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, type BellItem } from "../kit/command.tsx";
import { useI18n } from "../lib/i18n.tsx";
import { appHref } from "../modules/fromManifest.tsx";
import { useModuleNav, useModules } from "../modules/index.tsx";
import { markRead, notificationsQuery, recordPage, type Notification } from "../modules/useNotifications.ts";
import { useWorkspace } from "./workspace.ts";

type Item = BellItem & { module: string; notification: Notification; external: boolean };

/**
 * Every module's unread notifications in one list. One from an app of its own links to the page it names there; one
 * from a module in Workbench opens the record it's about, when a module has a page for it, and otherwise that module.
 */
export function WorkbenchBell() {
	const { t } = useI18n();
	const { tenant, path } = useWorkspace();
	const client = useQueryClient();
	const navigate = useNavigate();
	const nav = useModuleNav();
	const modules = useModules();
	// The entries that show a count are the modules that notify, once each.
	const sources = nav.filter(({ module, entry, available }, index) => available && entry.unread === true && nav.findIndex((other) => other.module.id === module.id && other.entry.unread === true) === index);
	const results = useQueries({ queries: sources.map(({ module }) => notificationsQuery(module, tenant, t, client)) });
	const items: Item[] = sources.flatMap(({ module, entry }, index) =>
		(results[index]?.data ?? []).map((notification) => ({
			id: `${module.id}:${notification.id}`,
			// A title is the reader's own name for what it's about, such as an automation's, and isn't translated.
			label: notification.title ? `${t(module.eventLabel(notification.event.kind))}: ${notification.title}` : t(module.eventLabel(notification.event.kind)),
			app: t(entry.label),
			icon: entry.icon,
			href: entry.href === undefined ? path(recordPage(modules, notification.target) ?? entry.to) : appHref(entry.href, tenant, notification.to ?? ""),
			external: entry.href !== undefined,
			module: module.id,
			notification,
		})),
	);

	useEffect(() => {
		document.title = items.length > 0 ? `(${items.length}) ${t("Workbench")}` : t("Workbench");
	}, [items.length, t]);

	return (
		<Bell
			items={items}
			onOpen={(chosen) => {
				const item = items.find((other) => other.id === chosen.id);
				if (item === undefined) return;
				// Opening a record marks everything about it read.
				const target = item.notification.target;
				const same = items.filter((other) => other.module === item.module && (other.id === item.id || (target !== undefined && other.notification.target === target)));
				markRead(client, item.module, tenant, same.map((other) => other.notification.id));
				if (item.external) window.location.assign(item.href);
				else navigate(item.href);
			}}
			onReadAll={() => {
				for (const { module } of sources) markRead(client, module.id, tenant, items.filter((item) => item.module === module.id).map((item) => item.notification.id));
			}}
		/>
	);
}
