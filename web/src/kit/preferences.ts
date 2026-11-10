/** A person's language and theme, kept by the auth service for every t10 app. Browser
 * storage is only the cache that paints the first screen before it answers. */
import { useEffect, useRef } from "react";
import { request } from "./api.ts";
import { type Language, useI18n } from "./i18n.tsx";
import { setTheme, type Theme, useTheme } from "./theme.ts";

type Saved = { language?: "en" | "zh-Hans"; theme?: Theme };

const fromSaved = (language: Saved["language"]): Language | undefined => (language === "zh-Hans" ? "zh" : language === "en" ? "en" : undefined);
const toSaved = (language: Language): Saved["language"] => (language === "zh" ? "zh-Hans" : "en");

/**
 * Call once in a signed-in app. It applies the saved choices when the page opens and whenever the person comes back to
 * it, so a change made in another app shows here too, and saves each change made here. Nothing is saved before the
 * first read, so a browser's guess never overwrites a choice.
 */
export function useSavedPreferences(): void {
	const { language, setLanguage } = useI18n();
	const theme = useTheme();
	const now = useRef({ language, theme });
	now.current = { language, theme };
	// What the auth service holds, as far as this page knows; undefined until it has answered.
	const known = useRef<{ language: Language; theme: Theme } | undefined>(undefined);

	useEffect(() => {
		const read = () =>
			request<Saved>("/api/preferences").then(
				(saved) => {
					const nextLanguage = fromSaved(saved.language) ?? now.current.language;
					const nextTheme = saved.theme ?? now.current.theme;
					known.current = { language: nextLanguage, theme: nextTheme };
					if (nextLanguage !== now.current.language) setLanguage(nextLanguage);
					if (nextTheme !== now.current.theme) setTheme(nextTheme);
				},
				() => undefined,
			);
		const onVisible = () => {
			if (document.visibilityState === "visible") void read();
		};
		void read();
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", onVisible);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", onVisible);
		};
	}, [setLanguage]);

	useEffect(() => {
		const before = known.current;
		if (before === undefined) return;
		const change: Saved = {};
		if (language !== before.language) change.language = toSaved(language);
		if (theme !== before.theme) change.theme = theme;
		if (Object.keys(change).length === 0) return;
		known.current = { language, theme };
		// Losing the save only means the next app shows the old choice; this page keeps the new one.
		void request("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }).catch(() => undefined);
	}, [language, theme]);
}
