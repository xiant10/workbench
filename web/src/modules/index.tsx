import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LockKeyhole } from "lucide-react";
import { type ReactNode, useMemo, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { Empty } from "../lib/ui.tsx";
import { type AppConfig, configQuery, useWorkspace } from "../shell/workspace.ts";
import { knowledge } from "./knowledge/module.tsx";
import { agents } from "./agents/module.tsx";
import { automations } from "./automations/module.tsx";
import { collab } from "./collab/module.tsx";
import type { ModuleAdmin, ModuleNav, ResultAction, WorkbenchModule } from "./types.ts";

/** The modules this build ships, in menu order. A deployment turns them on through `MODULE_URLS`. */
const compiled: WorkbenchModule[] = [collab, automations, knowledge, agents];

/** Every route a module could own. A tenant without the module falls back to Home. */
export const moduleRoutes = compiled.flatMap((module) => module.routes.map((route) => ({ ...route, element: <ModuleGate id={module.id}>{route.element}</ModuleGate> })));

/**
 * Absent: not deployed, off for this tenant, or a version this build doesn't know. Unavailable: deployed, but it gave no
 * clear answer, so it keeps its place in the menu. No role: deployed, but this person has no use of it. These only decide
 * what to show. The proxy refuses an unlisted module, and each module checks every call.
 */
type ModuleState = "available" | "unavailable" | "no_role" | "absent";

function stateOf(module: WorkbenchModule, config: AppConfig, isAdmin: boolean): ModuleState {
	const found = config.modules.find((entry) => entry.id === module.id);
	const down = config.unavailable_modules.includes(module.id);
	if (found === undefined ? !down : found.api_version !== module.apiVersion) return "absent";
	// A tenant admin always sees it, so a missing permission catalog can't hide a module from whoever would fix that.
	if (module.access === "role" && !isAdmin && config.access !== undefined && !config.access.modules.includes(module.id)) return "no_role";
	return found === undefined ? "unavailable" : "available";
}

function nameOf(module: WorkbenchModule): string {
	return module.nav[0]?.label ?? module.id;
}

/** Wraps a module's page by its state. A page already open stays open if its module goes down, so nothing typed is lost. */
export function ModuleGate({ id, children }: { id: string; children: ReactNode }) {
	const { t } = useI18n();
	const { tenant, config, isAdmin } = useWorkspace();
	const client = useQueryClient();
	const opened = useRef(false);
	const module = compiled.find((entry) => entry.id === id);
	const state = module === undefined ? "absent" : stateOf(module, config, isAdmin);
	if (state === "available") opened.current = true;
	if (module === undefined || state === "absent") return <Navigate to={`/t/${tenant}`} replace />;
	if (state === "no_role") {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("You don't have access to {name}. Ask a tenant admin for a role.", { name: t(nameOf(module)) })} />
			</div>
		);
	}
	if (state === "unavailable" && !opened.current) {
		return (
			<div className="page">
				<Empty icon={CircleAlert} title={t("{name} is unavailable right now.", { name: t(nameOf(module)) })}>
					<button type="button" className="primary" onClick={() => void client.invalidateQueries({ queryKey: configQuery.queryKey })}>
						{t("Retry")}
					</button>
				</Empty>
			</div>
		);
	}
	return children;
}

/** A module's settings in Administration, however it declared them. */
export function adminsOf(module: WorkbenchModule): ModuleAdmin[] {
	return module.admin === undefined ? [] : Array.isArray(module.admin) ? module.admin : [module.admin];
}

/** Modules working for this person, which is who gets to add to Home, poll and act. */
export function useModules(): WorkbenchModule[] {
	const { config, isAdmin } = useWorkspace();
	return useMemo(() => compiled.filter((module) => stateOf(module, config, isAdmin) === "available"), [config, isAdmin]);
}

/** Modules that keep a place in menus and tabs, including those down for now. */
export function useModuleMenu(): { module: WorkbenchModule; available: boolean }[] {
	const { config, isAdmin } = useWorkspace();
	return useMemo(
		() =>
			compiled.flatMap((module) => {
				const state = stateOf(module, config, isAdmin);
				return state === "available" || state === "unavailable" ? [{ module, available: state === "available" }] : [];
			}),
		[config, isAdmin],
	);
}

/** The sidebar's and the palette's entries for this person. */
export function useModuleNav(): { module: WorkbenchModule; entry: ModuleNav; available: boolean }[] {
	const { isAdmin } = useWorkspace();
	const menu = useModuleMenu();
	return useMemo(() => menu.flatMap(({ module, available }) => module.nav.filter((entry) => isAdmin || entry.adminOnly !== true).map((entry) => ({ module, entry, available }))), [menu, isAdmin]);
}

/** The first module offering an action on an agent's reply. */
export function useResultAction(): ResultAction | undefined {
	return useModules().find((module) => module.resultAction !== undefined)?.resultAction;
}
