import { describe, expect, test } from "bun:test";

import { AdapterRegistry, startAdapterBounded, type BridgeAdapter } from "../../src/opencode-router/bridge-adapters";

function adapter(overrides: Partial<BridgeAdapter> = {}): BridgeAdapter {
  return {
    key: "wecom:default",
    name: "wecom",
    identityId: "default",
    maxTextLength: 1000,
    start: async () => {},
    stop: async () => {},
    sendText: async () => {},
    ...overrides,
  };
}

describe("AdapterRegistry", () => {
  test("registers, retrieves, finds and deletes adapters", () => {
    const registry = new AdapterRegistry();
    const item = adapter();

    registry.set(item.key, item);

    expect(registry.get(item.key)).toBe(item);
    expect(registry.hasChannel("wecom")).toBe(true);
    expect(registry.find((entry) => entry.identityId === "default")).toBe(item);
    expect(registry.delete(item.key)).toBe(true);
    expect(registry.get(item.key)).toBeUndefined();
  });

  test("stopAll stops registered adapters", async () => {
    const stopped: string[] = [];
    const registry = new AdapterRegistry();
    registry.set("a:1", adapter({ key: "a:1", name: "a", identityId: "1", stop: async () => { stopped.push("a:1"); } }));
    registry.set("b:1", adapter({ key: "b:1", name: "b", identityId: "1", stop: async () => { stopped.push("b:1"); } }));

    await registry.stopAll();

    expect(stopped).toEqual(["a:1", "b:1"]);
  });
});

describe("startAdapterBounded", () => {
  test("returns started when adapter starts", async () => {
    await expect(startAdapterBounded(adapter(), { timeoutMs: 100 })).resolves.toEqual({ status: "started" });
  });

  test("returns error when adapter fails", async () => {
    const result = await startAdapterBounded(adapter({ start: async () => { throw new Error("boom"); } }), { timeoutMs: 100 });

    expect(result.status).toBe("error");
  });

  test("returns timeout when adapter start hangs", async () => {
    const result = await startAdapterBounded(adapter({ start: async () => { await new Promise(() => {}); } }), { timeoutMs: 1 });

    expect(result.status).toBe("timeout");
  });
});
