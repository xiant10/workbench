import { useEffect, useState, type KeyboardEvent } from "react";

export const RESULTS_BREAKPOINT = 1200;

export function useMedia(query: string): boolean {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, [query]);
	return matches;
}

export function navigateOptions(event: KeyboardEvent<HTMLElement>) {
	if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
	const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"], [role="radio"]')].filter((button) => !button.disabled);
	const at = options.indexOf(document.activeElement as HTMLButtonElement);
	if (at < 0 || options.length === 0) return;
	event.preventDefault();
	const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (at + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
	options[next]?.focus();
	options[next]?.click();
}
