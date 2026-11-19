import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError } from "./api.ts";
import { load, save } from "./storage.ts";

export type Language = "en" | "zh";

/** Every language the apps are written in. A deployment may offer fewer, which the auth service says. */
export const LANGUAGES: Language[] = ["en", "zh"];

type Vars = Record<string, string | number>;

/** The language comes from the account page, through the saved preferences: an app shows it and never changes it. */
type Context = {
	language: Language;
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

/** What the saved preferences hand the provider: the person's choice, if any, and the languages offered. */
type Apply = (chosen: Language | undefined, offered: Language[]) => void;

const ApplyLanguage = createContext<Apply | undefined>(undefined);

/** A language chosen on the account page arrives in a short-lived cookie after sign-in, once. */
function languageFromSignIn(): Language | undefined {
	const match = /(?:^|; )t10_lang=([^;]*)/.exec(document.cookie);
	if (match === null) return undefined;
	document.cookie = "t10_lang=; Max-Age=0; Path=/";
	return match[1] === "zh-Hans" ? "zh" : match[1] === "en" ? "en" : undefined;
}

/** The languages offered, as the auth service last said; all of them before it has. */
function cachedOffered(): Language[] {
	const cached = (load("languages") ?? "").split(",").filter((code): code is Language => LANGUAGES.includes(code as Language));
	return cached.length > 0 ? cached : LANGUAGES;
}

/** For someone who hasn't chosen: the browser's language if it's offered, else the deployment's default. */
function guess(offered: Language[]): Language {
	for (const tag of navigator.languages ?? [navigator.language]) {
		const lower = tag.toLowerCase();
		const language: Language | undefined = lower.startsWith("zh") ? "zh" : lower.startsWith("en") ? "en" : undefined;
		if (language !== undefined && offered.includes(language)) return language;
	}
	return offered[0] ?? "en";
}

function initialLanguage(): Language {
	const offered = cachedOffered();
	const signedIn = languageFromSignIn();
	if (signedIn !== undefined) save("language", signedIn);
	const saved = load("language");
	if ((saved === "en" || saved === "zh") && offered.includes(saved)) return saved;
	return guess(offered);
}

/** `catalog` is each app's own Chinese, keyed by English. */
export function I18nProvider({ catalog, children }: { catalog: Record<string, string>; children: ReactNode }) {
	const [language, setLanguage] = useState(initialLanguage);
	const apply = useCallback<Apply>((chosen, offered) => {
		save("languages", offered.join(","));
		save("language", chosen);
		setLanguage(chosen !== undefined && offered.includes(chosen) ? chosen : guess(offered));
	}, []);
	const tag = language === "zh" ? "zh-CN" : "en";
	// Also picks the right glyphs: without it, a browser may draw Chinese with a Japanese font.
	useEffect(() => {
		document.documentElement.lang = tag;
	}, [tag]);
	const t = useCallback(
		(text: string, vars: Vars = {}) => {
			const template = language === "zh" ? (catalog[text] ?? text) : text;
			return template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
		},
		[catalog, language],
	);
	const value = useMemo<Context>(() => {
		const dates = new Intl.DateTimeFormat(tag, { dateStyle: "medium" });
		const days = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeZone: "UTC" });
		const times = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
		const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
		return {
			language,
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
	}, [language, t, tag]);
	return (
		<ApplyLanguage.Provider value={apply}>
			<I18n.Provider value={value}>{children}</I18n.Provider>
		</ApplyLanguage.Provider>
	);
}

/** Only the saved preferences call this: nothing in an app changes the language. */
export function useApplyLanguage(): Apply {
	const apply = useContext(ApplyLanguage);
	if (apply === undefined) throw new Error("useApplyLanguage needs I18nProvider");
	return apply;
}

export function useI18n(): Context {
	const context = useContext(I18n);
	if (context === undefined) throw new Error("useI18n needs I18nProvider");
	return context;
}
