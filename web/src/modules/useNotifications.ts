import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { postJSON, request } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { load, save } from "../lib/storage.ts";
import { useWorkspace } from "../shell/workspace.ts";
import type { WorkbenchModule } from "./types.ts";

const POLL_MS = 30_000;

/**
 * The shape every module's `GET /v1/notifications` answers with. `to`, from a module with its own app, is the page it
 * leads to under the app's `/t/<tenant>/`.
 */
export type Notification = { id: string; read_at: string | null; target?: string; to?: string; event: { kind: string } };

/** What's unread, per module and tenant, for the tab: the badge and the bell read the same one. */
const unread = new Map<string, Map<string, Notification>>();

function unreadFor(module: string, tenant: string): Map<string, Notification> {
	const key = `${module}:${tenant}`;
	let found = unread.get(key);
	if (found === undefined) {
		found = new Map();
		unread.set(key, found);
	}
	return found;
}

/** New notifications since the last poll, kept for the tab. The cursor survives a reload, so nothing repeats. */
export function notificationsQuery(module: WorkbenchModule, tenant: string, t: (text: string) => string, client: QueryClient) {
	const cursorKey = `notifications:${module.id}:${tenant}`;
	return {
		queryKey: ["notifications", module.id, tenant],
		refetchInterval: POLL_MS,
		refetchIntervalInBackground: true,
		queryFn: async () => {
			const cursor = load(cursorKey) ?? "";
			const page = await request<{ notifications: Notification[]; cursor: string }>(`/api/modules/${module.id}/notifications?limit=200${cursor === "" ? "" : `&after=${encodeURIComponent(cursor)}`}`);
			save(cursorKey, page.cursor);
			const items = unreadFor(module.id, tenant);
			for (const notification of page.notifications) {
				if (notification.read_at === null) items.set(notification.id, notification);
				else items.delete(notification.id);
				if (notification.read_at === null && mayNotify()) new window.Notification(t("Workbench"), { body: t(module.eventLabel(notification.event.kind)), tag: notification.id });
			}
			if (page.notifications.length > 0) module.onNotifications?.(client);
			return [...items.values()];
		},
	};
}

/** Marks these read in the module that sent them. */
export function markRead(client: QueryClient, module: string, tenant: string, ids: string[]): void {
	if (ids.length === 0) return;
	const items = unreadFor(module, tenant);
	for (const id of ids) items.delete(id);
	client.setQueryData(["notifications", module, tenant], [...items.values()]);
	void postJSON<void>(`/api/modules/${module}/notifications/read`, { ids }).then(() => client.invalidateQueries({ queryKey: ["notifications", module, tenant] }));
}

/** One module's unread notifications. */
export function useNotifications(module: WorkbenchModule) {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const client = useQueryClient();
	const query = useQuery(notificationsQuery(module, tenant, t, client));
	return { items: query.data ?? [] };
}

function mayNotify(): boolean {
	return "Notification" in window && window.Notification.permission === "granted" && load("notify") === "on" && document.hidden;
}
