/** One sign-in and one sign-out for every t10 web app in this browser. auth-server holds
 * the sign-in, and each app holds a session of its own that ends with it. */
import { postJSON } from "./api.ts";
import { load, save } from "./storage.ts";

const CHANNEL = "t10-session";
/** How often a page someone is using asks whether the sign-in still stands. */
const CHECK_MS = 30_000;
/** A click or key asks at once, unless a check ran this recently. */
const NEXT_USE_MS = 5_000;
/** Lets the tab that signed out finish first, so another can't slip back in. */
const FOLLOW_MS = 1_000;

function channel(): BroadcastChannel | undefined {
	return typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL);
}

/** The language auth-server should show: only one the person chose, never a guess. */
function chosenLanguage(): string | undefined {
	const saved = load("language");
	return saved === "zh" ? "zh-Hans" : saved === "en" ? "en" : undefined;
}

/** Why sign-in is being asked for, which its page says. */
export type SignInReason = "ended" | "signedout";

export function signInHref(next: string, reason?: SignInReason): string {
	const query = new URLSearchParams({ next });
	if (reason !== undefined) query.set("reason", reason);
	const lang = chosenLanguage();
	if (lang !== undefined) query.set("lang", lang);
	return `/auth/login?${query}`;
}

export function signIn(next = window.location.pathname + window.location.search, reason?: SignInReason): void {
	window.location.assign(signInHref(next, reason));
}

/** Ends every t10 app in this browser, then shows the sign-in page. A draft left here
 * would greet the next person, so it goes too. */
export async function signOut(): Promise<void> {
	const { redirect } = await postJSON<{ redirect: string }>("/auth/logout", {});
	clearDrafts();
	const tabs = channel();
	tabs?.postMessage("signed-out");
	tabs?.close();
	window.location.assign(redirect);
}

/** Keeps drafts only for the person who wrote them, on a computer people share. */
export function keepDraftsFor(userId: string): void {
	if (load("owner") !== userId) clearDrafts();
	save("owner", userId);
}

function clearDrafts(): void {
	try {
		for (const key of Object.keys(localStorage)) if (key.startsWith("wb:draft:")) localStorage.removeItem(key);
	} catch {
		// Blocked storage held no drafts.
	}
}

/** Takes this page off the screen once the sign-in behind it ends: at once for a
 * sign-out in another tab of this app, and for any other app on the next click or key
 * (at most every 5 seconds), when someone comes back to the page, or every 30 seconds
 * while they use it. An unattended page doesn't ask, because asking keeps the session
 * alive. Returns a cleanup. */
export function watchSession(): () => void {
	let used = false;
	let checked = 0;
	const check = () => {
		checked = Date.now();
		fetch("/auth/session", { credentials: "same-origin" }).then(
			(response) => {
				if (response.status === 401) signIn(undefined, "ended");
			},
			() => undefined,
		);
	};
	const tabs = channel();
	if (tabs !== undefined) tabs.onmessage = (event) => {
		if (event.data === "signed-out") window.setTimeout(() => window.location.assign("/signed-out"), FOLLOW_MS);
	};
	const markUsed = () => {
		used = true;
		if (Date.now() - checked > NEXT_USE_MS) {
			used = false;
			check();
		}
	};
	const onVisible = () => {
		if (document.visibilityState === "visible") check();
	};
	const onShow = (event: PageTransitionEvent) => {
		if (event.persisted) check();
	};
	const timer = window.setInterval(() => {
		if (used && document.visibilityState === "visible") {
			used = false;
			check();
		}
	}, CHECK_MS);
	document.addEventListener("pointerdown", markUsed, { passive: true });
	document.addEventListener("keydown", markUsed, { passive: true });
	document.addEventListener("visibilitychange", onVisible);
	window.addEventListener("focus", check);
	window.addEventListener("pageshow", onShow);
	return () => {
		window.clearInterval(timer);
		tabs?.close();
		document.removeEventListener("pointerdown", markUsed);
		document.removeEventListener("keydown", markUsed);
		document.removeEventListener("visibilitychange", onVisible);
		window.removeEventListener("focus", check);
		window.removeEventListener("pageshow", onShow);
	};
}
