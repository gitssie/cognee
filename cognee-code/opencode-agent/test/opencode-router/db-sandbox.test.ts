import { describe, expect, test, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BridgeStore } from "../../src/opencode-router/db";

const TEST_DB = join(tmpdir(), `test-sandboxes-${Date.now()}.sqlite`);

afterEach(() => {
  try {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  } catch {
    // best-effort cleanup
  }
});

function inMemoryStore(): BridgeStore {
  return new BridgeStore(":memory:");
}

describe("BridgeStore — sandboxes CRUD", () => {
  test("creates sandboxes table on construction", () => {
    const store = inMemoryStore();
    // The table exists if we can query it without error
    expect(store.getSandbox("ch", "id", "p")).toBeNull();
    store.close();
  });

  test("getSandbox returns null for missing entry", () => {
    const store = inMemoryStore();
    expect(store.getSandbox("nonexistent", "id", "p")).toBeNull();
    expect(store.getSandbox("ch", "missing", "p")).toBeNull();
    expect(store.getSandbox("ch", "id", "missing")).toBeNull();
    store.close();
  });

  test("upsertSandbox creates entry, getSandbox returns it with all fields", () => {
    const store = inMemoryStore();
    store.upsertSandbox("test", "id1", "p1", "sbx_1", "running", "/workspace", "/data");

    const row = store.getSandbox("test", "id1", "p1");
    expect(row).not.toBeNull();
    expect(row!.channel).toBe("test");
    expect(row!.identity_id).toBe("id1");
    expect(row!.peer_id).toBe("p1");
    expect(row!.sandbox_id).toBe("sbx_1");
    expect(row!.status).toBe("running");
    expect(row!.host_workspace_path).toBe("/workspace");
    expect(row!.host_data_path).toBe("/data");
    expect(typeof row!.created_at).toBe("number");
    expect(typeof row!.updated_at).toBe("number");
    expect(row!.created_at).toBeGreaterThan(0);
    expect(row!.updated_at).toBeGreaterThan(0);
    store.close();
  });

  test("upsertSandbox updates existing entry (upsert behavior)", () => {
    const store = inMemoryStore();
    store.upsertSandbox("test", "id1", "p1", "sbx_1", "running", "/ws1", "/d1");
    const originalRow = store.getSandbox("test", "id1", "p1")!;
    const originalCreatedAt = originalRow.created_at;
    const originalUpdatedAt = originalRow.updated_at;

    // Brief pause so updated_at differs
    const beforeUpdate = Date.now();
    store.upsertSandbox("test", "id1", "p1", "sbx_2", "stopped", "/ws2", "/d2");
    const afterUpdate = Date.now();

    const updatedRow = store.getSandbox("test", "id1", "p1");
    expect(updatedRow).not.toBeNull();
    // Fields should be updated
    expect(updatedRow!.sandbox_id).toBe("sbx_2");
    expect(updatedRow!.status).toBe("stopped");
    expect(updatedRow!.host_workspace_path).toBe("/ws2");
    expect(updatedRow!.host_data_path).toBe("/d2");
    // Primary key fields stay the same
    expect(updatedRow!.channel).toBe("test");
    expect(updatedRow!.identity_id).toBe("id1");
    expect(updatedRow!.peer_id).toBe("p1");
    // created_at must be preserved
    expect(updatedRow!.created_at).toBe(originalCreatedAt);
    // updated_at must advance
    expect(updatedRow!.updated_at).toBeGreaterThanOrEqual(beforeUpdate);
    expect(updatedRow!.updated_at).toBeLessThanOrEqual(afterUpdate);
    store.close();
  });

  test("deleteSandbox returns true for existing entry, false for missing", () => {
    const store = inMemoryStore();
    store.upsertSandbox("test", "id1", "p1", "sbx_1", "running", "/ws", "/d");

    // Delete existing
    const deleted = store.deleteSandbox("test", "id1", "p1");
    expect(deleted).toBe(true);
    expect(store.getSandbox("test", "id1", "p1")).toBeNull();

    // Delete already deleted
    const deletedAgain = store.deleteSandbox("test", "id1", "p1");
    expect(deletedAgain).toBe(false);

    // Delete never-inserted
    expect(store.deleteSandbox("nope", "id", "p")).toBe(false);
    store.close();
  });

  test("listSandboxes returns all entries sorted by updated_at DESC", () => {
    const store = inMemoryStore();

    store.upsertSandbox("ch1", "id1", "p1", "sbx_a", "running", "/ws/a", "/d/a");
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // We must ensure at least 1ms between inserts for reliable ordering
    store.upsertSandbox("ch2", "id2", "p2", "sbx_b", "stopped", "/ws/b", "/d/b");
    store.upsertSandbox("ch3", "id3", "p3", "sbx_c", "ready", "/ws/c", "/d/c");

    const rows = store.listSandboxes();
    expect(rows.length).toBe(3);

    // All expected sandboxes present
    const sandboxIds = rows.map((r) => r.sandbox_id).sort();
    expect(sandboxIds).toEqual(["sbx_a", "sbx_b", "sbx_c"]);

    // Verify sort order: updated_at DESC (non-increasing)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].updated_at).toBeGreaterThanOrEqual(rows[i].updated_at);
    }
    store.close();
  });

  test("backfill from sessions populates sandboxes on first construction", () => {
    // Phase 1: Create file-based store so we have tables
    const store1 = new BridgeStore(TEST_DB);
    store1.close();

    // Phase 2: Insert a session with sandbox_id via raw SQL
    const raw = new Database(TEST_DB);
    const now = Date.now();
    raw.run(
      "INSERT INTO sessions (channel, identity_id, peer_id, session_id, sandbox_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "test",
      "id1",
      "p1",
      "ses_1",
      "sbx_1",
      now,
      now,
    );
    // Also insert a session WITHOUT sandbox_id — should NOT be backfilled
    raw.run(
      "INSERT INTO sessions (channel, identity_id, peer_id, session_id, sandbox_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "test",
      "id2",
      "p2",
      "ses_2",
      null,
      now,
      now,
    );
    // Clear sandboxes table so the backfill triggers on next open
    raw.run("DELETE FROM sandboxes");
    raw.close();

    // Phase 3: Reopen — backfill runs because sandboxes was emptied
    const store2 = new BridgeStore(TEST_DB);
    const rows = store2.listSandboxes();
    expect(rows.length).toBe(1);

    const row = rows[0];
    expect(row.channel).toBe("test");
    expect(row.identity_id).toBe("id1");
    expect(row.peer_id).toBe("p1");
    expect(row.sandbox_id).toBe("sbx_1");
    expect(row.status).toBe("unknown");
    expect(row.host_workspace_path).toBe("");
    expect(row.host_data_path).toBe("");

    store2.close();
  });
});
