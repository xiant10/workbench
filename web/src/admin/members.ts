import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useI18n } from "../lib/i18n.tsx";
import { useFeedback } from "../lib/ui.tsx";
import { useWorkspace } from "../shell/workspace.ts";
import { listMembers, reason } from "./api.ts";
import { nameOf } from "./org.ts";

/** Reports a failure, with the auth service's own reason when it gave one. */
export function useFailure(): (error: Error) => void {
	const { t, describe } = useI18n();
	const { toast } = useFeedback();
	return (error) => {
		const known = reason(error);
		toast(known === undefined ? describe(error) : t(known));
	};
}

/**
 * Names for the user IDs that histories record, from the tenant's members, which admins can list. Someone who isn't a
 * member, such as a platform admin or a person who has left, keeps their ID.
 */
export function useMemberName(): (userId: string) => string {
	const { tenant, isAdmin } = useWorkspace();
	const members = useQuery({ queryKey: ["org", tenant, "members"], queryFn: () => listMembers(tenant), enabled: isAdmin, staleTime: 300_000 });
	const data = members.data;
	return useCallback((userId: string) => nameOf(data?.find((member) => member.user_id === userId), userId), [data]);
}
