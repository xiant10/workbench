import { postJSON, request } from "../../lib/api.ts";

export type AutomationState = "active" | "paused" | "failing" | "revoked";

/** A person's standing instruction to an agent, on a schedule. */
export type Automation = {
	id: string;
	name: string;
	agent: string;
	instruction: string;
	cron: string;
	timezone: string;
	state: AutomationState;
	next_fire_at: string | null;
	failures: number;
};

/** One run of an automation. `problem` is the service's own words, never the agent's. */
export type Firing = {
	id: string;
	scheduled_for: string;
	state: "claimed" | "running" | "done" | "failed" | "skipped";
	session_id?: string;
	problem?: string;
	finished_at: string | null;
};

export type Draft = { name: string; agent: string; instruction: string; cron: string; timezone: string };

const base = "/api/modules/automations";
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const listAutomations = () => request<{ automations: Automation[] }>(`${base}/automations`).then((body) => body.automations);
export const getAutomation = (id: string) => request<{ automation: Automation; firings: Firing[] }>(`${base}/automations/${encodeURIComponent(id)}`);
export const createAutomation = (draft: Draft) => postJSON<Automation>(`${base}/automations`, draft);
export const updateAutomation = (id: string, change: Partial<Omit<Draft, "agent">> & { state?: "active" | "paused" }) =>
	request<Automation>(`${base}/automations/${encodeURIComponent(id)}`, json("PATCH", change));
export const deleteAutomation = (id: string) => request<void>(`${base}/automations/${encodeURIComponent(id)}`, { method: "DELETE" });
export const runAutomation = (id: string) => postJSON<Firing>(`${base}/automations/${encodeURIComponent(id)}/run`, {});

/** Days of the week as cron numbers, Monday first. */
export const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** A time of day on chosen days, which is all the form writes. Anything else shows as written. */
export type Simple = { hour: number; minute: number; days: number[] };

export function toCron({ hour, minute, days }: Simple): string {
	const sorted = [...days].sort((a, b) => a - b);
	const field = sorted.length === 7 ? "*" : sorted.join(",") === "1,2,3,4,5" ? "1-5" : sorted.join(",");
	return `${minute} ${hour} * * ${field}`;
}

export function fromCron(cron: string): Simple | undefined {
	const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6](?:,[0-6])*)$/.exec(cron.trim());
	if (match === null) return undefined;
	const field = match[3]!;
	const days = field === "*" ? [...DAYS] : field === "1-5" ? [1, 2, 3, 4, 5] : field.split(",").map(Number);
	return { minute: Number(match[1]), hour: Number(match[2]), days };
}
