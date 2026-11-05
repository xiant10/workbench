-- Skill workflows moved to t10-agent-control, which owns tenant agent settings
-- and which agents read from directly (t10-agent-control/docs/tenant-skills.md).
-- This drops the table an unreleased build created.
DROP TABLE IF EXISTS workbench.agent_workflows;
