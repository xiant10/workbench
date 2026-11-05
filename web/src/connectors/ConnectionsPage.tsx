import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { Empty, Skeleton, useFeedback } from "../lib/ui.tsx";
import { disconnect, listConnections, startConnection } from "./api.ts";
import "./connectors.css";

const RESULTS: Record<string, string> = {
	connected: "Connected.",
	refused: "Sign-in was cancelled.",
	expired: "That sign-in had expired or wasn't yours. Try again.",
	failed: "Sign-in failed. Try again, or tell an admin.",
	invalid: "That sign-in couldn't be read. Try again.",
};

/** `/t/<tenant>/connections`: the connectors each person signs in to with their own account. */
export function ConnectionsPage() {
	const { t, ago, describe } = useI18n();
	const { toast } = useFeedback();
	const queries = useQueryClient();
	const [params, setParams] = useSearchParams();
	const list = useQuery({ queryKey: ["connections"], queryFn: listConnections, retry: false });
	const connect = useMutation({ mutationFn: startConnection, onSuccess: (url) => window.location.assign(url), onError: (e) => toast(e.message || describe(e)) });
	const leave = useMutation({ mutationFn: disconnect, onSuccess: () => void queries.invalidateQueries({ queryKey: ["connections"] }) });

	// Back from the provider: say how it went, once.
	const result = params.get("result");
	useEffect(() => {
		if (result === null) return;
		toast(t(RESULTS[result] ?? "Sign-in failed. Try again, or tell an admin."));
		setParams({}, { replace: true });
	}, [result]);

	return (
		<div className="page connections-page">
			<header className="page-head">
				<h1>{t("Connections")}</h1>
			</header>
			<p className="quiet">{t("Services your organization's agents can use as you. Until you connect one, the agent can't use it for you, and never uses anyone else's account instead.")}</p>
			{list.isPending && <Skeleton rows={3} />}
			{list.isError && <Empty icon={Plug} title={t("Connections can't be read right now.")} />}
			{list.isSuccess && list.data.length === 0 && <Empty icon={Plug} title={t("Nothing here needs your own sign-in.")} />}
			{list.isSuccess && list.data.length > 0 && (
				<ul className="connectors-list">
					{list.data.map((connection) => (
						<li key={connection.id} className="connectors-row static" data-testid={`connection-${connection.name}`}>
							<span className="connectors-name">
								<strong>{connection.title}</strong>
								<span className="quiet">
									{connection.connected && connection.connected_at !== undefined ? t("Connected {when}", { when: ago(Date.parse(connection.connected_at)) }) : t("Not connected")}
								</span>
							</span>
							{connection.connected ? (
								<button type="button" className="ghost small" disabled={leave.isPending} onClick={() => leave.mutate(connection.id)} data-testid={`disconnect-${connection.name}`}>
									{t("Disconnect")}
								</button>
							) : (
								<button type="button" className="primary small" disabled={connect.isPending} onClick={() => connect.mutate(connection.id)} data-testid={`connect-${connection.name}`}>
									{t("Connect")}
								</button>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
