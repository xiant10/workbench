import { useQuery } from "@tanstack/react-query";
import { AppWindow } from "lucide-react";
import { request } from "../lib/api.ts";
import type { Language } from "../lib/i18n.tsx";
import { useWorkspace } from "../shell/workspace.ts";
import { maskIcon, type NavSection, SectionLinks } from "../kit/frame.tsx";
import type { Icon, WorkbenchModule } from "./types.ts";

/** A label in each language a module answers in, because the shell's catalog doesn't hold a module it doesn't ship. */
export type Labelled = { label: string; label_zh: string };
/** One of Home's rows: the sum of `keys` from the module's attention read. `{count}` in a label is that sum. */
export type AttentionRow = Labelled & { keys: string[]; to: string };
export type ModuleManifest = {
	id: string;
	api_version: number;
	features: string[] | null;
	/**
	 * A module with its own web app. The shell links to it, and ships none of its screens. `icon_svg` is the menu icon,
	 * drawn on a 24 by 24 grid and used only as a mask, so its colour follows the menu's. `access` is "member" when every
	 * member has some use for the app; otherwise only people holding a role in it see it. `nav` lists every section the
	 * app has; a person's own come from the module's `GET /v1/me/nav`.
	 */
	app?: Labelled & { url: string; icon_svg?: string; access?: "role" | "member"; nav?: NavSection[] };
	attention?: AttentionRow[];
	events?: Record<string, Labelled>;
};

/** Larger than any icon needs, so a manifest can't make every menu render heavy. */
const MAX_ICON_SVG = 8192;

/** The manifest's own drawing, else a generic one. This build names no module's icon. */
export function iconOf(app: NonNullable<ModuleManifest["app"]>): Icon {
	const svg = app.icon_svg?.trim();
	if (svg !== undefined && svg.startsWith("<svg") && svg.length <= MAX_ICON_SVG) return maskIcon(svg);
	return AppWindow;
}

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
		const RowIcon = manifest.app === undefined ? AppWindow : iconOf(manifest.app);
		return (
			<>
				{rows.map((row) => {
					const count = row.keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
					if (count === 0) return null;
					return (
						<li key={row.keys.join()} className="row">
							<span className="row-icon accent"><RowIcon size={16} aria-hidden="true" /></span>
							<div className="row-main"><a href={appHref(url, tenant, row.to)}>{say(row, language).replace("{count}", String(count))}</a></div>
						</li>
					);
				})}
			</>
		);
	};
}

/** A module's answer is data from elsewhere, so only well-formed sections get a link. */
function wellFormed(value: unknown): value is NavSection {
	const section = value as Partial<NavSection> | null;
	return typeof section?.key === "string" && typeof section.to === "string" && typeof section.label === "string" && typeof section.label_zh === "string" && typeof section.group === "string";
}

/**
 * One of this person's conversations in a module's app, from its `GET /v1/me/conversations`: when it was used, where it
 * continues, and a title only if the app has a safe one.
 */
export type AppConversation = { id: string; last_used_at: string; to: string; title?: string };

function isConversation(value: unknown): value is AppConversation {
	const item = value as Partial<AppConversation> | null;
	return typeof item?.id === "string" && typeof item.to === "string" && typeof item.last_used_at === "string" && !Number.isNaN(Date.parse(item.last_used_at)) && (item.title === undefined || typeof item.title === "string");
}

/** A module's conversations, for the list beside Workbench's own. A module that can't answer just adds none. */
export function conversationsQuery(module: string, tenant: string) {
	return {
		queryKey: [module, tenant, "conversations"],
		queryFn: () => request<{ conversations: unknown[] }>(`/api/modules/${module}/me/conversations`).then((list) => (Array.isArray(list.conversations) ? list.conversations.filter(isConversation) : [])),
		retry: false,
		staleTime: 30_000,
	};
}

/** This person's sections in a module's app, read through the module proxy. Only well-formed ones come back. */
export function navQuery(module: string, tenant: string) {
	return {
		queryKey: [module, tenant, "nav"],
		queryFn: () => request<{ sections: unknown[] }>(`/api/modules/${module}/me/nav`).then((nav) => (Array.isArray(nav.sections) ? nav.sections.filter(wellFormed) : [])),
		retry: false,
		staleTime: 60_000,
	};
}

function sectionsFor(manifest: ModuleManifest, url: string) {
	if ((manifest.app?.nav ?? []).length === 0) return undefined;
	return function AppSections() {
		const { tenant } = useWorkspace();
		const nav = useQuery(navQuery(manifest.id, tenant));
		// The same read as Home's rows, so opening the sections costs no second one.
		const attention = useQuery({ queryKey: [manifest.id, tenant, "attention"], queryFn: () => request<Record<string, number>>(`/api/modules/${manifest.id}/attention`), retry: false });
		// Refused or down: the entry above still opens the app, which says why.
		if (nav.data === undefined) return null;
		return <SectionLinks sections={nav.data} href={(to) => appHref(url, tenant, to)} counts={attention.data} />;
	};
}

/** The shell's view of a module with its own app, built from what the module says about itself. */
export function moduleFromManifest(manifest: ModuleManifest, language: Language): WorkbenchModule | undefined {
	const url = appUrl(manifest);
	if (url === undefined || manifest.app === undefined) return undefined;
	const HomeRows = rowsFor(manifest, url, language);
	const Sections = sectionsFor(manifest, url);
	return {
		id: manifest.id,
		apiVersion: manifest.api_version,
		...(manifest.app.access === "member" ? {} : { access: "role" as const }),
		routes: [],
		nav: [{ key: manifest.id, label: say(manifest.app, language), to: "", href: url, icon: iconOf(manifest.app), unread: true, ...(Sections === undefined ? {} : { Sections }), ...(manifest.features?.includes("conversations") === true ? { conversations: true } : {}) }],
		eventLabel: (kind) => {
			// `work_order.*` covers a family of kinds with one meaning.
			const event = manifest.events?.[kind] ?? manifest.events?.[`${kind.split(".")[0]}.*`];
			return event === undefined ? kind : say(event, language);
		},
		...(HomeRows === undefined ? {} : { HomeRows }),
	};
}
