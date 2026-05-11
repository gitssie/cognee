import fs from "node:fs";
import path from "node:path";

import { Database } from "bun:sqlite";

import type { ChannelName } from "./config.js";

type SessionRow = {
  channel: ChannelName;
  identity_id: string;
  peer_id: string;
  session_id: string;
  directory?: string | null;
  sandbox_id?: string | null;
  created_at: number;
  updated_at: number;
};

type BindingRow = {
  channel: ChannelName;
  identity_id: string;
  peer_id: string;
  directory: string;
  created_at: number;
  updated_at: number;
};

type AllowlistRow = {
  channel: ChannelName;
  peer_id: string;
  created_at: number;
};

type SandboxRow = {
  channel: ChannelName;
  identity_id: string;
  peer_id: string;
  sandbox_id: string;
  status: string;
  host_workspace_path: string;
  host_data_path: string;
  created_at: number;
  updated_at: number;
};

export class BridgeStore {
  private db: Database;

  constructor(private readonly dbPath: string) {
    this.ensureDir();
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        channel TEXT NOT NULL,
        identity_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        directory TEXT,
        sandbox_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (channel, identity_id, peer_id)
      );
      CREATE TABLE IF NOT EXISTS allowlist (
        channel TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (channel, peer_id)
      );
      CREATE TABLE IF NOT EXISTS bindings (
        channel TEXT NOT NULL,
        identity_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        directory TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (channel, identity_id, peer_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sandboxes (
        channel TEXT NOT NULL,
        identity_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        sandbox_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        host_workspace_path TEXT NOT NULL DEFAULT '',
        host_data_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (channel, identity_id, peer_id)
      );
    `);
    // One-time migration: backfill sandbox_id from sessions into sandboxes table
    const sandboxCount = (this.db.prepare("SELECT COUNT(*) AS cnt FROM sandboxes").get() as { cnt: number }).cnt;
    if (sandboxCount === 0) {
      this.db.exec(`
        INSERT OR IGNORE INTO sandboxes (channel, identity_id, peer_id, sandbox_id, status, host_workspace_path, host_data_path, created_at, updated_at)
        SELECT channel, identity_id, peer_id, sandbox_id, 'unknown', '', '', created_at, updated_at
        FROM sessions
        WHERE sandbox_id IS NOT NULL AND sandbox_id != ''
      `);
    }
  }

  private ensureDir() {
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  getSession(channel: ChannelName, identityId: string, peerId: string): SessionRow | null {
    const stmt = this.db.prepare(
      "SELECT channel, identity_id, peer_id, session_id, directory, sandbox_id, created_at, updated_at FROM sessions WHERE channel = ? AND identity_id = ? AND peer_id = ?",
    );
    const row = stmt.get(channel, identityId, peerId) as SessionRow | null;
    return row ?? null;
  }

  upsertSession(channel: ChannelName, identityId: string, peerId: string, sessionId: string, directory?: string | null, sandboxId?: string | null) {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO sessions (channel, identity_id, peer_id, session_id, directory, sandbox_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel, identity_id, peer_id) DO UPDATE SET session_id = excluded.session_id, directory = excluded.directory, sandbox_id = excluded.sandbox_id, updated_at = excluded.updated_at`,
    );
    stmt.run(channel, identityId, peerId, sessionId, directory ?? null, sandboxId ?? null, now, now);
  }

  clearSession(channel: ChannelName, identityId: string, peerId: string, directory?: string | null): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(
      `UPDATE sessions
       SET session_id = '', directory = COALESCE(?, directory), updated_at = ?
       WHERE channel = ? AND identity_id = ? AND peer_id = ?`,
    );
    const result = stmt.run(directory ?? null, now, channel, identityId, peerId);
    return result.changes > 0;
  }

  deleteSession(channel: ChannelName, identityId: string, peerId: string): boolean {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE channel = ? AND identity_id = ? AND peer_id = ?");
    const result = stmt.run(channel, identityId, peerId);
    return result.changes > 0;
  }

  getBinding(channel: ChannelName, identityId: string, peerId: string): BindingRow | null {
    const stmt = this.db.prepare(
      "SELECT channel, identity_id, peer_id, directory, created_at, updated_at FROM bindings WHERE channel = ? AND identity_id = ? AND peer_id = ?",
    );
    const row = stmt.get(channel, identityId, peerId) as BindingRow | null;
    return row ?? null;
  }

  upsertBinding(channel: ChannelName, identityId: string, peerId: string, directory: string) {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO bindings (channel, identity_id, peer_id, directory, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel, identity_id, peer_id) DO UPDATE SET directory = excluded.directory, updated_at = excluded.updated_at`,
    );
    stmt.run(channel, identityId, peerId, directory, now, now);
  }

  deleteBinding(channel: ChannelName, identityId: string, peerId: string): boolean {
    const stmt = this.db.prepare("DELETE FROM bindings WHERE channel = ? AND identity_id = ? AND peer_id = ?");
    const result = stmt.run(channel, identityId, peerId);
    return result.changes > 0;
  }

  listBindings(filters: { channel?: ChannelName; identityId?: string; directory?: string } = {}): BindingRow[] {
    const where: string[] = [];
    const args: Array<string> = [];
    if (filters.channel) {
      where.push("channel = ?");
      args.push(filters.channel);
    }
    if (filters.identityId) {
      where.push("identity_id = ?");
      args.push(filters.identityId);
    }
    if (filters.directory) {
      where.push("directory = ?");
      args.push(filters.directory);
    }

    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const stmt = this.db.prepare(
      `SELECT channel, identity_id, peer_id, directory, created_at, updated_at FROM bindings${clause} ORDER BY updated_at DESC`,
    );
    return stmt.all(...args) as BindingRow[];
  }

  isAllowed(channel: ChannelName, peerId: string): boolean {
    const stmt = this.db.prepare(
      "SELECT channel, peer_id, created_at FROM allowlist WHERE channel = ? AND peer_id = ?",
    );
    return Boolean(stmt.get(channel, peerId));
  }

  allowPeer(channel: ChannelName, peerId: string) {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO allowlist (channel, peer_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(channel, peer_id) DO UPDATE SET created_at = excluded.created_at`,
    );
    stmt.run(channel, peerId, now);
  }

  seedAllowlist(channel: ChannelName, peers: Iterable<string>) {
    const insert = this.db.prepare(
      `INSERT INTO allowlist (channel, peer_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(channel, peer_id) DO NOTHING`,
    );
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      for (const peer of peers) {
        insert.run(channel, peer, now);
      }
    });
    transaction();
  }

  getSetting(key: string): string | null {
    const stmt = this.db.prepare("SELECT value FROM settings WHERE key = ?");
    const row = stmt.get(key) as { value?: string } | null;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string) {
    const stmt = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    stmt.run(key, value);
  }

  getSandbox(channel: ChannelName, identityId: string, peerId: string): SandboxRow | null {
    const stmt = this.db.prepare(
      "SELECT channel, identity_id, peer_id, sandbox_id, status, host_workspace_path, host_data_path, created_at, updated_at FROM sandboxes WHERE channel = ? AND identity_id = ? AND peer_id = ?",
    );
    const row = stmt.get(channel, identityId, peerId) as SandboxRow | null;
    return row ?? null;
  }

  upsertSandbox(channel: ChannelName, identityId: string, peerId: string, sandboxId: string, status: string, hostWorkspacePath: string, hostDataPath: string) {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO sandboxes (channel, identity_id, peer_id, sandbox_id, status, host_workspace_path, host_data_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel, identity_id, peer_id) DO UPDATE SET sandbox_id = excluded.sandbox_id, status = excluded.status, host_workspace_path = excluded.host_workspace_path, host_data_path = excluded.host_data_path, updated_at = excluded.updated_at`,
    );
    stmt.run(channel, identityId, peerId, sandboxId, status, hostWorkspacePath, hostDataPath, now, now);
  }

  deleteSandbox(channel: ChannelName, identityId: string, peerId: string): boolean {
    const stmt = this.db.prepare("DELETE FROM sandboxes WHERE channel = ? AND identity_id = ? AND peer_id = ?");
    const result = stmt.run(channel, identityId, peerId);
    return result.changes > 0;
  }

  listSandboxes(): SandboxRow[] {
    const stmt = this.db.prepare(
      "SELECT channel, identity_id, peer_id, sandbox_id, status, host_workspace_path, host_data_path, created_at, updated_at FROM sandboxes ORDER BY updated_at DESC",
    );
    return stmt.all() as SandboxRow[];
  }

  close() {
    this.db.close();
  }
}
