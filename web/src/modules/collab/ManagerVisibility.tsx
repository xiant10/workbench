import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../lib/i18n.tsx";
import { Setting, useFeedback } from "../../lib/ui.tsx";
import { getSettings, putSettings, type Visibility } from "./api.ts";

export function ManagerVisibility() {
	const { t, describe } = useI18n();
	const { confirm, toast } = useFeedback();
	const client = useQueryClient();
	const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
	const update = useMutation({ mutationFn: putSettings, onSuccess: () => void client.invalidateQueries({ queryKey: ["settings"] }), onError: (error) => toast(describe(error)) });
	if (settings.data === undefined) return null;
	return (
		<div className="card">
			<Setting title={t("Who can see tasks")} hint={t("Applies to everyone in this tenant.")}>
				<select
					aria-label={t("Who can see tasks")}
					value={settings.data.manager_visibility}
					onChange={async (event) => {
						const next = event.target.value as Visibility;
						if (next === "none" || (await confirm({ title: t("Change who can see tasks?"), body: t("Existing tasks become visible at once."), action: t("Change") }))) update.mutate(next);
					}}
				>
					<option value="none">{t("Nobody above a person")}</option>
					<option value="direct_reports">{t("Direct manager")}</option>
					<option value="all_reports">{t("Everyone they report to")}</option>
				</select>
			</Setting>
		</div>
	);
}
