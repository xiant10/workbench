/** What collab's event kinds mean to a reader. A kind not listed here shows as sent. */
const EVENTS: Record<string, string> = {
	"item.created": "Created the task",
	"item.updated": "Updated the task",
	"item.deleted": "Deleted the task",
	"item.claimed": "Claimed the task",
	"item.queued": "Waiting for a new owner",
	"item.reassigned": "Reassigned the task",
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
	"list.created": "Created a list",
	"list.linked": "Linked a list to a team",
	"list.member_set": "Changed a list's members",
	"list.member_removed": "Removed a list member",
	"list.unit_deleted": "A linked team was deleted",
	"list.members_departed": "Members left the tenant",
	"list.owner_assigned": "Gave the list a new owner",
	"settings.changed": "Changed task visibility",
};

export function eventLabel(kind: string): string {
	return EVENTS[kind] ?? kind;
}
