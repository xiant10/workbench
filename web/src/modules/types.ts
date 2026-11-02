import type { QueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import type { SessionInfo } from "../lib/agent.ts";

/** A page under `/t/:tenant/`. */
export type ModuleRoute = { path: string; element: ReactElement };

export type ModuleNav = {
	key: string;
	/** English, like every string here. The shell translates it. */
	label: string;
	to: string;
	icon: LucideIcon;
	/** Show the module's unread count beside this entry. */
	unread?: boolean;
};

/** Something a person can do with an agent's reply, such as sending it to a teammate. */
export type ResultAction = {
	label: string;
	icon: LucideIcon;
	Dialog: ComponentType<{ text: string; onClose(): void }>;
};

/**
 * Everything the shell knows about a business module. Only this object and the module's own folder know its routes,
 * so a new module adds a folder and one line in `index.ts`.
 */
export type WorkbenchModule = {
	/** The ID in its manifest, and in `MODULE_URLS`. */
	id: string;
	/** The manifest's major version this code was written for. Any other hides the module. */
	apiVersion: number;
	routes: ModuleRoute[];
	nav: ModuleNav[];
	/** What a notification's event kind means to a reader. */
	eventLabel(kind: string): string;
	/** Called when new notifications arrive, to refresh what they change. */
	onNotifications?(client: QueryClient): void;
	/** Rows for Home's "Needs you" list. */
	HomeRows?: ComponentType;
	/** A section in Settings, for tenant admins. */
	AdminSettings?: ComponentType;
	resultAction?: ResultAction;
	/** A chip in a conversation's header, when the conversation came from this module. */
	SessionChip?: ComponentType<{ session: SessionInfo }>;
};
