/**
 * Workspace and OpenCode data path resolution for per-user sandboxes.
 *
 * OpenCode state uses XDG environment variables to redirect all state under
 * a single /data mount point, avoiding IRQ exhaustion from too many volumes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { publish, WorkspaceInit } from "../events";
import type { ProviderSecret } from "./types";

export interface WorkspacePaths {
  /** Host path mounted as /workspace inside the sandbox. */
  workspaceHostPath: string;
  /** Host path mounted as /data inside the sandbox.
   *  XDG vars map opencode state under /data/.local/share, /.cache, etc. */
  opencodeDataHostPath: string;
}

/** XDG env vars that redirect OpenCode state under /data. */
export const OPENCODE_XDG_ENV: Record<string, string> = {
  XDG_DATA_HOME: "/data/.local/share",
  XDG_CACHE_HOME: "/data/.cache",
  XDG_CONFIG_HOME: "/data/.config",
  XDG_STATE_HOME: "/data/.local/state",
};

/** Guest path where auth.json lives (XDG_DATA_HOME/opencode/auth.json). */
export const AUTH_JSON_GUEST_PATH = "/data/.local/share/opencode/auth.json";

/**
 * Resolve host paths under a unified sandbox root:
 *   workspaceHostPath  = <sandboxRoot>/<sandboxName>/workspace  → /workspace
 *   opencodeDataHostPath = <sandboxRoot>/<sandboxName>/data     → /data
 */
export function resolveWorkspacePaths(
  identity: string,
  sandboxRoot: string,
): WorkspacePaths {
  const sandboxName = buildSandboxName(identity);

  const workspaceHostPath = resolve(sandboxRoot, sandboxName, "workspace");
  const opencodeDataHostPath = resolve(sandboxRoot, sandboxName, "data");

  assertWithinRoot(workspaceHostPath, sandboxRoot);
  assertWithinRoot(opencodeDataHostPath, sandboxRoot);

  mkdirSync(workspaceHostPath, { recursive: true });
  mkdirSync(opencodeDataHostPath, { recursive: true });

  return { workspaceHostPath, opencodeDataHostPath };
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
// Filesystem init — shared by both local SandboxManager and
// HttpSandboxManager (MCP-based).
// ═══════════════════════════════════════════════════════════

const API_KEY_PROVIDER: Record<string, string> = {
  DEEPSEEK_API_KEY: "deepseek",
  ANTHROPIC_API_KEY: "anthropic",
  OPENAI_API_KEY: "openai",
};

const COGNEE_AGENT_JSON = JSON.stringify(
  {
    agent: {
      "cognee-coder": {
        name: "cognee-coder",
        description: "AI coding assistant with memory",
        model: "deepseek/deepseek-v4-flash",
        steps: 50,
        temperature: 0.1,
        permission: {
          bash: "allow",
          edit: "allow",
          read: "allow",
          glob: "allow",
          grep: "allow",
          list: "allow",
          task: "allow",
          webfetch: "allow",
          websearch: "allow",
          codesearch: "allow",
          lsp: "allow",
          todowrite: "allow",
          skill: "allow",
          external_directory: "allow",
          question: "deny",
          doom_loop: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
        },
      },
    },
  },
  null,
  2,
);

export interface FilesystemInitConfig {
  sandboxRoot: string;
  secrets: ProviderSecret[];
}

/**
 * Initialize host workspace & data directories for a sandbox identity.
 * Creates directory structure, writes auth.json + opencode.json,
 * and publishes WorkspaceInit for template seeding.
 *
 * @returns resolved host paths for workspace and data volumes
 */
export function initFilesystem(
  identity: string,
  config: FilesystemInitConfig,
): WorkspacePaths {
  const paths = resolveWorkspacePaths(identity, config.sandboxRoot);

  // Trigger template seeding (AGENTS.md, TOOLS.md, MEMORY.md)
  publish(WorkspaceInit, {
    workspaceHostPath: paths.workspaceHostPath,
    opencodeDataHostPath: paths.opencodeDataHostPath,
    identity,
  });

  // auth.json
  const auth: Record<string, { type: "api"; key: string }> = {};
  for (const s of config.secrets) {
    const p = API_KEY_PROVIDER[s.envName];
    if (p && s.value) auth[p] = { type: "api", key: s.value };
  }
  if (Object.keys(auth).length > 0) {
    const dir = `${paths.opencodeDataHostPath}/.local/share/opencode`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/auth.json`, JSON.stringify(auth, null, 2) + "\n");
  }

  // opencode.json
  const cfgDir = `${paths.opencodeDataHostPath}/.config/opencode`;
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(`${cfgDir}/opencode.json`, COGNEE_AGENT_JSON + "\n");

  return paths;
}
