import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { useFeedback } from "../../lib/ui.tsx";
import { type Findings, getPolicy, type Policy, type PolicyRule, putPolicy, reviewPolicy } from "./api.ts";

/** Triggers a rule can name, as the run's token carries them. Unattended ones come first, because they're what most rules are for. */
const TRIGGERS = ["schedule", "event", "webhook", "user", "voice"] as const;
const TRIGGER_LABELS: Record<string, string> = { schedule: "scheduled", event: "event", webhook: "webhook", user: "typed", voice: "voice" };

/** The tenant's rules for what its agents' tools may do, enforced by the tool gateway for every harness. */
export function PolicySettings() {
	const { t, describe } = useI18n();
	const { toast } = useFeedback();
	const client = useQueryClient();
	const live = useQuery({ queryKey: ["agent-policy"], queryFn: getPolicy });
	const [draft, setDraft] = useState<Policy>();
	const [findings, setFindings] = useState<Findings>();
	const [reason, setReason] = useState("");
	useEffect(() => {
		if (draft === undefined || live.data === undefined) return;
		void reviewPolicy(draft).then((answer) => setFindings(answer.findings));
	}, [draft, live.data]);
	const publish = useMutation({
		mutationFn: () => putPolicy(draft!, reason, live.data!.version),
		onSuccess: (next) => {
			client.setQueryData(["agent-policy"], next);
			setDraft(undefined);
			setFindings(undefined);
			setReason("");
			toast(t("Published. The tool gateway applies it within a few seconds, in runs already going too."));
		},
		onError: (error) => toast(describe(error)),
	});
	if (live.data === undefined) return null;
	const view = live.data;
	if (!view.entitled && view.policy.rules.length === 0) {
		return (
			<div className="card">
				<h2>{t("Agent policy")}</h2>
				<p className="quiet">{t("Rules for what agents' tools may do, by trigger, agent and tool, come with the enterprise plan.")}</p>
			</div>
		);
	}
	const shown = draft ?? view.policy;
	const change = (rules: PolicyRule[]) => setDraft({ ...shown, rules });
	const problems = findings?.problems ?? [];
	return (
		<div className="card">
			<h2>{t("Agent policy")}</h2>
			<p className="quiet">{t("Every tool call goes through the gateway, which applies the first rule that matches. Nothing here widens what an agent can do.")}</p>
			{!view.entitled && <p className="quiet">{t("Your plan no longer includes policies. You can still remove rules.")}</p>}
			<ul className="rows" data-empty={t("No rules: every tool an agent has may run.")}>
				{shown.rules.map((rule) => (
					<li key={rule.id} className="row">
						<div className="row-main">
							<span>{describeRule(rule, t)}</span>
							<span className="quiet mono">{rule.id}</span>
						</div>
						<div className="row-actions">
							<button type="button" className="icon-button" aria-label={t("Remove")} title={t("Remove")} onClick={() => change(shown.rules.filter((r) => r.id !== rule.id))}>
								<Trash2 size={15} aria-hidden="true" />
							</button>
						</div>
					</li>
				))}
			</ul>
			{view.entitled && <NewRule agents={view.agents} rules={shown.rules} onAdd={(rule) => change([...shown.rules, rule])} />}
			{draft !== undefined && (
				<div className="policy-publish">
					{problems.map((p) => (
						<p key={p.text} className="banner warn">
							{p.text}
						</p>
					))}
					{(findings?.warnings ?? []).map((w) => (
						<p key={w.text} className="quiet">
							{w.text}
						</p>
					))}
					<input aria-label={t("Reason")} placeholder={t("Why, for the history")} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
					<div className="row-actions">
						<button type="button" className="ghost" onClick={() => (setDraft(undefined), setFindings(undefined))}>
							{t("Discard")}
						</button>
						<button type="button" className="primary" disabled={reason.trim() === "" || problems.length > 0 || publish.isPending} onClick={() => publish.mutate()}>
							{t("Publish")}
						</button>
					</div>
				</div>
			)}
			{view.history.length > 0 && (
				<p className="quiet">
					{t("Version {version}, by {actor}: {reason}", { version: String(view.version), actor: view.history[0]!.actor, reason: view.history[0]!.reason })}
				</p>
			)}
		</div>
	);
}

function describeRule(rule: PolicyRule, t: ReturnType<typeof useI18n>["t"]): string {
	const runs = rule.trigger === undefined || rule.trigger.length === 0 ? t("every run") : rule.trigger.map((trigger) => t(TRIGGER_LABELS[trigger] ?? trigger)).join(", ");
	const agent = rule.agent === undefined || rule.agent === "" ? t("any agent") : rule.agent;
	if (rule.effect === "approve") {
		const who = (rule.approvers ?? ["principal", "owners"]).map((a) => (a === "admins" ? t("an admin") : a === "principal" || a === "owners" ? t("the run's person") : a)).join(", ");
		return t("Hold {tool} on {server} for {who} to approve, for {runs}, by {agent}", { tool: rule.tool, server: rule.server, who, runs, agent });
	}
	return t("Deny {tool} on {server}, for {runs}, by {agent}", { tool: rule.tool, server: rule.server, runs, agent });
}

function NewRule({ agents, rules, onAdd }: { agents: string[]; rules: PolicyRule[]; onAdd(rule: PolicyRule): void }) {
	const { t } = useI18n();
	const [server, setServer] = useState("collab");
	const [tool, setTool] = useState("");
	const [agent, setAgent] = useState("");
	const [triggers, setTriggers] = useState<string[]>(["schedule", "event", "webhook"]);
	const [effect, setEffect] = useState<"deny" | "approve">("deny");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		let n = rules.length + 1;
		while (rules.some((r) => r.id === `r${n}`)) n++;
		onAdd({
			id: `r${n}`,
			server: server.trim(),
			tool: tool.trim(),
			effect,
			// An admin decides, and never the run's own person.
			...(effect === "approve" ? { approvers: ["admins"], self_approval: false } : {}),
			...(agent === "" ? {} : { agent }),
			...(triggers.length === 0 ? {} : { trigger: triggers }),
		});
		setTool("");
	};
	return (
		<form className="policy-rule" onSubmit={submit}>
			<input aria-label={t("Server")} value={server} onChange={(event) => setServer(event.target.value)} placeholder={t("Server, such as collab")} />
			<input aria-label={t("Tool")} value={tool} onChange={(event) => setTool(event.target.value)} placeholder={t("Tool, * for any run of letters, such as work_create*")} />
			<select aria-label={t("Agent")} value={agent} onChange={(event) => setAgent(event.target.value)}>
				<option value="">{t("any agent")}</option>
				{agents.map((name) => (
					<option key={name} value={name}>
						{name}
					</option>
				))}
			</select>
			<div className="day-picks" role="group" aria-label={t("Runs")}>
				{TRIGGERS.map((trigger) => (
					<label key={trigger} className={triggers.includes(trigger) ? "day-pick on" : "day-pick"}>
						<input type="checkbox" checked={triggers.includes(trigger)} onChange={(event) => setTriggers(event.target.checked ? [...triggers, trigger] : triggers.filter((x) => x !== trigger))} />
						{t(TRIGGER_LABELS[trigger]!)}
					</label>
				))}
			</div>
			<select aria-label={t("Decision")} value={effect} onChange={(event) => setEffect(event.target.value as "deny" | "approve")}>
				<option value="deny">{t("Deny")}</option>
				<option value="approve">{t("Needs an admin's approval")}</option>
			</select>
			<button type="submit" className="ghost" disabled={server.trim() === "" || tool.trim() === ""}>
				{t("Add a rule")}
			</button>
		</form>
	);
}
