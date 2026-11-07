import { ArrowRight, ArrowUpRight, Building2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { Avatar, CopyButton } from "../lib/ui.tsx";
import { AccountNav } from "./AccountNav.tsx";
import { displayName, useWorkspace } from "./workspace.ts";

export function Profile() {
	const { t } = useI18n();
	const { me, tenant, config, path, isAdmin } = useWorkspace();
	const name = displayName(me);
	const workspace = me.tenants.find(item => item.id === tenant);
	return <div className="page account-page profile-page">
		<header className="page-head">
			<div><h1>{t("Profile")}</h1><p className="quiet">{t("Your personal information and workspace membership.")}</p></div>
		</header>
		<AccountNav />
		<section className="profile-identity" aria-labelledby="profile-name">
			<Avatar name={name} size={64} />
			<div><span className="profile-eyebrow">{t("Your t10 account")}</span><h2 id="profile-name" title={name}>{name}</h2><p className="quiet">{t("One profile across your t10 apps.")}</p></div>
		</section>
		<div className="profile-grid">
			<div className="profile-main">
				<section className="card profile-card" aria-labelledby="personal-heading">
					<header className="profile-card-head">
						<div><h2 id="personal-heading">{t("Personal information")}</h2><p>{t("How you appear to people you work with.")}</p></div>
						<a className="button primary" href={config.account_url}>{t("Edit profile")}<ArrowUpRight size={14} aria-hidden="true" /></a>
					</header>
					<dl className="profile-details">
						<div><dt>{t("Display name")}</dt><dd>{me.display_name || <span className="quiet">{t("Not set")}</span>}</dd></div>
						<div><dt>{t("Sign-in name")}</dt><dd>{me.sign_in_name || <span className="quiet">{t("Not available")}</span>}</dd></div>
						<div><dt>{t("User ID")}</dt><dd className="profile-copy"><code>{me.user_id}</code><CopyButton text={me.user_id} label={t("Copy user ID")} /></dd></div>
					</dl>
					<p className="profile-note">{t("Editing opens your t10 account. Changes apply across your apps.")}</p>
				</section>
				<section className="card profile-card" aria-labelledby="workspace-heading">
					<header className="profile-card-head"><div><h2 id="workspace-heading">{t("Workspace")}</h2><p>{t("Your access in the workspace you are using.")}</p></div></header>
					<div className="profile-workspace"><span className="profile-icon"><Building2 size={20} aria-hidden="true" /></span><div><strong>{workspace?.name ?? tenant}</strong><span className="quiet">{t("Current workspace")}</span></div><span className="profile-role">{t(isAdmin ? "Admin" : "Member")}</span></div>
					<p className="profile-note">{t("Workspace roles are managed by your administrator.")}</p>
				</section>
			</div>
			<aside className="profile-side" aria-label={t("Account controls")}>
				<section className="card profile-card" aria-labelledby="security-heading">
					<span className="profile-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
					<h2 id="security-heading">{t("Account security")}</h2>
					<p className="quiet">{t("Manage your password, second factor and signed-in devices in your t10 account.")}</p>
					<a className="button ghost" href={config.account_url}>{t("Manage security")}<ArrowUpRight size={14} aria-hidden="true" /></a>
				</section>
				<section className="card profile-card" aria-labelledby="preferences-heading">
					<span className="profile-icon"><SlidersHorizontal size={20} aria-hidden="true" /></span>
					<h2 id="preferences-heading">{t("Preferences")}</h2>
					<p className="quiet">{t("Make Workbench feel right for you with appearance, language and notifications.")}</p>
					<Link className="button ghost" to={path("settings")}>{t("Customize Workbench")}<ArrowRight size={14} aria-hidden="true" /></Link>
				</section>
			</aside>
		</div>
	</div>;
}
