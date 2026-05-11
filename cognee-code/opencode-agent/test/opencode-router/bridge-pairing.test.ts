import { describe, expect, test } from "bun:test";

import { hashPairingCode, TelegramPairingService } from "../../src/opencode-router/bridge-pairing";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as any;

function service(overrides: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const bindings: Array<[string, string, string, string]> = [];
  const sessionsCleared: Array<[string, string, string, string | null | undefined]> = [];
  const deps = {
    logger,
    store: {
      getSession: () => null,
      upsertBinding: (...args: any[]) => bindings.push(args as any),
      clearSession: (...args: any[]) => { sessionsCleared.push(args as any); return true; },
    },
    directoryPolicy: {
      defaultDirectory: "/workspace/default",
      resolveIdentityDirectory: () => "/workspace/identity",
      isDangerousRootDirectory: () => false,
      resolveScopedDirectory: (dir: string) => ({ ok: true, directory: dir }),
    },
    resolveTelegramIdentityAccess: () => ({ access: "private", pairingCodeHash: hashPairingCode("CODE123") }),
    sendText: async (_channel: string, _identityId: string, _peerId: string, text: string) => { sent.push(text); },
    ...overrides,
  } as any;
  return { svc: new TelegramPairingService(deps), sent, bindings, sessionsCleared };
}

describe("TelegramPairingService", () => {
  test("continues for public identities", async () => {
    const { svc, sent } = service({ resolveTelegramIdentityAccess: () => ({ access: "public", pairingCodeHash: "" }) });

    await expect(svc.handle({ identityId: "default", peerKey: "p1", peerId: "p1", text: "hello" })).resolves.toBe("continue");
    expect(sent).toEqual([]);
  });

  test("asks for pairing code when private and unpaired", async () => {
    const { svc, sent } = service();

    await expect(svc.handle({ identityId: "default", peerKey: "p1", peerId: "p1", text: "hello" })).resolves.toBe("handled");
    expect(sent[0]).toContain("pairing code");
  });

  test("pairs valid code and writes binding", async () => {
    const { svc, sent, bindings, sessionsCleared } = service();

    await expect(svc.handle({ identityId: "default", peerKey: "p1", peerId: "p1", text: "/pair code-123" })).resolves.toBe("handled");

    expect(bindings).toEqual([["telegram", "default", "p1", "/workspace/identity"]]);
    expect(sessionsCleared).toEqual([["telegram", "default", "p1", "/workspace/identity"]]);
    expect(sent).toEqual(["Pairing successful. This chat is now linked to your worker."]);
  });
});
