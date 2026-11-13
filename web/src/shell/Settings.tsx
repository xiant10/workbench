import { useEffect, useState } from "react";
import { request } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { load, save } from "../lib/storage.ts";
import { Setting } from "../lib/ui.tsx";
import { useModules } from "../modules/index.tsx";
import { SHORTCUT } from "../kit/command.tsx";
import { useWorkspace } from "./workspace.ts";

/** Workbench's own preferences. Language, theme and the account are in the account menu, the same in every app. */
export function Settings() {
	const { t } = useI18n();
	const { agent, agents, setAgent } = useWorkspace();
	const modules = useModules();
	const [notify, setNotify] = useState(load("notify") === "on");
	const supported = "Notification" in window;
	const blocked = supported && window.Notification.permission === "denied";
	return (
		<div className="page settings account-page">
			<header className="page-head">
				<h1>{t("Workbench settings")}</h1>
			</header>
			{agents.length > 1 && (
				<section className="card">
					<h2>{t("Agent")}</h2>
					<Setting title={t("Default agent")} hint={t("Where new conversations go, and whose conversations the sidebar lists.")}>
						<select aria-label={t("Agent")} value={agent} onChange={(event) => setAgent(event.target.value)}>
							{agents.map((option) => (
								<option key={option.name} value={option.name}>
									{option.title ?? option.name}
								</option>
							))}
						</select>
					</Setting>
				</section>
			)}
			<section className="card">
				<h2>{t("Calls")}</h2>
				<GreetingSetting />
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
								disabled={!supported || blocked}
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

type Greeting = "personal" | "simple" | "off";

/** How an agent greets you on a call. The auth service keeps it, so it's the same in every app. */
function GreetingSetting() {
	const { t } = useI18n();
	const [greeting, setGreeting] = useState<Greeting>();
	useEffect(() => {
		request<{ greeting?: Greeting }>("/api/preferences").then(
			(saved) => setGreeting(saved.greeting ?? "personal"),
			() => setGreeting("personal"),
		);
	}, []);
	const choose = (next: Greeting) => {
		const before = greeting;
		setGreeting(next);
		void request("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ greeting: next }) }).catch(() => setGreeting(before));
	};
	return (
		<Setting title={t("Greeting on calls")} hint={t("When you start a call, the agent can greet you by name and mention your work, greet you simply, or wait for you to speak.")}>
			<select aria-label={t("Greeting on calls")} value={greeting ?? "personal"} disabled={greeting === undefined} onChange={(event) => choose(event.target.value as Greeting)} data-testid="settings-greeting">
				<option value="personal">{t("By name, with my work")}</option>
				<option value="simple">{t("Simple")}</option>
				<option value="off">{t("No greeting")}</option>
			</select>
		</Setting>
	);
}
