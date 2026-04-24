import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import type { Config, ServerOptions } from "@opencode-ai/sdk/v2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_OPENCODE_HOSTNAME = "127.0.0.1";
const DEFAULT_OPENCODE_PORT = 4096;
const DEFAULT_OPENCODE_TIMEOUT = 30000;
const DEFAULT_COGNEE_MCP_URL = "http://localhost:8000/mcp/";
const DEFAULT_ROUTER_HEALTH_PORT = 3005;

export interface RouterRuntimePaths {
    rootDir: string;
    workspaceDir: string;
    dataDir: string;
    logDir: string;
    configPath: string;
}

interface RouterConfigFile {
    version: number;
    opencodeDirectory?: string;
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

export function buildOpencodeConfig(): Config {
    const mcpHeaders: Record<string, string> = {};
    const cogneeApiToken = process.env.COGNEE_API_TOKEN?.trim();

    if (cogneeApiToken) {
        mcpHeaders.Authorization = `Bearer ${cogneeApiToken}`;
    }

    return {
        mcp: {
            cognee: {
                type: "remote" as const,
                url: process.env.COGNEE_MCP_URL?.trim() || DEFAULT_COGNEE_MCP_URL,
                enabled: true,
                ...(Object.keys(mcpHeaders).length > 0
                    ? { headers: mcpHeaders }
                    : {}),
            },
        },
        plugin: [`file://${join(__dirname, "plugin", "index.ts")}`],
        agent: {
            "cognee-coder": {
                name: "cognee-coder",
                description:
                    "AI coding assistant with persistent memory backed by the cognee knowledge graph",
                model: "github-copilot/gpt-5.4-mini",
                prompt: [
                    "You are an advanced coding assistant with persistent memory backed by the cognee knowledge graph.",
                    "",
                    "## Knowledge Base Search",
                    "Use the `search` MCP tool to query the knowledge base when you need information",
                    "about the project, coding conventions, or past decisions.",
                    "- search_type: Use GRAPH_COMPLETION for natural language Q&A",
                    "- datasets: Restrict to specific dataset names when provided",
                    "",
                    "## Dataset Constraints",
                    "If the user message contains a '<system-reminder>' block listing available datasets,",
                    "you MUST restrict your `search` MCP tool calls to only those datasets.",
                    "Pass the dataset names as the `datasets` parameter when calling `search`.",
                ].join("\n"),
                steps: 50,
                temperature: 0.1,
                permission: {
                    bash: "allow" as const,
                    edit: "allow" as const,
                    webfetch: "allow" as const,
                    question: "allow" as const,
                },
            },
        },
    };
}

export function buildOpencodeOptions(): ServerOptions {
    return {
        hostname: process.env.OPENCODE_HOST?.trim() || DEFAULT_OPENCODE_HOSTNAME,
        port: parseInteger(process.env.OPENCODE_PORT, DEFAULT_OPENCODE_PORT),
        timeout: parseInteger(process.env.OPENCODE_START_TIMEOUT_MS, DEFAULT_OPENCODE_TIMEOUT),
        config: buildOpencodeConfig(),
    };
}

export function getRouterRuntimePaths(): RouterRuntimePaths {
    const rootDir = process.env.OPENCODE_ROUTER_ROOT_DIR?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_ROOT_DIR.trim())
        : resolve(__dirname, "..", ".tmp", "opencode-router");
    const workspaceDir = join(rootDir, "workspace");
    const dataDir = process.env.OPENCODE_ROUTER_DATA_DIR?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_DATA_DIR.trim())
        : join(rootDir, "data");
    const logDir = process.env.OPENCODE_ROUTER_LOG_DIR?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_LOG_DIR.trim())
        : join(dataDir, "logs");
    const configPath = process.env.OPENCODE_ROUTER_CONFIG_PATH?.trim()
        ? resolve(process.env.OPENCODE_ROUTER_CONFIG_PATH.trim())
        : join(dataDir, "opencode-router.json");

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

export function ensureRouterRuntimeConfig(paths: RouterRuntimePaths): RouterConfigFile {
    mkdirSync(paths.workspaceDir, { recursive: true });
    mkdirSync(paths.logDir, { recursive: true });

    const current = readRouterConfigFile(paths.configPath);
    const explicitOpencodeDirectory = current.opencodeDirectory?.trim() || process.env.OPENCODE_DIRECTORY?.trim();
    const next: RouterConfigFile = {
        ...current,
        version: 1,
        healthPort: current.healthPort ?? parseInteger(process.env.OPENCODE_ROUTER_HEALTH_PORT, DEFAULT_ROUTER_HEALTH_PORT),
        ...(explicitOpencodeDirectory ? { opencodeDirectory: explicitOpencodeDirectory } : {}),
    };

    writeFileSync(paths.configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
}

export function buildRouterEnv(serverUrl: string, paths: RouterRuntimePaths): NodeJS.ProcessEnv {
    const config = ensureRouterRuntimeConfig(paths);

    return {
        ...process.env,
        OPENCODE_URL: serverUrl,
        OPENCODE_ROUTER_DATA_DIR: paths.dataDir,
        OPENCODE_ROUTER_CONFIG_PATH: paths.configPath,
        OPENCODE_ROUTER_LOG_FILE: join(paths.logDir, "opencode-router.log"),
        OPENCODE_ROUTER_HEALTH_PORT: String(config.healthPort ?? DEFAULT_ROUTER_HEALTH_PORT),
    };
}
