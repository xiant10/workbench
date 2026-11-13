import { useQueries } from "@tanstack/react-query";
import { AudioLines, Home as HomeIcon, Languages, MessageSquare, MessageSquarePlus, Moon, Settings as SettingsIcon, Sun, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Palette as KitPalette, type PaletteEntry } from "../kit/command.tsx";
import { MicrophoneRefused, useCalls } from "../call/CallProvider.tsx";
import { useI18n } from "../lib/i18n.tsx";
import { useFeedback } from "../lib/ui.tsx";
import { appHref, navQuery } from "../modules/fromManifest.tsx";
import { useModuleNav } from "../modules/index.tsx";
import { setTheme, useTheme } from "./theme.ts";
import { useSessions, useWorkspace } from "./workspace.ts";

const MAX_CONVERSATIONS = 8;
/** With nothing typed, few enough that the actions show too. */
const RECENT_CONVERSATIONS = 4;
/** Other apps' sections are for finding by name, so they wait for something typed. */
const MAX_SECTIONS = 8;

/** One place to jump anywhere, from the keyboard or a tap on Search: conversations, Workbench, and other apps' sections. */
export function Palette({ onClose }: { onClose(): void }) {
	const { t, ago, language, setLanguage, describe } = useI18n();
	const { toast } = useFeedback();
	const calls = useCalls();
	const { path, tenant, config } = useWorkspace();
	const nav = useModuleNav();
	const navigate = useNavigate();
	const theme = useTheme();
	const sessions = useSessions();
	// The apps that list sections, read the same way as under their Apps entries.
	const apps = nav.filter(({ entry, available }) => available && entry.href !== undefined && entry.Sections !== undefined);
	const sections = useQueries({ queries: apps.map(({ module }) => navQuery(module.id, tenant)) });

	const search = (query: string): PaletteEntry[] => {
		const go = (to: string) => () => navigate(path(to));
		const dark = document.documentElement.dataset.theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
		const actions: PaletteEntry[] = [
			{ key: "new", label: t("New conversation"), icon: MessageSquarePlus, run: go("") },
			...(config.voice
				? [{ key: "voice", label: t("New voice conversation"), icon: AudioLines, run: () => void calls.startNew().catch((error: Error) => toast(error instanceof MicrophoneRefused ? t("Allow the microphone to start a voice conversation.") : describe(error))) }]
				: []),
			{ key: "home", label: t("Home"), icon: HomeIcon, run: go("") },
			...nav.map(({ entry }) => ({ key: entry.key, label: t(entry.label), icon: entry.icon, run: entry.href === undefined ? go(entry.to) : () => window.location.assign(appHref(entry.href ?? "", tenant)) })),
			{ key: "account", label: t("Account"), icon: UserRound, run: () => window.location.assign(config.account_url) },
			{ key: "settings", label: t("Workbench settings"), icon: SettingsIcon, run: go("settings") },
			{ key: "theme", label: t(dark ? "Switch to light theme" : "Switch to dark theme"), icon: dark ? Sun : Moon, run: () => setTheme(dark ? "light" : "dark") },
			{ key: "language", label: language === "zh" ? "Switch to English" : "切换到简体中文", icon: Languages, run: () => setLanguage(language === "zh" ? "en" : "zh") },
		];
		const conversations: PaletteEntry[] = [...(sessions.data ?? [])]
			.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
			.map((session) => ({ key: session.sessionId, label: session.metadata?.title ?? t("New conversation"), icon: MessageSquare, hint: ago(session.lastActiveAt), run: go(`c/${session.sessionId}`) }));
		const elsewhere: PaletteEntry[] = apps.flatMap(({ module, entry }, index) =>
			(sections[index]?.data ?? []).map((section) => ({
				key: `${module.id}:${section.key}`,
				label: language === "zh" ? section.label_zh : section.label,
				icon: entry.icon,
				hint: t(entry.label),
				run: () => window.location.assign(appHref(entry.href ?? "", tenant, section.to)),
			})),
		);
		const needle = query.trim().toLowerCase();
		const matches = (entry: PaletteEntry) => entry.label.toLowerCase().includes(needle);
		return [
			...conversations.filter(matches).slice(0, needle === "" ? RECENT_CONVERSATIONS : MAX_CONVERSATIONS),
			...actions.filter(matches),
			...(needle === "" ? [] : elsewhere.filter((entry) => matches(entry) || (entry.hint ?? "").toLowerCase().includes(needle)).slice(0, MAX_SECTIONS)),
		];
	};

	return <KitPalette search={search} placeholder={t("Search conversations and actions")} scope={t("Searches open conversation titles, actions, and your apps' sections.")} onClose={onClose} />;
}
