import { AppWindow, Building2, Check, ChevronsUpDown, LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
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
export type RailApp = { id: string; label: string; href: string; icon?: Icon; badge?: ReactNode; unavailable?: boolean };

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
export function Rail({ current, top, sections, apps, children, account, open = false, onCollapse }: RailProps) {
	const { t } = useI18n();
	return (
		<nav className={open ? "sidebar open" : "sidebar"} aria-label={current.label}>
			<div className="brand">
				{current.home}
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
						return (
							<a key={app.id} className={["nav-link", here ? "active" : "", app.unavailable === true ? "unavailable" : ""].join(" ").trim()} href={app.href} aria-current={here ? "page" : undefined} data-testid={`app-${app.id}`}>
								<AppIcon size={16} aria-hidden="true" />
								{app.label}
								{!here && app.badge}
							</a>
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
