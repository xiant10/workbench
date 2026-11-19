/** A person's language and theme, chosen on the account page and kept by the auth service for every t10 app. An app
 * only shows them: browser storage is just the cache that paints the first screen before the auth service answers. */
import { useEffect } from "react";
import { request } from "./api.ts";
import { LANGUAGES, type Language, useApplyLanguage } from "./i18n.tsx";
import { applySavedTheme, type Theme } from "./theme.ts";

type Tag = "en" | "zh-Hans";
type Saved = { language?: Tag; theme?: Theme; languages?: Tag[] };

const fromSaved = (language: Tag | undefined): Language | undefined => (language === "zh-Hans" ? "zh" : language === "en" ? "en" : undefined);

/**
 * Call once in a signed-in app. It applies the saved choices when the page opens and whenever the person comes back to
 * it, so a change made on the account page shows here too. A person who hasn't chosen a language sees the browser's, if
 * the deployment offers it.
 */
export function useSavedPreferences(): void {
	const applyLanguage = useApplyLanguage();
	useEffect(() => {
		const read = () =>
			request<Saved>("/api/preferences").then(
				(saved) => {
					const offered = (saved.languages ?? []).map(fromSaved).filter((language) => language !== undefined);
					applyLanguage(fromSaved(saved.language), offered.length > 0 ? offered : LANGUAGES);
					applySavedTheme(saved.theme ?? "system");
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
	}, [applyLanguage]);
}
