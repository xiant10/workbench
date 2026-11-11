import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { Dialog, Empty, Skeleton, useFeedback } from "../lib/ui.tsx";
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
const REASON_LABELS: Record<Reason, string> = { unavailable: "Busy or down", rejected: "Key refused", limit: "Over a limit" };
const STATUS_LABELS: Record<string, string> = { active: "On", rejected: "Refused by the provider", disabled: "Off" };
const AGENT = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function agentList(text: string): string[] {
	return text
		.split(",")
		.map((a) => a.trim())
		.filter((a) => a !== "");
}

/** Administration → Model keys: the tenant's own keys and endpoints, which models use them, and when the platform's take over. */
export function ModelKeysSettings() {
	const { t, describe } = useI18n();
	const keys = useQuery({ queryKey: ["model-keys"], queryFn: getModelKeys, retry: false });
	const [adding, setAdding] = useState<"key" | "endpoint" | "mapping" | undefined>();

	if (keys.isPending) return <Skeleton rows={4} />;
	if (keys.isError) return <Empty icon={KeyRound} title={t("Model keys can't be read right now.")}>{describe(keys.error)}</Empty>;
	const data = keys.data;
	const offered = CAPABILITIES.filter(
		(c) => data.platform[c]?.byok_providers.length > 0 || data.platform[c]?.endpoints_allowed || data.policies.some((p) => p.capability === c),
	);
	return (
		<div className="modelkeys" data-testid="model-keys">
			<p className="quiet">
				{t("Your organization's own keys for model and speech providers, and your own model endpoints. Each call uses your keys or the platform's in the order you choose below. Keys are never shown again once saved.")}
			</p>
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

			<section className="modelkeys-section">
				<header className="modelkeys-head">
					<h3>{t("Keys")}</h3>
					{data.sealing && data.providers.length > 0 && (
						<button type="button" className="primary small" onClick={() => setAdding("key")} data-testid="model-key-new">
							<Plus size={14} aria-hidden="true" />
							{t("Add key")}
						</button>
					)}
				</header>
				{data.credentials.filter((c) => c.provider !== undefined).length === 0 ? (
					<p className="quiet">{t("No keys of your own.")}</p>
				) : (
					<ul className="modelkeys-list">
						{data.credentials
							.filter((c) => c.provider !== undefined)
							.map((c) => (
								<KeyRow key={c.id} credential={c} />
							))}
					</ul>
				)}
			</section>

			{CAPABILITIES.some((c) => data.platform[c]?.endpoints_allowed) && (
				<section className="modelkeys-section">
					<header className="modelkeys-head">
						<h3>{t("Endpoints")}</h3>
						<button type="button" className="primary small" onClick={() => setAdding("endpoint")} data-testid="model-endpoint-new">
							<Plus size={14} aria-hidden="true" />
							{t("Add endpoint")}
						</button>
					</header>
					<p className="quiet">
						{t("Your own model servers, such as an Azure OpenAI deployment. Prompts, tool results and replies of the agents you map to one go to it.")}
					</p>
					{data.endpoints.length === 0 ? (
						<p className="quiet">{t("No endpoints of your own.")}</p>
					) : (
						<ul className="modelkeys-list">
							{data.endpoints.map((e) => (
								<EndpointRow key={e.id} endpoint={e} />
							))}
						</ul>
					)}
				</section>
			)}

			{data.aliases.length > 0 && (data.endpoints.length > 0 || data.credentials.length > 0 || data.mappings.length > 0) && (
				<section className="modelkeys-section">
					<header className="modelkeys-head">
						<h3>{t("Models")}</h3>
						<button type="button" className="primary small" onClick={() => setAdding("mapping")} data-testid="model-mapping-new">
							<Plus size={14} aria-hidden="true" />
							{t("Choose a model")}
						</button>
					</header>
					<p className="quiet">
						{t("Agents keep their instructions, which were tuned for the platform's model. A check proves a model works, not that an agent works well on it.")}
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
					<ul className="modelkeys-list">
						{data.assigned.map((a) => (
							<li key={a.id} className="modelkeys-row">
								<span className="modelkeys-name">
									<strong>{a.label}</strong>
									<span className="quiet">{a.provider ?? a.endpoint}</span>
								</span>
								<span className="modelkeys-state">{t(STATUS_LABELS[a.status] ?? "On")}</span>
							</li>
						))}
						{data.assigned_endpoints.map((e) => (
							<li key={e.id} className="modelkeys-row">
								<span className="modelkeys-name">
									<strong>{e.name}</strong>
									<span className="quiet">{e.models.join(", ")}</span>
								</span>
								<span className="modelkeys-state">{e.region ?? ""}</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{data.changes.length > 0 && (
				<section className="modelkeys-section">
					<h3>{t("Recent changes")}</h3>
					<ul className="modelkeys-changes">
						{data.changes.slice(0, 10).map((c, i) => (
							<li key={i}>
								<span>{c.platform ? t("Platform") : c.actor}</span> <span>{c.action}</span> <span className="quiet">{c.object}</span>
								{c.reason !== undefined && c.reason !== "" && !c.reason.includes(":t10/") && <span className="quiet"> — {c.reason}</span>}
							</li>
						))}
					</ul>
				</section>
			)}

			{adding === "key" && <AddKey keys={data} onClose={() => setAdding(undefined)} />}
			{adding === "endpoint" && <AddEndpoint keys={data} onClose={() => setAdding(undefined)} />}
			{adding === "mapping" && <AddMapping keys={data} onClose={() => setAdding(undefined)} />}
		</div>
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
	return (
		<div className="modelkeys-policy" data-testid={`policy-${capability}`}>
			<div className="modelkeys-policy-head">
				<strong>{t(CAPABILITY_LABELS[capability])}</strong>
				<select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label={t("Agent")}>
					<option value="*">{t("Every agent")}</option>
					{agents.map((a) => (
						<option key={a} value={a}>
							{a}
						</option>
					))}
				</select>
				<input
					className="modelkeys-agent-input"
					placeholder={t("Another agent")}
					onKeyDown={(e) => {
						const value = e.currentTarget.value.trim();
						if (e.key === "Enter" && AGENT.test(value)) {
							setAgent(value);
							e.currentTarget.value = "";
						}
					}}
				/>
			</div>
			<label>
				<span className="sr-only">{t("Mode")}</span>
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
			{!current.set && <span className="quiet">{t("The default")}</span>}
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
	const { toast } = useFeedback();
	const refresh = useRefresh();
	const [replacing, setReplacing] = useState(false);
	const toggle = useMutation({ mutationFn: () => patchKey(c.id, { disabled: c.status !== "disabled" }), onSuccess: refresh, onError: (e: Error) => toast(e.message || describe(e)) });
	const remove = useMutation({ mutationFn: () => deleteKey(c.id), onSuccess: refresh, onError: (e: Error) => toast(e.message || describe(e)) });
	return (
		<li className="modelkeys-row" data-testid={`model-key-${c.label}`}>
			<span className="modelkeys-name">
				<strong>{c.label}</strong>
				<span className="quiet">
					{c.provider} · {c.hint}
					{c.agents.length > 0 && ` · ${c.agents.join(", ")}`} · {t("Changed {when}", { when: ago(Date.parse(c.updated_at)) })}
				</span>
				{c.status_reason !== undefined && c.status_reason !== "" && <span className="danger-text">{c.status_reason}</span>}
			</span>
			<span className={`modelkeys-state ${c.status}`}>{t(STATUS_LABELS[c.status] ?? "On")}</span>
			<span className="modelkeys-actions">
				<button type="button" className="ghost small" onClick={() => setReplacing(true)}>
					{t("Replace")}
				</button>
				<button type="button" className="ghost small" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
					{c.status === "disabled" ? t("Turn on") : t("Turn off")}
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Delete")}
					onClick={() => window.confirm(t("Delete this key? Calls stop using it at once.")) && remove.mutate()}
				>
					<Trash2 size={14} aria-hidden="true" />
				</button>
			</span>
			{replacing && <ReplaceKey id={c.id} label={c.label} onClose={() => setReplacing(false)} />}
		</li>
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
	const [agents, setAgents] = useState("");
	const [cap, setCap] = useState("");
	const badAgent = agentList(agents).some((a) => !AGENT.test(a));
	const { save, unreachable, error } = useCheckedSave(
		(force) =>
			addKey({
				provider,
				label: label.trim(),
				secret,
				agents: agentList(agents),
				...(cap === "" ? {} : { monthly_token_cap: Number(cap) }),
				save_unreachable: force,
			}),
		onClose,
	);
	const ready = provider !== "" && label.trim() !== "" && secret !== "" && !badAgent;
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
				<label>
					<span>{t("Only for these agents")}</span>
					<input value={agents} placeholder="sales, assistant" onChange={(e) => setAgents(e.target.value)} />
					<span className="quiet">{badAgent ? t("Agents are named by their IDs.") : t("Empty for every agent.")}</span>
				</label>
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

function EndpointRow({ endpoint: e }: { endpoint: Endpoint }) {
	const { t, describe } = useI18n();
	const { toast } = useFeedback();
	const refresh = useRefresh();
	const check = useMutation({ mutationFn: () => checkEndpoint(e.id), onSuccess: refresh, onError: (err: Error) => toast(err.message || describe(err)) });
	const toggle = useMutation({ mutationFn: () => patchEndpoint(e.id, { disabled: e.status === "active" }), onSuccess: refresh, onError: (err: Error) => toast(err.message || describe(err)) });
	const remove = useMutation({ mutationFn: () => deleteEndpoint(e.id), onSuccess: refresh, onError: (err: Error) => toast(err.message || describe(err)) });
	const mark = (ok: boolean | undefined, label: string) => (ok === undefined ? null : <span className={ok ? "ok" : "no"}>{t(label)}</span>);
	return (
		<li className="modelkeys-row endpoint" data-testid={`model-endpoint-${e.name}`}>
			<span className="modelkeys-name">
				<strong>{e.name}</strong>
				<span className="quiet">
					{e.kind} · {e.base_url}
				</span>
				{e.region !== undefined && e.region !== "" && (
					<span className="quiet">
						{e.region_confirmed_by ? t("Region {region}, confirmed", { region: e.region }) : t("Region {region}, waiting for the platform to confirm", { region: e.region })}
					</span>
				)}
				{e.status_reason !== undefined && e.status_reason !== "" && <span className="danger-text">{e.status_reason}</span>}
				<span className="modelkeys-models">
					{e.models.map((m) => (
						<span key={m.name} className="modelkeys-model">
							{m.name} {mark(m.streaming, "streams")} {mark(m.tools, "tools")} {mark(m.images, "images")} {mark(m.responses, "Responses")}
						</span>
					))}
				</span>
			</span>
			<span className={`modelkeys-state ${e.status}`}>{t(STATUS_LABELS[e.status] ?? "On")}</span>
			<span className="modelkeys-actions">
				<button type="button" className="ghost small" onClick={() => check.mutate()} disabled={check.isPending}>
					{check.isPending ? t("Checking…") : t("Check again")}
				</button>
				<button type="button" className="ghost small" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
					{e.status === "active" ? t("Turn off") : t("Turn on")}
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Delete")}
					onClick={() => window.confirm(t("Delete this endpoint, its key and the models mapped to it?")) && remove.mutate()}
				>
					<Trash2 size={14} aria-hidden="true" />
				</button>
			</span>
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
				models: agentList(models),
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
	const { toast } = useFeedback();
	const refresh = useRefresh();
	const remove = useMutation({ mutationFn: () => deleteMapping(alias, agent), onSuccess: refresh, onError: (e: Error) => toast(e.message || describe(e)) });
	return (
		<li className="modelkeys-row" data-testid={`model-mapping-${alias}`}>
			<span className="modelkeys-name">
				<strong>
					{alias} · {agent === "*" ? t("Every agent") : agent}
				</strong>
				<span className="quiet">{chain.map((l) => linkLabel(keys, l)).join(" → ")}</span>
			</span>
			<span />
			<span className="modelkeys-actions">
				<button type="button" className="icon-button" aria-label={t("Delete")} onClick={() => remove.mutate()} disabled={remove.isPending}>
					<Trash2 size={14} aria-hidden="true" />
				</button>
			</span>
		</li>
	);
}

function AddMapping({ keys, onClose }: { keys: Keys; onClose(): void }) {
	const { t, describe } = useI18n();
	const refresh = useRefresh();
	const aliases = keys.aliases.filter((a) => a.mappable && a.capability !== "embedding");
	const [alias, setAlias] = useState(aliases[0]?.alias ?? "");
	const [agent, setAgent] = useState("");
	const targets: { value: string; label: string; models: string[] }[] = [
		...keys.endpoints.filter((e) => e.status === "active").map((e) => ({ value: `endpoint:${e.id}`, label: e.name, models: e.models.map((m) => m.name) })),
		...keys.assigned_endpoints.map((e) => ({ value: `endpoint:${e.id}`, label: e.name, models: e.models })),
		...keys.providers.map((p) => ({ value: `provider:${p.name}`, label: p.name, models: [] })),
	];
	const [chain, setChain] = useState<{ target: string; model: string }[]>([{ target: targets[0]?.value ?? "", model: "" }]);
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
			<form
				className="modelkeys-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready) save.mutate();
				}}
			>
				<label>
					<span>{t("In place of")}</span>
					<select value={alias} onChange={(e) => setAlias(e.target.value)}>
						{aliases.map((a) => (
							<option key={a.alias} value={a.alias}>
								{a.alias}
							</option>
						))}
					</select>
					{requires.length > 0 && <span className="quiet">{t("A model here must pass: {checks}.", { checks: requires.join(", ") })}</span>}
				</label>
				<label>
					<span>{t("For")}</span>
					<input value={agent} placeholder={t("Every agent")} onChange={(e) => setAgent(e.target.value)} />
				</label>
				{chain.map((step, i) => {
					const target = targets.find((x) => x.value === step.target);
					return (
						<div key={i} className="modelkeys-step">
							<span className="quiet">{i === 0 ? t("First") : t("Then")}</span>
							<select value={step.target} onChange={(e) => setChain(chain.map((c, j) => (j === i ? { ...c, target: e.target.value } : c)))}>
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
					<button type="submit" className="primary" disabled={save.isPending || !ready}>
						{t("Save")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
