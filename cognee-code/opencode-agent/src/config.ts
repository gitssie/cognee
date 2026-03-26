import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const COGNEE_MCP_URL =
    process.env.COGNEE_MCP_URL ?? "http://localhost:8000/mcp/";
const COGNEE_API_TOKEN = process.env.COGNEE_API_TOKEN;

/** Build CLI args for `opencode serve` */
export function buildOpencodeArgs(): { args: string[]; port: number } {
    const hostname = process.env.OPENCODE_HOSTNAME ?? "0.0.0.0";
    const port = Number(process.env.OPENCODE_PORT ?? 4097);
    const args = [
        "serve",
        `--hostname=${hostname}`,
        `--port=${port}`,
        "--print-logs",
    ];
    return { args, port };
}

/** Build env vars for the opencode child process */
export function buildOpencodeEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpencodeConfig()),
        // Point the opencode wrapper script directly to the native binary so it
        // skips the CJS require() block that fails under Node 22 ESM mode.
        OPENCODE_BIN_PATH: resolveNativeOpencodeBin(),
    };
}

function resolveNativeOpencodeBin(): string {
    if (process.env.OPENCODE_BIN_PATH) return process.env.OPENCODE_BIN_PATH
    const candidates = [
        "/root/.bun/install/global/node_modules/opencode-linux-x64/bin/opencode",
        "/root/.bun/install/global/node_modules/opencode-linux-x64-baseline/bin/opencode",
    ]
    for (const c of candidates) {
        if (existsSync(c)) return c
    }
    return "opencode"
}

function buildOpencodeConfig() {
    const mcpHeaders: Record<string, string> = {};
    if (COGNEE_API_TOKEN) {
        mcpHeaders["Authorization"] = `Bearer ${COGNEE_API_TOKEN}`;
    }

    return {
        // MCP: connect cognee-code Python backend
        mcp: {
            cognee: {
                type: "remote" as const,
                url: COGNEE_MCP_URL,
                enabled: true,
                ...(Object.keys(mcpHeaders).length > 0
                    ? { headers: mcpHeaders }
                    : {}),
            },
        },

        // M9-2: Register the CogneeProjectPlugin for automatic rules + dataset injection
        plugin: [`file://${join(__dirname, "plugin", "index.ts")}`],

        // Custom agent: cognee-coder — a coding assistant with persistent memory
        agent: {
            "cognee-coder": {
                name: "cognee-coder",
                description:
                    "AI coding assistant with persistent memory backed by the cognee knowledge graph",
                model: "zhipuai-coding-plan/glm-4.7",
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
