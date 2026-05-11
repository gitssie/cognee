import { describe, expect, test } from "bun:test";

import { BridgeSessionRuntime, type SessionRunState } from "../../src/opencode-router/bridge-session";

const logger = { error() {}, warn() {}, info() {}, debug() {} } as any;

const noopInstance = {
  getClient: async () => ({ release: async () => {}, client: {} }),
} as any;

function runState(key = "k1"): SessionRunState {
  return {
    key,
    directory: "/workspace",
    sessionID: "ses_1",
    channel: "wecom",
    identityId: "default",
    adapterKey: "wecom:default",
    peerId: "p1",
    peerKey: "p1",
    toolUpdatesEnabled: false,
    seenToolStates: new Map(),
  };
}

describe("BridgeSessionRuntime", () => {
  test("builds stable session queue keys", () => {
    const runtime = new BridgeSessionRuntime({ logger, instance: noopInstance, getChannelLabel: (c) => c, formatPeer: (_c, p) => p, getAdapter: () => undefined });

    expect(runtime.keyForSession("/workspace", "ses_1")).toBe("/workspace::ses_1");
  });

  test("enqueue runs same-key tasks sequentially", async () => {
    const runtime = new BridgeSessionRuntime({ logger, instance: noopInstance, getChannelLabel: (c) => c, formatPeer: (_c, p) => p, getAdapter: () => undefined });
    const events: string[] = [];

    runtime.enqueue("k", async () => {
      events.push("a:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push("a:end");
    });
    runtime.enqueue("k", async () => {
      events.push("b:start");
      events.push("b:end");
    });

    await runtime.getPending("k");

    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
    expect(runtime.getPending("k")).toBeUndefined();
  });

  test("reports thinking and done via status sink", () => {
    const statuses: string[] = [];
    const runtime = new BridgeSessionRuntime({
      logger,
      instance: noopInstance,
      reportStatus: (msg) => statuses.push(msg),
      getChannelLabel: (c) => c,
      formatPeer: (_c, p) => p,
      getAdapter: () => undefined,
    });
    const run = runState();

    runtime.reportThinking(run);
    runtime.reportDone(run);

    expect(statuses).toEqual(["[wecom/default] p1 Thinking...", "[wecom/default] p1 Done"]);
  });

  test("starts and stops typing loop", async () => {
    let typingCount = 0;
    const runtime = new BridgeSessionRuntime({
      logger,
      instance: noopInstance,
      getChannelLabel: (c) => c,
      formatPeer: (_c, p) => p,
      getAdapter: () => ({ name: "wecom", identityId: "default", sendTyping: async () => { typingCount += 1; } }),
      typingIntervalMs: 10,
    });

    runtime.startTyping(runState());
    await new Promise((resolve) => setTimeout(resolve, 0));
    runtime.stopTyping("k1");

    expect(typingCount).toBeGreaterThanOrEqual(1);
  });

  test("creates session through provider and persists sandbox id", async () => {
    const upserts: unknown[] = [];
    const runtime = new BridgeSessionRuntime({
      logger,
      config: { permissionMode: "allow" } as any,
      store: {
        getSession: () => null,
        getSandbox: () => null,
        upsertSession: (...args: unknown[]) => upserts.push(args),
      } as any,
      instance: {
        getClient: async () => ({
          sandboxId: "sbx_1",
          release: async () => {},
          client: { session: { create: async () => ({ id: "ses_new" }) } },
        }),
      } as any,
      getChannelLabel: (c) => c,
      formatPeer: (_c, p) => p,
      getAdapter: () => undefined,
    });

    await expect(runtime.createSession({ channel: "wecom", identityId: "default", peerId: "p1", peerKey: "p1", directory: "/workspace" })).resolves.toBe("ses_new");
    expect(upserts[0]).toEqual(["wecom", "default", "p1", "ses_new", "/workspace"]);
  });

  test("abort and compact use provider session client", async () => {
    const calls: string[] = [];
    const runtime = new BridgeSessionRuntime({
      logger,
      instance: {
        getClient: async () => ({
          release: async () => {},
          client: {
            session: {
              abort: async () => calls.push("abort"),
              messages: async () => ({ data: [{ info: { role: "assistant", providerID: "p", modelID: "m" } }] }),
              summarize: async (input: any) => calls.push(`summarize:${input.providerID}/${input.modelID}`),
            },
          },
        }),
      } as any,
      getChannelLabel: (c) => c,
      formatPeer: (_c, p) => p,
      getAdapter: () => undefined,
    });

    await runtime.abortSession({ channel: "wecom", identityId: "default", peerKey: "p1", directory: "/workspace", sessionID: "ses_1" });
    await runtime.compactSession({ channel: "wecom", identityId: "default", peerKey: "p1", directory: "/workspace", sessionID: "ses_1" });

    expect(calls).toEqual(["abort", "summarize:undefined/undefined"]);
  });
});
