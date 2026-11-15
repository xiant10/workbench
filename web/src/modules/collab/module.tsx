import type { QueryClient } from "@tanstack/react-query";
import { CheckSquare, Inbox, ListTodo } from "lucide-react";
import type { WorkbenchModule } from "../types.ts";
import { itemsPage } from "./api.ts";
import { eventLabel } from "./events.ts";
import { HomeRows, WaitingRows } from "./HomeRows.tsx";
import { ListPage, ListsPage } from "./ListsPage.tsx";
import { ManagerVisibility } from "./ManagerVisibility.tsx";
import { SendDialog } from "./SendDialog.tsx";
import { SessionTaskChip } from "./TaskChip.tsx";
import { TaskPage } from "./TaskPage.tsx";
import { TasksPage } from "./TasksPage.tsx";

/** People's work, from `t10-collab`. */
export const collab: WorkbenchModule = {
	id: "collab",
	apiVersion: 1,
	routes: [
		{ path: "tasks", element: <TasksPage /> },
		{ path: "tasks/:id", element: <TaskPage /> },
		{ path: "lists", element: <ListsPage /> },
		{ path: "lists/:id", element: <ListPage /> },
	],
	nav: [
		{ key: "tasks", label: "Tasks", to: "tasks", icon: CheckSquare, unread: true },
		{ key: "lists", label: "Shared lists", to: "lists", icon: ListTodo },
	],
	eventLabel,
	records: { work_item: "tasks/:id", list: "lists/:id" },
	onNotifications: (client: QueryClient) => void client.invalidateQueries({ queryKey: ["offers"] }),
	HomeRows,
	WaitingRows,
	// Who a manager sees follows the org tree, so it sits beside it.
	admin: { joins: "organization", Settings: ManagerVisibility },
	resultAction: { label: "Send as task", icon: Inbox, Dialog: SendDialog },
	SessionChip: SessionTaskChip,
	// Task titles this person can see, through collab's own text filter, open ones first.
	search: async (query) =>
		(await itemsPage(`q=${encodeURIComponent(query)}`, "")).items
			.toSorted((a, b) => Number(a.status === "done" || a.status === "cancelled") - Number(b.status === "done" || b.status === "cancelled"))
			.slice(0, 6)
			.map((item) => ({ key: item.id, label: item.title, to: `tasks/${item.id}` })),
};
