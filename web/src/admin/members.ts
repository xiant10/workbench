import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useWorkspace } from "../shell/workspace.ts";
import { listMembers } from "./api.ts";

/**
 * Names for the user IDs that histories record, from the tenant's members, which admins can list. Someone who isn't a
 * member, such as a platform admin or a person who has left, keeps their ID.
 */
export function useMemberName(): (userId: string) => string {
	const { tenant, isAdmin } = useWorkspace();
	const members = useQuery({ queryKey: ["org", tenant, "members"], queryFn: () => listMembers(tenant), enabled: isAdmin, staleTime: 300_000 });
	const data = members.data;
	return useCallback((userId: string) => data?.find((member) => member.user_id === userId)?.name || userId, [data]);
}
