import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { postJSON, request } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { load, save } from "../lib/storage.ts";
import { useWorkspace } from "../shell/workspace.ts";
import type { WorkbenchModule } from "./types.ts";

const POLL_MS = 30_000;

/** The shape every module's `GET /v1/notifications` answers with. */
export type Notification = { id: string; read_at: string | null; target?: string; event: { kind: string } };

/** New notifications since the last poll, kept for the tab. The cursor survives a reload, so nothing repeats. */
export function useNotifications(module: WorkbenchModule) {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const client = useQueryClient();
	const unread = useRef(new Map<string, Notification>());
	const base = `/api/modules/${module.id}/notifications`;
	const key = `notifications:${module.id}:${tenant}`;
	const query = useQuery({
		queryKey: ["notifications", module.id, tenant],
		refetchInterval: POLL_MS,
		refetchIntervalInBackground: true,
		queryFn: async () => {
			const cursor = load(key) ?? "";
			const page = await request<{ notifications: Notification[]; cursor: string }>(`${base}?limit=200${cursor === "" ? "" : `&after=${encodeURIComponent(cursor)}`}`);
			save(key, page.cursor);
			for (const notification of page.notifications) {
				if (notification.read_at === null) unread.current.set(notification.id, notification);
				else unread.current.delete(notification.id);
				if (notification.read_at === null && mayNotify()) new window.Notification(t("Workbench"), { body: t(module.eventLabel(notification.event.kind)), tag: notification.id });
			}
			if (page.notifications.length > 0) module.onNotifications?.(client);
			return [...unread.current.values()];
		},
	});
	const items = query.data ?? [];

	useEffect(() => {
		document.title = items.length > 0 ? `(${items.length}) ${t("Workbench")}` : t("Workbench");
	}, [items.length, t]);

	/** Opening a record marks everything about it read. */
	const open = (target: string) => {
		const ids = items.filter((item) => item.target === target).map((item) => item.id);
		if (ids.length === 0) return;
		for (const id of ids) unread.current.delete(id);
		void postJSON<void>(`${base}/read`, { ids }).then(() => client.invalidateQueries({ queryKey: ["notifications", module.id, tenant] }));
	};
	return { items, open };
}

function mayNotify(): boolean {
	return "Notification" in window && window.Notification.permission === "granted" && load("notify") === "on" && document.hidden;
}
