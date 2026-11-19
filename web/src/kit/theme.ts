import { useSyncExternalStore } from "react";
import { load, save } from "./storage.ts";

export type Theme = "system" | "light" | "dark";

const listeners = new Set<() => void>();

const current = (): Theme => (load("theme") as Theme | undefined) ?? "system";

export function applyTheme(theme: Theme = current()): void {
	if (theme === "system") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
}

/** Only the saved preferences call this: a person chooses the theme on the account page. */
export function applySavedTheme(theme: Theme): void {
	if (theme === current()) return;
	save("theme", theme);
	applyTheme(theme);
	for (const listener of listeners) listener();
}

/** What the account page chose, for whatever draws in the theme. */
export function useTheme(): Theme {
	return useSyncExternalStore((listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}, current);
}
