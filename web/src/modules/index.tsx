import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LockKeyhole } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import { type Language, useI18n } from "../lib/i18n.tsx";
import { load, save } from "../lib/storage.ts";
import { Empty } from "../lib/ui.tsx";
import { type AppConfig, configQuery, useWorkspace } from "../shell/workspace.ts";
import { knowledge } from "./knowledge/module.tsx";
import { agents } from "./agents/module.tsx";
import { automations } from "./automations/module.tsx";
import { collab } from "./collab/module.tsx";
import { appHref, appUrl, moduleFromManifest, type ModuleManifest } from "./fromManifest.tsx";
import type { ModuleAdmin, ModuleNav, ResultAction, WorkbenchModule } from "./types.ts";

/** The modules this build ships, in menu order. A deployment turns them on through `MODULE_URLS`. */
const compiled: WorkbenchModule[] = [collab, automations, knowledge, agents];

/** Every route a module could own. A tenant without the module falls back to Home. */
export const moduleRoutes = compiled.flatMap((module) => module.routes.map((route) => ({ ...route, element: <ModuleGate id={module.id}>{route.element}</ModuleGate> })));

/** The manifest last seen for a module with an app, so a menu entry outlasts an outage: a down module sends none. */
const lastSeen = (id: string) => `module:${id}`;

function seenManifest(id: string): ModuleManifest | undefined {
	try {
		const saved = load(lastSeen(id));
		return saved === undefined ? undefined : (JSON.parse(saved) as ModuleManifest);
	} catch {
		return undefined;
	}
}

/**
 * Every module this person's shell knows of, compiled or described by its manifest. A manifest with an app wins over a
 * compiled folder for the same ID, so a module moves out by deploying its app, before its folder goes. Modules with
 * apps go before `agents`, which stays last in the menus.
 */
function knownModules(config: AppConfig, language: Language): WorkbenchModule[] {
	const manifests = [...config.modules.filter((entry) => entry.app !== undefined), ...config.unavailable_modules.flatMap((id) => seenManifest(id) ?? [])];
	const apps = manifests.flatMap((manifest) => moduleFromManifest(manifest, language) ?? []);
	const kept = compiled.filter((module) => !apps.some((app) => app.id === module.id));
	const last = kept.filter((module) => module.id === "agents");
	return [...kept.filter((module) => module.id !== "agents"), ...apps, ...last];
}

/** Sends the reader to the same path in a module's own app, or Home if it has none. */
function ToApp({ id }: { id: string }) {
	const { tenant, config } = useWorkspace();
	const url = appUrl(config.modules.find((entry) => entry.id === id) ?? {});
	useEffect(() => {
		if (url === undefined) return;
		const rest = window.location.pathname.split(`/t/${tenant}/${id}`)[1] ?? "";
		window.location.replace(appHref(url, tenant, rest + window.location.search));
	}, [id, tenant, url]);
	return url === undefined ? <Navigate to={`/t/${tenant}`} replace /> : null;
}

/** A link to a page of a module with no folder here, such as an old bookmark. */
export function ModuleRedirect() {
	const { module: id = "" } = useParams();
	return <ToApp id={id} />;
}

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
	const hasApp = config.modules.some((entry) => entry.id === id && appUrl(entry) !== undefined);
	const module = compiled.find((entry) => entry.id === id);
	const state = module === undefined ? "absent" : stateOf(module, config, isAdmin);
	if (hasApp) return <ToApp id={id} />;
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
	const { language } = useI18n();
	return useMemo(() => knownModules(config, language).filter((module) => stateOf(module, config, isAdmin) === "available"), [config, isAdmin, language]);
}

/** Modules that keep a place in menus and tabs, including those down for now. */
export function useModuleMenu(): { module: WorkbenchModule; available: boolean }[] {
	const { config, isAdmin } = useWorkspace();
	const { language } = useI18n();
	useEffect(() => {
		for (const entry of config.modules) if (entry.app !== undefined) save(lastSeen(entry.id), JSON.stringify(entry));
	}, [config.modules]);
	return useMemo(
		() =>
			knownModules(config, language).flatMap((module) => {
				const state = stateOf(module, config, isAdmin);
				return state === "available" || state === "unavailable" ? [{ module, available: state === "available" }] : [];
			}),
		[config, isAdmin, language],
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
