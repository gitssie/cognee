import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { createBridgePaths, createBridgeRuntime } from "../../src/opencode-router/bridge-runtime";

describe("bridge runtime", () => {
  test("derives router, workspace and media paths from dataDir", () => {
    const dataDir = resolve("/tmp/opencode-router/data");

    expect(createBridgePaths({ dataDir })).toEqual({
      routerRoot: resolve("/tmp/opencode-router"),
      workspaceRoot: resolve("/tmp/opencode-router/workspaces"),
      mediaRoot: join(resolve("/tmp/opencode-router/workspaces"), ".opencode-router", "media"),
    });
  });

  test("allows path overrides to be injected", () => {
    const paths = createBridgePaths(
      { dataDir: "/ignored/data" },
      {
        routerRoot: "/router",
        workspaceRoot: "/workspace-root",
        mediaRoot: "/media-root",
      },
    );

    expect(paths).toEqual({
      routerRoot: "/router",
      workspaceRoot: "/workspace-root",
      mediaRoot: "/media-root",
    });
  });

  test("uses injected media store instead of constructing one", async () => {
    let ensured = 0;
    const mediaStore = {
      ensureReady: async () => {
        ensured += 1;
      },
    } as any;

    const runtime = await createBridgeRuntime(
      { dataDir: "/ignored/data" },
      { mediaStore, paths: { mediaRoot: "/unused-media-root" } },
    );

    expect(runtime.mediaStore).toBe(mediaStore);
    expect(runtime.paths.mediaRoot).toBe("/unused-media-root");
    expect(ensured).toBe(1);
  });
});
