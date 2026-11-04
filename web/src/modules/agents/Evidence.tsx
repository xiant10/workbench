import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { useFeedback } from "../../lib/ui.tsx";
import { exportURL, listEvidence, verifyEvidence } from "./api.ts";

/**
 * What the tool gateway decided for this tenant's runs, from its tamper-evident record. Only the tenant's admins see it;
 * platform admins can't. It holds no arguments or results.
 */
export function Evidence() {
	const { t, ago, describe } = useI18n();
	const { toast } = useFeedback();
	const [automation, setAutomation] = useState("");
	const [trigger, setTrigger] = useState("");
	const [effect, setEffect] = useState("");
	const records = useQuery({
		queryKey: ["evidence", automation, trigger, effect],
		queryFn: () => listEvidence({ automation, trigger, effect, limit: "50" }),
		refetchInterval: 15_000,
	});
	const verify = useMutation({
		mutationFn: verifyEvidence,
		onSuccess: (v) =>
			toast(
				v.ok
					? v.gaps.length === 0
						? t("Intact: {records} records follow one from another.", { records: String(v.records) })
						: t("Intact, but a gateway lost records: {gaps}.", { gaps: v.gaps.map((g) => `${g.writer} ${g.from}–${g.to}`).join(", ") })
					: t("Broken at record {seq}: {problem}", { seq: String(v.break_at ?? 0), problem: v.problem ?? "" }),
			),
		onError: (error) => toast(describe(error)),
	});
	if (records.data === undefined && !records.isError) return null;
	if (records.isError) return null;
	return (
		<div className="card">
			<h2>{t("Decisions")}</h2>
			<p className="quiet">{t("Every tool call a policy applied to, with the rule that decided it. It keeps no arguments or results.")}</p>
			<div className="policy-rule">
				<input aria-label={t("Automation")} placeholder={t("Automation ID")} value={automation} onChange={(event) => setAutomation(event.target.value.trim())} />
				<select aria-label={t("Runs")} value={trigger} onChange={(event) => setTrigger(event.target.value)}>
					<option value="">{t("Every run")}</option>
					<option value="schedule">{t("scheduled")}</option>
					<option value="user">{t("typed")}</option>
					<option value="voice">{t("voice")}</option>
				</select>
				<select aria-label={t("Decision")} value={effect} onChange={(event) => setEffect(event.target.value)}>
					<option value="">{t("Any decision")}</option>
					<option value="deny">{t("Denied")}</option>
					<option value="allow">{t("Allowed")}</option>
				</select>
				<button type="button" className="ghost" disabled={verify.isPending} onClick={() => verify.mutate()}>
					{t("Verify")}
				</button>
				<a className="ghost button" href={exportURL} download>
					{t("Export")}
				</a>
			</div>
			<ul className="rows" data-empty={t("Nothing recorded yet.")}>
				{(records.data ?? []).map(({ seq, record }) => (
					<li key={seq} className="row">
						<div className="row-main">
							<span>
								{record.kind === "decision" ? (
									<span className={record.effect === "deny" ? "pill warn" : "pill"}>{record.effect === "deny" ? t("Denied") : t("Allowed")}</span>
								) : (
									<span className="pill">{t(record.outcome === "ok" ? "Ran" : "Failed")}</span>
								)}{" "}
								<span className="mono">
									{record.server}/{record.tool}
								</span>
								{record.rule !== undefined && <span className="quiet"> · {t("rule {rule}, version {version}", { rule: record.rule, version: String(record.version ?? 0) })}</span>}
							</span>
							<span className="quiet">
								{ago(Date.parse(record.at))} · {t(record.trigger === "schedule" ? "scheduled" : record.trigger === "user" ? "typed" : record.trigger)}
								{record.automation !== undefined && <> · {record.automation}</>} · {record.principal}
								{record.agent !== undefined && <> · {record.agent}</>}
							</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
