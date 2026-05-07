import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import type { Config, ServerOptions } from "@opencode-ai/sdk/v2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

const DEFAULT_OPENCODE_HOSTNAME = "127.0.0.1";
const DEFAULT_OPENCODE_PORT = 4096;
const DEFAULT_OPENCODE_TIMEOUT = 30000;
const DEFAULT_COGNEE_MCP_URL = "http://localhost:8000/mcp/";
const DEFAULT_ROUTER_HEALTH_PORT = 3005;
const DEFAULT_AGENT_NAME = "cognee-coder";
const DEFAULT_AGENT_DESCRIPTION =
    "AI coding assistant with persistent memory backed by the cognee knowledge graph";
const DEFAULT_AGENT_MODEL = "deepseek/deepseek-v4-flash";

export interface RouterRuntimePaths {
    rootDir: string;
    workspaceDir: string;
    dataDir: string;
    logDir: string;
    configPath: string;
}

export interface SandboxConfig {
    /** Host root for per-user sandbox directories.
     *  Each identity gets `<sandboxRoot>/<identity>/` with `workspace/` and `data/` subdirs. */
    sandboxRoot: string;
    /** Start of allocated localhost port range. */
    portStart: number;
    /** End of allocated localhost port range. */
    portEnd: number;
    /** Idle TTL in ms before stopping a sandbox. */
    idleTtlMs: number;
    /** Max sandbox runtime in ms before forced drain. */
    maxRuntimeMs: number;
    /** Graceful stop timeout in ms. */
    stopTimeoutMs: number;
    /** OpenCode OCI image. */
    opencodeImage: string;
    /** Per-sandbox CPU count. */
    cpus: number;
    /** Per-sandbox memory in MB. */
    memoryMb: number;
    /** Cleanup check interval in ms. */
    cleanupIntervalMs: number;
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
    opencode?: {
        hostname?: string;
        port?: number;
        timeout?: number;
        mcp?: {
            cognee?: {
                url?: string;
                enabled?: boolean;
            };
        };
        cogneeApi?: {
            baseUrl?: string;
            email?: string;
            password?: string;
            cookieName?: string;
        };
        agent?: {
            name?: string;
            description?: string;
            model?: string;
            steps?: number;
            temperature?: number;
            prompt?: string[];
            permission?: Record<string, "allow" | "deny" | "ask">;
        };
        plugin?: string[];
    };
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

function readProjectConfig(): RouterConfigFile {
    return readRouterConfigFile(getRouterRuntimePaths().configPath);
}

function getConfiguredAgentName(config: RouterConfigFile): string {
    return config.opencode?.agent?.name?.trim() || DEFAULT_AGENT_NAME;
}

function setEnvDefault(name: string, value: string | undefined): void {
    if (!process.env[name] && value?.trim()) {
        process.env[name] = value.trim();
    }
}

function applyConfiguredEnvironment(config: RouterConfigFile): void {
    const cogneeApi = config.opencode?.cogneeApi;

    setEnvDefault("COGNEE_API_URL", cogneeApi?.baseUrl);
    setEnvDefault("COGNEE_API_EMAIL", cogneeApi?.email);
    setEnvDefault("COGNEE_API_PASSWORD", cogneeApi?.password);
    setEnvDefault("AUTH_TOKEN_COOKIE_NAME", cogneeApi?.cookieName);
}

export function buildOpencodeConfig(): Config {
    const projectConfig = readProjectConfig();
    applyConfiguredEnvironment(projectConfig);
    const cogneeMcp = projectConfig.opencode?.mcp?.cognee;
    const agentConfig = projectConfig.opencode?.agent;
    const agentName = getConfiguredAgentName(projectConfig);
    const opencodePlugins = projectConfig.opencode?.plugin ?? [];
    const mcpHeaders: Record<string, string> = {};
    const cogneeApiToken = process.env.COGNEE_API_TOKEN?.trim();

    if (cogneeApiToken) {
        mcpHeaders.Authorization = `Bearer ${cogneeApiToken}`;
    }

    return {
        mcp: {
            cognee: {
                type: "remote" as const,
                url:
                    cogneeMcp?.url?.trim() ||
                    process.env.COGNEE_MCP_URL?.trim() ||
                    DEFAULT_COGNEE_MCP_URL,
                enabled: cogneeMcp?.enabled ?? true,
                ...(Object.keys(mcpHeaders).length > 0
                    ? { headers: mcpHeaders }
                    : {}),
            },
        },
        ...(opencodePlugins.length ? { plugin: opencodePlugins } : {}),
        agent: {
            [agentName]: {
                name: agentName,
                description:
                    agentConfig?.description?.trim() || DEFAULT_AGENT_DESCRIPTION,
                model: agentConfig?.model?.trim() || DEFAULT_AGENT_MODEL,
                prompt: agentConfig?.prompt?.join("\n") ?? "",
                steps: agentConfig?.steps ?? 50,
                temperature: agentConfig?.temperature ?? 0.1,
                ...(agentConfig?.permission
                    ? { permission: agentConfig.permission }
                    : {}),
            },
        },
    };
}

export function buildOpencodeOptions(): ServerOptions {
    const projectConfig = readProjectConfig();
    applyConfiguredEnvironment(projectConfig);
    const opencodeConfig = projectConfig.opencode;

    return {
        hostname:
            opencodeConfig?.hostname?.trim() ||
            process.env.OPENCODE_HOST?.trim() || DEFAULT_OPENCODE_HOSTNAME,
        port:
            opencodeConfig?.port ??
            parseInteger(process.env.OPENCODE_PORT, DEFAULT_OPENCODE_PORT),
        timeout: parseInteger(
            process.env.OPENCODE_START_TIMEOUT_MS,
            opencodeConfig?.timeout ?? DEFAULT_OPENCODE_TIMEOUT,
        ),
        config: buildOpencodeConfig(),
    };
}

export function getRouterRuntimePaths(): RouterRuntimePaths {
    const configPath = process.env.OPENCODE_ROUTER_CONFIG_PATH?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_CONFIG_PATH.trim())
        : join(PROJECT_ROOT, "opencode-router.json");
    const projectConfig = readRouterConfigFile(configPath);
    const rootDir = process.env.OPENCODE_ROUTER_ROOT_DIR?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_ROOT_DIR.trim())
        : resolve(PROJECT_ROOT, projectConfig.router?.rootDir ?? ".opencode-router");
    const workspaceDir = resolve(rootDir, projectConfig.router?.workspaceDir ?? "workspaces");
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
// Sandbox configuration (microsandbox per-user OpenCode sandboxes)
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_SANDBOX_PORT_START = 42000;
const DEFAULT_SANDBOX_PORT_END = 45999;
const DEFAULT_SANDBOX_IDLE_TTL_MS = 3_600_000;      // 1 hour
const DEFAULT_SANDBOX_MAX_RUNTIME_MS = 21_600_000;   // 6 hours
const DEFAULT_SANDBOX_STOP_TIMEOUT_MS = 30_000;       // 30 seconds
const DEFAULT_SANDBOX_CPU_COUNT = 1;
const DEFAULT_SANDBOX_MEMORY_MB = 1024;
const DEFAULT_SANDBOX_CLEANUP_INTERVAL_MS = 60_000;   // 1 minute
const DEFAULT_OPENCODE_IMAGE = "ghcr.io/anomalyco/opencode:latest";

export function buildSandboxConfig(paths: RouterRuntimePaths): SandboxConfig {
    return {
        sandboxRoot:
            process.env.OPENCODE_SANDBOX_ROOT?.trim() ||
            resolve(paths.rootDir, "sandboxes"),
        portStart: parseInteger(
            process.env.OPENCODE_SANDBOX_PORT_START,
            DEFAULT_SANDBOX_PORT_START,
        ),
        portEnd: parseInteger(
            process.env.OPENCODE_SANDBOX_PORT_END,
            DEFAULT_SANDBOX_PORT_END,
        ),
        idleTtlMs: parseInteger(
            process.env.OPENCODE_SANDBOX_IDLE_TTL_MS,
            DEFAULT_SANDBOX_IDLE_TTL_MS,
        ),
        maxRuntimeMs: parseInteger(
            process.env.OPENCODE_SANDBOX_MAX_RUNTIME_MS,
            DEFAULT_SANDBOX_MAX_RUNTIME_MS,
        ),
        stopTimeoutMs: parseInteger(
            process.env.OPENCODE_SANDBOX_STOP_TIMEOUT_MS,
            DEFAULT_SANDBOX_STOP_TIMEOUT_MS,
        ),
        opencodeImage:
            process.env.OPENCODE_SANDBOX_IMAGE?.trim() ||
            DEFAULT_OPENCODE_IMAGE,
        cpus: parseInteger(
            process.env.OPENCODE_SANDBOX_CPUS,
            DEFAULT_SANDBOX_CPU_COUNT,
        ),
        memoryMb: parseInteger(
            process.env.OPENCODE_SANDBOX_MEMORY_MB,
            DEFAULT_SANDBOX_MEMORY_MB,
        ),
        cleanupIntervalMs: parseInteger(
            process.env.OPENCODE_SANDBOX_CLEANUP_INTERVAL_MS,
            DEFAULT_SANDBOX_CLEANUP_INTERVAL_MS,
        ),
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
