import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import type { Line } from "../conversation/reducer.ts";
import { rpc } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { CopyButton } from "../lib/ui.tsx";
import { useWorkspace } from "../shell/workspace.ts";

type Payload = { request?: unknown; response?: unknown };

/** Fetch only when expanded. The endpoint returns recorded tool messages, not HTTP headers or model prompts. */
export function ToolActivity({ line }: { line: Extract<Line, { role: "tool" }> }) {
	const { t, describe } = useI18n();
	const { agent, tenant } = useWorkspace();
	const { sessionId = "" } = useParams();
	const [expanded, setExpanded] = useState(false);
	const payload = useQuery({
		queryKey: ["tool-payload", tenant, agent, sessionId, line.callId, line.state],
		queryFn: () => rpc<Payload>(agent, "session.tool", { callId: line.callId }, sessionId),
		enabled: expanded,
		retry: false,
		refetchInterval: expanded && line.state === "running" ? 2000 : false,
	});
	return <li className="tool-activity">
		<details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
			<summary><span>{line.name}</span><span className={`state ${line.state}`}>{t(line.state === "running" ? "Running" : line.state === "failed" ? "Failed" : "Done")}</span></summary>
			<p className="quiet">{t("Recorded tool request and response")}</p>
			<p className="quiet">{t("Call ID")}: <code>{line.callId}</code></p>
			{payload.isPending && <p role="status">{t("Loading…")}</p>}
			{payload.isError && <div role="alert"><p>{describe(payload.error)}</p><p className="quiet">{t("Payload details require an agent that supports this feature.")}</p><button type="button" className="ghost" onClick={() => void payload.refetch()}>{t("Retry")}</button></div>}
			{payload.isSuccess && (["request", "response"] as const).map((kind) => {
				const value = payload.data[kind];
				const text = JSON.stringify(value, null, 2);
				return <section key={kind} className="tool-payload">
					<div className="payload-heading"><h3>{t(kind === "request" ? "Request" : "Response")}</h3>{text !== undefined && <CopyButton text={text} label="Copy" className="ghost small" />}</div>
					{text === undefined ? <p className="quiet">{t(kind === "response" && line.state === "running" ? "Waiting for the tool response…" : "This payload isn't available in the recorded history.")}</p> : <pre tabIndex={0}>{text}</pre>}
				</section>;
			})}
		</details>
	</li>;
}
