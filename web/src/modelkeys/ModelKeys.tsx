import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { useMemberName } from "../admin/members.ts";
import { Dialog, Empty, Skeleton, useFeedback } from "../lib/ui.tsx";
import { useWorkspace } from "../shell/workspace.ts";
import {
	addEndpoint,
	addKey,
	CAPABILITIES,
	type Capability,
	checkEndpoint,
	deleteEndpoint,
	deleteKey,
	deleteMapping,
	deletePolicy,
	effectiveMode,
	type Endpoint,
	getModelKeys,
	KINDS,
	type Kind,
	type Link,
	type Mode,
	type ModelCheck,
	type ModelKeys as Keys,
	MODES,
	patchEndpoint,
	patchKey,
	putMapping,
	putPolicy,
	type Reason,
	REASONS,
	replaceKey,
} from "./api.ts";
import "./modelkeys.css";

const CAPABILITY_LABELS: Record<Capability, string> = { llm: "Chat models", embedding: "Embeddings", stt: "Speech to text", tts: "Text to speech" };
const MODE_LABELS: Record<Mode, string> = {
	strict: "Only our keys",
	own_then_assigned: "Our keys, then keys the platform gave us",
	own_then_platform: "Our keys, then the platform's",
	platform_then_own: "The platform's keys, then ours",
	platform: "The platform's keys",
};
const MODE_HINTS: Record<Mode, string> = {
	strict: "Calls use only your keys and endpoints. A call fails when none of them can take it.",
	own_then_assigned: "Your keys and endpoints first, then keys the platform assigned to you. Keys the platform shares with everyone aren't used.",
	own_then_platform: "Your keys and endpoints first. When they can't take a call, the platform's keys do.",
	platform_then_own: "The platform's keys first. Yours take a call when the platform's can't.",
	platform: "Calls use the platform's keys. Yours aren't used.",
};
const REASON_LABELS: Record<Reason, string> = { unavailable: "Busy or down", rejected: "Key refused", limit: "Over a limit" };
const STATUS_LABELS: Record<string, string> = { active: "On", rejected: "Refused by the provider", disabled: "Off" };
const CHANGE_ACTIONS: Record<string, string> = {
	create: "Added",
	rotate: "Replaced the key of",
	set: "Changed",
	disable: "Turned off",
	enable: "Turned on",
	delete: "Deleted",
	remove: "Removed",
	assign: "Assigned",
	unassign: "Took back",
	confirm_region: "Confirmed the region of",
	check: "Checked",
	rejected: "The provider refused",
};
const CHANGE_OBJECTS: Record<string, string> = { credential: "a key", endpoint: "an endpoint", policy: "which keys pay", platform_policy: "what you may bring", mapping: "a model choice" };
const AGENT = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function commaList(text: string): string[] {
	return text
		.split(",")
		.map((a) => a.trim())
		.filter((a) => a !== "");
}

/** AgentOptions lists the organization's agents for a field to suggest, with any others it should offer too. */
function AgentOptions({ id, also = [] }: { id: string; also?: string[] }) {
	const { agents } = useWorkspace();
	const names = [...new Set([...agents.map((a) => a.name), ...also])];
	return (
		<datalist id={id}>
			{names.map((name) => (
				<option key={name} value={name}>
					{agents.find((a) => a.name === name)?.title ?? name}
				</option>
			))}
		</datalist>
	);
}

/**
 * AgentField is one agent, picked from the organization's or typed, since an agent can be named before it exists.
 * Empty is every agent. It reports a name only once it's a valid ID.
 */
function AgentField({ value, onChange, also, label }: { value: string; onChange(agent: string): void; also?: string[]; label: string }) {
	const { t } = useI18n();
	const list = useId();
	const [draft, setDraft] = useState(value === "*" ? "" : value);
	const bad = draft.trim() !== "" && !AGENT.test(draft.trim());
	// The list stays outside the label, or its options' text joins the field's name.
	return (
		<>
			<label>
				<span className="quiet">{label}</span>
				<input
					list={list}
				value={draft}
					placeholder={t("Every agent")}
					aria-invalid={bad}
					onChange={(e) => {
						setDraft(e.target.value);
						const next = e.target.value.trim();
						if (next === "") onChange("*");
						else if (AGENT.test(next)) onChange(next);
					}}
				/>
				{bad && <span className="danger-text">{t("Agents are named by their IDs.")}</span>}
			</label>
			<AgentOptions id={list} also={also} />
		</>
	);
}

/** AgentsField is a list of agents, as removable chips with a box that suggests the organization's agents. */
function AgentsField({ value, onChange }: { value: string[]; onChange(agents: string[]): void }) {
	const { t } = useI18n();
	const { agents } = useWorkspace();
	const list = useId();
	const [draft, setDraft] = useState("");
	const bad = draft.trim() !== "" && !AGENT.test(draft.trim());
	const add = (name: string) => {
		const next = name.trim();
		if (!AGENT.test(next)) return false;
		if (!value.includes(next)) onChange([...value, next]);
		setDraft("");
		return true;
	};
	return (
		<div className="modelkeys-agents">
			<span>{t("Only for these agents")}</span>
			<div className="modelkeys-chips">
				{value.map((name) => (
					<span key={name} className="modelkeys-chip">
						{agents.find((a) => a.name === name)?.title ?? name}
						<button type="button" className="icon-button" aria-label={t("Remove {name}", { name })} onClick={() => onChange(value.filter((a) => a !== name))}>
							<X size={12} aria-hidden="true" />
						</button>
					</span>
				))}
				<input
					list={list}
					value={draft}
					placeholder={value.length === 0 ? t("Every agent") : t("Add an agent")}
					aria-label={t("Add an agent")}
					aria-invalid={bad}
					onChange={(e) => {
						// Picking from the list fills the whole name at once, so it's added straight away.
						if (agents.some((a) => a.name === e.target.value) && add(e.target.value)) return;
						setDraft(e.target.value.replace(",", ""));
					}}
					onKeyDown={(e) => {
						if ((e.key === "Enter" || e.key === ",") && draft.trim() !== "") {
							e.preventDefault();
							add(draft);
						} else if (e.key === "Backspace" && draft === "" && value.length > 0) onChange(value.slice(0, -1));
					}}
					onBlur={() => draft.trim() !== "" && add(draft)}
				/>
				<AgentOptions id={list} />
			</div>
			{bad ? (
				<span className="danger-text">{t("Agents are named by their IDs.")}</span>
			) : (
				<span className="quiet">{t("Empty for every agent. Agents listed here use this key before the others.")}</span>
			)}
		</div>
	);
}

/** The platform models a tenant may answer with its own, which embeddings never are until re-indexing exists. */
function mappableAliases(keys: Keys) {
	return keys.aliases.filter((a) => a.mappable && a.capability !== "embedding");
}

/** The platform models a tenant's choices send to an endpoint. */
function usedFor(keys: Keys, endpoint: string): string[] {
	return [...new Set(keys.mappings.filter((m) => m.chain.some((l) => l.endpoint === endpoint)).map((m) => m.alias))];
}

/** The endpoint's own models those choices name. */
function modelsUsed(keys: Keys, endpoint: string): string[] {
	return keys.mappings.flatMap((m) => m.chain.filter((l) => l.endpoint === endpoint).map((l) => l.model));
}

/** Administration → Model keys: the tenant's own keys and endpoints, which models use them, and when the platform's take over. */
export function ModelKeysSettings() {
	const { t, describe } = useI18n();
	const keys = useQuery({ queryKey: ["model-keys"], queryFn: getModelKeys, retry: false });
	const [adding, setAdding] = useState<{ what: "key" | "endpoint" | "mapping"; endpoint?: string } | undefined>();

	if (keys.isPending) return <Skeleton rows={4} />;
	if (keys.isError) return <Empty icon={KeyRound} title={t("Model keys can't be read right now.")}>{describe(keys.error)}</Empty>;
	const data = keys.data;
	const offered = CAPABILITIES.filter(
		(c) => data.platform[c]?.byok_providers.length > 0 || data.platform[c]?.endpoints_allowed || data.policies.some((p) => p.capability === c),
	);
	const ownKeys = data.credentials.filter((c) => c.provider !== undefined);
	const mappable = mappableAliases(data);
	const mayKeys = data.sealing && data.providers.length > 0 && (ownKeys.length > 0 || CAPABILITIES.some((c) => data.platform[c]?.byok_providers.length > 0));
	const mayEndpoints = CAPABILITIES.some((c) => data.platform[c]?.endpoints_allowed);
	return (
		<div className="modelkeys" data-testid="model-keys">
			<p className="quiet">{t("Your organization's own keys and model servers, and when the platform's keys take over. Keys are never shown again once saved.")}</p>
			{!data.sealing && <p className="modelkeys-notice">{t("This platform has no key for storing secrets, so keys can't be added yet.")}</p>}
			{data.gateway === "unreachable" && <p className="modelkeys-notice">{t("The model gateway can't be reached, so providers and models aren't listed right now.")}</p>}
			{offered.length === 0 && data.credentials.length === 0 && (
				<Empty icon={KeyRound} title={t("Your organization uses the platform's keys.")}>
					{t("Ask the platform to let you bring your own keys or endpoints.")}
				</Empty>
			)}

			{offered.length > 0 && (
				<section className="modelkeys-section">
					<h3>{t("Which keys pay")}</h3>
					{offered.map((capability) => (
						<PolicyRow key={capability} keys={data} capability={capability} />
					))}
				</section>
			)}

			{(mayKeys || ownKeys.length > 0) && (
				<section className="modelkeys-section">
					<header className="modelkeys-head">
						<h3>{t("Keys")}</h3>
						{mayKeys && (
							<button type="button" className="primary small" onClick={() => setAdding({ what: "key" })} data-testid="model-key-new">
								<Plus size={14} aria-hidden="true" />
								{t("Add key")}
							</button>
						)}
					</header>
					<p className="quiet">{t("Your accounts with the platform's providers. They answer the platform's models as they are.")}</p>
					{ownKeys.length === 0 ? (
						<p className="quiet">{t("No keys of your own.")}</p>
					) : (
						<ul className="modelkeys-list">
							{ownKeys.map((c) => (
								<KeyRow key={c.id} credential={c} />
							))}
						</ul>
					)}
				</section>
			)}

			{(mayEndpoints || data.endpoints.length > 0) && (
				<section className="modelkeys-section">
					<header className="modelkeys-head">
						<h3>{t("Endpoints")}</h3>
						{data.sealing && mayEndpoints && (
							<button type="button" className="primary small" onClick={() => setAdding({ what: "endpoint" })} data-testid="model-endpoint-new">
								<Plus size={14} aria-hidden="true" />
								{t("Add endpoint")}
							</button>
						)}
					</header>
					<p className="quiet">
						{t("Your own model servers, such as an Azure OpenAI deployment. One takes calls only for the models you choose for it under Models. Prompts, tool results and replies of those calls go to it.")}
					</p>
					{mayEndpoints && mappable.length === 0 && <p className="modelkeys-notice">{t("The platform hasn't let organizations choose models yet, so an endpoint takes no calls.")}</p>}
					{data.endpoints.length === 0 ? (
						<p className="quiet">{t("No endpoints of your own.")}</p>
					) : (
						<ul className="modelkeys-list">
							{data.endpoints.map((e) => (
								<EndpointRow
									key={e.id}
									endpoint={e}
									credential={data.credentials.find((c) => c.endpoint === e.id)}
									used={usedFor(data, e.id)}
									models={modelsUsed(data, e.id)}
									onChoose={mappable.length > 0 ? () => setAdding({ what: "mapping", endpoint: e.id }) : undefined}
								/>
							))}
						</ul>
					)}
				</section>
			)}

			{mappable.length > 0 && (data.endpoints.length > 0 || data.assigned_endpoints.length > 0 || ownKeys.length > 0 || data.mappings.length > 0) && (
				<section className="modelkeys-section">
					<header className="modelkeys-head">
						<h3>{t("Models")}</h3>
						<button type="button" className="primary small" onClick={() => setAdding({ what: "mapping" })} data-testid="model-mapping-new">
							<Plus size={14} aria-hidden="true" />
							{t("Choose a model")}
						</button>
					</header>
					<p className="quiet">
						{t("Agents keep asking for the platform's model, and your choice answers instead. They keep their instructions, which were tuned for the platform's model: a check proves a model works, not that an agent works well on it.")}
					</p>
					{data.mappings.length === 0 ? (
						<p className="quiet">{t("Agents use the platform's models.")}</p>
					) : (
						<ul className="modelkeys-list">
							{data.mappings.map((m) => (
								<MappingRow key={`${m.alias}/${m.agent}`} keys={data} alias={m.alias} agent={m.agent} chain={m.chain} />
							))}
						</ul>
					)}
				</section>
			)}

			{(data.assigned.length > 0 || data.assigned_endpoints.length > 0) && (
				<section className="modelkeys-section">
					<h3>{t("From the platform")}</h3>
					<p className="quiet">{t("Keys and endpoints the platform gave your organization. It pays for them, and you never see their keys.")}</p>
					<ul className="modelkeys-list">
						{data.assigned.map((a) => (
							<li key={a.id} className="modelkeys-row">
								<span className="modelkeys-name">
									<span className="modelkeys-title">
										<strong>{a.label}</strong>
										<State status={a.status} />
									</span>
									<span className="quiet">{a.provider ?? a.endpoint}</span>
								</span>
							</li>
						))}
						{data.assigned_endpoints.map((e) => {
							const used = usedFor(data, e.id);
							return (
								<li key={e.id} className="modelkeys-row">
									<span className="modelkeys-name">
										<strong>{e.name}</strong>
										<span className="quiet">
											{e.kind}
											{e.region !== undefined && e.region !== "" && ` · ${e.region}`} · {t("{count} models", { count: e.models.length })}
										</span>
										{used.length > 0 ? (
											<span className="modelkeys-used">{t("Used for {models}", { models: used.join(", ") })}</span>
										) : (
											<span className="modelkeys-used warn">
												{t("No model is chosen for it yet, so it takes no calls.")}
												{mappable.length > 0 && (
													<button type="button" className="ghost small" onClick={() => setAdding({ what: "mapping", endpoint: e.id })}>
														{t("Choose a model")}
													</button>
												)}
											</span>
										)}
									</span>
								</li>
							);
						})}
					</ul>
				</section>
			)}

			{data.changes.length > 0 && <Changes changes={data.changes} />}

			{adding?.what === "key" && <AddKey keys={data} onClose={() => setAdding(undefined)} />}
			{adding?.what === "endpoint" && <AddEndpoint keys={data} onClose={() => setAdding(undefined)} />}
			{adding?.what === "mapping" && <AddMapping keys={data} endpoint={adding.endpoint} onClose={() => setAdding(undefined)} />}
		</div>
	);
}

function Changes({ changes }: { changes: Keys["changes"] }) {
	const { t, ago } = useI18n();
	const nameOf = useMemberName();
	return (
		<section className="modelkeys-section">
			<h3>{t("Recent changes")}</h3>
			<ul className="modelkeys-changes">
				{changes.slice(0, 10).map((c, i) => {
					const mode = MODE_LABELS[c.reason as Mode];
					return (
						<li key={i}>
							<span>
								<strong>{c.platform ? t("The platform") : nameOf(c.actor)}</strong> {t(CHANGE_ACTIONS[c.action] ?? c.action)} {t(CHANGE_OBJECTS[c.object] ?? c.object)}
								{mode !== undefined ? <span className="quiet"> — {t(mode)}</span> : c.reason !== undefined && c.reason !== "" && !c.reason.includes(":t10/") && <span className="quiet"> — {c.reason}</span>}
							</span>
							<span className="quiet">{ago(Date.parse(c.at))}</span>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function useRefresh() {
	const queries = useQueryClient();
	return () => void queries.invalidateQueries({ queryKey: ["model-keys"] });
}

function PolicyRow({ keys, capability }: { keys: Keys; capability: Capability }) {
	const { t, describe } = useI18n();
	const { toast } = useFeedback();
	const refresh = useRefresh();
	const [agent, setAgent] = useState("*");
	const current = effectiveMode(keys, capability, agent);
	const stored = keys.policies.find((p) => p.capability === capability && p.agent === agent);
	const allowed = keys.platform[capability].allowed_modes.length > 0 ? keys.platform[capability].allowed_modes : MODES;
	const agents = [...new Set(keys.policies.filter((p) => p.capability === capability && p.agent !== "*").map((p) => p.agent))];
	const save = useMutation({
		mutationFn: (v: { mode: Mode; fallbackOn: Reason[] }) => putPolicy(capability, agent, v.mode, v.fallbackOn),
		onSuccess: refresh,
		onError: (e: Error) => toast(e.message || describe(e)),
	});
	const reset = useMutation({ mutationFn: () => deletePolicy(capability, agent), onSuccess: refresh, onError: (e: Error) => toast(e.message || describe(e)) });
	const fallbackOn = stored?.fallback_on ?? REASONS;
	const falls = current.mode !== "strict" && current.mode !== "platform";
	// With only endpoints, strict leaves every platform model nobody chose for one without a key.
	const ownKey = keys.credentials.some((c) => c.provider !== undefined && c.status !== "disabled" && keys.providers.find((p) => p.name === c.provider)?.capabilities.includes(capability));
	const onlyChosen = current.mode === "strict" && capability === "llm" && !ownKey && keys.endpoints.some((e) => e.status === "active");
	return (
		<div className="modelkeys-policy" data-testid={`policy-${capability}`}>
			<div className="modelkeys-policy-head">
				<strong>{t(CAPABILITY_LABELS[capability])}</strong>
				{!current.set && <span className="pill">{t("The default")}</span>}
			</div>
			<div className="modelkeys-policy-fields">
				<label>
					<span className="quiet">{t("Calls use")}</span>
					<select
						value={current.mode}
						onChange={(e) => save.mutate({ mode: e.target.value as Mode, fallbackOn })}
						disabled={save.isPending}
						data-testid={`policy-${capability}-mode`}
					>
						{allowed.map((m) => (
							<option key={m} value={m}>
								{t(MODE_LABELS[m])}
							</option>
						))}
					</select>
				</label>
				<AgentField label={t("For")} value={agent} onChange={setAgent} also={agents} />
			</div>
			<p className="quiet modelkeys-hint">{t(MODE_HINTS[current.mode])}</p>
			{onlyChosen && (
				<p className="modelkeys-warn" role="note">
					{t("Only the models you choose under Models can be used. An agent asking for any other model is refused. To let the platform answer those, choose “Our keys, then the platform's”.")}
				</p>
			)}
			{falls && (
				<div className="modelkeys-reasons">
					<span className="quiet">{t("Move on when a key is")}</span>
					{REASONS.map((r) => (
						<label key={r} className="modelkeys-check">
							<input
								type="checkbox"
								checked={fallbackOn.includes(r)}
								onChange={(e) =>
									save.mutate({ mode: current.mode, fallbackOn: e.target.checked ? [...fallbackOn, r] : fallbackOn.filter((x) => x !== r) })
								}
							/>
							{t(REASON_LABELS[r])}
						</label>
					))}
				</div>
			)}
			{stored !== undefined && (
				<button type="button" className="ghost small" onClick={() => reset.mutate()} disabled={reset.isPending}>
					{agent === "*" ? t("Use the default") : t("Use every agent's")}
				</button>
			)}
		</div>
	);
}

function KeyRow({ credential: c }: { credential: Keys["credentials"][number] }) {
	const { t, describe, ago } = useI18n();
	const { toast, confirm } = useFeedback();
	const refresh = useRefresh();
	const [replacing, setReplacing] = useState(false);
	const [editing, setEditing] = useState(false);
	const toggle = useMutation({ mutationFn: () => patchKey(c.id, { disabled: c.status !== "disabled" }), onSuccess: refresh, onError: (e: Error) => toast(e.message || describe(e)) });
	const remove = useMutation({ mutationFn: () => deleteKey(c.id), onSuccess: refresh, onError: (e: Error) => toast(e.message || describe(e)) });
	return (
		<li className="modelkeys-row" data-testid={`model-key-${c.label}`}>
			<span className="modelkeys-name">
				<span className="modelkeys-title">
					<strong>{c.label}</strong>
					<State status={c.status} />
				</span>
				<span className="quiet">
					{c.provider} · {c.hint}
					{c.agents.length > 0 && ` · ${t("first for {agents}", { agents: c.agents.join(", ") })}`}
					{c.weight > 1 && ` · ${t("weight {weight}", { weight: c.weight })}`} · {t("Changed {when}", { when: ago(Date.parse(c.updated_at)) })}
				</span>
				{c.status_reason !== undefined && c.status_reason !== "" && <span className="danger-text">{c.status_reason}</span>}
			</span>
			<span className="modelkeys-actions">
				<button type="button" className="ghost small" onClick={() => setReplacing(true)}>
					{t("Replace")}
				</button>
				<button type="button" className="ghost small" onClick={() => setEditing(true)}>
					{t("Agents and weight")}
				</button>
				<button type="button" className="ghost small" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
					{c.status === "disabled" ? t("Turn on") : t("Turn off")}
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Delete")}
					onClick={async () => (await confirm({ title: t("Delete {name}?", { name: c.label }), body: t("Calls stop using it at once."), action: t("Delete"), danger: true })) && remove.mutate()}
				>
					<Trash2 size={14} aria-hidden="true" />
				</button>
			</span>
			{replacing && <ReplaceKey id={c.id} label={c.label} onClose={() => setReplacing(false)} />}
			{editing && <KeySettings credential={c} onClose={() => setEditing(false)} />}
		</li>
	);
}

/** State is a key's or endpoint's state, as a pill. */
function State({ status }: { status: string }) {
	const { t } = useI18n();
	return <span className={`pill ${status === "active" ? "done" : status === "rejected" ? "warn" : ""}`}>{t(STATUS_LABELS[status] ?? "On")}</span>;
}

/** KeySettings changes which agents use a key first, and its weight. No agents means every agent. */
function KeySettings({ credential: c, onClose }: { credential: Keys["credentials"][number]; onClose(): void }) {
	const { t, describe } = useI18n();
	const refresh = useRefresh();
	const [agents, setAgents] = useState(c.agents);
	const [weight, setWeight] = useState(String(c.weight || 1));
	const n = Number(weight);
	const badWeight = !Number.isInteger(n) || n < 1 || n > 100;
	const save = useMutation({
		mutationFn: () => patchKey(c.id, { agents, weight: n }),
		onSuccess: () => {
			refresh();
			onClose();
		},
	});
	return (
		<Dialog label={t("Agents and weight")} onClose={onClose}>
			<h2>{c.label}</h2>
			<form
				className="modelkeys-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (!badWeight) save.mutate();
				}}
			>
				<AgentsField value={agents} onChange={setAgents} />
				<label>
					<span>{t("Weight")}</span>
					<input value={weight} inputMode="numeric" onChange={(e) => setWeight(e.target.value)} />
					<span className="quiet">{badWeight ? t("Weight is from 1 to 100.") : t("Keys for the same agents share calls by weight.")}</span>
				</label>
				{save.isError && <p className="danger-text">{save.error.message || describe(save.error)}</p>}
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={save.isPending || badWeight}>
						{t("Save")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

/** saveAnyway runs a write, and offers to repeat it when the provider couldn't be reached to check the key. */
function useCheckedSave<T>(run: (saveUnreachable: boolean) => Promise<T>, done: () => void) {
	const { describe } = useI18n();
	const refresh = useRefresh();
	const [unreachable, setUnreachable] = useState(false);
	const save = useMutation({
		mutationFn: (force: boolean) => run(force),
		onSuccess: () => {
			refresh();
			done();
		},
		onError: (e: Error) => setUnreachable(e instanceof ApiError && e.code === "unreachable"),
	});
	const error = save.isError ? save.error.message || describe(save.error) : undefined;
	return { save, unreachable, error };
}

function ReplaceKey({ id, label, onClose }: { id: string; label: string; onClose(): void }) {
	const { t } = useI18n();
	const [secret, setSecret] = useState("");
	const { save, unreachable, error } = useCheckedSave((force) => replaceKey(id, secret, force), onClose);
	return (
		<Dialog label={t("Replace key")} onClose={onClose}>
			<h2>{t("Replace {name}", { name: label })}</h2>
			<form
				className="modelkeys-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (secret !== "") save.mutate(false);
				}}
			>
				<label>
					<span>{t("New key")}</span>
					<input type="password" autoComplete="off" value={secret} autoFocus onChange={(e) => setSecret(e.target.value)} />
					<span className="quiet">{t("It's checked with the provider before it replaces the old one.")}</span>
				</label>
				{error !== undefined && <p className="danger-text">{error}</p>}
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					{unreachable && (
						<button type="button" className="ghost" onClick={() => save.mutate(true)} disabled={save.isPending}>
							{t("Save anyway")}
						</button>
					)}
					<button type="submit" className="primary" disabled={save.isPending || secret === ""}>
						{t("Replace")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

function AddKey({ keys, onClose }: { keys: Keys; onClose(): void }) {
	const { t } = useI18n();
	const [provider, setProvider] = useState(keys.providers[0]?.name ?? "");
	const [label, setLabel] = useState("");
	const [secret, setSecret] = useState("");
	const [agents, setAgents] = useState<string[]>([]);
	const [cap, setCap] = useState("");
	const { save, unreachable, error } = useCheckedSave(
		(force) =>
			addKey({
				provider,
				label: label.trim(),
				secret,
				agents,
				...(cap === "" ? {} : { monthly_token_cap: Number(cap) }),
				save_unreachable: force,
			}),
		onClose,
	);
	const ready = provider !== "" && label.trim() !== "" && secret !== "";
	return (
		<Dialog label={t("Add key")} onClose={onClose}>
			<h2>{t("Add key")}</h2>
			<form
				className="modelkeys-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready) save.mutate(false);
				}}
			>
				<label>
					<span>{t("Provider")}</span>
					<select value={provider} onChange={(e) => setProvider(e.target.value)} data-testid="model-key-provider">
						{keys.providers.map((p) => (
							<option key={p.name} value={p.name}>
								{p.name}
								{p.region !== undefined && p.region !== "" ? ` (${p.region})` : ""}
								{` · ${p.capabilities.join(", ")}`}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>{t("Name")}</span>
					<input value={label} maxLength={64} autoFocus placeholder={t("Production key")} onChange={(e) => setLabel(e.target.value)} data-testid="model-key-label" />
				</label>
				<label>
					<span>{t("Key")}</span>
					<input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} data-testid="model-key-secret" />
					<span className="quiet">{t("It's checked with the provider, then stored sealed. Nobody can read it back, admins included.")}</span>
				</label>
				<AgentsField value={agents} onChange={setAgents} />
				<label>
					<span>{t("Monthly token cap")}</span>
					<input value={cap} inputMode="numeric" placeholder={t("No cap")} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} />
				</label>
				{error !== undefined && <p className="danger-text">{error}</p>}
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					{unreachable && (
						<button type="button" className="ghost" onClick={() => save.mutate(true)} disabled={save.isPending}>
							{t("Save anyway")}
						</button>
					)}
					<button type="submit" className="primary" disabled={save.isPending || !ready} data-testid="model-key-save">
						{t("Check and save")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

function EndpointRow({
	endpoint: e,
	credential,
	used,
	models,
	onChoose,
}: { endpoint: Endpoint; credential?: Keys["credentials"][number]; used: string[]; models: string[]; onChoose?: () => void }) {
	const { t, describe } = useI18n();
	const { toast, confirm } = useFeedback();
	const refresh = useRefresh();
	const [replacing, setReplacing] = useState(false);
	const check = useMutation({ mutationFn: () => checkEndpoint(e.id), onSuccess: refresh, onError: (err: Error) => toast(err.message || describe(err)) });
	const toggle = useMutation({ mutationFn: () => patchEndpoint(e.id, { disabled: e.status === "active" }), onSuccess: refresh, onError: (err: Error) => toast(err.message || describe(err)) });
	const remove = useMutation({ mutationFn: () => deleteEndpoint(e.id), onSuccess: refresh, onError: (err: Error) => toast(err.message || describe(err)) });
	const mark = (ok: boolean | undefined, label: string) => (ok === undefined ? null : <span className={ok ? "ok" : "no"}>{t(label)}</span>);
	// The models a choice uses show, or else a few that stream and call tools; the rest fold, since one can serve a hundred.
	const inUse = e.models.filter((m) => models.includes(m.name));
	const checked = inUse.length > 0 ? inUse : e.models.filter((m) => m.streaming === true && m.tools === true).slice(0, 5);
	const listed = e.models.filter((m) => !checked.includes(m));
	const idle = e.status === "active" && used.length === 0;
	return (
		<li className="modelkeys-row endpoint" data-testid={`model-endpoint-${e.name}`}>
			<span className="modelkeys-name">
				<span className="modelkeys-title">
					<strong>{e.name}</strong>
					<State status={credential?.status === "rejected" ? "rejected" : e.status} />
					{idle && <span className="pill warn">{t("Takes no calls")}</span>}
				</span>
				<span className="quiet">
					{e.kind} · {e.base_url} · {e.auth_kind === "none" ? t("no sign-in") : credential !== undefined ? t("signs in with {hint}", { hint: credential.hint }) : t("signs in with a key")}
				</span>
				{e.region !== undefined && e.region !== "" && (
					<span className="quiet">
						{e.region_confirmed_by ? t("Region {region}, confirmed", { region: e.region }) : t("Region {region}, waiting for the platform to confirm", { region: e.region })}
					</span>
				)}
				{e.status_reason !== undefined && e.status_reason !== "" && <span className="danger-text">{e.status_reason}</span>}
				{credential?.status === "rejected" && <span className="danger-text">{t("Its key was refused: {reason}", { reason: credential.status_reason ?? "" })}</span>}
				{used.length > 0 ? (
					<span className="modelkeys-used">{t("Used for {models}", { models: used.join(", ") })}</span>
				) : (
					e.status === "active" && (
						<span className="modelkeys-used warn">
							{onChoose !== undefined ? t("No model is chosen for it yet, so it takes no calls.") : t("The platform hasn't let organizations choose models yet, so it takes no calls.")}
							{onChoose !== undefined && (
								<button type="button" className="ghost small" onClick={onChoose}>
									{t("Choose a model")}
								</button>
							)}
						</span>
					)
				)}
				{checked.length > 0 && (
					<span className="modelkeys-models">
						{checked.map((m) => (
							<span key={m.name} className="modelkeys-model">
								{m.name} {mark(m.streaming, "streams")} {mark(m.tools, "tools")} {mark(m.images, "images")} {mark(m.responses, "Responses")}
							</span>
						))}
					</span>
				)}
				{listed.length > 0 && (
					<details className="modelkeys-more">
						<summary>{checked.length > 0 ? t("{count} more models it serves", { count: listed.length }) : t("{count} models it serves", { count: listed.length })}</summary>
						<span className="modelkeys-models">
							{listed.map((m) => (
								<span key={m.name} className="modelkeys-model">
									{m.name} {mark(m.streaming, "streams")} {mark(m.tools, "tools")} {mark(m.images, "images")} {mark(m.responses, "Responses")}
								</span>
							))}
						</span>
					</details>
				)}
			</span>
			<span className="modelkeys-actions">
				<button type="button" className="ghost small" onClick={() => check.mutate()} disabled={check.isPending}>
					{check.isPending ? t("Checking…") : t("Check again")}
				</button>
				{credential !== undefined && (
					<button type="button" className="ghost small" onClick={() => setReplacing(true)}>
						{t("Replace key")}
					</button>
				)}
				<button type="button" className="ghost small" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
					{e.status === "active" ? t("Turn off") : t("Turn on")}
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Delete")}
					onClick={async () =>
						(await confirm({ title: t("Delete {name}?", { name: e.name }), body: t("Its key and the model choices that use it go too."), action: t("Delete"), danger: true })) && remove.mutate()
					}
				>
					<Trash2 size={14} aria-hidden="true" />
				</button>
			</span>
			{replacing && credential !== undefined && <ReplaceKey id={credential.id} label={e.name} onClose={() => setReplacing(false)} />}
		</li>
	);
}

function AddEndpoint({ keys, onClose }: { keys: Keys; onClose(): void }) {
	const { t } = useI18n();
	const allowedKinds = KINDS.filter((k) =>
		(k === "openai_embeddings" ? ["embedding"] : k === "dashscope_realtime" ? ["stt", "tts"] : ["llm"]).some((c) => keys.platform[c as Capability]?.endpoints_allowed),
	);
	const [name, setName] = useState("");
	const [kind, setKind] = useState<Kind>(allowedKinds[0] ?? "openai_chat");
	const [url, setUrl] = useState("");
	const [region, setRegion] = useState("");
	const [auth, setAuth] = useState<Endpoint["auth_kind"]>("bearer");
	const [header, setHeader] = useState("api-key");
	const [secret, setSecret] = useState("");
	const [models, setModels] = useState("");
	const { save, unreachable, error } = useCheckedSave(
		(force) =>
			addEndpoint({
				name: name.trim(),
				kind,
				base_url: url.trim(),
				...(region === "" ? {} : { region }),
				auth_kind: auth,
				...(auth === "header" ? { auth_header: header } : {}),
				...(auth === "none" ? {} : { secret }),
				models: commaList(models),
				save_unreachable: force,
			}),
		onClose,
	);
	const ready = name.trim() !== "" && url.trim() !== "" && (auth === "none" || secret !== "");
	return (
		<Dialog label={t("Add endpoint")} onClose={onClose}>
			<h2>{t("Add endpoint")}</h2>
			<form
				className="modelkeys-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready) save.mutate(false);
				}}
			>
				<label>
					<span>{t("Name")}</span>
					<input value={name} maxLength={64} autoFocus placeholder="Azure OpenAI" onChange={(e) => setName(e.target.value)} data-testid="model-endpoint-name" />
				</label>
				<label>
					<span>{t("Protocol")}</span>
					<select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
						{allowedKinds.map((k) => (
							<option key={k} value={k}>
								{k}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>{t("Address")}</span>
					<input value={url} type="url" placeholder="https://acme.openai.azure.com/openai/v1" onChange={(e) => setUrl(e.target.value)} data-testid="model-endpoint-url" />
					<span className="quiet">{t("HTTPS, at a public address.")}</span>
				</label>
				<label>
					<span>{t("Region")}</span>
					<input value={region} placeholder="cn-beijing" onChange={(e) => setRegion(e.target.value.toLowerCase())} />
					<span className="quiet">{t("Where it processes data. It counts for your organization's regions once the platform confirms it.")}</span>
				</label>
				<label>
					<span>{t("Signs in with")}</span>
					<select value={auth} onChange={(e) => setAuth(e.target.value as Endpoint["auth_kind"])}>
						<option value="bearer">{t("A bearer key")}</option>
						<option value="header">{t("A key in a header")}</option>
						<option value="none">{t("Nothing")}</option>
					</select>
				</label>
				{auth === "header" && (
					<label>
						<span>{t("Header")}</span>
						<input value={header} onChange={(e) => setHeader(e.target.value)} />
					</label>
				)}
				{auth !== "none" && (
					<label>
						<span>{t("Key")}</span>
						<input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} data-testid="model-endpoint-secret" />
					</label>
				)}
				<label>
					<span>{t("Models to check")}</span>
					<input value={models} placeholder="gpt-5.4, gpt-5.4-mini" onChange={(e) => setModels(e.target.value)} />
					<span className="quiet">{t("The gateway lists the rest where it can, and checks streaming, tools and images for these.")}</span>
				</label>
				{error !== undefined && <p className="danger-text">{error}</p>}
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					{unreachable && (
						<button type="button" className="ghost" onClick={() => save.mutate(true)} disabled={save.isPending}>
							{t("Save anyway")}
						</button>
					)}
					<button type="submit" className="primary" disabled={save.isPending || !ready} data-testid="model-endpoint-save">
						{save.isPending ? t("Checking…") : t("Check and save")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

function linkLabel(keys: Keys, link: Link): string {
	if (link.endpoint !== undefined) {
		const e = keys.endpoints.find((x) => x.id === link.endpoint) ?? keys.assigned_endpoints.find((x) => x.id === link.endpoint);
		return `${e?.name ?? link.endpoint} · ${link.model}`;
	}
	return `${link.provider} · ${link.model}`;
}

function MappingRow({ keys, alias, agent, chain }: { keys: Keys; alias: string; agent: string; chain: Link[] }) {
	const { t, describe } = useI18n();
	const { toast, confirm } = useFeedback();
	const refresh = useRefresh();
	const remove = useMutation({ mutationFn: () => deleteMapping(alias, agent), onSuccess: refresh, onError: (e: Error) => toast(e.message || describe(e)) });
	return (
		<li className="modelkeys-row" data-testid={`model-mapping-${alias}`}>
			<span className="modelkeys-name">
				<span className="modelkeys-title">
					<strong className="mono">{alias}</strong>
					<span className="pill">{agent === "*" ? t("Every agent") : agent}</span>
				</span>
				<span className="modelkeys-chain">
					{chain.map((l, i) => (
						<span key={i}>
							{i > 0 && <span className="quiet"> {t("then")} </span>}
							<span className="modelkeys-model">{linkLabel(keys, l)}</span>
						</span>
					))}
				</span>
			</span>
			<span className="modelkeys-actions">
				<button
					type="button"
					className="icon-button"
					aria-label={t("Delete")}
					onClick={async () =>
						(await confirm({ title: t("Stop answering {model} with your choice?", { model: alias }), body: t("Agents go back to the platform's model."), action: t("Stop"), danger: true })) &&
						remove.mutate()
					}
					disabled={remove.isPending}
				>
					<Trash2 size={14} aria-hidden="true" />
				</button>
			</span>
		</li>
	);
}

type Target = { value: string; label: string; models: string[]; checks: Map<string, ModelCheck> };

/** The checks a model must pass for an alias that it failed, where its endpoint checked it. */
function failed(target: Target | undefined, model: string, requires: string[]): string[] {
	const check = target?.checks.get(model.trim());
	if (check === undefined) return [];
	const passed: Record<string, boolean | undefined> = { streaming: check.streaming, tools: check.tools, images: check.images, responses: check.responses };
	return requires.filter((r) => passed[r] === false);
}

function AddMapping({ keys, endpoint, onClose }: { keys: Keys; endpoint?: string; onClose(): void }) {
	const { t, describe } = useI18n();
	const refresh = useRefresh();
	const aliases = mappableAliases(keys);
	const [alias, setAlias] = useState(aliases[0]?.alias ?? "");
	const [agent, setAgent] = useState("");
	const targets: Target[] = [
		...keys.endpoints
			.filter((e) => e.status === "active")
			.map((e) => {
				// Models that passed the checks first: those are the ones known to work.
				const checked = e.models.filter((m) => m.streaming === true && m.tools === true);
				return {
					value: `endpoint:${e.id}`,
					label: e.name,
					models: [...checked, ...e.models.filter((m) => !checked.includes(m))].map((m) => m.name),
					checks: new Map(e.models.map((m) => [m.name, m])),
				};
			}),
		...keys.assigned_endpoints.map((e) => ({ value: `endpoint:${e.id}`, label: e.name, models: e.models, checks: new Map<string, ModelCheck>() })),
		...keys.providers.map((p) => ({ value: `provider:${p.name}`, label: p.name, models: [], checks: new Map<string, ModelCheck>() })),
	];
	// The model with the alias's own name, where the target serves it, else the first that passed its checks.
	const suggest = (target: string, forAlias: string) => {
		const found = targets.find((x) => x.value === target);
		if (found === undefined) return "";
		return found.models.includes(forAlias) ? forAlias : (found.models[0] ?? "");
	};
	const first = endpoint !== undefined ? `endpoint:${endpoint}` : (targets[0]?.value ?? "");
	const [chain, setChain] = useState<{ target: string; model: string }[]>([{ target: first, model: suggest(first, aliases[0]?.alias ?? "") }]);
	const save = useMutation({
		mutationFn: () =>
			putMapping(
				alias,
				agent.trim() === "" ? "*" : agent.trim(),
				chain.map((c) => {
					const [type, id] = c.target.split(/:(.*)/s);
					return type === "endpoint" ? { endpoint: id, model: c.model.trim() } : { provider: id, model: c.model.trim() };
				}),
			),
		onSuccess: () => {
			refresh();
			onClose();
		},
	});
	const requires = aliases.find((a) => a.alias === alias)?.requires ?? [];
	const ready = alias !== "" && chain.every((c) => c.target !== "" && c.model.trim() !== "") && (agent.trim() === "" || AGENT.test(agent.trim()));
	if (aliases.length === 0) {
		return (
			<Dialog label={t("Choose a model")} onClose={onClose}>
				<p>{t("The platform doesn't let organizations choose models yet.")}</p>
			</Dialog>
		);
	}
	return (
		<Dialog label={t("Choose a model")} onClose={onClose} wide>
			<h2>{t("Choose a model")}</h2>
			<p className="quiet">{t("When an agent asks for the platform's model, your choice answers instead.")}</p>
			<form
				className="modelkeys-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready) save.mutate();
				}}
			>
				<label>
					<span>{t("In place of")}</span>
					<select
						value={alias}
						onChange={(e) => {
							setAlias(e.target.value);
							setChain(chain.map((c, i) => (i === 0 && c.model === suggest(c.target, alias) ? { ...c, model: suggest(c.target, e.target.value) } : c)));
						}}
					>
						{aliases.map((a) => (
							<option key={a.alias} value={a.alias}>
								{a.alias}
							</option>
						))}
					</select>
					{requires.length > 0 && <span className="quiet">{t("A model here must pass: {checks}.", { checks: requires.join(", ") })}</span>}
				</label>
				<AgentField label={t("For")} value={agent === "" ? "*" : agent} onChange={(a) => setAgent(a === "*" ? "" : a)} />
				{chain.map((step, i) => {
					const target = targets.find((x) => x.value === step.target);
					const missing = failed(target, step.model, requires);
					return (
						<div key={i} className="modelkeys-step-wrap">
							<div className="modelkeys-step">
								<span className="quiet">{i === 0 ? t("First") : t("Then")}</span>
								<select
									value={step.target}
									aria-label={t("Endpoint or provider")}
									onChange={(e) => setChain(chain.map((c, j) => (j === i ? { target: e.target.value, model: suggest(e.target.value, alias) } : c)))}
								>
									{targets.map((x) => (
										<option key={x.value} value={x.value}>
											{x.label}
										</option>
									))}
								</select>
								<input
									list={`models-${i}`}
									value={step.model}
									placeholder={t("Model")}
									aria-label={t("Model")}
									onChange={(e) => setChain(chain.map((c, j) => (j === i ? { ...c, model: e.target.value } : c)))}
								/>
								<datalist id={`models-${i}`}>
									{(target?.models ?? []).map((m) => (
										<option key={m} value={m} />
									))}
								</datalist>
								{chain.length > 1 && (
									<button type="button" className="icon-button" aria-label={t("Remove")} onClick={() => setChain(chain.filter((_, j) => j !== i))}>
										<Trash2 size={14} aria-hidden="true" />
									</button>
								)}
							</div>
							{missing.length > 0 && <p className="danger-text">{t("It failed the check for {checks}, so it can't be chosen here.", { checks: missing.join(", ") })}</p>}
						</div>
					);
				})}
				{chain.length < 3 && (
					<button type="button" className="ghost small" onClick={() => setChain([...chain, { target: targets[0]?.value ?? "", model: "" }])}>
						{t("Add a fallback")}
					</button>
				)}
				{save.isError && <p className="danger-text">{save.error.message || describe(save.error)}</p>}
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={save.isPending || !ready || chain.some((c) => failed(targets.find((x) => x.value === c.target), c.model, requires).length > 0)}>
						{t("Save")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
