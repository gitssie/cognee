import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { ServerOptions } from "@opencode-ai/sdk/v2/server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

const DEFAULT_ROUTER_HEALTH_PORT = 3005;
export interface RouterRuntimePaths {
    rootDir: string;
    workspaceDir: string;
    dataDir: string;
    logDir: string;
    configPath: string;
}

export interface SandboxConfig {
    /** Sandbox provider: "local" | "http" | "e2b".
     *  Determined by presence of apiUrl (e2b) or mcpUrl (http). */
    provider: "local" | "http" | "e2b";
    
    // ── Common ──────────────────────────────────────────
    /** Host root for per-user sandbox directories.
     *  Each identity gets `<sandboxRoot>/<identity>/` with `workspace/` and `data/` subdirs. */
    sandboxRoot: string;
    /** Idle TTL in ms before stopping a sandbox. */
    idleTtlMs: number;
    /** Max sandbox runtime in ms before forced drain. */
    maxRuntimeMs: number;
    /** Graceful stop timeout in ms. */
    stopTimeoutMs: number;
    /** Cleanup check interval in ms. */
    cleanupIntervalMs: number;
    
    // ── local / http (microsandbox) ─────────────────────
    /** Start of allocated localhost port range. */
    portStart: number;
    /** End of allocated localhost port range. */
    portEnd: number;
    /** OpenCode OCI image. */
    opencodeImage: string;
    /** Per-sandbox CPU count. */
    cpus: number;
    /** Per-sandbox memory in MB. */
    memoryMb: number;
    
    // ── http (MCP remote) ───────────────────────────────
    /** MCP sandbox server URL. */
    mcpUrl?: string;
    
    // ── e2b (Cube / E2B cloud) ──────────────────────────
    /** E2B / Cube Sandbox API base URL.
     *  Self-hosted Cube: "http://172.16.17.231:3000"
     *  E2B cloud:       "" (omit → api.e2b.app) */
    e2bApiUrl?: string;
    /** E2B / Cube API key ("dummy" for Cube). */
    e2bApiKey?: string;
    /** E2B sandbox template ID. */
    e2bTemplate?: string;
    /** E2B sandbox initial timeout in ms. Defaults to idleTtlMs. */
    e2bTimeoutMs?: number;
    /** OpenCode server port inside E2B sandbox (default 4096). */
    e2bOpencodePort?: number;
}

interface RouterConfigFile {
    version: number;
    router?: {
        rootDir?: string;
        workspaceDir?: string;
        dataDir?: string;
        logDir?: string;
        healthHost?: string;
    };
    opencodeDirectory?: string;
    sandbox?: {
        rootDir?: string;
        portStart?: number;
        portEnd?: number;
        image?: string;
        cpus?: number;
        memoryMb?: number;
        idleTtlMs?: number;
        maxRuntimeMs?: number;
        stopTimeoutMs?: number;
        cleanupIntervalMs?: number;
        /** MCP sandbox server URL (triggers http provider). */
        mcpUrl?: string;
        /** E2B / Cube Sandbox API base URL (triggers e2b provider).
         *  Self-hosted Cube: "http://172.16.17.231:3000" */
        apiUrl?: string;
        /** E2B / Cube API key ("dummy" for Cube). */
        apiKey?: string;
        /** E2B sandbox template ID. */
        template?: string;
        /** E2B sandbox initial timeout in ms. */
        timeoutMs?: number;
        /** OpenCode server port inside E2B sandbox. */
        opencodePort?: number;
    };
    opencode?: Record<string, unknown>;
    healthPort?: number;
    plugin?: unknown;
    channels?: unknown;
    groupsEnabled?: boolean;
}

function parseInteger(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function getRouterRuntimePaths(): RouterRuntimePaths {
    const configPath = process.env.OPENCODE_ROUTER_CONFIG_PATH?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_CONFIG_PATH.trim())
        : join(PROJECT_ROOT, "opencode-router.json");
    const projectConfig = readRouterConfigFile(configPath);
    const rootDir = process.env.OPENCODE_ROUTER_ROOT_DIR?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_ROOT_DIR.trim())
        : resolve(
              PROJECT_ROOT,
              projectConfig.router?.rootDir ?? ".opencode-router",
          );
    const workspaceDir = resolve(
        rootDir,
        projectConfig.router?.workspaceDir ?? "workspaces",
    );
    const dataDir = process.env.OPENCODE_ROUTER_DATA_DIR?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_DATA_DIR.trim())
        : resolve(rootDir, projectConfig.router?.dataDir ?? "data");
    const logDir = process.env.OPENCODE_ROUTER_LOG_DIR?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_LOG_DIR.trim())
        : resolve(dataDir, projectConfig.router?.logDir ?? "logs");

    return {
        rootDir,
        workspaceDir,
        dataDir,
        logDir,
        configPath,
    };
}

function readRouterConfigFile(configPath: string): RouterConfigFile {
    try {
        return JSON.parse(readFileSync(configPath, "utf8")) as RouterConfigFile;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { version: 1 };
        }

        throw error;
    }
}

export function ensureRouterRuntimeConfig(
    paths: RouterRuntimePaths,
): RouterConfigFile {
    mkdirSync(paths.workspaceDir, { recursive: true });
    mkdirSync(paths.logDir, { recursive: true });

    const current = readRouterConfigFile(paths.configPath);
    const explicitOpencodeDirectory =
        current.opencodeDirectory?.trim() ||
        process.env.OPENCODE_DIRECTORY?.trim();
    const next: RouterConfigFile = {
        ...current,
        version: 1,
        healthPort:
            current.healthPort ??
            parseInteger(
                process.env.OPENCODE_ROUTER_HEALTH_PORT,
                DEFAULT_ROUTER_HEALTH_PORT,
            ),
        ...(explicitOpencodeDirectory
            ? { opencodeDirectory: explicitOpencodeDirectory }
            : {}),
    };

    writeFileSync(
        paths.configPath,
        `${JSON.stringify(next, null, 2)}\n`,
        "utf8",
    );
    return next;
}

// ────────────────────────────────────────────────────────────────────────────
// Classic-mode OpenCode server options.
// ────────────────────────────────────────────────────────────────────────────

export function buildOpencodeOptions(paths?: RouterRuntimePaths): ServerOptions {
    const p = paths ?? getRouterRuntimePaths();
    const cfg = readRouterConfigFile(p.configPath);
    return {
        hostname: process.env.OPENCODE_HOSTNAME?.trim() || "127.0.0.1",
        port: parseInteger(process.env.OPENCODE_PORT, 0), // 0 = random available port
        config: cfg.opencode as any,
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Sandbox configuration — reads from opencode-router.json sandbox section,
// with env-var overrides for backward compat.
// ────────────────────────────────────────────────────────────────────────────

export function buildSandboxConfig(paths: RouterRuntimePaths): SandboxConfig {
    const cfg = readRouterConfigFile(paths.configPath);
    const s = cfg.sandbox ?? {};
    const root = paths.rootDir;
    
    // Determine provider: e2b → http → local
    const e2bApiUrl = process.env.OPENCODE_SANDBOX_API_URL?.trim()
        ?? (typeof s.apiUrl === "string" ? s.apiUrl.trim() : undefined);
    const mcpUrl = process.env.OPENCODE_SANDBOX_MCP_URL?.trim()
        ?? (typeof s.mcpUrl === "string" ? s.mcpUrl.trim() : undefined);
    const provider: SandboxConfig["provider"] = e2bApiUrl !== undefined ? "e2b" : mcpUrl ? "http" : "local";

    // Common
    const idleTtlMs = parseInteger(process.env.OPENCODE_SANDBOX_IDLE_TTL_MS, s.idleTtlMs ?? 3_600_000);
    const maxRuntimeMs = parseInteger(process.env.OPENCODE_SANDBOX_MAX_RUNTIME_MS, s.maxRuntimeMs ?? 21_600_000);

    return {
        provider,
        sandboxRoot: process.env.OPENCODE_SANDBOX_ROOT?.trim()
            || (typeof s.rootDir === "string" && s.rootDir.trim()) || resolve(root, "sandboxes"),
        idleTtlMs,
        maxRuntimeMs,
        stopTimeoutMs: parseInteger(process.env.OPENCODE_SANDBOX_STOP_TIMEOUT_MS, s.stopTimeoutMs ?? 30_000),
        cleanupIntervalMs: parseInteger(process.env.OPENCODE_SANDBOX_CLEANUP_INTERVAL_MS, s.cleanupIntervalMs ?? 60_000),

        // microsandbox (local / http)
        portStart: parseInteger(process.env.OPENCODE_SANDBOX_PORT_START, s.portStart ?? 42000),
        portEnd: parseInteger(process.env.OPENCODE_SANDBOX_PORT_END, s.portEnd ?? 45999),
        opencodeImage: process.env.OPENCODE_SANDBOX_IMAGE?.trim()
            || (typeof s.image === "string" && s.image.trim()) || "ghcr.io/anomalyco/opencode:latest",
        cpus: parseInteger(process.env.OPENCODE_SANDBOX_CPUS, s.cpus ?? 1),
        memoryMb: parseInteger(process.env.OPENCODE_SANDBOX_MEMORY_MB, s.memoryMb ?? 1024),

        // http (MCP)
        mcpUrl,

        // e2b
        e2bApiUrl: e2bApiUrl ?? "",
        e2bApiKey: process.env.OPENCODE_SANDBOX_API_KEY?.trim()
            ?? (typeof s.apiKey === "string" ? s.apiKey.trim() : "dummy"),
        e2bTemplate: process.env.OPENCODE_SANDBOX_TEMPLATE?.trim()
            ?? (typeof s.template === "string" ? s.template.trim() : "opencode-tools"),
        e2bTimeoutMs: parseInteger(process.env.OPENCODE_SANDBOX_TIMEOUT_MS, s.timeoutMs ?? idleTtlMs),
        e2bOpencodePort: parseInteger(process.env.OPENCODE_SANDBOX_OPENCODE_PORT, s.opencodePort ?? 4096),
    };
}

export function buildRouterEnv(
    serverUrl: string,
    paths: RouterRuntimePaths,
): NodeJS.ProcessEnv {
    const config = ensureRouterRuntimeConfig(paths);

    return {
        ...process.env,
        OPENCODE_URL: serverUrl,
        OPENCODE_ROUTER_DATA_DIR: paths.dataDir,
        OPENCODE_ROUTER_CONFIG_PATH: paths.configPath,
        OPENCODE_ROUTER_LOG_FILE: join(paths.logDir, "opencode-router.log"),
        OPENCODE_ROUTER_HEALTH_HOST:
            config.router?.healthHost?.trim() || "127.0.0.1",
        OPENCODE_ROUTER_HEALTH_PORT: String(
            config.healthPort ?? DEFAULT_ROUTER_HEALTH_PORT,
        ),
    };
}
