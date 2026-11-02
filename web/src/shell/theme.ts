import { useSyncExternalStore } from "react";
import { load, save } from "../lib/storage.ts";

export type Theme = "system" | "light" | "dark";

const listeners = new Set<() => void>();

const current = (): Theme => (load("theme") as Theme | undefined) ?? "system";

export function applyTheme(theme: Theme = current()): void {
	if (theme === "system") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
	save("theme", theme);
	applyTheme(theme);
	for (const listener of listeners) listener();
}

/** The menu and Settings both change it, so they read one value. */
export function useTheme(): Theme {
	return useSyncExternalStore((listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}, current);
}
