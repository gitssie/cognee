import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";

import { schema, type Schema } from "./db/index.js";
import type { ChannelName } from "./config.js";

type SessionRow = {
  channel: ChannelName;
  identity_id: string;
  peer_id: string;
  session_id: string;
  directory: string | null;
  sandbox_id: string | null;
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
  private pool: Pool;
  private db: NodePgDatabase<Schema>;

  constructor(dbUrl: string) {
    this.pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 });
    this.db = drizzle({ client: this.pool, schema });
  }

  // ── Sessions ────────────────────────────────────────────────────────────────

  async getSession(channel: ChannelName, identityId: string, peerId: string): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.channel, channel),
          eq(schema.sessions.identity_id, identityId),
          eq(schema.sessions.peer_id, peerId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertSession(
    channel: ChannelName,
    identityId: string,
    peerId: string,
    sessionId: string,
    directory?: string | null,
    sandboxId?: string | null,
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(schema.sessions)
      .values({
        channel,
        identity_id: identityId,
        peer_id: peerId,
        session_id: sessionId,
        directory: directory ?? null,
        sandbox_id: sandboxId ?? null,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [schema.sessions.channel, schema.sessions.identity_id, schema.sessions.peer_id],
        set: {
          session_id: sessionId,
          directory: directory ?? null,
          sandbox_id: sandboxId ?? null,
          updated_at: now,
        },
      });
  }

  async clearSession(channel: ChannelName, identityId: string, peerId: string, directory?: string | null): Promise<boolean> {
    const now = Date.now();
    const setValues: Record<string, unknown> = {
      session_id: "",
      updated_at: now,
    };
    if (directory !== undefined) {
      setValues.directory = directory;
    }
    const result = await this.db
      .update(schema.sessions)
      .set(setValues)
      .where(
        and(
          eq(schema.sessions.channel, channel),
          eq(schema.sessions.identity_id, identityId),
          eq(schema.sessions.peer_id, peerId),
        ),
      );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async deleteSession(channel: ChannelName, identityId: string, peerId: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.sessions)
      .where(
        and(
          eq(schema.sessions.channel, channel),
          eq(schema.sessions.identity_id, identityId),
          eq(schema.sessions.peer_id, peerId),
        ),
      );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // ── Bindings ────────────────────────────────────────────────────────────────

  async getBinding(channel: ChannelName, identityId: string, peerId: string): Promise<BindingRow | null> {
    const rows = await this.db
      .select()
      .from(schema.bindings)
      .where(
        and(
          eq(schema.bindings.channel, channel),
          eq(schema.bindings.identity_id, identityId),
          eq(schema.bindings.peer_id, peerId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertBinding(channel: ChannelName, identityId: string, peerId: string, directory: string): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(schema.bindings)
      .values({
        channel,
        identity_id: identityId,
        peer_id: peerId,
        directory,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [schema.bindings.channel, schema.bindings.identity_id, schema.bindings.peer_id],
        set: { directory, updated_at: now },
      });
  }

  async deleteBinding(channel: ChannelName, identityId: string, peerId: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.bindings)
      .where(
        and(
          eq(schema.bindings.channel, channel),
          eq(schema.bindings.identity_id, identityId),
          eq(schema.bindings.peer_id, peerId),
        ),
      );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async listBindings(
    filters: { channel?: ChannelName; identityId?: string; directory?: string } = {},
  ): Promise<BindingRow[]> {
    const conditions = [];
    if (filters.channel) conditions.push(eq(schema.bindings.channel, filters.channel));
    if (filters.identityId) conditions.push(eq(schema.bindings.identity_id, filters.identityId));
    if (filters.directory) conditions.push(eq(schema.bindings.directory, filters.directory));

    let query = this.db.select().from(schema.bindings).$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    return query.orderBy(schema.bindings.updated_at);
  }

  // ── Allowlist ───────────────────────────────────────────────────────────────

  async isAllowed(channel: ChannelName, peerId: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(schema.allowlist)
      .where(
        and(
          eq(schema.allowlist.channel, channel),
          eq(schema.allowlist.peer_id, peerId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async allowPeer(channel: ChannelName, peerId: string): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(schema.allowlist)
      .values({ channel, peer_id: peerId, created_at: now })
      .onConflictDoUpdate({
        target: [schema.allowlist.channel, schema.allowlist.peer_id],
        set: { created_at: now },
      });
  }

  async seedAllowlist(channel: ChannelName, peers: Iterable<string>): Promise<void> {
    const now = Date.now();
    for (const peer of peers) {
      await this.db
        .insert(schema.allowlist)
        .values({ channel, peer_id: peer, created_at: now })
        .onConflictDoNothing();
    }
  }

  // ── Settings ────────────────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value },
      });
  }

  // ── Sandboxes ───────────────────────────────────────────────────────────────

  async getSandbox(channel: ChannelName, identityId: string, peerId: string): Promise<SandboxRow | null> {
    const rows = await this.db
      .select()
      .from(schema.sandboxes)
      .where(
        and(
          eq(schema.sandboxes.channel, channel),
          eq(schema.sandboxes.identity_id, identityId),
          eq(schema.sandboxes.peer_id, peerId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertSandbox(
    channel: ChannelName,
    identityId: string,
    peerId: string,
    sandboxId: string,
    status: string,
    hostWorkspacePath: string,
    hostDataPath: string,
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(schema.sandboxes)
      .values({
        channel,
        identity_id: identityId,
        peer_id: peerId,
        sandbox_id: sandboxId,
        status,
        host_workspace_path: hostWorkspacePath,
        host_data_path: hostDataPath,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [schema.sandboxes.channel, schema.sandboxes.identity_id, schema.sandboxes.peer_id],
        set: {
          sandbox_id: sandboxId,
          status,
          host_workspace_path: hostWorkspacePath,
          host_data_path: hostDataPath,
          updated_at: now,
        },
      });
  }

  async deleteSandbox(channel: ChannelName, identityId: string, peerId: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.sandboxes)
      .where(
        and(
          eq(schema.sandboxes.channel, channel),
          eq(schema.sandboxes.identity_id, identityId),
          eq(schema.sandboxes.peer_id, peerId),
        ),
      );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async listSandboxes(): Promise<SandboxRow[]> {
    return this.db
      .select()
      .from(schema.sandboxes)
      .orderBy(schema.sandboxes.updated_at);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.pool.end();
  }
}
