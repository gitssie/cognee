import { describe, expect, test } from "bun:test";

import { BridgeHealthController } from "../../src/opencode-router/bridge-health";
import { createBridgeRuntimeState } from "../../src/opencode-router/bridge-runtime";

const logger = {
  warn() {},
  info() {},
  error() {},
  debug() {},
} as any;

describe("BridgeHealthController", () => {
  test("refresh updates runtime health state", async () => {
    const state = createBridgeRuntimeState({ groupsEnabled: true, now: Date.UTC(2026, 0, 1) });
    const controller = new BridgeHealthController({
      provider: {
        getHealth: async () => ({ healthy: true, version: "test-version" }),
      } as any,
      state,
      opencodeUrl: "http://opencode.local",
      getChannels: () => ({ telegram: true }),
      logger,
      disabled: true,
    });

    await controller.refresh();

    expect(state.health).toEqual({ healthy: true, version: "test-version" });
    expect(controller.snapshot().ok).toBe(true);
    expect(controller.snapshot().opencode.version).toBe("test-version");
  });

  test("snapshot uses runtime groups and activity state", () => {
    const state = createBridgeRuntimeState({ groupsEnabled: false, now: Date.UTC(2026, 0, 1) });
    state.setGroupsEnabled(true);
    state.recordInboundActivity(Date.UTC(2026, 0, 1, 1));
    state.recordOutboundActivity(Date.UTC(2026, 0, 1, 2));
    const controller = new BridgeHealthController({
      provider: { getHealth: async () => ({ healthy: false }) } as any,
      state,
      opencodeUrl: "http://opencode.local",
      getChannels: () => ({ wecom: true, whatsapp: false }),
      logger,
      disabled: true,
    });

    const snapshot = controller.snapshot();

    expect(snapshot.config.groupsEnabled).toBe(true);
    expect(snapshot.activity?.inboundToday).toBe(1);
    expect(snapshot.activity?.outboundToday).toBe(1);
    expect(snapshot.activity?.lastMessageAt).toBe(Date.UTC(2026, 0, 1, 2));
    expect(snapshot.channels).toEqual({ wecom: true, whatsapp: false });
  });

  test("start and stop manage polling without health server", async () => {
    let checks = 0;
    const state = createBridgeRuntimeState({ groupsEnabled: false });
    const controller = new BridgeHealthController({
      provider: {
        getHealth: async () => {
          checks += 1;
          return { healthy: true };
        },
      } as any,
      state,
      opencodeUrl: "http://opencode.local",
      getChannels: () => ({}),
      logger,
      disabled: true,
      fastIntervalMs: 10,
      slowIntervalMs: 20,
    });

    await controller.start();
    controller.stop();

    expect(checks).toBe(1);
    expect(state.health.healthy).toBe(true);
  });
});
