/**
 * Peer workspace directory provisioning utilities.
 *
 * Extracted from bridge.ts so that channel-runtime.ts can reuse the same
 * per-peer directory logic without introducing a circular dependency.
 */

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { Logger } from "pino";
import type { DirectoryStrategy } from "./config.js";

// Built-in workspace template bundled with opencode-router.
export const BUILTIN_TEMPLATE_DIR = new URL("../shims/openclaw/workspace-template", import.meta.url).pathname;

/**
 * Given a parsed DirectoryStrategy, a peerId, and the router dataDir (used as
 * the default root for bare "per-peer"), return the resolved absolute directory.
 *
 * For mode="per-peer":
 *  - Creates <root>/<safePeerId>/ on first call.
 *  - Copies built-in template files (non-recursively) unless they already exist.
 *
 * Works for any channel — the caller is responsible for resolving the strategy
 * from whatever identity or global config is appropriate.
 */
export async function provisionPeerDirectory(
  strategy: DirectoryStrategy,
  peerId: string,
  dataDir: string,
  logger: Logger,
): Promise<string> {
  if (strategy.mode === "static") {
    return strategy.path;
  }

  const routerRoot = resolve(dataDir, "..");
  const root = strategy.root
    ? resolve(isAbsolute(strategy.root) ? strategy.root : join(routerRoot, strategy.root))
    : join(routerRoot, "workspaces");
  // Sanitize peerId to a safe directory component
  const safePeer = peerId.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "default";
  const peerDir = join(root, safePeer);

  try {
    await mkdir(peerDir, { recursive: true });
  } catch (err) {
    logger.warn({ err, peerDir }, "directory-policy: failed to create peer directory");
    return peerDir;
  }

  // Copy built-in template files — skip files that already exist
  try {
    const entries = await readdir(BUILTIN_TEMPLATE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const src = join(BUILTIN_TEMPLATE_DIR, entry.name);
      const dst = join(peerDir, entry.name);
      try {
        await stat(dst);
        // Already exists — preserve user modifications
      } catch {
        await copyFile(src, dst);
        logger.debug({ dst }, "directory-policy: seeded template file");
      }
    }
  } catch (err) {
    logger.warn({ err, template: BUILTIN_TEMPLATE_DIR }, "directory-policy: failed to seed template files");
  }

  return peerDir;
}
