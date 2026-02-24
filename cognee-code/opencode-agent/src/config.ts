import { existsSync } from "node:fs"

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

        // M9: Register the CogneeMemoryPlugin for automatic memory injection
        plugin: ["@cognee/opencode-memory-plugin"],

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
                    "## Memory",
                    "Relevant knowledge from past sessions is automatically injected above.",
                    "You can also use these tools explicitly:",
                    "- `cognee_search`: Search the knowledge graph for specific past knowledge",
                    "- `cognee_save`: Persist important decisions, conventions, or findings",
                    "",
                    "## Memory Management (MCP tools — for explicit operations)",
                    "1. At the start of each task, call `read_memory` to load existing knowledge.",
                    "2. Before searching, use the `search` MCP tool to query the knowledge graph.",
                    "3. Save important coding decisions, architecture choices, and best practices",
                    "   using `write_memory`.",
                    "4. At the end of each coding session, call `save_interaction` to extract",
                    "   reusable coding rules.",
                    "",
                    "## Coding Principles",
                    "- Follow the existing code style and patterns in the project.",
                    "- Read relevant files before making changes.",
                    "- Keep changes small and focused.",
                    "- When uncertain about design decisions, consult the cognee knowledge base first.",
                    "",
                    "## Dataset Constraints",
                    "If the system prompt contains a '## 知识库查询约束' or '## Knowledge Base Constraints'",
                    "section, you MUST respect those dataset restrictions when calling the `search` tool.",
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
