import { useQuery } from "@tanstack/react-query";
import { AppWindow, Building2, type LucideIcon } from "lucide-react";
import { request } from "../lib/api.ts";
import type { Language } from "../lib/i18n.tsx";
import { useWorkspace } from "../shell/workspace.ts";
import type { WorkbenchModule } from "./types.ts";

/** A label in each language a module answers in, because the shell's catalog doesn't hold a module it doesn't ship. */
export type Labelled = { label: string; label_zh: string };
/** One of Home's rows: the sum of `keys` from the module's attention read. `{count}` in a label is that sum. */
export type AttentionRow = Labelled & { keys: string[]; to: string };
export type ModuleManifest = {
	id: string;
	api_version: number;
	features: string[] | null;
	/** A module with its own web app. The shell links to it, and ships none of its screens. */
	app?: Labelled & { url: string; icon?: string };
	attention?: AttentionRow[];
	events?: Record<string, Labelled>;
};

const ICONS: Record<string, LucideIcon> = { building: Building2 };

const say = (labelled: Labelled, language: Language) => (language === "zh" ? labelled.label_zh : labelled.label);

/** An address from a manifest becomes a link and a redirect, so only http(s) counts. */
export function appUrl(manifest: Pick<ModuleManifest, "app">): string | undefined {
	const url = manifest.app?.url;
	if (url === undefined) return undefined;
	try {
		const { protocol } = new URL(url);
		return protocol === "http:" || protocol === "https:" ? url.replace(/\/+$/, "") : undefined;
	} catch {
		return undefined;
	}
}

/** Where a path in a module's app is, for this tenant. */
export function appHref(url: string, tenant: string, to = ""): string {
	return `${url}/t/${encodeURIComponent(tenant)}/${to.replace(/^\/+/, "")}`;
}

function rowsFor(manifest: ModuleManifest, url: string, language: Language) {
	const rows = manifest.attention ?? [];
	if (rows.length === 0) return undefined;
	return function HomeRows() {
		const { tenant } = useWorkspace();
		// No failure row: someone with no role is refused, and Home isn't the place to say so.
		const attention = useQuery({ queryKey: [manifest.id, tenant, "attention"], queryFn: () => request<Record<string, number>>(`/api/modules/${manifest.id}/attention`), retry: false });
		const counts = attention.data;
		if (counts === undefined) return null;
		const Icon = ICONS[manifest.app?.icon ?? ""] ?? AppWindow;
		return (
			<>
				{rows.map((row) => {
					const count = row.keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
					if (count === 0) return null;
					return (
						<li key={row.keys.join()} className="row">
							<span className="row-icon accent"><Icon size={16} aria-hidden="true" /></span>
							<div className="row-main"><a href={appHref(url, tenant, row.to)}>{say(row, language).replace("{count}", String(count))}</a></div>
						</li>
					);
				})}
			</>
		);
	};
}

/** The shell's view of a module with its own app, built from what the module says about itself. */
export function moduleFromManifest(manifest: ModuleManifest, language: Language): WorkbenchModule | undefined {
	const url = appUrl(manifest);
	if (url === undefined || manifest.app === undefined) return undefined;
	const HomeRows = rowsFor(manifest, url, language);
	return {
		id: manifest.id,
		apiVersion: manifest.api_version,
		access: "role",
		routes: [],
		nav: [{ key: manifest.id, label: say(manifest.app, language), to: "", href: url, icon: ICONS[manifest.app.icon ?? ""] ?? AppWindow, unread: true }],
		eventLabel: (kind) => {
			const event = manifest.events?.[kind];
			return event === undefined ? kind : say(event, language);
		},
		...(HomeRows === undefined ? {} : { HomeRows }),
	};
}
