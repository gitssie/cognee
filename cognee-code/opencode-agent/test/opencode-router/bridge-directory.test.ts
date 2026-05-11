import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { createDirectoryPolicy } from "../../src/opencode-router/bridge-directory";

const logger = { info() {}, warn() {}, debug() {}, error() {} } as any;

function config(overrides: Record<string, unknown> = {}) {
  return {
    channels: [{ channel: "wecom", id: "default", directory: "project-a" }],
    opencodeDirectory: "",
    dataDir: "/tmp/router/data",
    ...overrides,
  } as any;
}

describe("DirectoryPolicy", () => {
  test("resolves identity directory from channel config", () => {
    const policy = createDirectoryPolicy({ config: config(), workspaceRoot: "/tmp/router/workspaces", logger });

    expect(policy.resolveIdentityDirectory("wecom", "default")).toBe("project-a");
    expect(policy.resolveIdentityDirectory("wecom", "missing")).toBe("");
  });

  test("rejects dangerous and out-of-scope directories", () => {
    const policy = createDirectoryPolicy({ config: config(), workspaceRoot: "/tmp/router/workspaces", logger });

    expect(policy.isDangerousRootDirectory("/")).toBe(true);
    expect(policy.resolveScopedDirectory("/etc")).toEqual({
      ok: false,
      error: "Directory must stay within workspace root: /tmp/router/workspaces",
    });
  });

  test("resolves relative directory inside workspace root", () => {
    const policy = createDirectoryPolicy({ config: config(), workspaceRoot: "/tmp/router/workspaces", logger });

    expect(policy.resolveScopedDirectory("project-a")).toEqual({
      ok: true,
      directory: join("/tmp/router/workspaces", "project-a"),
    });
  });

  test("returns static identity directory without provisioning", async () => {
    const policy = createDirectoryPolicy({ config: config(), workspaceRoot: "/tmp/router/workspaces", logger });

    await expect(policy.provisionPolicyDirectory({ channel: "wecom", identityId: "default", peerId: "peer" })).resolves.toEqual({
      identityDirectory: "project-a",
      policyDirectory: "",
    });
  });
});
