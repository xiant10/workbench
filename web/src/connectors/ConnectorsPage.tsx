import { useMutation, useQuery } from "@tanstack/react-query";
import { LockKeyhole, Plug, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { Dialog, Empty, Skeleton } from "../lib/ui.tsx";
import { useWorkspace } from "../shell/workspace.ts";
import { AUTH_LABELS, type Auth, type AuthKind, type Connector, createConnector, listConnectors } from "./api.ts";
import "./connectors.css";

const NAME = /^[a-z][a-z0-9-]{0,30}$/;

export function stateLabel(connector: Pick<Connector, "state">): string {
	return { draft: "Draft", published: "Live", disabled: "Off" }[connector.state];
}

/** `/t/<tenant>/connectors`: the tenant's own MCP servers, for admins only. */
export function ConnectorsPage() {
	const { t, ago } = useI18n();
	const { isAdmin, path } = useWorkspace();
	const navigate = useNavigate();
	const [adding, setAdding] = useState(false);
	const list = useQuery({ queryKey: ["connectors"], queryFn: listConnectors, enabled: isAdmin, retry: false });
	if (!isAdmin) {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("Only this tenant's admins can open this page.")} />
			</div>
		);
	}
	const connectors = list.data?.connectors ?? [];
	return (
		<div className="page connectors-page">
			<header className="page-head">
				<h1>{t("Connectors")}</h1>
				<button type="button" className="primary small" onClick={() => setAdding(true)} data-testid="connectors-new">
					<Plus size={14} aria-hidden="true" />
					{t("Add connector")}
				</button>
			</header>
			<p className="quiet">{t("Your own MCP servers. Their tools reach the agents you choose on everyone's next turn, and every call goes through the tool gateway with this tenant's policy.")}</p>
			{list.data?.sealing === false && <p className="connectors-notice">{t("This platform has no key for credentials, so only servers without sign-in can be added.")}</p>}
			{list.isPending && <Skeleton rows={3} />}
			{list.isError && <Empty icon={Plug} title={t("Connectors can't be read right now.")} />}
			{list.isSuccess && connectors.length === 0 && <Empty icon={Plug} title={t("No connectors yet.")} />}
			{connectors.length > 0 && (
				<ul className="connectors-list">
					{connectors.map((connector) => (
						<li key={connector.id}>
							<button type="button" className="connectors-row" onClick={() => navigate(path(`connectors/${connector.id}`))} data-testid={`connector-row-${connector.name}`}>
								<span className="connectors-name">
									<strong>{connector.title}</strong>
									<span className="quiet">
										{connector.name} · {t(AUTH_LABELS[connector.draft.auth.kind])}
									</span>
								</span>
								<span className={`connectors-state ${connector.state}`}>{t(stateLabel(connector))}</span>
								<span className="quiet">{connector.version === 0 ? "—" : `v${connector.version}`}</span>
								<span className="quiet">{ago(Date.parse(connector.updated_at))}</span>
							</button>
						</li>
					))}
				</ul>
			)}
			{adding && (
				<AddConnector
					taken={new Set(connectors.map((c) => c.name))}
					onClose={() => setAdding(false)}
					onCreated={(id) => navigate(path(`connectors/${id}`))}
				/>
			)}
		</div>
	);
}

/** The sign-in fields for a kind, shared by adding and editing. */
export function AuthFields({ auth, onChange }: { auth: Auth; onChange(auth: Auth): void }) {
	const { t } = useI18n();
	const set = (patch: Partial<Auth>) => onChange({ ...auth, ...patch });
	return (
		<>
			<label>
				<span>{t("Sign-in")}</span>
				<select value={auth.kind} onChange={(e) => onChange({ kind: e.target.value as AuthKind })} data-testid="connector-auth-kind">
					{(Object.keys(AUTH_LABELS) as AuthKind[]).map((kind) => (
						<option key={kind} value={kind}>
							{t(AUTH_LABELS[kind])}
						</option>
					))}
				</select>
			</label>
			{auth.kind === "api_key" && (
				<label>
					<span>{t("Header")}</span>
					<input value={auth.header ?? ""} placeholder="Authorization: Bearer" onChange={(e) => set({ header: e.target.value.trim() })} data-testid="connector-header" />
					<span className="quiet">{t("Empty sends the key as Authorization: Bearer. Or name a header such as X-API-Key.")}</span>
				</label>
			)}
			{(auth.kind === "oauth_client" || auth.kind === "oauth_user") && (
				<>
					<label>
						<span>{t("Client ID")}</span>
						<input value={auth.client_id ?? ""} onChange={(e) => set({ client_id: e.target.value.trim() })} data-testid="connector-client-id" />
						{auth.kind === "oauth_user" && <span className="quiet">{t("Leave empty to register automatically, if the server allows it.")}</span>}
					</label>
					<label>
						<span>{t("Token URL")}</span>
						<input value={auth.token_url ?? ""} placeholder="https://" onChange={(e) => set({ token_url: e.target.value.trim() })} data-testid="connector-token-url" />
						{auth.kind === "oauth_user" && <span className="quiet">{t("Leave both URLs empty to find them from the server.")}</span>}
					</label>
					{auth.kind === "oauth_user" && (
						<label>
							<span>{t("Authorization URL")}</span>
							<input value={auth.authorize_url ?? ""} placeholder="https://" onChange={(e) => set({ authorize_url: e.target.value.trim() })} />
						</label>
					)}
					<label>
						<span>{t("Scopes")}</span>
						<input value={auth.scopes ?? ""} onChange={(e) => set({ scopes: e.target.value })} />
					</label>
				</>
			)}
		</>
	);
}

function AddConnector({ taken, onClose, onCreated }: { taken: ReadonlySet<string>; onClose(): void; onCreated(id: string): void }) {
	const { t, describe } = useI18n();
	const [name, setName] = useState("");
	const [title, setTitle] = useState("");
	const [url, setUrl] = useState("");
	const [auth, setAuth] = useState<Auth>({ kind: "oauth_user" });
	const create = useMutation({ mutationFn: () => createConnector({ name, title: title.trim(), url: url.trim(), auth }), onSuccess: (body) => onCreated(body.connector.id) });
	const sample = name === "" ? "crm" : name;
	const problem = name === "" ? undefined : !NAME.test(name) ? t("Lowercase letters, digits and -, starting with a letter, at most 31.") : taken.has(name) ? t("A connector with this name already exists.") : undefined;
	return (
		<Dialog label={t("Add connector")} onClose={onClose}>
			<h2>{t("Add connector")}</h2>
			<form
				className="connectors-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (problem === undefined && name !== "" && title.trim() !== "" && url.trim() !== "") create.mutate();
				}}
			>
				<label>
					<span>{t("Title")}</span>
					<input value={title} autoFocus maxLength={80} placeholder="Acme CRM" onChange={(e) => setTitle(e.target.value)} data-testid="connector-title" />
				</label>
				<label>
					<span>{t("Name")}</span>
					<input value={name} maxLength={31} placeholder="crm" onChange={(e) => setName(e.target.value.toLowerCase())} data-testid="connector-name" />
					<span className="quiet">{problem ?? t("Tools are offered as {name}_<tool>, and policy rules name it. It can't change later.", { name: sample })}</span>
				</label>
				<label>
					<span>{t("Server address")}</span>
					<input value={url} type="url" placeholder="https://mcp.example.com/mcp" onChange={(e) => setUrl(e.target.value)} data-testid="connector-url" />
				</label>
				<AuthFields auth={auth} onChange={setAuth} />
				{create.isError && <p className="danger-text">{create.error.message || describe(create.error)}</p>}
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={create.isPending || problem !== undefined || name === "" || title.trim() === "" || url.trim() === ""} data-testid="connector-create">
						{t("Create")}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
