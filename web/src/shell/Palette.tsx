import { Home as HomeIcon, Languages, type LucideIcon, MessageSquare, MessageSquarePlus, Moon, Search, Settings as SettingsIcon, Sun } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../lib/ui.tsx";
import { useI18n } from "../lib/i18n.tsx";
import { useModules } from "../modules/index.tsx";
import { setTheme, useTheme } from "./theme.ts";
import { useSessions, useWorkspace } from "./workspace.ts";

const MAX_CONVERSATIONS = 8;
/** With nothing typed, few enough that the actions show too. */
const RECENT_CONVERSATIONS = 4;

type Entry = { key: string; label: string; icon: LucideIcon; hint?: string; run(): void };

/** One place to jump anywhere, from the keyboard or a tap on Search. */
export function Palette({ onClose }: { onClose(): void }) {
	const { t, ago, language, setLanguage } = useI18n();
	const { path } = useWorkspace();
	const modules = useModules();
	const navigate = useNavigate();
	const theme = useTheme();
	const sessions = useSessions();
	const list = useRef<HTMLUListElement>(null);
	const [query, setQuery] = useState("");
	const [at, setAt] = useState(0);

	const entries = useMemo<Entry[]>(() => {
		const go = (to: string) => () => navigate(path(to));
		const dark = document.documentElement.dataset.theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
		const actions: Entry[] = [
			{ key: "new", label: t("New conversation"), icon: MessageSquarePlus, run: go("") },
			{ key: "home", label: t("Home"), icon: HomeIcon, run: go("") },
			...modules.flatMap((module) => module.nav.map((entry) => ({ key: entry.key, label: t(entry.label), icon: entry.icon, run: go(entry.to) }))),
			{ key: "settings", label: t("Settings"), icon: SettingsIcon, run: go("settings") },
			{ key: "theme", label: t(dark ? "Switch to light theme" : "Switch to dark theme"), icon: dark ? Sun : Moon, run: () => setTheme(dark ? "light" : "dark") },
			{ key: "language", label: language === "zh" ? "Switch to English" : "切换到简体中文", icon: Languages, run: () => setLanguage(language === "zh" ? "en" : "zh") },
		];
		const conversations: Entry[] = [...(sessions.data ?? [])]
			.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
			.map((session) => ({ key: session.sessionId, label: session.metadata?.title ?? t("New conversation"), icon: MessageSquare, hint: ago(session.lastActiveAt), run: go(`c/${session.sessionId}`) }));
		const needle = query.trim().toLowerCase();
		const matches = (entry: Entry) => entry.label.toLowerCase().includes(needle);
		return [...conversations.filter(matches).slice(0, needle === "" ? RECENT_CONVERSATIONS : MAX_CONVERSATIONS), ...actions.filter(matches)];
	}, [ago, language, modules, navigate, path, query, sessions.data, setLanguage, t, theme]);

	useEffect(() => setAt(0), [query]);
	useEffect(() => {
		list.current?.children[at]?.scrollIntoView({ block: "nearest" });
	}, [at]);

	const choose = (entry: Entry | undefined) => {
		if (entry === undefined) return;
		onClose();
		entry.run();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (entries.length === 0) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setAt((at + step + entries.length) % entries.length);
		}
		// Enter also confirms an IME's candidate.
		if (event.key === "Enter" && !event.nativeEvent.isComposing) choose(entries[at]);
	};

	return (
		<Dialog label={t("Search")} onClose={onClose} className="palette" backdropClassName="palette-backdrop">
				<div className="palette-input">
					<Search size={17} aria-hidden="true" />
					<input
						role="combobox"
						aria-expanded="true"
						aria-controls="palette-list"
						aria-activedescendant={entries[at] === undefined ? undefined : `palette-${at}`}
						value={query}
						placeholder={t("Search conversations and actions")}
						aria-label={t("Search conversations")}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onKeyDown}
					/>
					<kbd>Esc</kbd>
				</div>
				<p className="quiet search-scope">{t("Searches open conversation titles and actions.")}</p>
				<ul id="palette-list" ref={list} role="listbox" aria-label={t("Results")}>
					{entries.map((entry, index) => (
						<li key={entry.key} id={`palette-${index}`} role="option" aria-selected={index === at} className={index === at ? "active" : ""} onMouseMove={() => setAt(index)} onClick={() => choose(entry)}>
							<entry.icon size={16} aria-hidden="true" />
							<span className="palette-label">{entry.label}</span>
							{entry.hint !== undefined && <span className="quiet">{entry.hint}</span>}
						</li>
					))}
					{entries.length === 0 && <li className="palette-none">{t("Nothing found.")}</li>}
				</ul>
		</Dialog>
	);
}
