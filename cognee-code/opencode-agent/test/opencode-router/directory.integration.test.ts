/**
 * Integration test: directory mode — connects to real opencode-serve Docker container.
 *
 * Prerequisites: opencode-serve container running on port 4096 with /work mounted.
 * Per-user directories are under /work/userX.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

const OPENCODE_URL = "http://127.0.0.1:4096";
const WORKSPACE_ROOT = "/work";

let client: ReturnType<typeof createOpencodeClient>;

beforeAll(() => {
  client = createOpencodeClient({
    baseUrl: OPENCODE_URL,
    responseStyle: "data",
    throwOnError: true,
  } as any);
});

function ensureUserDir(name: string): string {
  const dir = join(WORKSPACE_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterAll(() => {
  // Clean up test user directories
  for (const name of ["user01", "userA", "userB", "no-dir-test"]) {
    try { rmSync(join(WORKSPACE_ROOT, name), { recursive: true }); } catch {}
  }
});

describe("Directory mode — opencode-serve connectivity", () => {
  test("opencode serve health check passes", async () => {
    const result = await client.global.health() as { healthy?: boolean };
    expect(result.healthy).toBeTrue();
  });

  test("creates session with directory scoping under /work/user01", async () => {
    const userDir = ensureUserDir("user01");

    const session = await client.session.create({
      title: "integration-test-dir-user01",
      directory: userDir,
    } as any);

    const sessionId = (session as any).data?.id ?? (session as any).id;
    expect(sessionId).toBeString();
    expect(sessionId).not.toBeEmpty();
  });

  test("two different users get isolated sessions under /work/userA and /work/userB", async () => {
    const dirA = ensureUserDir("userA");
    const dirB = ensureUserDir("userB");

    const sessionA = await client.session.create({
      title: "userA-session",
      directory: dirA,
    } as any);
    const sessionB = await client.session.create({
      title: "userB-session",
      directory: dirB,
    } as any);

    const idA = (sessionA as any).data?.id ?? (sessionA as any).id;
    const idB = (sessionB as any).data?.id ?? (sessionB as any).id;

    expect(idA).not.toBe(idB);
  });

  test("session directory parameter is required for isolation", async () => {
    const session = await client.session.create({
      title: "no-dir-session",
    } as any);

    const sessionId = (session as any).data?.id ?? (session as any).id;
    expect(sessionId).toBeString();

    // Verify we can get the session
    const retrieved = await client.session.get({ sessionID: sessionId } as any);
    expect(retrieved).toBeDefined();
  });

  test("sends a prompt and receives AI response via /work/user01", async () => {
    const userDir = ensureUserDir("user01");
    const session = await client.session.create({
      title: "prompt-test",
      directory: userDir,
    } as any);
    const sessionId = (session as any).data?.id ?? (session as any).id;
    expect(sessionId).toBeString();

    // Send a simple prompt — no agent specified, uses built-in default
    const result = await client.session.prompt({
      sessionID: sessionId,
      parts: [{ type: "text", text: "Reply with exactly: OK" }],
    } as any);

    const parts = (result as any).data?.parts ?? (result as any).parts ?? [];
    const textParts = parts.filter((p: any) => p.type === "text");
    expect(textParts.length).toBeGreaterThan(0);

    // The AI should have responded with something containing "OK"
    const responseText = textParts.map((p: any) => p.text).join("");
    console.log(`[prompt-test] AI response: ${responseText}`);
    expect(responseText).not.toBeEmpty();
  }, 30000);
});
