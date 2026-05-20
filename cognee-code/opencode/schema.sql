-- ============================================================
-- OpenCode Core — PostgreSQL Schema (no RLS, no user_id)
-- Generated from opencode_test + INIT.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS account (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL,
    url            TEXT NOT NULL,
    access_token   TEXT NOT NULL,
    refresh_token  TEXT NOT NULL,
    token_expiry   BIGINT,
    time_created   BIGINT NOT NULL,
    time_updated   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_state (
    id                INTEGER PRIMARY KEY,
    active_account_id TEXT,
    active_org_id     TEXT
);

CREATE TABLE IF NOT EXISTS control_account (
    email           TEXT NOT NULL,
    url             TEXT NOT NULL,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    token_expiry    BIGINT,
    active          BOOLEAN NOT NULL,
    time_created    BIGINT NOT NULL,
    time_updated    BIGINT NOT NULL,
    PRIMARY KEY (email, url)
);

CREATE TABLE IF NOT EXISTS data_migration (
    name            TEXT PRIMARY KEY,
    time_completed  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_sequence (
    aggregate_id TEXT PRIMARY KEY,
    seq          BIGINT NOT NULL,
    owner_id     TEXT
);

CREATE TABLE IF NOT EXISTS event (
    id           TEXT PRIMARY KEY,
    aggregate_id TEXT NOT NULL,
    seq          BIGINT NOT NULL,
    type         TEXT NOT NULL,
    data         JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS message (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    time_created BIGINT NOT NULL,
    time_updated BIGINT NOT NULL,
    data         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS message_session_time_created_id_idx ON message(session_id, time_created, id);

CREATE TABLE IF NOT EXISTS part (
    id           TEXT PRIMARY KEY,
    message_id   TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    time_created BIGINT NOT NULL,
    time_updated BIGINT NOT NULL,
    data         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS part_message_id_id_idx ON part(message_id, id);
CREATE INDEX IF NOT EXISTS part_session_idx ON part(session_id);

CREATE TABLE IF NOT EXISTS permission (
    project_id   TEXT PRIMARY KEY,
    time_created BIGINT NOT NULL,
    time_updated BIGINT NOT NULL,
    data         JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
    id                 TEXT PRIMARY KEY,
    worktree           TEXT NOT NULL,
    vcs                TEXT,
    name               TEXT,
    icon_url           TEXT,
    icon_url_override  TEXT,
    icon_color         TEXT,
    time_created       BIGINT NOT NULL,
    time_updated       BIGINT NOT NULL,
    time_initialized   BIGINT,
    sandboxes          JSONB NOT NULL,
    commands           JSONB
);

CREATE TABLE IF NOT EXISTS session (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL,
    workspace_id        TEXT,
    parent_id           TEXT,
    slug                TEXT NOT NULL,
    directory           TEXT NOT NULL,
    path                TEXT,
    title               TEXT NOT NULL,
    version             TEXT NOT NULL,
    share_url           TEXT,
    summary_additions   INTEGER,
    summary_deletions   INTEGER,
    summary_files       INTEGER,
    summary_diffs       JSONB,
    cost                DOUBLE PRECISION NOT NULL DEFAULT 0,
    tokens_input        BIGINT NOT NULL DEFAULT 0,
    tokens_output       BIGINT NOT NULL DEFAULT 0,
    tokens_reasoning    BIGINT NOT NULL DEFAULT 0,
    tokens_cache_read   BIGINT NOT NULL DEFAULT 0,
    tokens_cache_write  BIGINT NOT NULL DEFAULT 0,
    revert              JSONB,
    permission          JSONB,
    agent               TEXT,
    model               JSONB,
    time_created        BIGINT NOT NULL,
    time_updated        BIGINT NOT NULL,
    time_compacting     BIGINT,
    time_archived       BIGINT
);
CREATE INDEX IF NOT EXISTS session_project_idx ON session(project_id);
CREATE INDEX IF NOT EXISTS session_workspace_idx ON session(workspace_id);
CREATE INDEX IF NOT EXISTS session_parent_idx ON session(parent_id);

CREATE TABLE IF NOT EXISTS session_message (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    type         TEXT NOT NULL,
    time_created BIGINT NOT NULL,
    time_updated BIGINT NOT NULL,
    data         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS session_message_session_idx ON session_message(session_id);
CREATE INDEX IF NOT EXISTS session_message_session_type_idx ON session_message(session_id, type);
CREATE INDEX IF NOT EXISTS session_message_time_created_idx ON session_message(time_created);

CREATE TABLE IF NOT EXISTS session_share (
    session_id   TEXT PRIMARY KEY,
    id           TEXT NOT NULL,
    secret       TEXT NOT NULL,
    url          TEXT NOT NULL,
    time_created BIGINT NOT NULL,
    time_updated BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS todo (
    session_id   TEXT NOT NULL,
    content      TEXT NOT NULL,
    status       TEXT NOT NULL,
    priority     TEXT NOT NULL,
    position     INTEGER NOT NULL,
    time_created BIGINT NOT NULL,
    time_updated BIGINT NOT NULL,
    PRIMARY KEY (session_id, position)
);
CREATE INDEX IF NOT EXISTS todo_session_idx ON todo(session_id);

CREATE TABLE IF NOT EXISTS workspace (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    branch     TEXT,
    directory  TEXT,
    extra      JSONB,
    project_id TEXT NOT NULL,
    time_used  BIGINT NOT NULL DEFAULT 0
);
