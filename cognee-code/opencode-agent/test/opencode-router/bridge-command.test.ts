import { beforeEach, describe, expect, test } from "bun:test";

import { createBridgeCommandRouter } from "../../src/opencode-router/bridge-command";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as any;

describe("BridgeCommandRouter", () => {
  let sent: string[];
  let cleared: Array<[string, string, string, string | null | undefined]>;
  let bindings: Map<string, { directory: string }>;
  let sessions: Map<string, { session_id: string; directory?: string | null }>;
  let stopped: unknown[];
  let compacted: unknown[];

  const key = (channel: string, identityId: string, peerKey: string) => `${channel}:${identityId}:${peerKey}`;

  beforeEach(() => {
    sent = [];
    cleared = [];
    bindings = new Map();
    sessions = new Map();
    stopped = [];
    compacted = [];
  });

  const router = () => createBridgeCommandRouter({
    logger,
    defaultDirectory: "",
    workspaceRoot: "/workspace-root",
    channels: {
      getPairingHandler: () => undefined,
      handlePairing: async () => "continue",
    } as any,
    store: {
      clearSession: (channel: string, identityId: string, peerKey: string, directory?: string | null) => {
        cleared.push([channel, identityId, peerKey, directory]);
        sessions.delete(key(channel, identityId, peerKey));
        return true;
      },
      getSession: (channel: string, identityId: string, peerKey: string) =>
        sessions.get(key(channel, identityId, peerKey)) ?? null,
      getBinding: (channel: string, identityId: string, peerKey: string) =>
        bindings.get(key(channel, identityId, peerKey)) ?? null,
      upsertBinding: (channel: string, identityId: string, peerKey: string, directory: string) => {
        bindings.set(key(channel, identityId, peerKey), { directory });
      },
    } as any,
    sendText: async (_channel, _identityId, _peerId, text) => {
      sent.push(text);
    },
    resolveIdentityDirectory: () => "/identity-dir",
    resolveScopedDirectory: (input) => input === "bad" ? { ok: false, error: "bad dir" } : { ok: true, directory: `/workspace-root/${input}` },
    stopActiveRun: async (input) => { stopped.push(input); },
    compactSession: async (input) => { compacted.push(input); },
  });

  test("reset deletes session and sends system reply", async () => {
    const handled = await router().route({ channel: "wecom", identityId: "default", peerKey: "p1", peerId: "p1", text: "/reset" });

    expect(handled).toBe(true);
    expect(cleared).toEqual([["wecom", "default", "p1", undefined]]);
    expect(sent).toEqual(["Session reset. Send a message to start fresh."]);
  });

  test("unknown command is not handled", async () => {
    const handled = await router().route({ channel: "wecom", identityId: "default", peerKey: "p1", peerId: "p1", text: "/unknown" });

    expect(handled).toBe(false);
    expect(sent).toEqual([]);
  });

  test("dir command updates binding and clears session", async () => {
    const handled = await router().route({ channel: "wecom", identityId: "default", peerKey: "p1", peerId: "p1", text: "/dir project-a" });

    expect(handled).toBe(true);
    expect(bindings.get("wecom:default:p1")?.directory).toBe("/workspace-root/project-a");
    expect(cleared).toEqual([["wecom", "default", "p1", "/workspace-root/project-a"]]);
    expect(sent).toEqual(["Directory set to: /workspace-root/project-a"]);
  });

  test("stop uses active session directory", async () => {
    sessions.set("wecom:default:p1", { session_id: "ses_1", directory: "/session-dir" });

    const handled = await router().route({ channel: "wecom", identityId: "default", peerKey: "p1", peerId: "p1", text: "/stop" });

    expect(handled).toBe(true);
    expect(stopped).toEqual([{ directory: "/session-dir", sessionID: "ses_1", channel: "wecom", identityId: "default", peerKey: "p1" }]);
    expect(sent).toEqual(["Stopped the active run."]);
  });

  test("compact reports missing session", async () => {
    const handled = await router().route({ channel: "wecom", identityId: "default", peerKey: "p1", peerId: "p1", text: "/compact" });

    expect(handled).toBe(true);
    expect(compacted).toEqual([]);
    expect(sent).toEqual(["No session to compact yet. Send a message first."]);
  });
});
