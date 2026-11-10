# Automations UX review

The first flexible-task UI made recurring setup possible but made existing tasks
hard to reach: a full editor always appeared above the list. Timezone IDs, cron
and daily limits all competed with writing a useful instruction. Editing was
hidden in expanded rows, and starting a run only produced a toast.

The revised flow keeps the list as the landing page. New automation opens an
inline editor with keyboard focus; Cancel closes it. Saving closes the editor
and expands the created task. The form keeps examples, name, instruction and
when to run visible. A single available agent is shown as text; multiple agents
remain selectable. Writing tips, timezone changes and run limits are optional
disclosures. Daily and weekday repeat shortcuts sit beside the time/day picker.
A human-readable preview confirms that timing; an empty day selection or invalid
timezone explains why saving is unavailable. Custom cron retains all existing
capabilities and is validated by the service on save.

Saved tasks have an explicit edit action and an expansion indicator. Expanding
shows the instruction, configuration and recent runs. Delete is inside the
expanded row. Pause is labelled as pausing the schedule, and paused schedules
explain that Run now remains available. On-demand tasks have no schedule pause
button. Run now immediately opens recent runs, shows the accepted firing and
disables repeat starts while it is queued or running. Polling continues through
an active run even when its row is collapsed, and its conversation link gives
a direct path to progress and results.

This is a client change using the existing module API, React Query cache,
workspace agent list, shared controls and English/Chinese catalogs. It adds no
client-owned execution state or scheduling engine. Browser coverage checks
creation, optional settings, validation and failed-save recovery, custom timing
preservation, repeat shortcuts, running feedback and mobile overflow. Full live
agent execution remains outside the mocked browser check.
