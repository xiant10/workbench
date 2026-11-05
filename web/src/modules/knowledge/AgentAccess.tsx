import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore } from "../../lib/paged.tsx";
import { Segmented, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import * as api from "./api.ts";
import { Problem, useLibrary } from "./shared.tsx";

/** Which document sets each agent may search. Within its limit, an agent still picks sets per question. */
export function AgentAccess() {
	const { t } = useI18n();
	const { tenant, agents } = useWorkspace();
	const limits = useQuery({ queryKey: ["knowledge", tenant, "agent-access"], queryFn: api.agentLimits, gcTime: 0 });
	// Agents the tenant can use, and any an older limit still names.
	const names = [...new Set([...agents.map((a) => a.name), ...(limits.data ?? []).map((l) => l.agent)])];
	return (
		<>
			<header className="kn-head">
				<div className="kn-head-text">
					<h1>{t("Agent access")}</h1>
					<p className="quiet">
						{t("Choose which document sets each agent may search. Within that, the agent picks the sets that fit each question. Members still see every published document on this page.")}
					</p>
				</div>
			</header>
			<Problem text={limits.isError ? "Agent access could not be loaded." : ""} />
			{limits.isPending && <Skeleton rows={4} />}
			{limits.isSuccess &&
				names.map((name) => (
					<AgentCard
						key={`${name}:${limits.data.find((l) => l.agent === name)?.revision ?? 0}`}
						name={name}
						title={agents.find((a) => a.name === name)?.title || name}
						limit={limits.data.find((l) => l.agent === name)}
					/>
				))}
		</>
	);
}

function AgentCard({ name, title, limit }: { name: string; title: string; limit?: api.AgentLimit }) {
	const { t } = useI18n();
	const { toast } = useFeedback();
	const { tenant } = useWorkspace();
	const client = useQueryClient();
	const { sets } = useLibrary(true);
	const [mode, setMode] = useState<"all" | "some">(limit ? "some" : "all");
	const [chosen, setChosen] = useState(new Set(limit?.set_ids ?? []));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const changed = mode === "all" ? limit !== undefined : !limit || chosen.size !== limit.set_ids.length || limit.set_ids.some((id) => !chosen.has(id));
	async function save() {
		setBusy(true);
		setError("");
		try {
			if (mode === "all" && limit) await api.clearAgentLimit(limit);
			if (mode === "some") await api.saveAgentLimit(name, [...chosen], limit?.revision ?? 0);
			toast(t("Saved access for {agent}.", { agent: title }));
			await client.invalidateQueries({ queryKey: ["knowledge", tenant, "agent-access"] });
		} catch (e) {
			setError(api.message(e));
		} finally {
			setBusy(false);
		}
	}
	const known = new Set((sets.data ?? []).map((s) => s.id));
	const unlisted = [...chosen].filter((id) => !known.has(id)).length;
	return (
		<section className="card kn-card" aria-label={title}>
			<div className="kn-head">
				<span className="kn-row-title">
					<Bot size={16} aria-hidden="true" />
					{title}
				</span>
				<Segmented<"all" | "some">
					label={t("Access for {agent}", { agent: title })}
					value={mode}
					options={[
						{ value: "all", label: t("All document sets") },
						{ value: "some", label: t("Only chosen sets") },
					]}
					onChange={setMode}
				/>
			</div>
			{mode === "some" && (
				<>
					<div className="kn-toggles">
						{sets.data?.map((s) => (
							<label key={s.id} className={chosen.has(s.id) ? "day-pick on" : "day-pick"} title={s.description || undefined}>
								<input
									type="checkbox"
									checked={chosen.has(s.id)}
									disabled={busy}
									onChange={(e) => {
										const next = new Set(chosen);
										if (e.target.checked) next.add(s.id);
										else next.delete(s.id);
										setChosen(next);
									}}
								/>
								{s.title}
							</label>
						))}
						<LoadMore list={sets} label="Show more sets" className="link" />
					</div>
					{unlisted > 0 && <p className="quiet">{t("{count} more chosen sets aren't shown. Show more sets to see them.", { count: unlisted })}</p>}
					{chosen.size === 0 && <p className="inline-error">{t("With no sets chosen, this agent can't use company knowledge.")}</p>}
				</>
			)}
			<Problem text={error} />
			<div className="dialog-actions">
				<button type="button" className="primary" disabled={busy || !changed} onClick={() => void save()}>
					{t("Save")}
				</button>
			</div>
		</section>
	);
}
