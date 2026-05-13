/**
 * Workspace and OpenCode data path resolution for per-user sandboxes.
 *
 * Host-mount path:   join(workspaceRoot, safePeer)  →  /home/user  (E2B_HOME)
 * Workspace inside:  /home/user/workspace           (E2B_WORKSPACE)
 *
 * When host-mount is enabled, the entire /home/user directory is backed by
 * the host. This means opencode's config/data dirs live on the host:
 *   /home/user/.config/opencode/opencode.json
 *   /home/user/.local/share/opencode/auth.json
 *
 * These files can be pre-populated on the host before (or between) sandbox
 * runs, making configuration injection reliable across restarts.
 *
 * Router alignment:  workspaceRoot = join(router.rootDir, router.workspaceDir)
 *                    = same root as provisionPeerDirectory() in directory.ts
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { publish, WorkspaceInit } from "../events";
import type { Config } from "../opencode-router/config.js";

export interface WorkspacePaths {
    /** Host path mounted as /workspace inside the sandbox. */
    workspaceHostPath: string;
}

/** XDG env vars that redirect OpenCode state under /data. */
export const OPENCODE_XDG_ENV: Record<string, string> = {
    XDG_DATA_HOME: "/data/.local/share",
    XDG_CACHE_HOME: "/data/.cache",
    XDG_CONFIG_HOME: "/data/.config",
    XDG_STATE_HOME: "/data/.local/state",
};


/**
 * Resolve host workspace path:
 *   workspaceHostPath = join(workspaceRoot, safePeer)
 *
 * workspaceRoot is the per-peer workspace root, aligned with
 * provisionPeerDirectory() in directory.ts — same formula,
 * same naming (safePeer, no "opencode-" prefix).
 */
export function resolveWorkspacePaths(
    identity: string,
    workspaceRoot: string,
): WorkspacePaths {
    const peerKey = identity.split(":").pop() ?? identity;
    const safePeer = sanitize(peerKey);
    const workspaceHostPath = resolve(workspaceRoot, safePeer);
    assertWithinRoot(workspaceHostPath, workspaceRoot);
    // Pre-create the full directory tree so the sandbox user can write to them
    // when the host directory is bind-mounted as /home/user.
    for (const sub of [
        "workspace",
        ".config/opencode",
        ".local/share/opencode",
        ".local/state",
        ".local/cache",
    ]) {
        mkdirSync(resolve(workspaceHostPath, sub), { recursive: true });
    }
    return { workspaceHostPath };
}

/** Replace unsafe characters and truncate to 64 chars. */
export function sanitize(raw: string): string {
    return raw
        .replace(/[^a-zA-Z0-9_.-]+/g, "-")
        .replace(/^[.-]+|[.-]+$/g, "")
        .slice(0, 64);
}

/** Build a short, human-readable sandbox name from identity.
 *  identity format: "channel:identityId:peerKey"
 *  result: "opencode-{peerKey}" (last colon-separated segment) */
export function buildSandboxName(identity: string): string {
    const user = identity.split(":").pop() ?? identity;
    return `opencode-${sanitize(user)}`;
}

/** Verify a resolved path stays under the allowed root. */
function assertWithinRoot(candidate: string, root: string): void {
    const normalizedRoot = resolve(root) + "/";
    const normalizedCandidate = resolve(candidate) + "/";
    if (!normalizedCandidate.startsWith(normalizedRoot)) {
        throw new Error(
            `Path "${candidate}" is outside allowed root "${root}". ` +
                "Workspace and state paths must stay within configured roots.",
        );
    }
}

// ═══════════════════════════════════════════════════════════
// Filesystem init — shared by E2BSandboxManager.
// ═══════════════════════════════════════════════════════════

/**
 * Serialize the `opencode` section from the already-parsed Config object.
 * No filesystem reads — config was parsed once at startup.
 */
export function buildOpencodeAgentJson(config: Config): string {
  const opencode = (config.configFile as any).opencode;
  if (opencode && typeof opencode === "object") {
    return JSON.stringify(opencode, null, 2);
  }
  return "{}";
}

export interface FilesystemInitConfig {
    /** Absolute workspace root — resolved from sandbox.hostMount.workspaceRoot
     *  (relative to router.rootDir, default "workspaces"). */
    workspaceRoot: string;
}

/**
 * Initialize host workspace directory for a sandbox identity.
 * Creates directory structure and publishes WorkspaceInit for template seeding.
 *
 * Path:  join(workspaceRoot, safePeer)   ← same formula as provisionPeerDirectory()
 *
 * @returns resolved host path for workspace volume
 */
export function initFilesystem(
    identity: string,
    config: FilesystemInitConfig,
): WorkspacePaths {
    const paths = resolveWorkspacePaths(identity, config.workspaceRoot);

    // Trigger template seeding (AGENTS.md, TOOLS.md, MEMORY.md)
    publish(WorkspaceInit, {
        workspaceHostPath: paths.workspaceHostPath,
        identity,
    });

    return paths;
}
