/** Browser storage for conveniences only. It can be blocked or empty, and the app works without it. */
export function load(key: string): string | undefined {
	try {
		return localStorage.getItem(`wb:${key}`) ?? undefined;
	} catch {
		return undefined;
	}
}

export function save(key: string, value: string | undefined): void {
	try {
		if (value === undefined || value === "") localStorage.removeItem(`wb:${key}`);
		else localStorage.setItem(`wb:${key}`, value);
	} catch {
		// Losing a convenience is fine.
	}
}
