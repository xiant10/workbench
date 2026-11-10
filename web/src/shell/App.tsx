import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LockKeyhole } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import { AdminPage } from "../admin/AdminPage.tsx";
import { ConversationPage } from "../conversation/ConversationPage.tsx";
import { listAgents } from "../lib/agent.ts";
import { keepDraftsFor, signIn, watchSession } from "../kit/session.ts";
import { useSavedPreferences } from "../kit/preferences.ts";
import { ApiError, onModuleGone, onSignedOut, postJSON, request } from "../lib/api.ts";
import { useMedia } from "../lib/layout.ts";
import { useI18n } from "../lib/i18n.tsx";
import { load, save } from "../lib/storage.ts";
import { focusMenuButton, Frame } from "../kit/frame.tsx";
import { Empty, LanguageSwitch, Logo } from "../lib/ui.tsx";
import { ModuleRedirect, moduleRoutes } from "../modules/index.tsx";
import { Home } from "./Home.tsx";
import { Palette } from "./Palette.tsx";
import "./shell.css";
import { Settings } from "./Settings.tsx";
import { WorkbenchBell } from "./Bell.tsx";
import { Sidebar, SignOutButton } from "./Sidebar.tsx";
import { configQuery, type Me, type Workspace, WorkspaceContext, useWorkspace } from "./workspace.ts";

/** Drafts belong to whoever wrote them, so another person signing in here starts clean. */
const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => request<Me>("/api/me").then((me) => { keepDraftsFor(me.user_id); return me; }), retry: false });

function Splash() {
	return (
		<div className="splash">
			<Logo size={44} />
		</div>
	);
}

/** Pages shown outside a tenant, including to someone with no session, so language is chosen here too. */
function CenterCard({ children }: { children: ReactNode }) {
	const { t } = useI18n();
	return (
		<main className="center-page">
			<div className="center-card">
				<div className="center-brand">
					<Logo size={44} />
					<span>{t("Workbench")}</span>
				</div>
				{children}
			</div>
			<LanguageSwitch />
		</main>
	);
}

function LoadError({ retry }: { retry(): void }) {
	const { t } = useI18n();
	return <CenterCard><Empty icon={CircleAlert} title={t("Couldn't load this. Try again.")}>
		<button type="button" className="primary" onClick={retry}>{t("Retry")}</button>
	</Empty></CenterCard>;
}

function Root({ page = "" }: { page?: string }) {
	const me = useMe();
	const location = useLocation();
	useEffect(() => {
		if (me.error instanceof ApiError && me.error.status === 401) signIn(location.pathname);
	}, [me.error, location.pathname]);
	if (me.isError && !(me.error instanceof ApiError && me.error.status === 401)) return <LoadError retry={() => void me.refetch()} />;
	if (me.data?.active_tenant === "") return <NoTenantPage />;
	if (me.data !== undefined) return <Navigate to={`/t/${me.data.active_tenant}/${page}`} replace />;
	return <Splash />;
}

/** Everything here happens in a tenant, and an account can belong to none, such as a platform admin's. */
function NoTenantPage() {
	const { t } = useI18n();
	const config = useQuery(configQuery);
	return (
		<CenterCard>
			<p>{t(config.data?.console_url === undefined ? "Your account isn't in any tenant yet. Ask a tenant admin for an invitation link." : "You run the platform and aren't in a tenant. Open the platform console.")}</p>
			{config.data?.console_url !== undefined && (
				<a className="button primary wide" href={config.data.console_url}>
					{t("Open the platform console")}
				</a>
			)}
			{config.data !== undefined && (
				<SignOutButton className="ghost wide" />
			)}
		</CenterCard>
	);
}

/** A sign-in that was refused, or a sign-out that couldn't finish. A sign-out that did
 * finish goes straight to the sign-in page, which says so. */
function SignedOutPage() {
	const { t } = useI18n();
	const [params] = useSearchParams();
	const reason = params.get("reason") ?? "";
	const message = {
		mfa: "That workspace requires a second factor. Set one up, then sign in again.",
		no_access: "You don't have access to that workspace.",
		failed: "Sign-in didn't finish. Try again.",
		incomplete: "You've signed out of Workbench, but t10's sign-in service didn't answer, so your other apps may still be signed in. Try again in a moment.",
	}[reason];
	return (
		<CenterCard>
			<p>{t(message ?? "You're signed out.")}</p>
			{reason === "incomplete" ? (
				<a className="button primary wide" href="/auth/leave">{t("Finish signing out")}</a>
			) : (
				<button type="button" className="primary wide" onClick={() => signIn("/")}>{t("Sign in")}</button>
			)}
			{reason === "mfa" && <a className="button ghost wide" href="/auth/account">{t("Set up a second factor")}</a>}
			{reason === "no_access" && <a className="button ghost wide" href="/auth/leave">{t("Use a different account")}</a>}
		</CenterCard>
	);
}

function Shell() {
	const { t } = useI18n();
	const { tenant = "" } = useParams();
	const location = useLocation();
	const me = useMe();
	const config = useQuery(configQuery);
	const [signedOut, setSignedOut] = useState(false);
	const mobile = useMedia("(max-width: 600px)");
	const [denied, setDenied] = useState(false);
	const [searching, setSearching] = useState(false);
	useEffect(() => onSignedOut(() => setSignedOut(true)), []);
	useEffect(watchSession, []);
	const client = useQueryClient();
	useEffect(() => onModuleGone(() => void client.invalidateQueries({ queryKey: configQuery.queryKey })), [client]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearching((open) => !open);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	// A link opened in another tenant switches after checking membership, instead of showing a false "gone".
	const active = me.data?.active_tenant;
	useEffect(() => {
		if (active === undefined || active === tenant) return;
		postJSON("/auth/tenant", { tenant }).then(
			() => window.location.reload(),
			() => setDenied(true),
		);
	}, [active, tenant]);
	useEffect(() => {
		if (me.error instanceof ApiError && me.error.status === 401) signIn(location.pathname + location.search);
	}, [me.error]); // eslint-disable-line react-hooks/exhaustive-deps

	const agentList = useQuery({
		queryKey: ["agents", tenant],
		queryFn: () => listAgents(config.data?.agents ?? []),
		enabled: config.data !== undefined && active === tenant,
		retry: false,
	});
	const [picked, setPicked] = useState(() => load(`agent:${tenant}`));

	const workspace = useMemo<Workspace | undefined>(() => {
		if (me.data === undefined || config.data === undefined || active !== tenant) return undefined;
		if (agentList.isPending) return undefined;
		const agents = agentList.data?.agents ?? [];
		const agent = agents.some((option) => option.name === picked) ? (picked as string) : (agentList.data?.defaultAgent ?? agents[0]?.name ?? config.data.agents[0] ?? "");
		return {
			me: me.data,
			config: config.data,
			tenant,
			agent,
			agents,
			setAgent: (next) => {
				save(`agent:${tenant}`, next);
				setPicked(next);
			},
			profile: config.data.profiles[0] ?? "chat",
			isAdmin: me.data.tenants.find((item) => item.id === tenant)?.role === "admin",
			signedOut,
			path: (rest = "") => `/t/${tenant}/${rest}`,
		};
	}, [me.data, config.data, active, tenant, signedOut, agentList.isPending, agentList.data, picked]);

	if (denied) {
		return (
			<main className="center-page">
				<Empty icon={LockKeyhole} title={t("You don't have access to that workspace.")}>
					<a className="button primary" href="/">
						{t("Home")}
					</a>
					<a className="button ghost" href="/auth/leave">
						{t("Use a different account")}
					</a>
				</Empty>
			</main>
		);
	}
	if (me.isError && !(me.error instanceof ApiError && me.error.status === 401)) {
		return (
			<main className="center-page">
				<Empty icon={CircleAlert} title={t("Couldn't load this. Try again.")}>
					<button type="button" className="ghost" onClick={() => void me.refetch()}>
						{t("Retry")}
					</button>
				</Empty>
			</main>
		);
	}
	if (config.isError && config.data === undefined) return <LoadError retry={() => void config.refetch()} />;
	if (workspace === undefined) return <Splash />;
	return (
		<WorkspaceContext.Provider value={workspace}>
			<SavedPreferences />
			<Frame
				place={location.pathname}
				title={t("Workbench")}
				bell={<WorkbenchBell />}
				rail={({ open, close, collapse }) => <Sidebar open={open} onClose={close} onCollapse={collapse} onSearch={() => { close(); setSearching(true); }} />}
			>
				{signedOut && (
					<div className="banner" role="alert">
						{t("You've been signed out. What you typed is kept.")}{" "}
						<button type="button" className="link" onClick={() => signIn(location.pathname, "ended")}>
							{t("Sign in again")}
						</button>
					</div>
				)}
				<Outlet />
			</Frame>
			{searching && <Palette onClose={() => { setSearching(false); if (mobile) focusMenuButton(); }} />}
		</WorkspaceContext.Provider>
	);
}

export function App() {
	return (
		<Routes>
			<Route path="/" element={<Root />} />
			<Route path="/signed-out" element={<SignedOutPage />} />
			<Route path="/t/:tenant" element={<Shell />}>
				<Route index element={<Home />} />
				<Route path="c/:sessionId" element={<ConversationPage />} />
				{moduleRoutes.map(({ path, element }) => (
					<Route key={path} path={path} element={element} />
				))}
				{/* The Workflows page became Skills, with each skill's workflow on its own tab. */}
				<Route path="workflows" element={<Navigate to="../skills" replace />} />
				<Route path=":module/*" element={<ModuleRedirect />} />
				{/* Profile became the account page, which every app shares. */}
				<Route path="profile" element={<ToAccount />} />
				<Route path="settings" element={<Settings />} />
				<Route path="admin" element={<AdminPage />} />
			</Route>
			{/* The auth service's /admin sends tenant admins here, before it knows the tenant. */}
			<Route path="/admin" element={<Root page="admin" />} />
			<Route path="/workflows" element={<Root page="skills" />} />
			<Route path="/skills" element={<Root page="skills" />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}

/** An old link to Workbench's profile: who a person is lives on the account page now. */
function ToAccount() {
	const { config } = useWorkspace();
	useEffect(() => window.location.replace(config.account_url), [config.account_url]);
	return null;
}

/** Language and theme as the person saved them, in every app. Only once signed in. */
function SavedPreferences() {
	useSavedPreferences();
	return null;
}
