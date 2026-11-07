import { NavLink } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { useWorkspace } from "./workspace.ts";

export function AccountNav() {
	const { t } = useI18n();
	const { path } = useWorkspace();
	return <nav className="account-tabs" aria-label={t("Account")}>
		<NavLink to={path("profile")}>{t("Profile")}</NavLink>
		<NavLink to={path("settings")}>{t("Settings")}</NavLink>
	</nav>;
}
