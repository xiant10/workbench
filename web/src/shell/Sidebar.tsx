import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ChevronRight, Home as HomeIcon, LogOut, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings as SettingsIcon, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { postJSON, rpc } from "../lib/api.ts";
import type { SessionInfo } from "../lib/agent.ts";
import { signOut } from "../kit/session.ts";
import { useI18n } from "../lib/i18n.tsx";
import { SearchButton } from "../kit/command.tsx";
import { AccountMenu, CONSOLE_APP, Rail, type RailApp, WORKBENCH_APP } from "../kit/frame.tsx";
import { WorkbenchBell } from "./Bell.tsx";
import { Logo, Menu, Skeleton, useFeedback } from "../lib/ui.tsx";
import { type AppConversation, appHref, conversationsQuery } from "../modules/fromManifest.tsx";
import { useModuleNav } from "../modules/index.tsx";
import type { Icon, WorkbenchModule } from "../modules/types.ts";
import { useNotifications } from "../modules/useNotifications.ts";
import { LoadMore } from "../lib/paged.tsx";
import { displayName, useRefreshSessions, useSessions, useWorkspace } from "./workspace.ts";

function UnreadBadge({ module }: { module: WorkbenchModule }) {
	const { items } = useNotifications(module);
	return items.length > 0 ? <span className="badge">{items.length}</span> : null;
}

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

export function SignOutButton({ className = "", icon = false }: { className?: string; icon?: boolean }) {
 const { t, describe } = useI18n();
 const { toast } = useFeedback();
 const [busy, setBusy] = useState(false);
 return <button type="button" className={className} disabled={busy} onClick={async () => {
  setBusy(true);
  try { await signOut(); } catch (error) { toast(describe(error instanceof Error ? error : new Error(String(error)))); setBusy(false); }
 }}>
  {icon && <LogOut size={15} aria-hidden="true" />}
  {t(busy ? "Signing out…" : "Sign out")}
 </button>;
}

/** A conversation in the list: one of Workbench's own, or one in another app, which opens there. */
type Listed = { kind: "session"; session: SessionInfo; at: number } | { kind: "app"; conversation: AppConversation; app: { id: string; label: string; href: string; icon: Icon }; at: number };

/** Recent conversations by age, newest first. Groups with nothing in them are dropped. */
function byAge(sessions: Listed[]): { label: string; sessions: Listed[] }[] {
	const midnight = new Date().setHours(0, 0, 0, 0);
	const groups = [
		{ label: "Today", since: midnight },
		{ label: "Yesterday", since: midnight - DAY_MS },
		{ label: "Previous 7 days", since: midnight - WEEK_DAYS * DAY_MS },
		{ label: "Older", since: 0 },
	];
	const sorted = [...sessions].sort((a, b) => b.at - a.at);
	return groups
		.map((group, index) => ({
			label: group.label,
			sessions: sorted.filter((session) => session.at >= group.since && session.at < (groups[index - 1]?.since ?? Infinity)),
		}))
		.filter((group) => group.sessions.length > 0);
}

/** A conversation in another app. Only that app shows what was said, so the row says where it is. */
function AppRow({ conversation, app, at }: Extract<Listed, { kind: "app" }>) {
	const { t, ago } = useI18n();
	const { tenant } = useWorkspace();
	return (
		<li className="session">
			<a className="app-conversation" href={appHref(app.href, tenant, conversation.to)} data-testid={`conversation-${app.id}`}>
				<app.icon size={14} aria-hidden="true" />
				<span className="session-title">{conversation.title ?? t("Conversation in {app}", { app: app.label })}</span>
				<span className="session-when">{ago(at)}</span>
			</a>
		</li>
	);
}

/** Every app's conversations that list them, beside Workbench's own. */
function useAppConversations(): Listed[] {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const apps = useModuleNav().filter(({ entry, available }) => available && entry.href !== undefined && entry.conversations === true);
	const lists = useQueries({ queries: apps.map(({ module }) => conversationsQuery(module.id, tenant)) });
	return apps.flatMap(({ module, entry }, index) =>
		(lists[index]?.data ?? []).map((conversation) => ({ kind: "app" as const, conversation, app: { id: module.id, label: t(entry.label), href: entry.href ?? "", icon: entry.icon }, at: Date.parse(conversation.last_used_at) })),
	);
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

/** The shared account menu, with Workbench's settings as its only item of its own. */
function Account() {
	const { t } = useI18n();
	const { me, tenant, config, path } = useWorkspace();
	const client = useQueryClient();
	const switchTenant = async (next: string) => {
		await postJSON("/auth/tenant", { tenant: next });
		client.clear();
		window.location.assign(`/t/${next}/`);
	};
	return (
		<AccountMenu name={displayName(me)} tenant={tenant} tenants={me.tenants} onSwitch={(next) => void switchTenant(next)} signOut={signOut} accountUrl={config.account_url}>
			{(close) => (
				<Link to={path("settings")} onClick={close}>
					<SettingsIcon size={15} aria-hidden="true" />
					{t("Workbench settings")}
				</Link>
			)}
		</AccountMenu>
	);
}

type Props = { open: boolean; onClose(): void; onCollapse(): void; onSearch(): void };

/** Workbench in the shared rail: its own sections and conversations, and every app this person has, from manifests. */
export function Sidebar({ open, onClose, onCollapse, onSearch }: Props) {
	const { t } = useI18n();
	const { path, isAdmin, tenant, config } = useWorkspace();
	const [showArchived, setShowArchived] = useState(false);
	const sessions = useSessions();
	const archived = useSessions(true);
	const nav = useModuleNav();

	const all = sessions.data ?? [];
	const pinned = all.filter((session) => session.metadata?.pinned === true);
	const elsewhere = useAppConversations();
	const recent = byAge([...all.filter((session) => session.metadata?.pinned !== true).map((session) => ({ kind: "session" as const, session, at: session.lastActiveAt })), ...elsewhere]);
	const rows = (list: (SessionInfo | Listed)[]) => (
		<ul>
			{list.map((item) => {
				if (!("kind" in item)) return <Row key={item.sessionId} session={item} onDone={onClose} />;
				if (item.kind === "session") return <Row key={item.session.sessionId} session={item.session} onDone={onClose} />;
				return <AppRow key={`${item.app.id}:${item.conversation.id}`} {...item} />;
			})}
		</ul>
	);
	// A module with its own app is a place of its own, listed with Workbench, not one of Workbench's sections.
	const apps: RailApp[] = [
		{ id: WORKBENCH_APP, label: t("Workbench"), href: path() },
		...nav.flatMap(({ module, entry, available }) => entry.href === undefined ? [] : [{
			id: module.id,
			label: t(entry.label),
			href: appHref(entry.href, tenant),
			icon: entry.icon,
			unavailable: !available,
			badge: available && entry.unread === true ? <UnreadBadge module={module} /> : undefined,
			...(entry.Sections === undefined ? {} : { Sections: entry.Sections }),
		}]),
		...(config.console_url === undefined ? [] : [{ id: CONSOLE_APP, label: t("Platform console"), href: config.console_url }]),
	];

	return (
		<Rail
			open={open}
			onCollapse={() => {
				onClose();
				onCollapse();
			}}
			current={{
				id: WORKBENCH_APP,
				label: t("Workbench"),
				home: (
					<Link to={path()} className="brand-link" onClick={onClose}>
						<Logo size={26} />
						<span>{t("Workbench")}</span>
					</Link>
				),
			}}
			bell={<WorkbenchBell />}
			top={
				<>
					<Link className="button primary wide" to={path()} onClick={onClose}>
						<Plus size={16} aria-hidden="true" />
						{t("New conversation")}
					</Link>
					<SearchButton onClick={onSearch} />
				</>
			}
			sections={
				<>
					<NavLink className="nav-link" to={path()} end onClick={onClose}>
						<HomeIcon size={16} aria-hidden="true" />
						{t("Home")}
					</NavLink>
					{nav.map(({ module, entry, available }) => entry.href === undefined && (
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
				</>
			}
			apps={apps}
			account={<Account />}
		>
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
			{sessions.isSuccess && all.length === 0 && elsewhere.length === 0 && <p className="sidebar-hint">{t("Your conversations will appear here.")}</p>}
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
		</Rail>
	);
}
