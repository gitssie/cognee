import { describe, expect, test, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BridgeStore } from "../../src/opencode-router/db";

// ---------------------------------------------------------------------------
// SQL INJECTION PAYLOADS
// ---------------------------------------------------------------------------
const SQLI_PAYLOADS = [
  "'; DROP TABLE sandboxes; --",
  "'; DELETE FROM sandboxes; --",
  "1; DROP TABLE sessions; --",
  "' OR '1'='1",
  "' OR '1'='1' --",
  "' OR '1'='1' /*",
  "admin'--",
  "admin' /*",
  "admin' OR '1'='1",
  "'; SELECT * FROM sandboxes WHERE '1'='1",
  "'; UPDATE sandboxes SET status = 'hacked' WHERE '1'='1",
  "'; INSERT INTO sandboxes VALUES('hacked','hacked','hacked','hacked','hacked','/hack','/hack',0,0); --",
  "' UNION SELECT * FROM sandboxes --",
  "1' UNION SELECT 1,2,3,4,5,6,7,8,9 --",
  "1; SELECT pg_sleep(5) --", // PostgreSQL-specific but try on sqlite
  "'; WAITFOR DELAY '0:0:5' --", // MSSQL-specific but try
  "'; SELECT BENCHMARK(100000000,SHA1('test')) --", // MySQL-specific but try
  "\\'; DROP TABLE sandboxes; --",
  "\" OR \"1\"=\"1",
  "` OR 1=1 --",
  "/*!DROP TABLE sandboxes*/",
  "1' HAVING 1=1 --",
  "1' GROUP BY 1,2,3,4,5,6,7,8 HAVING 1=1 --",
  "'; EXEC xp_cmdshell('rm -rf /'); --",
  "../', (SELECT group_concat(name) FROM sqlite_master WHERE type='table'), '",
  "', host_workspace_path || host_data_path || sandbox_id, '",
];

// ---------------------------------------------------------------------------
// UNICODE / SPECIAL CHARS / OVERSIZED INPUTS
// ---------------------------------------------------------------------------
const UNICODE_INJECTIONS = [
  "\0", // null byte
  "\x00", // literal null
  "\x1f", // control char
  "\x7f", // DEL
  "\r\n injected", // CRLF injection
  "\n injected", // LF injection
  "\t injected", // tab
  "<script>alert(1)</script>",
  "${process.env.PATH}",
  "$PATH",
  "`id`",
  "| cat /etc/passwd",
  "&& ls -la",
  "; rm -rf /",
  "..\\..\\..\\etc\\passwd",
  "../../../etc/passwd",
  "..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts",
  // Emoji and Unicode
  "🚀🔥💥",
  "дропнуть таблицу сандбоксов",
  "删除 sandboxes 表",
  "\u202E\u202D", // RTL override
  "\u200B", // zero-width space
  "\u200C", // zero-width non-joiner
  "\uFF01", // fullwidth exclamation
  "ℑ𝓪𝓬𝓴𝓮𝓭 𝓘𝓷𝓳𝓮𝓬𝓽𝓲𝓸𝓷", // mathematical bold script
  // Long strings
  "A".repeat(1000),
  "A".repeat(10_000),
  "A".repeat(100_000),
  // Mixed boundary + injection
  "x".repeat(4095) + "'; DROP TABLE sandboxes; --",
  "\x00\x00\x00' OR 1=1 --",
];

// Race condition concurrency level
const RACE_THREADS = 50;

function inMemoryStore(): BridgeStore {
  return new BridgeStore(":memory:");
}

// Generate unique channel/identity/peer for each test to avoid cross-test pollution
let counter = 0;
function uniqueKey(label: string): { channel: string; identityId: string; peerId: string } {
  counter++;
  return { channel: `adv_${label}_${counter}`, identityId: `id_${counter}`, peerId: `p_${counter}` };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe("BridgeStore — sandbox getSandbox adversarial", () => {
  test.each(SQLI_PAYLOADS)(
    "getSandbox rejects SQL injection in channel: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { identityId, peerId } = uniqueKey("get_sqli_ch");
      // Should not throw — parameterized queries handle this safely
      expect(() => store.getSandbox(payload as any, identityId, peerId)).not.toThrow();
      // Should return null (no match), not leak data, not corrupt
      expect(store.getSandbox(payload as any, identityId, peerId)).toBeNull();
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "getSandbox rejects SQL injection in identityId: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { channel, peerId } = uniqueKey("get_sqli_id");
      expect(() => store.getSandbox(channel, payload, peerId)).not.toThrow();
      expect(store.getSandbox(channel, payload, peerId)).toBeNull();
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "getSandbox rejects SQL injection in peerId: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { channel, identityId } = uniqueKey("get_sqli_p");
      expect(() => store.getSandbox(channel, identityId, payload)).not.toThrow();
      expect(store.getSandbox(channel, identityId, payload)).toBeNull();
      store.close();
    },
  );

  test.each(UNICODE_INJECTIONS)(
    "getSandbox handles unicode/special channel input (repr %j)",
    (payload) => {
      const store = inMemoryStore();
      const { identityId, peerId } = uniqueKey("get_uni_ch");
      expect(() => store.getSandbox(payload as any, identityId, peerId)).not.toThrow();
      // Round-trip: write then read with same payload
      store.upsertSandbox(payload as any, identityId, peerId, "sbx_uni", "running", "/ws", "/d");
      const row = store.getSandbox(payload as any, identityId, peerId);
      expect(row).not.toBeNull();
      expect(row!.channel).toBe(payload);
      expect(row!.sandbox_id).toBe("sbx_uni");
      store.close();
    },
  );

  test.each(UNICODE_INJECTIONS)(
    "getSandbox handles unicode/special identityId (repr %j)",
    (payload) => {
      const store = inMemoryStore();
      const { channel, peerId } = uniqueKey("get_uni_id");
      expect(() => store.getSandbox(channel, payload, peerId)).not.toThrow();
      store.upsertSandbox(channel, payload, peerId, "sbx_uni2", "running", "/ws", "/d");
      const row = store.getSandbox(channel, payload, peerId);
      expect(row).not.toBeNull();
      expect(row!.identity_id).toBe(payload);
      store.close();
    },
  );

  test.each(UNICODE_INJECTIONS)(
    "getSandbox handles unicode/special peerId (repr %j)",
    (payload) => {
      const store = inMemoryStore();
      const { channel, identityId } = uniqueKey("get_uni_p");
      expect(() => store.getSandbox(channel, identityId, payload)).not.toThrow();
      store.upsertSandbox(channel, identityId, payload, "sbx_uni3", "running", "/ws", "/d");
      const row = store.getSandbox(channel, identityId, payload);
      expect(row).not.toBeNull();
      expect(row!.peer_id).toBe(payload);
      store.close();
    },
  );
});

describe("BridgeStore — sandbox upsertSandbox adversarial", () => {
  test.each(SQLI_PAYLOADS)(
    "upsertSandbox rejects SQL injection via channel: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { identityId, peerId } = uniqueKey("up_sqli_ch");
      expect(() =>
        store.upsertSandbox(payload as any, identityId, peerId, "sbx_sqli", "running", "/ws", "/d"),
      ).not.toThrow();
      // Verify the row was inserted with the raw payload, not interpreted as SQL
      const row = store.getSandbox(payload as any, identityId, peerId);
      expect(row).not.toBeNull();
      expect(row!.channel).toBe(payload);
      // Verify no data corruption in other rows
      expect(store.listSandboxes().length).toBe(1);
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "upsertSandbox rejects SQL injection via identityId: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { channel, peerId } = uniqueKey("up_sqli_id");
      expect(() =>
        store.upsertSandbox(channel, payload, peerId, "sbx_sqli2", "running", "/ws", "/d"),
      ).not.toThrow();
      const row = store.getSandbox(channel, payload, peerId);
      expect(row).not.toBeNull();
      expect(row!.identity_id).toBe(payload);
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "upsertSandbox rejects SQL injection via peerId: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { channel, identityId } = uniqueKey("up_sqli_p");
      expect(() =>
        store.upsertSandbox(channel, identityId, payload, "sbx_sqli3", "running", "/ws", "/d"),
      ).not.toThrow();
      const row = store.getSandbox(channel, identityId, payload);
      expect(row).not.toBeNull();
      expect(row!.peer_id).toBe(payload);
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "upsertSandbox rejects SQL injection via sandboxId: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const key = uniqueKey("up_sqli_sbx");
      expect(() =>
        store.upsertSandbox(key.channel, key.identityId, key.peerId, payload, "running", "/ws", "/d"),
      ).not.toThrow();
      const row = store.getSandbox(key.channel, key.identityId, key.peerId);
      expect(row).not.toBeNull();
      expect(row!.sandbox_id).toBe(payload);
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "upsertSandbox rejects SQL injection via status: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const key = uniqueKey("up_sqli_st");
      expect(() =>
        store.upsertSandbox(key.channel, key.identityId, key.peerId, "sbx_st", payload, "/ws", "/d"),
      ).not.toThrow();
      const row = store.getSandbox(key.channel, key.identityId, key.peerId);
      expect(row).not.toBeNull();
      expect(row!.status).toBe(payload);
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "upsertSandbox rejects SQL injection via hostWorkspacePath: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const key = uniqueKey("up_sqli_ws");
      expect(() =>
        store.upsertSandbox(key.channel, key.identityId, key.peerId, "sbx_ws", "running", payload, "/d"),
      ).not.toThrow();
      const row = store.getSandbox(key.channel, key.identityId, key.peerId);
      expect(row).not.toBeNull();
      expect(row!.host_workspace_path).toBe(payload);
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "upsertSandbox rejects SQL injection via hostDataPath: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const key = uniqueKey("up_sqli_dp");
      expect(() =>
        store.upsertSandbox(key.channel, key.identityId, key.peerId, "sbx_dp", "running", "/ws", payload),
      ).not.toThrow();
      const row = store.getSandbox(key.channel, key.identityId, key.peerId);
      expect(row).not.toBeNull();
      expect(row!.host_data_path).toBe(payload);
      store.close();
    },
  );

  // Oversized input tests on sandboxId
  test("upsertSandbox handles 1KB sandboxId", () => {
    const store = inMemoryStore();
    const key = uniqueKey("big1k");
    const longId = "A".repeat(1000);
    store.upsertSandbox(key.channel, key.identityId, key.peerId, longId, "running", "/ws", "/d");
    const row = store.getSandbox(key.channel, key.identityId, key.peerId);
    expect(row).not.toBeNull();
    expect(row!.sandbox_id).toBe(longId);
    expect(row!.sandbox_id.length).toBe(1000);
    store.close();
  });

  test("upsertSandbox handles 10KB sandboxId", () => {
    const store = inMemoryStore();
    const key = uniqueKey("big10k");
    const longId = "B".repeat(10_000);
    store.upsertSandbox(key.channel, key.identityId, key.peerId, longId, "running", "/ws", "/d");
    const row = store.getSandbox(key.channel, key.identityId, key.peerId);
    expect(row).not.toBeNull();
    expect(row!.sandbox_id).toBe(longId);
    expect(row!.sandbox_id.length).toBe(10_000);
    store.close();
  });

  test("upsertSandbox handles 100KB hostWorkspacePath", () => {
    const store = inMemoryStore();
    const key = uniqueKey("big100k");
    const longPath = "/".repeat(100_000);
    store.upsertSandbox(key.channel, key.identityId, key.peerId, "sbx_big", "running", longPath, "/d");
    const row = store.getSandbox(key.channel, key.identityId, key.peerId);
    expect(row).not.toBeNull();
    expect(row!.host_workspace_path.length).toBe(100_000);
    store.close();
  });

  test("upsertSandbox handles empty strings for all non-PK string fields", () => {
    const store = inMemoryStore();
    const key = uniqueKey("empty_str");
    store.upsertSandbox(key.channel, key.identityId, key.peerId, "", "", "", "");
    const row = store.getSandbox(key.channel, key.identityId, key.peerId);
    expect(row).not.toBeNull();
    expect(row!.sandbox_id).toBe("");
    expect(row!.status).toBe("");
    expect(row!.host_workspace_path).toBe("");
    expect(row!.host_data_path).toBe("");
    store.close();
  });

  test("upsertSandbox handles all-string-parameters with null bytes", () => {
    const store = inMemoryStore();
    const key = uniqueKey("nullbytes");
    const withNull = "abc\x00def\x00ghi";
    expect(() =>
      store.upsertSandbox(key.channel, key.identityId, key.peerId, withNull, withNull, withNull, withNull),
    ).not.toThrow();
    const row = store.getSandbox(key.channel, key.identityId, key.peerId);
    // SQLite TEXT fields can store embedded null bytes
    expect(row).not.toBeNull();
    expect(row!.sandbox_id).toBe(withNull);
    store.close();
  });
});

describe("BridgeStore — sandbox deleteSandbox adversarial", () => {
  test.each(SQLI_PAYLOADS)(
    "deleteSandbox rejects SQL injection via channel: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { identityId, peerId } = uniqueKey("del_sqli_ch");
      // Should not throw — parameterized query
      expect(() => store.deleteSandbox(payload as any, identityId, peerId)).not.toThrow();
      // Should return false (no matching row), not corrupt or delete all
      expect(store.deleteSandbox(payload as any, identityId, peerId)).toBe(false);
      // Verify sandboxes table is still intact
      expect(store.listSandboxes()).toEqual([]);
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "deleteSandbox rejects SQL injection via identityId: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { channel, peerId } = uniqueKey("del_sqli_id");
      expect(() => store.deleteSandbox(channel, payload, peerId)).not.toThrow();
      expect(store.deleteSandbox(channel, payload, peerId)).toBe(false);
      store.close();
    },
  );

  test.each(SQLI_PAYLOADS)(
    "deleteSandbox rejects SQL injection via peerId: %s (truncated)",
    (payload) => {
      const store = inMemoryStore();
      const { channel, identityId } = uniqueKey("del_sqli_p");
      expect(() => store.deleteSandbox(channel, identityId, payload)).not.toThrow();
      expect(store.deleteSandbox(channel, identityId, payload)).toBe(false);
      store.close();
    },
  );

  test("deleteSandbox does not delete different entries when given unicode/special peerId", () => {
    const store = inMemoryStore();
    // Insert a legitimate entry
    store.upsertSandbox("ch", "id", "real_peer", "sbx_real", "running", "/ws", "/d");
    // Attempt delete with evil strings
    store.deleteSandbox("ch", "id", "'; DELETE FROM sandboxes; --");
    store.deleteSandbox("ch", "id", "' OR '1'='1");
    store.deleteSandbox("ch", "id", "%");
    store.deleteSandbox("ch", "id", "_");
    // The real entry must survive
    const row = store.getSandbox("ch", "id", "real_peer");
    expect(row).not.toBeNull();
    expect(row!.sandbox_id).toBe("sbx_real");
    store.close();
  });

  test("deleteSandbox does not delete different entries when given unicode/special identityId", () => {
    const store = inMemoryStore();
    store.upsertSandbox("ch", "safe_id", "peer1", "sbx_safe", "running", "/ws", "/d");
    store.deleteSandbox("ch", "'; DROP TABLE sandboxes; --", "peer1");
    store.deleteSandbox("ch", "' OR '1'='1", "peer1");
    store.deleteSandbox("ch", "%", "peer1");
    const row = store.getSandbox("ch", "safe_id", "peer1");
    expect(row).not.toBeNull();
    store.close();
  });

  test("deleteSandbox wildcard-like peerId (% and _) are literal, not LIKE patterns", () => {
    const store = inMemoryStore();
    store.upsertSandbox("ch", "id", "peer_1", "sbx_w1", "running", "/ws", "/d");
    store.upsertSandbox("ch", "id", "peer%1", "sbx_w2", "running", "/ws", "/d");

    // Delete only the entry with literal '_' in peerId
    const deleted1 = store.deleteSandbox("ch", "id", "peer_1");
    expect(deleted1).toBe(true);
    expect(store.getSandbox("ch", "id", "peer_1")).toBeNull();
    // The '%' entry must survive (it uses =, not LIKE)
    expect(store.getSandbox("ch", "id", "peer%1")).not.toBeNull();
    store.close();
  });
});

describe("BridgeStore — sandbox race conditions", () => {
  test("concurrent upsertSandbox on the same key is safe", async () => {
    const store = inMemoryStore();
    const channel = "race_ch";
    const identityId = "race_id";
    const peerId = "race_p";
    const promises: Promise<void>[] = [];

    for (let i = 0; i < RACE_THREADS; i++) {
      promises.push(
        Promise.resolve().then(() => {
          store.upsertSandbox(channel, identityId, peerId, `sbx_${i}`, `status_${i}`, `/ws/${i}`, `/d/${i}`);
        }),
      );
    }
    await Promise.all(promises);

    // After all races, exactly one row should exist (upsert on the same PK)
    const rows = store.listSandboxes();
    const matching = rows.filter((r) => r.channel === channel && r.identity_id === identityId && r.peer_id === peerId);
    expect(matching.length).toBe(1);
    store.close();
  });

  test("concurrent upsertSandbox on unique keys is safe", async () => {
    const store = inMemoryStore();
    const promises: Promise<void>[] = [];

    for (let i = 0; i < RACE_THREADS; i++) {
      promises.push(
        Promise.resolve().then(() => {
          store.upsertSandbox(`race_ch_${i}`, `race_id_${i}`, `race_p_${i}`, `sbx_${i}`, "running", "/ws", "/d");
        }),
      );
    }
    await Promise.all(promises);

    const rows = store.listSandboxes();
    expect(rows.length).toBe(RACE_THREADS);
    store.close();
  });

  test("concurrent upsert + delete does not cause data integrity issues", async () => {
    const store = inMemoryStore();
    const channel = "race_ud";
    const identityId = "race_ud_id";
    const peerId = "race_ud_p";

    // Insert initial entry
    store.upsertSandbox(channel, identityId, peerId, "initial", "running", "/ws", "/d");

    const promises: Promise<void>[] = [];
    for (let i = 0; i < RACE_THREADS; i++) {
      if (i % 2 === 0) {
        promises.push(
          Promise.resolve().then(() => {
            store.upsertSandbox(channel, identityId, peerId, `sbx_${i}`, `status_${i}`, `/ws/${i}`, `/d/${i}`);
          }),
        );
      } else {
        promises.push(
          Promise.resolve().then(() => {
            store.deleteSandbox(channel, identityId, peerId);
          }),
        );
      }
    }
    await Promise.all(promises);

    // Either the entry exists (last upsert won) or it's deleted (last delete won)
    // Both states are valid — we just must not crash or enter an inconsistent state
    const row = store.getSandbox(channel, identityId, peerId);
    if (row !== null) {
      expect(row.channel).toBe(channel);
      expect(row.identity_id).toBe(identityId);
      expect(row.peer_id).toBe(peerId);
      expect(row.sandbox_id).toMatch(/^sbx_\d+$/);
      expect(row.status).toMatch(/^status_\d+$/);
    }

    // Table must be queryable (no corruption)
    const allRows = store.listSandboxes();
    const ourRows = allRows.filter(
      (r) => r.channel === channel && r.identity_id === identityId && r.peer_id === peerId,
    );
    expect(ourRows.length).toBeLessThanOrEqual(1);
    store.close();
  });

  test("concurrent delete on non-existent entries does not throw", async () => {
    const store = inMemoryStore();
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      const ch = `nonexistent_${i}`;
      const id = `id_${i}`;
      const p = `p_${i}`;
      promises.push(
        Promise.resolve().then(() => {
          expect(() => store.deleteSandbox(ch, id, p)).not.toThrow();
        }),
      );
    }
    await Promise.all(promises);
    store.close();
  });

  test("concurrent getSandbox on same key is safe", async () => {
    const store = inMemoryStore();
    store.upsertSandbox("concurrent_get", "id", "p", "sbx_get", "running", "/ws", "/d");
    const promises: Promise<void>[] = [];
    for (let i = 0; i < RACE_THREADS; i++) {
      promises.push(
        Promise.resolve().then(() => {
          const row = store.getSandbox("concurrent_get", "id", "p");
          expect(row).not.toBeNull();
          expect(row!.sandbox_id).toBe("sbx_get");
        }),
      );
    }
    await Promise.all(promises);
    store.close();
  });
});

describe("BridgeStore — sandbox listSandboxes adversarial", () => {
  test("listSandboxes is unaffected by injection attempts stored in table", () => {
    const store = inMemoryStore();
    // Insert entries with SQL injection payloads as data
    for (let i = 0; i < SQLI_PAYLOADS.length; i++) {
      store.upsertSandbox(
        SQLI_PAYLOADS[i % SQLI_PAYLOADS.length],
        `id_${i}`,
        `p_${i}`,
        `sbx_${i}`,
        "running",
        "/ws",
        "/d",
      );
    }
    // listSandboxes should return all rows without error
    const rows = store.listSandboxes();
    expect(rows.length).toBe(SQLI_PAYLOADS.length);
    // Verify round-trip for each row
    for (let i = 0; i < SQLI_PAYLOADS.length; i++) {
      const row = store.getSandbox(SQLI_PAYLOADS[i % SQLI_PAYLOADS.length], `id_${i}`, `p_${i}`);
      expect(row).not.toBeNull();
      expect(row!.sandbox_id).toBe(`sbx_${i}`);
    }
    store.close();
  });
});

describe("BridgeStore — sandbox cross-contamination", () => {
  test("upsert only affects the exact PK row", () => {
    const store = inMemoryStore();
    // Create two separate entries
    store.upsertSandbox("ch_a", "id_a", "p_a", "sbx_a", "running", "/ws_a", "/d_a");
    store.upsertSandbox("ch_b", "id_b", "p_b", "sbx_b", "stopped", "/ws_b", "/d_b");

    // Upsert for the first entry with new values
    store.upsertSandbox("ch_a", "id_a", "p_a", "sbx_a_v2", "ready", "/ws_a_v2", "/d_a_v2");

    // First entry updated
    const rowA = store.getSandbox("ch_a", "id_a", "p_a")!;
    expect(rowA.sandbox_id).toBe("sbx_a_v2");

    // Second entry unchanged
    const rowB = store.getSandbox("ch_b", "id_b", "p_b")!;
    expect(rowB.sandbox_id).toBe("sbx_b");
    expect(rowB.status).toBe("stopped");

    store.close();
  });

  test("delete only removes the exact PK row", () => {
    const store = inMemoryStore();
    store.upsertSandbox("ch_a", "id_a", "p_a", "sbx_a", "running", "/ws", "/d");
    store.upsertSandbox("ch_b", "id_b", "p_b", "sbx_b", "stopped", "/ws", "/d");

    store.deleteSandbox("ch_a", "id_a", "p_a");

    expect(store.getSandbox("ch_a", "id_a", "p_a")).toBeNull();
    expect(store.getSandbox("ch_b", "id_b", "p_b")).not.toBeNull();

    store.close();
  });

  test("wildcard characters in peerId do NOT match multiple rows", () => {
    const store = inMemoryStore();
    store.upsertSandbox("ch", "id", "p_abc", "sbx_1", "running", "/ws", "/d");
    store.upsertSandbox("ch", "id", "p_xyz", "sbx_2", "running", "/ws", "/d");

    // SQLite = operator treats _ and % as literals (not LIKE)
    const result = store.deleteSandbox("ch", "id", "p_abc");
    expect(result).toBe(true);
    // p_xyz should NOT be affected
    expect(store.getSandbox("ch", "id", "p_xyz")).not.toBeNull();
    store.close();
  });
});

describe("BridgeStore — listSandboxes after adversarial operations", () => {
  test("handles many entries with unicode/injection data gracefully", () => {
    const store = inMemoryStore();
    const keys: string[] = [];
    for (let i = 0; i < 100; i++) {
      const ch = `\u00E9\u00E8\u00EA_${i}`; // accented chars
      const id = `\u4E2D\u6587_${i}`; // Chinese
      const p = `<script>alert(${i})</script>`;
      keys.push(ch);
      store.upsertSandbox(ch, id, p, `sbx_${i}`, `status_${i}`, `/ws/${i}`, `/d/${i}`);
    }

    const rows = store.listSandboxes();
    expect(rows.length).toBe(100);

    // Verify round-trip integrity
    for (let i = 0; i < 100; i++) {
      const ch = `\u00E9\u00E8\u00EA_${i}`;
      const id = `\u4E2D\u6587_${i}`;
      const p = `<script>alert(${i})</script>`;
      const row = store.getSandbox(ch, id, p);
      expect(row).not.toBeNull();
      expect(row!.sandbox_id).toBe(`sbx_${i}`);
      expect(row!.status).toBe(`status_${i}`);
    }

    store.close();
  });
});
