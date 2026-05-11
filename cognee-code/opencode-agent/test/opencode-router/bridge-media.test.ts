import { describe, expect, test } from "bun:test";

import { BridgeMediaFlow } from "../../src/opencode-router/bridge-media";

describe("BridgeMediaFlow", () => {
  test("resolves text outbound parts", async () => {
    const flow = new BridgeMediaFlow({
      mediaStore: {} as any,
      getAdapter: () => undefined,
      adapterKey: (c, i) => `${c}:${i}`,
      recordOutboundActivity: () => {},
    });

    await expect(flow.resolveOutboundParts("/workspace", { text: "hello" })).resolves.toEqual([{ type: "text", text: "hello" }]);
  });

  test("returns not_found delivery when adapter is missing", async () => {
    const flow = new BridgeMediaFlow({
      mediaStore: {} as any,
      getAdapter: () => undefined,
      adapterKey: (c, i) => `${c}:${i}`,
      recordOutboundActivity: () => {},
    });

    const result = await flow.deliverParts("wecom", "default", "p1", [{ type: "text", text: "hello" }]);

    expect(result.sentParts).toBe(0);
    expect(result.partResults[0]?.code).toBe("not_found");
  });

  test("delivers text through adapter and reports outbound", async () => {
    const sent: string[] = [];
    const reported: string[] = [];
    let activity = 0;
    const flow = new BridgeMediaFlow({
      mediaStore: {} as any,
      getAdapter: () => ({
        key: "wecom:default",
        name: "wecom",
        identityId: "default",
        maxTextLength: 100,
        start: async () => {},
        stop: async () => {},
        sendText: async (_peerId, text) => { sent.push(text); },
      }),
      adapterKey: (c, i) => `${c}:${i}`,
      reporter: { onOutbound: (msg) => reported.push(msg.text) },
      recordOutboundActivity: () => { activity += 1; },
    });

    const result = await flow.deliverParts("wecom", "default", "p1", [{ type: "text", text: "hello" }]);

    expect(result.sentParts).toBe(1);
    expect(sent).toEqual(["hello"]);
    expect(reported).toEqual(["hello"]);
    expect(activity).toBe(1);
  });
});
