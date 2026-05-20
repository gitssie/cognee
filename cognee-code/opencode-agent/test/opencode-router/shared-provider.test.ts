import { describe, expect, test, mock, beforeAll, afterAll } from "bun:test";
import { createSharedServerProvider } from "../../src/sandbox/shared-provider";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { mkdir, writeFile, rm, access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const noopLogger = { info() {}, warn() {}, debug() {}, error() {} } as any;

function fakeClient(): OpencodeClient {
  return {
    session: {
      promptAsync: mock(async () => ({})),
      create: mock(async () => ({ data: { id: "ses_test" } })),
      get: mock(async () => ({ id: "ses_test" })),
    },
    global: {
      health: mock(async () => ({ healthy: true, version: "1.0" })),
      event: mock(async () => ({ stream: (async function* () {})() })),
    },
  } as unknown as OpencodeClient;
}

describe("SharedServerProvider (SSE hub + per-directory clients)", () => {
  // ---------- contract ----------
  // Factory type expected by createSharedServerProvider:
  //   (directory: string) => OpencodeClient
  // rootClient: used ONLY for SSE (ReactiveSSEListener.setClient)
  // factory:   used for every getClientForDirectory / getClientForSession

  test("getClientForSession creates per-directory client via factory", async () => {
    const calls: string[] = [];
    const factory = (dir: string) => {
      calls.push(dir);
      return fakeClient();
    };
    const provider = createSharedServerProvider(
      factory,
      fakeClient(), // rootClient (SSE only)
      noopLogger,
      { checkHealth: async () => ({ healthy: true }) },
    );

    await provider.getClientForSession({
      directory: "/work/userA",
      channel: "test",
      identityId: "id1",
      peerKey: "peer1",
    });

    expect(calls).toContain("/work/userA");
  });

  test("getClientForDirectory creates per-directory client via factory", async () => {
    const calls: string[] = [];
    const factory = (dir: string) => {
      calls.push(dir);
      return fakeClient();
    };
    const provider = createSharedServerProvider(factory, fakeClient(), noopLogger, {
      checkHealth: async () => ({ healthy: true }),
    });

    await provider.getClientForDirectory("/work/userB");
    expect(calls).toContain("/work/userB");
  });

  test("SSE hub uses rootClient, factory NOT called during construction", () => {
    let factoryCalled = false;
    const factory = (_dir: string) => {
      factoryCalled = true;
      return fakeClient();
    };
    createSharedServerProvider(factory, fakeClient(), noopLogger, {
      checkHealth: async () => ({ healthy: true }),
    });

    // Factory should only be called on getClientFor* calls, not during construction
    expect(factoryCalled).toBe(false);
  });

  test("two handles for different directories get different clients", async () => {
    let callCount = 0;
    const clients: OpencodeClient[] = [];
    const factory = (_dir: string) => {
      callCount++;
      const c = fakeClient();
      clients.push(c);
      return c;
    };
    const provider = createSharedServerProvider(factory, fakeClient(), noopLogger, {
      checkHealth: async () => ({ healthy: true }),
    });

    const h1 = await provider.getClientForSession({
      directory: "/work/foo",
      channel: "a", identityId: "a", peerKey: "a",
    });
    const h2 = await provider.getClientForSession({
      directory: "/work/bar",
      channel: "b", identityId: "b", peerKey: "b",
    });

    expect(callCount).toBe(2);
    expect(h1.client).not.toBe(h2.client);
  });

  test("all handles share the same ReactiveSSEListener", async () => {
    const factory = (_dir: string) => fakeClient();
    const provider = createSharedServerProvider(factory, fakeClient(), noopLogger, {
      checkHealth: async () => ({ healthy: true }),
    });

    const h1 = await provider.getClientForDirectory("/work/a");
    const h2 = await provider.getClientForSession({
      directory: "/work/b",
      channel: "x", identityId: "x", peerKey: "x",
    });

    expect(h1.sseListener).toBe(h2.sseListener);
    expect(typeof (h1.sseListener as any).addListener).toBe("function");
    expect(typeof (h1.sseListener as any).addGlobalListener).toBe("function");
  });

  test("health delegates via opts", async () => {
    const factory = (_dir: string) => fakeClient();
    const provider = createSharedServerProvider(factory, fakeClient(), noopLogger, {
      checkHealth: async () => ({ healthy: true, version: "3.0" }),
    });
    const h = await provider.getHealth();
    expect(h.healthy).toBe(true);
    expect(h.version).toBe("3.0");
  });

  test("shutdown does not throw", async () => {
    const factory = (_dir: string) => fakeClient();
    const provider = createSharedServerProvider(factory, fakeClient(), noopLogger, {
      checkHealth: async () => ({ healthy: true }),
    });
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});

// ─── provisionFiles ────────────────────────────────────────────────────────────

describe("SharedServerProvider.provisionFiles", () => {
  let tmpBase: string;

  beforeAll(async () => {
    tmpBase = join(tmpdir(), `opencode-test-${randomUUID().slice(0, 8)}`);
    await mkdir(tmpBase, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  async function makeProvider() {
    const factory = (_dir: string) => fakeClient();
    return createSharedServerProvider(factory, fakeClient(), noopLogger, {
      checkHealth: async () => ({ healthy: true }),
    });
  }

  test("moves files into targetDirectory/.opencode-router/media/", async () => {
    const provider = await makeProvider();

    // Create source files in a staging area (simulating MediaStore inbound)
    const staging = join(tmpBase, "staging");
    await mkdir(staging, { recursive: true });
    const srcA = join(staging, "photo.jpg");
    const srcB = join(staging, "doc.pdf");
    await writeFile(srcA, "fake-image-data");
    await writeFile(srcB, "fake-pdf-data");

    // Target: simulate per-user workspace
    const target = join(tmpBase, "user-workspace");
    await mkdir(target, { recursive: true });

    const moved = await provider.provisionFiles(
      [srcA, srcB],
      target,
      "wecom",
      "default",
      "user123",
    );

    // Verify files are in targetDirectory/.opencode-router/media/
    const mediaDir = join(target, ".opencode-router", "media");
    const dstA = join(mediaDir, "photo.jpg");
    const dstB = join(mediaDir, "doc.pdf");

    expect(moved.has(srcA)).toBe(true);
    expect(moved.has(srcB)).toBe(true);
    expect(moved.get(srcA)).toBe(dstA);
    expect(moved.get(srcB)).toBe(dstB);

    // Verify files actually exist at destinations
    await access(dstA);
    await access(dstB);
    expect(await readFile(dstA, "utf-8")).toBe("fake-image-data");
    expect(await readFile(dstB, "utf-8")).toBe("fake-pdf-data");

    // Source files should be gone (renamed away)
    await expect(access(srcA)).rejects.toThrow();
    await expect(access(srcB)).rejects.toThrow();
  });

  test("creates media directory if not exists", async () => {
    const provider = await makeProvider();
    const staging = join(tmpBase, "staging2");
    await mkdir(staging, { recursive: true });
    const src = join(staging, "note.txt");
    await writeFile(src, "hello");

    const target = join(tmpBase, "fresh-workspace");
    // Do NOT create the media directory — provisionFiles should create it

    await provider.provisionFiles([src], target, "wecom", "default", "peer1");

    const dst = join(target, ".opencode-router", "media", "note.txt");
    await access(dst);
    expect(await readFile(dst, "utf-8")).toBe("hello");
  });

  test("returns empty map for empty sourcePaths", async () => {
    const provider = await makeProvider();
    const target = join(tmpBase, "empty-target");
    const moved = await provider.provisionFiles([], target, "wecom", "default", "peer1");
    expect(moved.size).toBe(0);
  });
});
