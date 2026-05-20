-- ============================================================
-- OpenCode Agent — opr_* Tables (drizzle schema)
-- From: opencode-agent/src/opencode-router/db/schema/
-- ============================================================

CREATE TABLE IF NOT EXISTS opr_allowlist (
    channel text NOT NULL,
    peer_id text NOT NULL,
    created_at bigint NOT NULL,
    PRIMARY KEY (channel, peer_id)
);

CREATE TABLE IF NOT EXISTS opr_bindings (
    channel text NOT NULL,
    identity_id text NOT NULL,
    peer_id text NOT NULL,
    directory text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (channel, identity_id, peer_id)
);

CREATE TABLE IF NOT EXISTS opr_sandboxes (
    channel text NOT NULL,
    identity_id text NOT NULL,
    peer_id text NOT NULL,
    sandbox_id text NOT NULL,
    status text NOT NULL DEFAULT 'unknown',
    host_workspace_path text NOT NULL DEFAULT '',
    host_data_path text NOT NULL DEFAULT '',
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (channel, identity_id, peer_id)
);

CREATE TABLE IF NOT EXISTS opr_sessions (
    channel text NOT NULL,
    identity_id text NOT NULL,
    peer_id text NOT NULL,
    session_id text NOT NULL,
    directory text,
    sandbox_id text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (channel, identity_id, peer_id)
);

CREATE TABLE IF NOT EXISTS opr_settings (
    key text PRIMARY KEY,
    value text NOT NULL
);
