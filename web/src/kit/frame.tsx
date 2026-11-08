import { AppWindow, Building2, Check, ChevronDown, ChevronRight, ChevronsUpDown, LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ComponentType, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n.tsx";
import { useMedia } from "./layout.ts";
import { load, save } from "./storage.ts";
import { setTheme, type Theme, useTheme } from "./theme.ts";
import { Avatar, Dialog, LanguageSwitch, Menu, Segmented, useFeedback } from "./ui.tsx";

/** Lucide's icons fit this, and so does an icon drawn from a module's manifest. */
export type Icon = ComponentType<{ size?: number | string; "aria-hidden"?: boolean | "true" | "false" }>;

/**
 * A place in the Apps list. Every app shows the same list, Workbench first, so a person finds the same places wherever
 * they are. It comes from data, never from an app's code: a manifest, or the auth service's list of homes.
 */
export type RailApp = {
	id: string;
	label: string;
	href: string;
	icon?: Icon;
	badge?: ReactNode;
	unavailable?: boolean;
	/** The app's sections for this person, read only once they open them under its entry. */
	Sections?: ComponentType;
};

export type NavGroup = "daily" | "records" | "setup";

/**
 * One of an app's sections, as its `GET /v1/me/nav` answers: only those this person can use, in menu order. `to` is a
 * path under the app's `/t/<tenant>/`. `group` is one of three fixed words, so every app sorts the same way, and `keys`
 * name the attention counts that add up to its badge.
 */
export type NavSection = { key: string; to: string; label: string; label_zh: string; group: NavGroup; keys?: string[] };

/** The groups in menu order, with the heading each shows under. Daily work needs none. */
export const NAV_GROUPS: { id: NavGroup; label?: string }[] = [{ id: "daily" }, { id: "records", label: "Records" }, { id: "setup", label: "Setup" }];

/** Sections in their groups, in the fixed order. A group word this build doesn't know shows with records, not nowhere. */
export function groupSections<T extends { group: string }>(sections: T[]): { id: NavGroup; label?: string; sections: T[] }[] {
	const known = (group: string) => NAV_GROUPS.some(({ id }) => id === group);
	return NAV_GROUPS.map((group) => ({ ...group, sections: sections.filter((section) => section.group === group.id || (group.id === "records" && !known(section.group))) })).filter((group) => group.sections.length > 0);
}

/** A section's badge: the sum of its attention counts. */
export function sectionCount(section: { keys?: string[] }, counts: Record<string, number> | undefined): number {
	return (section.keys ?? []).reduce((sum, key) => sum + (counts?.[key] ?? 0), 0);
}

/** Another app's sections under its entry in the Apps list: daily work, then the rest behind More. Plain links, since each app is its own site. */
export function SectionLinks({ sections, href, counts }: { sections: NavSection[]; href(to: string): string; counts?: Record<string, number> }) {
	const { t, language } = useI18n();
	const [more, setMore] = useState(false);
	const daily = sections.filter((section) => section.group === "daily");
	const rest = sections.filter((section) => section.group !== "daily");
	const link = (section: NavSection) => {
		const count = sectionCount(section, counts);
		return (
			<a key={section.key} className="nav-link" href={href(section.to)} data-testid={`section-${section.key}`}>
				{language === "zh" ? section.label_zh : section.label}
				{count > 0 && <span className="badge">{count}</span>}
			</a>
		);
	};
	return (
		<>
			{daily.map(link)}
			{more && rest.map(link)}
			{rest.length > 0 && (
				<button type="button" className="nav-link rail-more" aria-expanded={more} onClick={() => setMore(!more)}>
					{t(more ? "Show fewer" : "More")}
				</button>
			)}
		</>
	);
}

export const WORKBENCH_APP = "workbench";

/** A module's own icon, as a mask over the text colour. Never put in the page as markup, so it can't run anything. */
export function maskIcon(svg: string): Icon {
	const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
	return function ModuleIcon({ size = 16 }) {
		return <span className="module-icon" aria-hidden="true" style={{ width: size, height: size, maskImage: image, WebkitMaskImage: image }} />;
	};
}

type RailProps = {
	/** The app this rail is in: its ID in `apps`, its name and its home. */
	current: { id: string; label: string; home: ReactNode };
	/** What the app puts above its sections, such as New conversation and Search. */
	top?: ReactNode;
	/** Beside the app's name: the notifications bell. */
	bell?: ReactNode;
	/** The app's own sections, as `nav-link`s. */
	sections: ReactNode;
	apps: RailApp[];
	/** Under the Apps list and growing, such as Workbench's conversations. */
	children?: ReactNode;
	account: ReactNode;
	open?: boolean;
	onCollapse(): void;
};

/** The left rail every t10 web app draws, so moving between apps changes the page and not the frame. */
export function Rail({ current, top, bell, sections, apps, children, account, open = false, onCollapse }: RailProps) {
	const { t } = useI18n();
	// Which apps' sections are open, kept per browser so the rail looks the same after a move between apps.
	const [opened, setOpened] = useState(() => (load("rail-open") ?? "").split(",").filter(Boolean));
	const toggle = (id: string) => {
		const next = opened.includes(id) ? opened.filter((other) => other !== id) : [...opened, id];
		setOpened(next);
		save("rail-open", next.join(","));
	};
	return (
		<nav className={open ? "sidebar open" : "sidebar"} aria-label={current.label}>
			<div className="brand">
				{current.home}
				{bell}
				<button type="button" className="icon-button" aria-label={t("Hide sidebar")} onClick={onCollapse}>
					<PanelLeftClose size={17} aria-hidden="true" />
				</button>
			</div>
			{top}
			<div className="nav-links">{sections}</div>
			{apps.length > 1 && (
				<div className="nav-links rail-apps" data-testid="rail-apps">
					<h2>{t("Apps")}</h2>
					{apps.map((app) => {
						const AppIcon = app.icon ?? (app.id === WORKBENCH_APP ? LayoutGrid : AppWindow);
						const here = app.id === current.id;
						const expandable = app.Sections !== undefined && !here && app.unavailable !== true;
						const expanded = expandable && opened.includes(app.id);
						return (
							<Fragment key={app.id}>
								<div className="rail-app">
									<a className={["nav-link", here ? "active" : "", app.unavailable === true ? "unavailable" : ""].join(" ").trim()} href={app.href} aria-current={here ? "page" : undefined} data-testid={`app-${app.id}`}>
										<AppIcon size={16} aria-hidden="true" />
										{app.label}
										{!here && app.badge}
									</a>
									{expandable && (
										<button type="button" className="icon-button rail-toggle" aria-expanded={expanded} aria-label={t(expanded ? "Hide {name}'s sections" : "Show {name}'s sections", { name: app.label })} data-testid={`app-${app.id}-toggle`} onClick={() => toggle(app.id)}>
											{expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
										</button>
									)}
								</div>
								{expanded && app.Sections !== undefined && (
									<div className="rail-sections" data-testid={`app-${app.id}-sections`}>
										<app.Sections />
									</div>
								)}
							</Fragment>
						);
					})}
				</div>
			)}
			<div className="session-scroll">{children}</div>
			<footer className="sidebar-foot">{account}</footer>
		</nav>
	);
}

type AccountMenuProps = {
	name: string;
	tenant: string;
	tenants: { id: string; name: string }[];
	onSwitch(tenant: string): void;
	/** Sign out of every t10 app in this browser. */
	signOut(): Promise<void>;
	/** The app's own items, between the settings and Sign out. */
	children?(close: () => void): ReactNode;
};

/** The same account menu in every app: tenants, language, theme, the app's own items, and one Sign out. */
export function AccountMenu({ name, tenant, tenants, onSwitch, signOut, children }: AccountMenuProps) {
	const { t, describe } = useI18n();
	const { toast } = useFeedback();
	const theme = useTheme();
	const [busy, setBusy] = useState(false);
	const tenantName = tenants.find((option) => option.id === tenant)?.name ?? tenant;
	return (
		<Menu
			label={t("Account")}
			triggerClass="account"
			panelClass="account-menu"
			trigger={
				<>
					<Avatar name={name} size={32} />
					<span className="account-text">
						<span className="who">{name}</span>
						<span className="quiet">{tenantName}</span>
					</span>
					<ChevronsUpDown size={15} aria-hidden="true" />
				</>
			}
		>
			{(close) => (
				<>
					{tenants.length > 1 && (
						<>
							{tenants.map((option) => (
								<button key={option.id} type="button" aria-current={option.id === tenant ? "true" : undefined} onClick={() => (option.id === tenant ? close() : onSwitch(option.id))}>
									{option.id === tenant ? <Check size={15} aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}
									{option.name}
								</button>
							))}
							<hr />
						</>
					)}
					<div className="menu-field">
						<span>{t("Language")}</span>
						<LanguageSwitch />
					</div>
					<div className="menu-field">
						<span>{t("Theme")}</span>
						<Segmented<Theme>
							label={t("Theme")}
							value={theme}
							options={[
								{ value: "system", label: t("System") },
								{ value: "light", label: t("Light") },
								{ value: "dark", label: t("Dark") },
							]}
							onChange={setTheme}
						/>
					</div>
					<hr />
					{children?.(close)}
					<button
						type="button"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							try {
								await signOut();
							} catch (error) {
								toast(describe(error instanceof Error ? error : new Error(String(error))));
								setBusy(false);
							}
						}}
					>
						<LogOut size={15} aria-hidden="true" />
						{t(busy ? "Signing out…" : "Sign out")}
					</button>
				</>
			)}
		</Menu>
	);
}

type FrameProps = {
	/** The rail, given how to close the phone drawer and how to hide the rail. */
	rail(controls: { open: boolean; close(): void; collapse(): void }): ReactNode;
	/** Any change here closes the phone drawer, such as the page's path. */
	place: string;
	children: ReactNode;
};

/** The rail and the page, the same in every app: a hideable rail on a wide screen, a drawer on a phone. */
export function Frame({ rail, place, children }: FrameProps) {
	const { t } = useI18n();
	const mobile = useMedia("(max-width: 600px)");
	const [drawer, setDrawer] = useState(false);
	const [collapsed, setCollapsed] = useState(load("sidebar") === "hidden");
	const menuButton = useRef<HTMLButtonElement>(null);
	useEffect(() => setDrawer(false), [place, mobile]);
	const hide = (hidden: boolean) => {
		setCollapsed(hidden);
		save("sidebar", hidden ? "hidden" : undefined);
	};
	const close = () => setDrawer(false);
	return (
		<div className={collapsed ? "shell collapsed" : "shell"}>
			<button
				type="button"
				ref={menuButton}
				className="drawer-toggle icon-button"
				aria-label={t("Menu")}
				aria-expanded={drawer}
				onClick={() => {
					hide(false);
					setDrawer(!drawer);
				}}
			>
				<PanelLeftOpen size={18} aria-hidden="true" />
			</button>
			{mobile
				? drawer && (
						<Dialog label={t("Menu")} onClose={close} className="sidebar-dialog" backdropClassName="sidebar-backdrop">
							{rail({ open: true, close, collapse: close })}
						</Dialog>
					)
				: rail({ open: false, close, collapse: () => hide(true) })}
			<main className="content">{children}</main>
		</div>
	);
}

/** Puts focus back on the drawer button, for a dialog opened from the drawer that has closed it. */
export function focusMenuButton(): void {
	requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".drawer-toggle")?.focus());
}
