import { type ReactNode, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useWorkspace } from "../shell/workspace.ts";
import { knowledge } from "./knowledge/module.tsx";
import { agents } from "./agents/module.tsx";
import { automations } from "./automations/module.tsx";
import { collab } from "./collab/module.tsx";
import type { ResultAction, WorkbenchModule } from "./types.ts";

/** The modules this build ships. A deployment turns them on through `MODULE_URLS`. */
const compiled: WorkbenchModule[] = [collab, agents, automations, knowledge];

/** Every route a module could own. A tenant without the module falls back to Home. */
export const moduleRoutes = compiled.flatMap((module) => module.routes.map((route) => ({ ...route, element: <ModuleGate id={module.id}>{route.element}</ModuleGate> })));

function ModuleGate({ id, children }: { id: string; children: ReactNode }) {
	const { tenant } = useWorkspace();
	return useModules().some((module) => module.id === id) ? children : <Navigate to={`/t/${tenant}`} replace />;
}

/** The modules that answered for this tenant, at a version this build understands. */
export function useModules(): WorkbenchModule[] {
	const { config } = useWorkspace();
	return useMemo(() => compiled.filter((module) => config.modules.some((found) => found.id === module.id && found.api_version === module.apiVersion)), [config.modules]);
}

/** The first module offering an action on an agent's reply. */
export function useResultAction(): ResultAction | undefined {
	return useModules().find((module) => module.resultAction !== undefined)?.resultAction;
}
