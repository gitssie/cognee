import { describe, expect, test } from "bun:test";

import type { BridgePluginGateway } from "../../src/opencode-router/bridge-plugin-gateway";

describe("BridgePluginGateway shape", () => {
  test("identity enabled check allows non-plugin channels and checks plugin identity state", () => {
    const identities = new Map([
      ["wecom", new Map([
        ["default", { id: "default", enabled: true }],
        ["disabled", { id: "disabled", enabled: false }],
      ])],
    ]);
    const gateway: BridgePluginGateway = {
      hosts: new Map(),
      identities,
      adapters: [],
      extraRequestHandlers: [],
      pluginRouteHandlers: [],
      isIdentityEnabled(channel, identityId) {
        const configured = identities.get(channel)?.get(identityId);
        return !identities.has(channel) || Boolean(configured && configured.enabled !== false);
      },
    };

    expect(gateway.isIdentityEnabled("telegram", "default")).toBe(true);
    expect(gateway.isIdentityEnabled("wecom", "default")).toBe(true);
    expect(gateway.isIdentityEnabled("wecom", "disabled")).toBe(false);
    expect(gateway.isIdentityEnabled("wecom", "missing")).toBe(false);
  });
});
