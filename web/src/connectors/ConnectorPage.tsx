import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, LockKeyhole, Plug, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { Empty, Skeleton, useFeedback } from "../lib/ui.tsx";
import { useWorkspace } from "../shell/workspace.ts";
import {
	type Auth,
	type ConnectorConfig,
	type ConnectorDetail,
	disconnect,
	discover,
	disableConnector,
	getConnector,
	publishConnector,
	putCredential,
	removeConnector,
	saveConnector,
	startConnection,
} from "./api.ts";
import { AuthFields, stateLabel } from "./ConnectorsPage.tsx";
import "./connectors.css";

const RESULTS: Record<string, string> = {
	connected: "Connected.",
	refused: "Sign-in was cancelled.",
	expired: "That sign-in had expired or wasn't yours. Try again.",
	failed: "Sign-in failed. Try again, or tell an admin.",
	invalid: "That sign-in couldn't be read. Try again.",
};

const ACTIONS: Record<string, string> = {
	create: "Created",
	credential: "Credential replaced",
	discover: "Tools discovered",
	publish: "Published",
	disable: "Turned off",
	delete: "Deleted",
	connect: "Signed in",
	disconnect: "Signed out",
};

/** `/t/<tenant>/connectors/<id>`: one connector, from address and sign-in to the tools and agents it serves. */
export function ConnectorPage() {
	const { t, ago, describe } = useI18n();
	const { id = "" } = useParams();
	const { isAdmin, path } = useWorkspace();
	const { toast, confirm } = useFeedback();
	const navigate = useNavigate();
	const queries = useQueryClient();
	const [params, setParams] = useSearchParams();
	const result = params.get("result");
	useEffect(() => {
		if (result === null) return;
		toast(t(RESULTS[result] ?? "Sign-in failed. Try again, or tell an admin."));
		setParams({}, { replace: true });
	}, [result]);

	const detail = useQuery({ queryKey: ["connector", id], queryFn: () => getConnector(id), enabled: isAdmin, retry: false });
	const [title, setTitle] = useState("");
	const [draft, setDraft] = useState<ConnectorConfig>({ url: "", auth: { kind: "none" }, tools: [], agents: [] });
	const [secret, setSecret] = useState("");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string>();
	const loaded = detail.data?.connector;
	useEffect(() => {
		if (loaded === undefined) return;
		setTitle(loaded.title);
		setDraft(loaded.draft);
	}, [loaded?.updated_at, loaded?.id]);

	const done = (body: ConnectorDetail) => {
		queries.setQueryData(["connector", id], body);
		void queries.invalidateQueries({ queryKey: ["connectors"] });
		setError(undefined);
	};
	const failed = (e: Error) => setError(e.message || describe(e));
	const save = useMutation({ mutationFn: () => saveConnector(id, { ...draft, title }), onSuccess: done, onError: failed });
	const credential = useMutation({
		mutationFn: () => putCredential(id, draft.auth.kind === "api_key" ? { key: secret } : { client_secret: secret }),
		onSuccess: (body) => {
			done(body);
			setSecret("");
			toast(t("Credential saved. It can't be shown again."));
		},
		onError: failed,
	});
	const find = useMutation({ mutationFn: async () => (await saveConnector(id, { ...draft, title }), discover(id)), onSuccess: done, onError: failed });
	const publish = useMutation({
		mutationFn: async () => (await saveConnector(id, { ...draft, title }), publishConnector(id, loaded?.version ?? 0, reason)),
		onSuccess: (body) => {
			done(body);
			setReason("");
			toast(t("Published. Agents offer these tools from their next turn."));
		},
		onError: failed,
	});
	const connect = useMutation({ mutationFn: async () => (await saveConnector(id, { ...draft, title }), startConnection(id)), onSuccess: (url) => window.location.assign(url), onError: failed });
	const leave = useMutation({
		mutationFn: () => disconnect(id),
		onSuccess: () => {
			void queries.invalidateQueries({ queryKey: ["connector", id] });
			void queries.invalidateQueries({ queryKey: ["connectors"] });
			toast(t("Disconnected."));
		},
		onError: failed,
	});

	if (!isAdmin) {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("Only this tenant's admins can open this page.")} />
			</div>
		);
	}
	if (detail.isPending) return <div className="page"><Skeleton rows={6} /></div>;
	if (detail.isError || loaded === undefined) {
		return (
			<div className="page">
				<Empty icon={Plug} title={t("This connector can't be read right now.")} />
			</div>
		);
	}
	const kind = draft.auth.kind;
	const shared = kind === "api_key" || kind === "oauth_client";
	const needsSecret = shared || (kind === "oauth_user" && (draft.auth.client_id ?? "") !== "");
	const discovered = loaded.discovered;
	const busy = save.isPending || credential.isPending || find.isPending || publish.isPending || connect.isPending;
	const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
	const setAuth = (auth: Auth) => setDraft({ ...draft, auth });

	const turnOff = async () => {
		if (!(await confirm({ title: t("Turn off {title}?", { title: loaded.title }), body: t("Agents stop offering its tools on their next turn, and the gateway refuses any call to it."), action: t("Turn off"), danger: true }))) return;
		try {
			done(await disableConnector(id, loaded.version));
		} catch (e) {
			failed(e as Error);
		}
	};
	const remove = async () => {
		if (!(await confirm({ title: t("Delete {title}?", { title: loaded.title }), body: t("Its tools stop at once and every stored credential and sign-in is forgotten. Its versions are kept as a record."), action: t("Delete"), danger: true }))) return;
		try {
			await removeConnector(id, loaded.version);
			void queries.invalidateQueries({ queryKey: ["connectors"] });
			navigate(path("connectors"));
		} catch (e) {
			failed(e as Error);
		}
	};

	return (
		<div className="page connector-page" data-testid="connector-page">
			<Link className="connector-back" to={path("connectors")}>
				<ArrowLeft size={14} aria-hidden="true" />
				{t("Connectors")}
			</Link>
			<header className="page-head">
				<h1>{loaded.title}</h1>
				<span className={`connectors-state ${loaded.state}`} data-testid="connector-state">
					{t(stateLabel(loaded))}
					{loaded.version > 0 && ` · v${loaded.version}`}
				</span>
			</header>
			<p className="quiet">{t("Tools are offered as {name}_<tool>.", { name: loaded.name })}</p>
			{error !== undefined && (
				<p className="connectors-notice danger" role="alert" data-testid="connector-error">
					{error}
				</p>
			)}

			<section className="connector-section">
				<h2>{t("Server")}</h2>
				<div className="connectors-form">
					<label>
						<span>{t("Title")}</span>
						<input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
					</label>
					<label>
						<span>{t("Server address")}</span>
						<input value={draft.url} type="url" onChange={(e) => setDraft({ ...draft, url: e.target.value })} data-testid="connector-url" />
					</label>
					<AuthFields auth={draft.auth} onChange={setAuth} />
				</div>
				{shared && (
					<p className="connectors-notice">
						<TriangleAlert size={14} aria-hidden="true" /> {t("Everyone using the chosen agents acts as this one account on the server, whatever their own rights. Use policy to deny or require approval for risky tools.")}
					</p>
				)}
			</section>

			{(needsSecret || kind === "oauth_user") && (
				<section className="connector-section">
					<h2>{t("Credential")}</h2>
					{needsSecret && (
						<div className="connector-secret">
							<span className="quiet">{loaded.credential ? t("Saved. It's never shown again; enter a new one to replace it.") : t("Not saved yet.")}</span>
							<input
								type="password"
								autoComplete="off"
								value={secret}
								placeholder={kind === "api_key" ? t("API key") : t("Client secret")}
								onChange={(e) => setSecret(e.target.value)}
								data-testid="connector-secret"
							/>
							<button type="button" className="small" disabled={secret === "" || busy} onClick={() => credential.mutate()} data-testid="connector-save-secret">
								<KeyRound size={14} aria-hidden="true" />
								{loaded.credential ? t("Replace") : t("Save")}
							</button>
						</div>
					)}
					{kind === "oauth_user" && (
						<div className="connector-secret">
							<span className="quiet">
								{loaded.connected === true
									? t("You're signed in. Discovery uses your account; everyone else signs in under Connectors.")
									: t("Sign in with your own account to discover its tools.")}
							</span>
							<button type="button" className="small" disabled={busy} onClick={() => connect.mutate()} data-testid="connector-connect">
								{loaded.connected === true ? t("Sign in again") : t("Sign in")}
							</button>
							{loaded.connected === true && (
								<button
									type="button"
									className="ghost small"
									disabled={busy || leave.isPending}
									onClick={() => leave.mutate()}
									data-testid="connector-disconnect"
								>
									{t("Disconnect")}
								</button>
							)}
						</div>
					)}
					{kind === "oauth_user" && <p className="quiet">{t("Redirect URL to register with the provider: {url}", { url: detail.data.callback_url })}</p>}
				</section>
			)}

			<section className="connector-section">
				<div className="connector-section-head">
					<h2>{t("Tools")}</h2>
					<button type="button" className="small" disabled={busy || draft.url === ""} onClick={() => find.mutate()} data-testid="connector-discover">
						<RefreshCw size={14} aria-hidden="true" />
						{t("Discover tools")}
					</button>
				</div>
				{discovered === null && <p className="quiet">{t("Discover the server's tools, then choose the ones agents may use.")}</p>}
				{discovered?.problem !== undefined && (
					<p className="connectors-notice danger" data-testid="connector-discover-problem">
						{discovered.problem}
					</p>
				)}
				{discovered !== null && discovered.tools.length > 0 && (
					<>
						<p className="quiet">
							{t("{server} listed {count} tools {when}.", { server: discovered.server || loaded.name, count: discovered.tools.length, when: ago(Date.parse(discovered.at)) })}
							{(discovered.skipped ?? 0) > 0 && ` ${t("{count} more were left out: their names or inputs aren't usable.", { count: discovered.skipped ?? 0 })}`}
						</p>
						<ul className="connector-tools">
							{discovered.tools.map((tool) => (
								<li key={tool.name}>
									<label>
										<input type="checkbox" checked={draft.tools.includes(tool.name)} onChange={() => setDraft({ ...draft, tools: toggle(draft.tools, tool.name) })} data-testid={`connector-tool-${tool.name}`} />
										<span>
											<code>{`${loaded.name}_${tool.name}`}</code>
											{tool.annotations?.readOnlyHint === true && <span className="connector-hint">{t("says it only reads")}</span>}
											{tool.annotations?.destructiveHint === true && <span className="connector-hint danger">{t("says it may delete")}</span>}
											<span className="quiet">{tool.description}</span>
										</span>
									</label>
								</li>
							))}
						</ul>
					</>
				)}
			</section>

			<section className="connector-section">
				<h2>{t("Agents")}</h2>
				<div className="connector-agents">
					{detail.data.agents.map((agent) => (
						<label key={agent}>
							<input type="checkbox" checked={draft.agents.includes(agent)} onChange={() => setDraft({ ...draft, agents: toggle(draft.agents, agent) })} data-testid={`connector-agent-${agent}`} />
							{agent}
						</label>
					))}
				</div>
			</section>

			<section className="connector-section connector-publish">
				<input value={reason} maxLength={200} placeholder={t("Why (optional)")} onChange={(e) => setReason(e.target.value)} />
				<button type="button" className="ghost" disabled={busy} onClick={() => save.mutate()} data-testid="connector-save">
					{t("Save draft")}
				</button>
				<button type="button" className="primary" disabled={busy || draft.tools.length === 0 || draft.agents.length === 0} onClick={() => publish.mutate()} data-testid="connector-publish">
					{t("Publish")}
				</button>
				{loaded.state === "published" && (
					<button type="button" className="ghost" disabled={busy} onClick={() => void turnOff()} data-testid="connector-disable">
						{t("Turn off")}
					</button>
				)}
				<button type="button" className="ghost danger" disabled={busy} onClick={() => void remove()} data-testid="connector-delete">
					{t("Delete")}
				</button>
			</section>

			<section className="connector-section">
				<h2>{t("History")}</h2>
				<ul className="connector-history">
					{detail.data.changes.map((change, index) => (
						<li key={index}>
							<span>{t(ACTIONS[change.action] ?? change.action)}</span>
							{change.outcome !== "ok" && <span className="connector-hint danger">{change.outcome}</span>}
							{change.reason !== "" && <span className="quiet">“{change.reason}”</span>}
							<span className="quiet">{change.actor}</span>
							<span className="quiet">{ago(Date.parse(change.at))}</span>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
