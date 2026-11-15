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
	"workflow.left": "It left the workflow: its stage was removed",
	"list.workflow_changed": "Changed a list's workflow",
	"list.workflow_removed": "Removed a list's workflow",
};

export function eventLabel(kind: string): string {
	return EVENTS[kind] ?? kind;
}

/** A workflow move reads by its result: passed, sent back, finished, or to the lead past its rounds. */
export function eventKey(event: { kind: string; detail: Record<string, unknown> }): string {
	if (event.kind !== "workflow.moved") return event.kind;
	if (event.detail.done === true) return "workflow.moved.done";
	if (typeof event.detail.reason === "string") return "workflow.moved.lead";
	return typeof event.detail.result === "string" ? `workflow.moved.${event.detail.result}` : event.kind;
}
