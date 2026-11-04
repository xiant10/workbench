import type { QueryClient } from "@tanstack/react-query";
import { AlarmClock } from "lucide-react";
import type { WorkbenchModule } from "../types.ts";
import { AutomationsPage } from "./AutomationsPage.tsx";

/** What a notification from an automation means to a reader. */
const EVENTS: Record<string, string> = {
	"automation.ready": "An automation's run is ready",
	"automation.failed": "An automation's run failed",
	"automation.failing": "An automation stopped after failing",
	"automation.revoked": "An automation stopped: your consent ended",
	"automation.skipped": "An automation skipped a run",
};

/** A person's scheduled runs, from `t10-automations`. */
export const automations: WorkbenchModule = {
	id: "automations",
	apiVersion: 1,
	routes: [{ path: "automations", element: <AutomationsPage /> }],
	nav: [{ key: "automations", label: "Automations", to: "automations", icon: AlarmClock, unread: true }],
	eventLabel: (kind) => EVENTS[kind] ?? kind,
	onNotifications: (client: QueryClient) => {
		void client.invalidateQueries({ queryKey: ["automations"] });
		void client.invalidateQueries({ queryKey: ["automation"] });
	},
};
