import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Building2, Check, ChevronRight, ChevronsUpDown, Home as HomeIcon, LogOut, MonitorCog, MoreHorizontal, PanelLeftClose, Pencil, Pin, PinOff, Plus, Search, Settings as SettingsIcon, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { postJSON, rpc } from "../lib/api.ts";
import type { SessionInfo } from "../lib/agent.ts";
import { useI18n } from "../lib/i18n.tsx";
import { save } from "../lib/storage.ts";
import { Avatar, LanguageSwitch, Logo, Menu, Segmented, Skeleton, useFeedback } from "../lib/ui.tsx";
import { appHref } from "../modules/fromManifest.tsx";
import { useModuleNav } from "../modules/index.tsx";
import type { WorkbenchModule } from "../modules/types.ts";
import { useNotifications } from "../modules/useNotifications.ts";
import { setTheme, type Theme, useTheme } from "./theme.ts";
import { LoadMore } from "../lib/paged.tsx";
import { displayName, useRefreshSessions, useSessions, useWorkspace } from "./workspace.ts";

function UnreadBadge({ module }: { module: WorkbenchModule }) {
	const { items } = useNotifications(module);
	return items.length > 0 ? <span className="badge">{items.length}</span> : null;
}

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

export const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

export async function signOut(accountUrl: string): Promise<void> {
	await postJSON("/auth/logout", {});
	// Kept here rather than in the URL, so a crafted link can't put its own address on the page.
	save("account_url", accountUrl);
	window.location.assign("/signed-out");
}

/** Recent conversations by age, newest first. Groups with nothing in them are dropped. */
function byAge(sessions: SessionInfo[]): { label: string; sessions: SessionInfo[] }[] {
	const midnight = new Date().setHours(0, 0, 0, 0);
	const groups = [
		{ label: "Today", since: midnight },
		{ label: "Yesterday", since: midnight - DAY_MS },
		{ label: "Previous 7 days", since: midnight - WEEK_DAYS * DAY_MS },
		{ label: "Older", since: 0 },
	];
	const sorted = [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
	return groups
		.map((group, index) => ({
			label: group.label,
			sessions: sorted.filter((session) => session.lastActiveAt >= group.since && session.lastActiveAt < (groups[index - 1]?.since ?? Infinity)),
		}))
		.filter((group) => group.sessions.length > 0);
}

function Row({ session, onDone }: { session: SessionInfo; onDone(): void }) {
	const { t, describe } = useI18n();
	const { confirm, toast } = useFeedback();
	const { agent, path } = useWorkspace();
	const navigate = useNavigate();
	const refresh = useRefreshSessions();
	const [renaming, setRenaming] = useState(false);
	const title = session.metadata?.title ?? t("New conversation");
	const [name, setName] = useState(title);
	const update = (change: Record<string, unknown>) =>
		rpc(agent, "session.update", change, session.sessionId).then(refresh, (error: Error) => toast(describe(error)));
	const remove = async () => {
		const yes = await confirm({ title: t("Delete this conversation?"), body: t("It can't be opened again."), action: t("Delete"), danger: true });
		if (!yes) return;
		await rpc(agent, "session.close", {}, session.sessionId).then(
			() => {
				refresh();
				navigate(path());
			},
			(error: Error) => toast(describe(error)),
		);
	};
	const archive = async () => {
		const restoring = session.archived === true;
		await update({ archived: !restoring });
		if (!restoring) toast(t("Conversation archived"), { label: t("Undo"), run: () => void update({ archived: false }) });
	};
	if (renaming) {
		return (
			<li className="session">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						setRenaming(false);
						if (name.trim() !== "") void update({ title: name.trim() });
					}}
				>
					<input
						autoFocus
						value={name}
						maxLength={200}
						aria-label={t("Rename")}
						onChange={(event) => setName(event.target.value)}
						onBlur={() => setRenaming(false)}
						onKeyDown={(event) => {
							if (event.key === "Escape") setRenaming(false);
						}}
					/>
				</form>
			</li>
		);
	}
	const pinned = session.metadata?.pinned === true;
	return (
		<li className="session">
			<NavLink to={path(`c/${session.sessionId}`)} onClick={onDone}>
				<span className="session-title">{title}</span>
				{session.busy && <span className="busy-dot" role="img" aria-label={t("Running")} />}
			</NavLink>
			<Menu label={t("Options for {title}", { title })} triggerClass="session-more" trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
				{(close) => {
					const item = (label: string, Icon: typeof Pin, run: () => void, danger = false) => (
						<button
							type="button"
							className={danger ? "menu-danger" : ""}
							onClick={() => {
								close();
								run();
							}}
						>
							<Icon size={15} aria-hidden="true" />
							{t(label)}
						</button>
					);
					return (
						<>
							{item("Rename", Pencil, () => setRenaming(true))}
							{item(pinned ? "Unpin" : "Pin", pinned ? PinOff : Pin, () => void update({ pinned: !pinned }))}
							{item(session.archived === true ? "Restore" : "Archive", session.archived === true ? ArchiveRestore : Archive, () => void archive())}
							{item("Delete", Trash2, () => void remove(), true)}
						</>
					);
				}}
			</Menu>
		</li>
	);
}

function Account() {
	const { t } = useI18n();
	const { me, tenant, config, path, agent, agents, setAgent } = useWorkspace();
	const client = useQueryClient();
	const navigate = useNavigate();
	const theme = useTheme();
	const name = displayName(me);
	const tenantName = me.tenants.find((option) => option.id === tenant)?.name;
	const switchTenant = async (next: string) => {
		await postJSON("/auth/tenant", { tenant: next });
		client.clear();
		window.location.assign(`/t/${next}/`);
	};
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
					{me.tenants.length > 1 && (
						<>
							{me.tenants.map((option) => (
								<button key={option.id} type="button" aria-current={option.id === tenant ? "true" : undefined} onClick={() => (option.id === tenant ? close() : void switchTenant(option.id))}>
									{option.id === tenant ? <Check size={15} aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}
									{option.name}
								</button>
							))}
							<hr />
						</>
					)}
					{agents.length > 1 && (
						<label>
							{t("Agent")}
							<select
								value={agent}
								onChange={(event) => {
									setAgent(event.target.value);
									navigate(path());
									close();
								}}
							>
								{agents.map((option) => (
									<option key={option.name} value={option.name}>
										{option.title ?? option.name}
									</option>
								))}
							</select>
						</label>
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
					<Link to={path("settings")} onClick={close}>
						<SettingsIcon size={15} aria-hidden="true" />
						{t("Settings")}
					</Link>
					{config.console_url !== undefined && (
						<a href={config.console_url} onClick={close}>
							<MonitorCog size={15} aria-hidden="true" />
							{t("Platform console")}
						</a>
					)}
					<a href={config.account_url} onClick={close}>
						<ShieldCheck size={15} aria-hidden="true" />
						{t("Account")}
					</a>
					<button type="button" onClick={() => void signOut(config.account_url)}>
						<LogOut size={15} aria-hidden="true" />
						{t("Sign out of Workbench")}
					</button>
				</>
			)}
		</Menu>
	);
}

type Props = { open: boolean; onClose(): void; onCollapse(): void; onSearch(): void };

export function Sidebar({ open, onClose, onCollapse, onSearch }: Props) {
	const { t } = useI18n();
	const { path, isAdmin } = useWorkspace();
	const [showArchived, setShowArchived] = useState(false);
	const sessions = useSessions();
	const archived = useSessions(true);
	const nav = useModuleNav();
	const { tenant } = useWorkspace();

	const all = sessions.data ?? [];
	const pinned = all.filter((session) => session.metadata?.pinned === true);
	const recent = byAge(all.filter((session) => session.metadata?.pinned !== true));
	const rows = (list: SessionInfo[]) => (
		<ul>
			{list.map((session) => (
				<Row key={session.sessionId} session={session} onDone={onClose} />
			))}
		</ul>
	);

	return (
		<nav className={open ? "sidebar open" : "sidebar"} aria-label={t("Workbench")}>
			<div className="brand">
				<Link to={path()} className="brand-link" onClick={onClose}>
					<Logo size={26} />
					<span>{t("Workbench")}</span>
				</Link>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Hide sidebar")}
					onClick={() => {
						onClose();
						onCollapse();
					}}
				>
					<PanelLeftClose size={17} aria-hidden="true" />
				</button>
			</div>
			<Link className="button primary wide" to={path()} onClick={onClose}>
				<Plus size={16} aria-hidden="true" />
				{t("New conversation")}
			</Link>
			<button type="button" className="search-button" onClick={onSearch}>
				<Search size={15} aria-hidden="true" />
				<span>{t("Search")}</span>
				<kbd>{SHORTCUT}</kbd>
			</button>
			<div className="nav-links">
				<NavLink className="nav-link" to={path()} end onClick={onClose}>
					<HomeIcon size={16} aria-hidden="true" />
					{t("Home")}
				</NavLink>
				{nav.map(({ module, entry, available }) => entry.href !== undefined ? (
					<a key={entry.key} className={available ? "nav-link" : "nav-link unavailable"} href={appHref(entry.href, tenant)} data-testid={`nav-${entry.key}`}>
						<entry.icon size={16} aria-hidden="true" />
						{t(entry.label)}
						{available && entry.unread === true && <UnreadBadge module={module} />}
					</a>
				) : (
					<NavLink key={entry.key} className={available ? "nav-link" : "nav-link unavailable"} to={path(entry.to)} onClick={onClose} data-testid={`nav-${entry.key}`}>
						<entry.icon size={16} aria-hidden="true" />
						{t(entry.label)}
						{available && entry.unread === true && <UnreadBadge module={module} />}
					</NavLink>
				))}
				{isAdmin && (
					<NavLink className="nav-link" to={path("admin")} onClick={onClose}>
						<UsersRound size={16} aria-hidden="true" />
						{t("Administration")}
					</NavLink>
				)}
			</div>
			<div className="session-scroll">
				{sessions.isPending && <Skeleton rows={5} />}
				{pinned.length > 0 && (
					<>
						<h2>{t("Pinned")}</h2>
						{rows(pinned)}
					</>
				)}
				{recent.map((group) => (
					<div key={group.label}>
						<h2>{t(group.label)}</h2>
						{rows(group.sessions)}
					</div>
				))}
				{sessions.isSuccess && all.length === 0 && <p className="sidebar-hint">{t("Your conversations will appear here.")}</p>}
				<LoadMore list={sessions} label="Show older conversations" className="link sidebar-more" />
				{(archived.data?.length ?? 0) > 0 && (
					<>
						<button type="button" className="archive-toggle" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
							<ChevronRight size={14} aria-hidden="true" />
							{t("Archived")} ({archived.data?.length}
							{archived.hasMore ? "+" : ""})
						</button>
						{showArchived && rows(archived.data ?? [])}
						{showArchived && <LoadMore list={archived} label="Show older conversations" className="link sidebar-more" />}
					</>
				)}
			</div>
			<footer className="sidebar-foot">
				<Account />
			</footer>
		</nav>
	);
}
