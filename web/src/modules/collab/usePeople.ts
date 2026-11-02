import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { displayName, useWorkspace } from "../../shell/workspace.ts";
import { findPeople, listUnits } from "./api.ts";

/** Names for the IDs collab returns. It has no lookup by ID, so this reads the directory once a minute. */
export function usePeople() {
	const { t } = useI18n();
	const { me, tenant } = useWorkspace();
	const people = useQuery({ queryKey: ["people", tenant], queryFn: () => findPeople(""), staleTime: 60_000 });
	const units = useQuery({ queryKey: ["units", tenant], queryFn: listUnits, staleTime: 60_000 });
	const name = useCallback(
		(id: string) => {
			if (id === me.user_id) return displayName(me);
			return people.data?.find((person) => person.user_id === id)?.display_name || t("Teammate");
		},
		[me, people.data, t],
	);
	const unit = useCallback((id: string) => units.data?.find((item) => item.id === id)?.name ?? "", [units.data]);
	return { people: people.data ?? [], name, unit };
}
