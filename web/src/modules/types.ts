import type { QueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import type { SessionInfo } from "../lib/agent.ts";

/** A menu icon: one of lucide's, or one a module drew in its manifest. */
export type { Icon } from "../kit/frame.tsx";
import type { Icon } from "../kit/frame.tsx";

/** A page under `/t/:tenant/`. */
export type ModuleRoute = { path: string; element: ReactElement };

export type ModuleNav = {
	key: string;
	/** English, like every string here. The shell translates it. */
	label: string;
	to: string;
	/** Set for a module with its own app: the entry leaves the workbench, and `to` isn't used. */
	href?: string;
	icon: Icon;
	/** For a module with its own app: its sections for this person, shown under its entry when they open them. */
	Sections?: ComponentType;
	/** For a module with its own app: it lists this person's conversations there, shown with Workbench's own. */
	conversations?: boolean;
	/** Show the module's unread count beside this entry. */
	unread?: boolean;
	/** For tenant admins. The page still checks for itself. */
	adminOnly?: boolean;
};

/** Something a person can do with an agent's reply, such as sending it to a teammate. */
export type ResultAction = {
	label: string;
	icon: LucideIcon;
	Dialog: ComponentType<{ text: string; onClose(): void }>;
};

/** Administration's own tabs that a module's settings can join. Activity is the auth service's log, so nothing joins it. */
export type AdminTab = "people" | "organization" | "roles" | "agents" | "security";

/**
 * A module's settings in Administration, for tenant admins. `Settings` renders whole cards. A module with one or two
 * switches joins the built-in tab they belong with; one with more takes a tab of its own, after the built-in ones.
 */
export type ModuleAdmin = { Settings: ComponentType } & ({ joins: AdminTab } | { label: string; icon: LucideIcon; id?: string });

/** Something a new tenant needs from its admin, shown on Home until it's done. `check` asks the module, so it can't drift from what's true. */
export type SetupStep = {
	key: string;
	label: string;
	to: string;
	check(tenant: string): Promise<boolean>;
};

/**
 * Everything the shell knows about a business module. Only this object and the module's own folder know its routes,
 * so a new module adds a folder and one line in `index.tsx`.
 */
export type WorkbenchModule = {
	/** The ID in its manifest, and in `MODULE_URLS`. */
	id: string;
	/** The manifest's major version this code was written for. Any other hides the module. */
	apiVersion: number;
	/** "role" hides it from anyone holding no business role in it. Leave it out where every member has some use for it. Only a hint: the module still refuses. */
	access?: "role";
	routes: ModuleRoute[];
	nav: ModuleNav[];
	/** What a notification's event kind means to a reader. */
	eventLabel(kind: string): string;
	/**
	 * Pages for this module's records, by type, with `:id` where the ID goes, such as `{ work_item: "tasks/:id" }`. A
	 * notification from any module whose target names one of these records opens it.
	 */
	records?: Record<string, string>;
	/** Called when new notifications arrive, to refresh what they change. */
	onNotifications?(client: QueryClient): void;
	/** Rows for Home's "Needs you" list. */
	HomeRows?: ComponentType;
	/** Rows for what this person is waiting on, after every module's `HomeRows`. */
	WaitingRows?: ComponentType;
	admin?: ModuleAdmin | ModuleAdmin[];
	setup?: SetupStep[];
	resultAction?: ResultAction;
	/** A chip in a conversation's header, when the conversation came from this module. */
	SessionChip?: ComponentType<{ session: SessionInfo }>;
};
