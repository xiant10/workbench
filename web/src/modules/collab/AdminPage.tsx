import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, ListTodo, LockKeyhole, UserRoundX } from "lucide-react";
import { ApiError } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { LoadMore, usePaged } from "../../lib/paged.tsx";
import { Empty, Skeleton, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { type QueuedItem, type QueuedList, queuedItemsPage, queuedListsPage, reassignItem, setListOwner } from "./api.ts";
import { ManagerVisibility } from "./ManagerVisibility.tsx";
import { PersonPicker } from "./PersonPicker.tsx";
import { usePeople } from "./usePeople.ts";

const ITEM_REASONS: Record<QueuedItem["reason"], string> = {
	no_successor: "Its owners left, and nobody took it on",
	owner_suspended: "Every owner is suspended",
};

const LIST_REASONS: Record<QueuedList["reason"], string> = {
	no_active_owner: "Nobody active can manage it",
	no_active_members: "It has open tasks and nobody active is on it",
};

/**
 * Collab's admin page, for tenant admins and anyone whose business role grants work:admin. It shows titles and names
 * only: an admin gives waiting work to someone, and never reads the work itself.
 */
export function AdminPage() {
	const { t, describe, day } = useI18n();
	const { toast } = useFeedback();
	const { tenant } = useWorkspace();
	const { name } = usePeople();
	const client = useQueryClient();
	const items = usePaged(["collab-queue", tenant, "items"], queuedItemsPage, { gcTime: 0 });
	const lists = usePaged(["collab-queue", tenant, "lists"], queuedListsPage, { gcTime: 0 });
	const refresh = () => void client.invalidateQueries({ queryKey: ["collab-queue", tenant] });
	const reassign = useMutation({
		mutationFn: ({ id, to }: { id: string; to: string }) => reassignItem(id, to),
		onSuccess: (_, { to }) => {
			toast(t("Given to {name}.", { name: name(to) }));
			refresh();
		},
		onError: (error) => toast(describe(error)),
	});
	const owner = useMutation({
		mutationFn: ({ id, to }: { id: string; to: string }) => setListOwner(id, to),
		onSuccess: (_, { to }) => {
			toast(t("{name} owns the list now.", { name: name(to) }));
			refresh();
		},
		onError: (error) => toast(describe(error)),
	});
	// The queue's answer is the only word on who may see this page: the menu entry is a hint.
	const refused = (items.isError || lists.isError) && [items, lists].some((list) => list.error instanceof ApiError && list.error.status === 403);
	if (refused) {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("Only tenant admins and task administrators can open this page.")} />
			</div>
		);
	}
	return (
		<div className="page">
			<header className="page-head">
				<h1>{t("Task admin")}</h1>
			</header>
			<p className="quiet">{t("Work whose owners left waits here. Give it to someone who can carry it on. You see titles and names, never the work itself.")}</p>
			<h2>{t("Tasks waiting for an owner")}</h2>
			{items.isPending && <Skeleton />}
			{items.isSuccess && items.data?.length === 0 && <Empty icon={CheckSquare} title={t("No tasks are waiting.")} />}
			<ul className="rows">
				{items.data?.map((item) => (
					<li key={item.id} className="row">
						<span className="row-icon">
							<UserRoundX size={16} aria-hidden="true" />
						</span>
						<div className="row-main">
							<span>{item.title}</span>
							<span className="quiet">
								{t(ITEM_REASONS[item.reason])} · {item.owners.map(name).join(", ") || t("No owners")} · {t("Since {day}", { day: day(item.queued_at) })}
							</span>
						</div>
						<PersonPicker label={t("Give {title} to", { title: item.title })} exclude={item.owners} disabled={reassign.isPending} onPick={(to) => reassign.mutate({ id: item.id, to })} />
					</li>
				))}
			</ul>
			<LoadMore list={items} />
			<h2>{t("Lists waiting for an owner")}</h2>
			{lists.isPending && <Skeleton />}
			{lists.isSuccess && lists.data?.length === 0 && <Empty icon={ListTodo} title={t("No lists are waiting.")} />}
			<ul className="rows">
				{lists.data?.map((list) => (
					<li key={list.id} className="row">
						<span className="row-icon">
							<ListTodo size={16} aria-hidden="true" />
						</span>
						<div className="row-main">
							<span>{list.name}</span>
							<span className="quiet">
								{t(LIST_REASONS[list.reason])} · {t("Since {day}", { day: day(list.queued_at) })}
							</span>
						</div>
						<PersonPicker label={t("Make the owner of {name}", { name: list.name })} exclude={[]} disabled={owner.isPending} onPick={(to) => owner.mutate({ id: list.id, to })} />
					</li>
				))}
			</ul>
			<LoadMore list={lists} />
			<h2>{t("Settings")}</h2>
			<ManagerVisibility />
		</div>
	);
}
