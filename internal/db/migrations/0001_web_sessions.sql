-- One signed-in browser. The cookie holds a random ID, and id is its hash, so a
-- read of this table can't act as anyone. Tokens are encrypted with the session
-- key.
CREATE TABLE workbench.web_sessions (
	id                text PRIMARY KEY,
	user_id           text NOT NULL,
	refresh_token     bytea NOT NULL,
	access_token      bytea NOT NULL,
	access_expires_at timestamptz NOT NULL,
	created_at        timestamptz NOT NULL DEFAULT now(),
	expires_at        timestamptz NOT NULL
);

CREATE INDEX web_sessions_expires_at ON workbench.web_sessions (expires_at);
