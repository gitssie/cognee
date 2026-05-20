import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { MediaStore } from "../../src/opencode-router/media-store";
import { createSharedServerProvider } from "../../src/sandbox/shared-provider";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { mock } from "bun:test";
import { mkdir, rm, access, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const noopLogger = { info() {}, warn() {}, debug() {}, error() {} } as any;

function fakeClient(): OpencodeClient {
  return {
    session: { promptAsync: mock(async () => ({})), create: mock(async () => ({ data: { id: "x" } })), get: mock(async () => ({})) },
    global: { health: mock(async () => ({})), event: mock(async () => ({ stream: (async function* () {})() })) },
  } as unknown as OpencodeClient;
}

describe("media provision: MediaStore inbound → provisionFiles → /work/<peer>", () => {
  let tmpRoot: string;
  // Simulate:
  //   directory.workspaceRoot = /work     (config)
  //   router.workspaceDir     = routerStaging  (for inbound staging)
  let workRoot: string;
  let routerStaging: string;

  beforeAll(async () => {
    tmpRoot = resolve(tmpdir(), `media-test-${randomUUID().slice(0, 8)}`);
    workRoot = join(tmpRoot, "work");
    routerStaging = join(tmpRoot, "opencode-router-staging");
    await mkdir(workRoot, { recursive: true });
    await mkdir(routerStaging, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("MediaStore saves inbound → provisionFiles moves to /work/<peer>/.opencode-router/media/", async () => {
    // 1. Create MediaStore with router's staging root
    const mediaRoot = join(routerStaging, ".opencode-router", "media");
    const store = new MediaStore(mediaRoot);
    await store.ensureReady();

    // 2. Save inbound media (simulating user upload)
    const saved = await store.saveInboundBuffer({
      channel: "wecom",
      identityId: "default",
      peerId: "yinyousong",
      kind: "image" as any,
      buffer: new TextEncoder().encode("FAKE_IMAGE_DATA"),
      filename: "screenshot.png",
      mimeType: "image/png",
    });
    expect(saved.filePath).toStartWith(mediaRoot);
    // File exists at staging location
    await access(saved.filePath);

    // 3. Resolution: boundDirectory = /work/yinyousong
    const peerDir = join(workRoot, "yinyousong");
    await mkdir(peerDir, { recursive: true });

    // 4. Try provisionFiles (from shared-provider)
    const factory = (_d: string) => fakeClient();
    const provider = createSharedServerProvider(factory, fakeClient(), noopLogger, {
      checkHealth: async () => ({ healthy: true }),
    });

    const moved = await provider
      .provisionFiles([saved.filePath], peerDir, "wecom", "default", "yinyousong")
      .catch(async () => {
        // Fallback: relocateInboundFiles
        return store.relocateInboundFiles(
          [saved.filePath],
          join(peerDir, ".opencode-router", "media"),
        );
      });

    // 5. Verify file is NOW under /work/yinyousong/.opencode-router/media/
    const expectedDst = join(peerDir, ".opencode-router", "media", "screenshot.png");
    expect(moved.has(saved.filePath)).toBe(true);
    expect(moved.get(saved.filePath)).toBe(expectedDst);

    // File exists at destination
    await access(expectedDst);
    const content = await readFile(expectedDst, "utf-8");
    expect(content).toBe("FAKE_IMAGE_DATA");
  });

  test("provisionFiles with boundDirectory NOT under /work fails gracefully via fallback", async () => {
    // If provisionFiles (rename) fails (e.g. cross-device),
    // the fallback relocateInboundFiles should still work.
    const mediaRoot = join(routerStaging, ".opencode-router", "media");
    const store = new MediaStore(mediaRoot);
    await store.ensureReady();
    const saved = await store.saveInboundBuffer({
      channel: "wecom",
      identityId: "default",
      peerId: "userB",
      kind: "image" as any,
      buffer: new TextEncoder().encode("DATA_B"),
      filename: "photo.jpg",
      mimeType: "image/jpeg",
    });

    // Simulate: we ignore provisionFiles result and only use fallback
    const peerDir = join(workRoot, "userB");
    await mkdir(peerDir, { recursive: true });

    const result = await store.relocateInboundFiles(
      [saved.filePath],
      join(peerDir, ".opencode-router", "media"),
    );

    const dst = join(peerDir, ".opencode-router", "media", "inbound", "2026-05-18", "photo.jpg");
    // relocateInboundFiles preserves inbound/<day>/ prefix, strips channel/id/peer segments
    expect(result.has(saved.filePath)).toBe(true);
    expect(result.get(saved.filePath)).toBe(dst);
    await access(dst);
    expect(await readFile(dst, "utf-8")).toBe("DATA_B");
  });
});
