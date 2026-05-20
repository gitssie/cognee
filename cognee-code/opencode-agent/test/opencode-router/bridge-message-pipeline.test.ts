import { describe, expect, test } from "bun:test";

import { createBridgeMessagePipeline } from "../../src/opencode-router/bridge-message-pipeline";
import { BridgeSessionRuntime } from "../../src/opencode-router/bridge-session";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any;

function baseDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const deps = {
    logger,
    config: {
      dataDir: "/tmp/data",
      opencodeDirectory: "",
      toolUpdatesEnabled: false,
    },
    store: {
      getBinding: () => null,
      getSession: () => null,
      getSandbox: () => null,
      upsertBinding: () => calls.push("upsertBinding"),
      deleteSession: () => calls.push("deleteSession"),
    },
    instance: {
      provisionFiles: async () => new Map(),
    },
    mediaStore: {
      relocateInboundFiles: async () => new Map(),
    },
    channels: {
      getPairingHandler: () => undefined,
      handlePairing: async () => "continue",
      shouldAutoBind: () => true,
    },
    pluginIdentities: new Map(),
    defaultDirectory: "/workspace",
    adapterKey: (channel: string, identityId: string) => `${channel}:${identityId}`,
    hasAdapter: () => true,
    recordInboundActivity: () => calls.push("recordInbound"),
    resolveIdentityDirectory: () => "/workspace",
    isDangerousRootDirectory: () => false,
    resolveScopedDirectory: (input: string) => ({ ok: true, directory: input }),
    normalizeDirectory: (input: string) => input,
    handleCommand: async () => false,
    sendText: async (_channel: string, _identityId: string, _peerId: string, text: string) => calls.push(`send:${text}`),
    sessionRuntime: new BridgeSessionRuntime({
      logger,
      config: {
        permissionMode: "allow",
      } as any,
      store: {
        getSession: () => null,
        getSandbox: () => null,
        upsertSession: () => calls.push("createSession"),
      } as any,
      provider: {
        getClientForSession: async () => ({
          client: {
            session: {
              create: async () => ({ id: "ses_1" }),
              prompt: async () => ({ parts: [{ type: "text", text: "reply" }] }),
            },
          },
        }),
      } as any,
      reportStatus: () => {},
      getChannelLabel: (channel: string) => channel,
      formatPeer: (_channel: any, peerId: string) => peerId,
      getAdapter: () => undefined,
    }),
    stream: {
      consumeSession: async (_sessionID: string, _handle: unknown, callbacks: { onText: (text: string) => Promise<void> }) => {
        await callbacks.onText("reply");
      },
    },
    onEnqueue: () => calls.push("enqueue"),
    reportThinking: () => calls.push("thinking"),
    reportDone: () => calls.push("done"),
    startTyping: () => calls.push("startTyping"),
    stopTyping: () => calls.push("stopTyping"),
    ...overrides,
  } as any;
  return { deps, calls };
}

describe("BridgeMessagePipeline", () => {
  test("ignores messages when adapter is missing", async () => {
    const { deps, calls } = baseDeps({ hasAdapter: () => false });
    const pipeline = createBridgeMessagePipeline(deps);

    await pipeline.handleInbound({ channel: "wecom", identityId: "default", peerId: "p1", text: "hi", raw: null });

    expect(calls).toEqual([]);
  });

  test("routes slash commands before session creation", async () => {
    const { deps, calls } = baseDeps({ handleCommand: async () => true });
    const pipeline = createBridgeMessagePipeline(deps);

    await pipeline.handleInbound({ channel: "wecom", identityId: "default", peerId: "p1", text: "/help", raw: null });

    expect(calls).toEqual(["recordInbound"]);
  });

  test("creates session and enqueues prompt for normal messages", async () => {
    const { deps, calls } = baseDeps();
    const pipeline = createBridgeMessagePipeline(deps);

    await pipeline.handleInbound({ channel: "wecom", identityId: "default", peerId: "p1", text: "hello", raw: null });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContain("recordInbound");
    expect(calls).toContain("upsertBinding");
    expect(calls).toContain("createSession");
    expect(calls).toContain("enqueue");
    expect(calls).toContain("send:reply");
  });
});
