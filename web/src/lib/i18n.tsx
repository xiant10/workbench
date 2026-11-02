import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError } from "./api.ts";
import { load, save } from "./storage.ts";
import { ZH } from "./zh.ts";

export type Language = "en" | "zh";

type Vars = Record<string, string | number>;

type Context = {
	language: Language;
	setLanguage(language: Language): void;
	/** English is the key, so a missing entry still reads. i18n.test.ts fails on one. */
	t(text: string, vars?: Vars): string;
	date(value: string | number): string;
	/** A calendar day, such as a due date: the same day wherever it's read. */
	day(value: string): string;
	dateTime(value: string | number): string;
	ago(value: number): string;
	/** A failure for a person to read. Services answer in English, so Chinese gets the meaning from the status. */
	describe(error: Error): string;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function failureText(error: Error): string {
	if (error.message.includes("open sessions")) return "Too many open conversations. Archive one first.";
	if (!(error instanceof ApiError)) return "Couldn't reach the service. Check your connection and try again.";
	if (error.status === 403) return "You don't have permission to do that.";
	if (error.status === 404) return "This no longer exists.";
	if (error.status === 409) return "Someone else changed this. Reload and try again.";
	if (error.status === 429) return "Too many requests. Wait a moment and try again.";
	return error.status >= 500 ? "Something went wrong. Try again." : "That didn't work. Check the details and try again.";
}

const I18n = createContext<Context | undefined>(undefined);

function initialLanguage(): Language {
	const saved = load("language");
	if (saved === "en" || saved === "zh") return saved;
	return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [language, setLanguageState] = useState(initialLanguage);
	const setLanguage = useCallback((next: Language) => {
		save("language", next);
		setLanguageState(next);
	}, []);
	const tag = language === "zh" ? "zh-CN" : "en";
	// Also picks the right glyphs: without it, a browser may draw Chinese with a Japanese font.
	useEffect(() => {
		document.documentElement.lang = tag;
	}, [tag]);
	const t = useCallback(
		(text: string, vars: Vars = {}) => {
			const template = language === "zh" ? (ZH[text] ?? text) : text;
			return template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
		},
		[language],
	);
	const value = useMemo<Context>(() => {
		const dates = new Intl.DateTimeFormat(tag, { dateStyle: "medium" });
		const days = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeZone: "UTC" });
		const times = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
		const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
		return {
			language,
			setLanguage,
			t,
			date: (at) => dates.format(new Date(at)),
			day: (at) => days.format(new Date(at)),
			dateTime: (at) => times.format(new Date(at)),
			ago: (at) => {
				const since = Date.now() - at;
				if (since < MINUTE_MS) return t("just now");
				if (since < HOUR_MS) return relative.format(-Math.floor(since / MINUTE_MS), "minute");
				if (since < DAY_MS) return relative.format(-Math.floor(since / HOUR_MS), "hour");
				return relative.format(-Math.floor(since / DAY_MS), "day");
			},
			describe: (error) => (language === "en" && error instanceof ApiError && error.status < 500 && error.status !== 0 ? error.message : t(failureText(error))),
		};
	}, [language, setLanguage, t, tag]);
	return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useI18n(): Context {
	const context = useContext(I18n);
	if (context === undefined) throw new Error("useI18n needs I18nProvider");
	return context;
}
