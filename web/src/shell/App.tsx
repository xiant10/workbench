import { useQuery } from "@tanstack/react-query";
import { CircleAlert, LockKeyhole, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ConversationPage } from "../conversation/ConversationPage.tsx";
import { ApiError, onSignedOut, postJSON, request } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { load, save } from "../lib/storage.ts";
import { Empty, LanguageSwitch, Logo } from "../lib/ui.tsx";
import { moduleRoutes } from "../modules/index.ts";
import { Home } from "./Home.tsx";
import { Palette } from "./Palette.tsx";
import { Settings } from "./Settings.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { type AppConfig, type Me, type Workspace, WorkspaceContext } from "./workspace.ts";

const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => request<Me>("/api/me"), retry: false });

function login(next: string): void {
	window.location.assign(`/auth/login?next=${encodeURIComponent(next)}`);
}

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

function Root() {
	const me = useMe();
	const location = useLocation();
	useEffect(() => {
		if (me.error instanceof ApiError && me.error.status === 401) login(location.pathname);
	}, [me.error, location.pathname]);
	if (me.data !== undefined) return <Navigate to={`/t/${me.data.active_tenant}/`} replace />;
	return <Splash />;
}

function SignedOutPage() {
	const { t } = useI18n();
	const [params] = useSearchParams();
	const account = load("account_url");
	const message = { mfa: "That tenant requires a second factor. Set one up, then sign in again.", no_access: "You don't have access to that tenant.", failed: "Sign-in didn't finish. Try again." }[params.get("reason") ?? ""];
	return (
		<CenterCard>
			<p>{t(message ?? "You're signed out.")}</p>
			<a className="button primary wide" href="/auth/login">
				{t("Sign in")}
			</a>
			{account !== undefined && (
				<div className="center-note">
					<p className="quiet">{t("You're still signed in to t10 on this browser, so Sign in won't ask for a password. On a shared computer, sign out there too.")}</p>
					<a href={account}>{t("Sign out of t10")}</a>
				</div>
			)}
		</CenterCard>
	);
}

/** The code flow can't say which tenant a person in several wants, and their list needs a token. */
function ChooseTenantPage() {
	const { t } = useI18n();
	const [params] = useSearchParams();
	const [tenant, setTenant] = useState("");
	return (
		<CenterCard>
			<h1>{t("Which tenant?")}</h1>
			<p className="quiet">{t("You belong to several tenants. Enter the ID of the one to open, such as ten_acme.")}</p>
			{/* Script, not a form action: form-action would also apply to the redirect to the auth service. */}
			<form
				className="add-row"
				onSubmit={(event) => {
					event.preventDefault();
					const query = new URLSearchParams({ next: params.get("next") ?? "/", tenant });
					window.location.assign(`/auth/login?${query}`);
				}}
			>
				<input required value={tenant} aria-label={t("Tenant")} onChange={(event) => setTenant(event.target.value)} />
				<button type="submit" className="primary">
					{t("Continue")}
				</button>
			</form>
		</CenterCard>
	);
}

function Shell() {
	const { t } = useI18n();
	const { tenant = "" } = useParams();
	const location = useLocation();
	const me = useMe();
	const config = useQuery({ queryKey: ["config"], queryFn: () => request<AppConfig>("/api/config"), retry: false, staleTime: Infinity });
	const [signedOut, setSignedOut] = useState(false);
	const [drawer, setDrawer] = useState(false);
	const [denied, setDenied] = useState(false);
	const [collapsed, setCollapsed] = useState(load("sidebar") === "hidden");
	const [searching, setSearching] = useState(false);
	useEffect(() => onSignedOut(() => setSignedOut(true)), []);
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
		if (me.error instanceof ApiError && me.error.status === 401) login(location.pathname + location.search);
	}, [me.error]); // eslint-disable-line react-hooks/exhaustive-deps

	const workspace = useMemo<Workspace | undefined>(() => {
		if (me.data === undefined || config.data === undefined || active !== tenant) return undefined;
		const agent = config.data.agents[0] ?? "";
		return {
			me: me.data,
			config: config.data,
			tenant,
			agent,
			profile: config.data.profiles[0] ?? "chat",
			isAdmin: me.data.tenants.find((item) => item.id === tenant)?.role === "admin",
			signedOut,
			path: (rest = "") => `/t/${tenant}/${rest}`,
		};
	}, [me.data, config.data, active, tenant, signedOut]);

	if (denied) {
		return (
			<main className="center-page">
				<Empty icon={LockKeyhole} title={t("You don't have access to that tenant.")}>
					<a className="button primary" href="/">
						{t("Home")}
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
	if (workspace === undefined) return <Splash />;
	const hide = (hidden: boolean) => {
		setCollapsed(hidden);
		save("sidebar", hidden ? "hidden" : undefined);
	};
	return (
		<WorkspaceContext.Provider value={workspace}>
			<div className={collapsed ? "shell collapsed" : "shell"}>
				<button
					type="button"
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
				{drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)} />}
				<Sidebar open={drawer} onClose={() => setDrawer(false)} onCollapse={() => hide(window.innerWidth > 600)} onSearch={() => setSearching(true)} />
				<main className="content">
					{signedOut && (
						<div className="banner" role="alert">
							{t("You've been signed out. What you typed is kept.")}{" "}
							<button type="button" className="link" onClick={() => login(location.pathname)}>
								{t("Sign in again")}
							</button>
						</div>
					)}
					<Outlet />
				</main>
				{searching && <Palette onClose={() => setSearching(false)} />}
			</div>
		</WorkspaceContext.Provider>
	);
}

export function App() {
	return (
		<Routes>
			<Route path="/" element={<Root />} />
			<Route path="/signed-out" element={<SignedOutPage />} />
			<Route path="/choose-tenant" element={<ChooseTenantPage />} />
			<Route path="/t/:tenant" element={<Shell />}>
				<Route index element={<Home />} />
				<Route path="c/:sessionId" element={<ConversationPage />} />
				{moduleRoutes.map(({ path, element }) => (
					<Route key={path} path={path} element={element} />
				))}
				<Route path="settings" element={<Settings />} />
			</Route>
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}
