/** What collab's event kinds mean to a reader. A kind not listed here shows as sent. */
const EVENTS: Record<string, string> = {
	"item.created": "Created the task",
	"item.updated": "Updated the task",
	"item.deleted": "Deleted the task",
	"item.claimed": "Claimed the task",
	"item.queued": "Waiting for a new owner",
	"item.reassigned": "Reassigned the task",
	"item.suggested": "Suggested who to send it to",
	"item.suggestion_dismissed": "Dismissed a suggested send",
	"owner.left": "An owner left",
	"owner.departed": "An owner left the tenant",
	"offer.sent": "Sent an offer",
	"offer.assigned": "Assigned the task",
	"offer.accepted": "Accepted the offer",
	"offer.declined": "Declined the offer",
	"offer.withdrawn": "Withdrew the offer",
	"collaborator.added": "Added a collaborator",
	"collaborator.removed": "Removed a collaborator",
	"comment.added": "Added a comment",
	"link.added": "Added a link",
	"link.removed": "Removed a link",
	"list.created": "Created a list",
	"list.linked": "Linked a list to a team",
	"list.member_set": "Changed a list's members",
	"list.member_removed": "Removed a list member",
	"list.unit_deleted": "A linked team was deleted",
	"list.members_departed": "Members left the tenant",
	"list.owner_assigned": "Gave the list a new owner",
	"settings.changed": "Changed task visibility",
	"workflow.moved": "Put it at a stage of the workflow",
	"workflow.moved.pass": "Passed a stage",
	"workflow.moved.changes": "Sent it back with changes",
	"workflow.moved.done": "Finished the last stage",
	"workflow.moved.lead": "Sent it to the workflow's lead",
	"workflow.moved.skip": "Passed it over a stage",
	"workflow.moved.auto": "Started it on the workflow",
	"workflow.left": "It left the workflow: its stage was removed",
	"workflow.left.list_changed": "It left the workflow: it moved off the list",
	"item.list_changed": "Moved it to another list",
	"list.holder_named": "Named you a holder on a list's workflow",
	"list.holding_changed": "Changed whether they take a list's workflow tasks",
	"list.workflow_changed": "Changed a list's workflow",
	"list.workflow_removed": "Removed a list's workflow",
};

export function eventLabel(kind: string): string {
	return EVENTS[kind] ?? kind;
}

/** A workflow move reads by its result: passed, skipped, sent back, finished, started as it was made, or to the lead past its rounds. */
export function eventKey(event: { kind: string; detail: Record<string, unknown> }): string {
	if (event.kind === "workflow.left" && event.detail.reason === "list_changed") return "workflow.left.list_changed";
	if (event.kind !== "workflow.moved") return event.kind;
	if (event.detail.done === true) return "workflow.moved.done";
	if (event.detail.reason === "auto_start") return "workflow.moved.auto";
	if (typeof event.detail.reason === "string") return "workflow.moved.lead";
	if (Array.isArray(event.detail.skipped)) return "workflow.moved.skip";
	return typeof event.detail.result === "string" ? `workflow.moved.${event.detail.result}` : event.kind;
}

/** What woke an agent teammate's run, from the kind of event t10-collab posted and who caused it. */
export function runCause(kind: string, name: string, t: (text: string, vars?: Record<string, string | number>) => string): string {
	switch (kind) {
		case "work.offered":
			return t("Offered work by {name}", { name });
		case "work.assigned":
			return t("Assigned work by {name}", { name });
		case "work.accepted":
			return t("{name} accepted what it sent", { name });
		case "work.declined":
			return t("{name} declined what it sent", { name });
		case "work.commented":
			return t("Comment by {name}", { name });
		case "list.item_added":
			return t("{name} added a task to its list", { name });
		default:
			return kind;
	}
}
