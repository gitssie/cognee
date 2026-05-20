import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Point config resolution to the real opencode-router.json
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.env.OPENCODE_ROUTER_CONFIG_PATH = path.join(projectRoot, "opencode-router.json");

import { loadConfig } from "../../src/opencode-router/config.js";
import { BridgeStore } from "../../src/opencode-router/db.js";
import { init } from "../../src/opencode-router/db/index.js";

const config = loadConfig();

describe("BridgeStore (PostgreSQL)", () => {
  let store: BridgeStore;

  beforeAll(async () => {
    // Run migrations
    const db = init(config.dbUrl);
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: path.join(projectRoot, "migration") });
    await (db.$client as any).end();

    store = new BridgeStore(config.dbUrl);
  });

  afterAll(async () => {
    // Clean up test data
    await store.deleteSession("test", "user1", "peer1");
    await store.deleteSession("test", "user2", "peer2");
    await store.deleteBinding("test", "user_a", "peer_a");
    await store.deleteBinding("test", "user_b", "peer_b");
    await store.deleteBinding("test", "user_c", "peer_c");
    await store.deleteSandbox("test", "user_s1", "peer_s1");
    await store.deleteSandbox("test", "user_s2", "peer_s2");
    await store.close();
  });

  // ── Cycle 1: Sessions ───────────────────────────────────────────────────────

  test("upsertSession creates and getSession retrieves", async () => {
    const row = await store.getSession("test", "user1", "peer1");
    expect(row).toBeNull();

    await store.upsertSession("test", "user1", "peer1", "sess-001", "/tmp/dir1", "sb-001");

    const retrieved = await store.getSession("test", "user1", "peer1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.channel).toBe("test");
    expect(retrieved!.identity_id).toBe("user1");
    expect(retrieved!.peer_id).toBe("peer1");
    expect(retrieved!.session_id).toBe("sess-001");
    expect(retrieved!.directory).toBe("/tmp/dir1");
    expect(retrieved!.sandbox_id).toBe("sb-001");
    expect(typeof retrieved!.created_at).toBe("number");
    expect(typeof retrieved!.updated_at).toBe("number");
  });

  test("upsertSession updates existing record", async () => {
    // Already inserted in previous test
    await store.upsertSession("test", "user1", "peer1", "sess-002", "/tmp/dir2", null);

    const row = await store.getSession("test", "user1", "peer1");
    expect(row).not.toBeNull();
    expect(row!.session_id).toBe("sess-002");
    expect(row!.directory).toBe("/tmp/dir2");
    expect(row!.sandbox_id).toBeNull();
  });

  test("clearSession resets session_id to empty", async () => {
    await store.upsertSession("test", "user2", "peer2", "sess-003", "/tmp/dir3", null);
    const cleared = await store.clearSession("test", "user2", "peer2", "/tmp/newdir");
    expect(cleared).toBe(true);

    const row = await store.getSession("test", "user2", "peer2");
    expect(row).not.toBeNull();
    expect(row!.session_id).toBe("");
    expect(row!.directory).toBe("/tmp/newdir");
  });

  test("deleteSession removes record", async () => {
    await store.upsertSession("test", "user3", "peer3", "sess-004", null, null);
    let row = await store.getSession("test", "user3", "peer3");
    expect(row).not.toBeNull();

    const deleted = await store.deleteSession("test", "user3", "peer3");
    expect(deleted).toBe(true);

    row = await store.getSession("test", "user3", "peer3");
    expect(row).toBeNull();

    // Double delete returns false
    const reDeleted = await store.deleteSession("test", "user3", "peer3");
    expect(reDeleted).toBe(false);
  });

  // ── Cycle 3: Bindings ───────────────────────────────────────────────────────

  test("bindings: upsert, get, delete, list", async () => {
    // Create bindings
    await store.upsertBinding("test", "user_a", "peer_a", "/tmp/bind_a");
    await store.upsertBinding("test", "user_b", "peer_b", "/tmp/bind_b");
    await store.upsertBinding("test", "user_c", "peer_c", "/tmp/shared");

    // Get specific binding
    const b = await store.getBinding("test", "user_a", "peer_a");
    expect(b).not.toBeNull();
    expect(b!.directory).toBe("/tmp/bind_a");

    // Update existing binding
    await store.upsertBinding("test", "user_a", "peer_a", "/tmp/bind_a2");
    const b2 = await store.getBinding("test", "user_a", "peer_a");
    expect(b2!.directory).toBe("/tmp/bind_a2");

    // List all
    const all = await store.listBindings();
    expect(all.length).toBeGreaterThanOrEqual(3);

    // List with channel filter
    const byChan = await store.listBindings({ channel: "test" });
    expect(byChan.length).toBeGreaterThanOrEqual(3);

    // List with identity filter
    const byId = await store.listBindings({ identityId: "user_a" });
    expect(byId.length).toBe(1);
    expect(byId[0].directory).toBe("/tmp/bind_a2");

    // List with directory filter
    const byDir = await store.listBindings({ directory: "/tmp/shared" });
    expect(byDir.length).toBe(1);
    expect(byDir[0].peer_id).toBe("peer_c");

    // Delete binding
    const deleted = await store.deleteBinding("test", "user_b", "peer_b");
    expect(deleted).toBe(true);
    const afterDel = await store.getBinding("test", "user_b", "peer_b");
    expect(afterDel).toBeNull();
  });

  // ── Cycle 4: Allowlist ──────────────────────────────────────────────────────

  test("allowlist: allow, check, seed", async () => {
    expect(await store.isAllowed("test", "alice")).toBe(false);

    await store.allowPeer("test", "alice");
    expect(await store.isAllowed("test", "alice")).toBe(true);
    expect(await store.isAllowed("test", "bob")).toBe(false);

    // Seed multiple peers
    await store.seedAllowlist("test", ["bob", "charlie", "dave"]);
    expect(await store.isAllowed("test", "bob")).toBe(true);
    expect(await store.isAllowed("test", "charlie")).toBe(true);
    expect(await store.isAllowed("test", "dave")).toBe(true);

    // Seed existing peer should not error (ON CONFLICT DO NOTHING)
    await store.seedAllowlist("test", ["alice", "bob"]);
    expect(await store.isAllowed("test", "alice")).toBe(true);
  });

  // ── Cycle 5: Settings ───────────────────────────────────────────────────────

  test("settings: get and set", async () => {
    expect(await store.getSetting("theme")).toBeNull();

    await store.setSetting("theme", "dark");
    expect(await store.getSetting("theme")).toBe("dark");

    // Update
    await store.setSetting("theme", "light");
    expect(await store.getSetting("theme")).toBe("light");

    // Multiple keys
    await store.setSetting("lang", "en");
    expect(await store.getSetting("lang")).toBe("en");
    expect(await store.getSetting("theme")).toBe("light");
  });

  // ── Cycle 6: Sandboxes ──────────────────────────────────────────────────────

  test("sandboxes: upsert, get, delete, list", async () => {
    // Create sandboxes
    await store.upsertSandbox("test", "user_s1", "peer_s1", "sb-100", "running", "/ws/s1", "/data/s1");
    await store.upsertSandbox("test", "user_s2", "peer_s2", "sb-200", "stopped", "/ws/s2", "/data/s2");

    // Get specific sandbox
    const s = await store.getSandbox("test", "user_s1", "peer_s1");
    expect(s).not.toBeNull();
    expect(s!.sandbox_id).toBe("sb-100");
    expect(s!.status).toBe("running");
    expect(s!.host_workspace_path).toBe("/ws/s1");
    expect(s!.host_data_path).toBe("/data/s1");

    // Update sandbox status
    await store.upsertSandbox("test", "user_s1", "peer_s1", "sb-100", "stopped", "/ws/s1", "/data/s1");
    const s2 = await store.getSandbox("test", "user_s1", "peer_s1");
    expect(s2!.status).toBe("stopped");

    // List all
    const all = await store.listSandboxes();
    expect(all.length).toBeGreaterThanOrEqual(2);

    // Delete sandbox
    const deleted = await store.deleteSandbox("test", "user_s2", "peer_s2");
    expect(deleted).toBe(true);
    const afterDel = await store.getSandbox("test", "user_s2", "peer_s2");
    expect(afterDel).toBeNull();
  });
});
