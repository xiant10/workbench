import { ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { load, save } from "../lib/storage.ts";
import { LanguageSwitch, Segmented, Setting } from "../lib/ui.tsx";
import { useModules } from "../modules/index.tsx";
import { SHORTCUT } from "./Sidebar.tsx";
import { setTheme, type Theme, useTheme } from "./theme.ts";
import { useWorkspace } from "./workspace.ts";

export function Settings() {
	const { t } = useI18n();
	const { config, isAdmin, path } = useWorkspace();
	const modules = useModules();
	const theme = useTheme();
	const [notify, setNotify] = useState(load("notify") === "on");
	const blocked = "Notification" in window && window.Notification.permission === "denied";
	return (
		<div className="page settings">
			<header className="page-head">
				<h1>{t("Settings")}</h1>
			</header>
			<section className="card">
				<h2>{t("Appearance")}</h2>
				<Setting title={t("Language")}>
					<LanguageSwitch />
				</Setting>
				<Setting title={t("Theme")}>
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
				</Setting>
			</section>
			{modules.length > 0 && (
				<section className="card">
					<h2>{t("Notifications")}</h2>
					<Setting title={t("Browser notifications")} hint={blocked ? t("Blocked") : t("Tell me about new tasks when this tab is in the background.")}>
						<label className="switch">
							<span className="sr-only">{t("Browser notifications")}</span>
							<input
								type="checkbox"
								role="switch"
								checked={notify}
								disabled={blocked}
								onChange={async (event) => {
									const wanted = event.target.checked;
									if (wanted && (await window.Notification.requestPermission()) !== "granted") return;
									setNotify(wanted);
									save("notify", wanted ? "on" : undefined);
								}}
							/>
							<span aria-hidden="true" />
						</label>
					</Setting>
				</section>
			)}
			{(isAdmin || config.console_url !== undefined) && (
				<section className="card">
					<h2>{t("Administration")}</h2>
					{isAdmin && (
						<Setting title={t("This tenant")} hint={t("People, organization, agents and policies.")}>
							<Link className="button ghost" to={path("admin")}>
								{t("Open")}
								<ChevronRight size={14} aria-hidden="true" />
							</Link>
						</Setting>
					)}
					{config.console_url !== undefined && (
						<Setting title={t("Platform console")} hint={t("Every tenant, the agent fleet and model usage. For platform admins.")}>
							<a className="button ghost" href={config.console_url} target="_blank" rel="noopener noreferrer">
								{t("Open")}
								<ExternalLink size={14} aria-hidden="true" />
							</a>
						</Setting>
					)}
				</section>
			)}
			<section className="card">
				<h2>{t("Account")}</h2>
				<Setting title={t("Account security")} hint={t("Password, second factor and signed-in devices.")}>
					<a className="button ghost" href={config.account_url} target="_blank" rel="noopener noreferrer">
						{t("Open")}
						<ExternalLink size={14} aria-hidden="true" />
					</a>
				</Setting>
			</section>
			<section className="card">
				<h2>{t("Keyboard shortcuts")}</h2>
				<Setting title={t("Search and jump anywhere")}>
					<kbd>{SHORTCUT}</kbd>
				</Setting>
				<Setting title={t("Send")}>
					<kbd>Enter</kbd>
				</Setting>
				<Setting title={t("New line")}>
					<kbd>Shift Enter</kbd>
				</Setting>
			</section>
		</div>
	);
}
