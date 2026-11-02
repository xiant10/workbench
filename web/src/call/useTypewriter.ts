import { useEffect, useRef, useState } from "react";

/** About the pace of speech; the agent releases a chunk's text with its first audio. */
const BASE_CPS = 18;
/** Never fall more than this far behind the text that has arrived. */
const MAX_LAG_S = 1.5;

/** How many characters to show after `elapsedS`, given what is shown and what has arrived. */
export function nextShown(shown: number, total: number, elapsedS: number): number {
	const backlog = total - shown;
	if (backlog <= 0) return total;
	const rate = Math.max(BASE_CPS, backlog / MAX_LAG_S);
	return Math.min(total, shown + Math.max(1, Math.round(rate * elapsedS)));
}

/**
 * Types `text` out a few characters at a time while `typing` (the agent's reply). A caption that
 * grows is typed on from where it was and a new one is typed from the start. With `typing` off
 * (the caller's own interim words) every update shows at once.
 */
export function useTypewriter(text: string, typing: boolean): string {
	const [shown, setShown] = useState(0);
	const previous = useRef("");
	const chars = Array.from(text);

	useEffect(() => {
		const grew = text.startsWith(previous.current) && previous.current !== "";
		previous.current = text;
		const total = Array.from(text).length;
		if (!typing) {
			setShown(total);
			return;
		}
		if (!grew) setShown(0);
		let last = performance.now();
		const timer = setInterval(() => {
			const now = performance.now();
			const elapsed = (now - last) / 1000;
			last = now;
			setShown((current) => {
				const next = nextShown(Math.min(current, total), total, elapsed);
				if (next >= total) clearInterval(timer);
				return next;
			});
		}, 33);
		return () => clearInterval(timer);
	}, [text, typing]);

	return chars.slice(0, Math.min(shown, chars.length)).join("");
}
