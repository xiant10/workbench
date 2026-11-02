import { useQuery } from "@tanstack/react-query";
import { SquareCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { SessionInfo } from "../../lib/agent.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { getItem, workItemOf } from "./api.ts";

function TaskChip({ id }: { id: string }) {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const item = useQuery({ queryKey: ["item", id], queryFn: () => getItem(id), retry: false });
	if (item.isError) return <span className="chip muted">{t("The linked task has gone")}</span>;
	return (
		<Link className="chip" to={path(`tasks/${id}`)}>
			<SquareCheck size={13} aria-hidden="true" />
			{t("Open task")}: {item.data?.title ?? "…"}
		</Link>
	);
}

export function SessionTaskChip({ session }: { session: SessionInfo }) {
	const id = workItemOf(session.metadata?.ref) ?? session.metadata?.workItemId;
	return id === undefined ? null : <TaskChip id={id} />;
}
