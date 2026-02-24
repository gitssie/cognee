# opencode-agent

Bun sub-project that wraps [`@opencode-ai/sdk`](https://www.npmjs.com/package/@opencode-ai/sdk) to provide an OpenCode Agent server for cognee-code.

## What it does

1. Starts an `opencode serve` process via `createOpencodeServer()` (port 4096 by default).
2. Registers the **cognee MCP server** (`http://localhost:8000/mcp/`) so the Agent can call `cognify`, `search`, `write_memory`, `read_memory`, `save_interaction`, etc.
3. Defines the **`cognee-coder`** custom Agent — a coding assistant that proactively uses the cognee knowledge graph for persistent memory.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- `opencode-ai` CLI installed globally: `bun add -g opencode-ai`
- cognee-code Python backend running on port 8000

## Development

```bash
# Install dependencies
bun install

# Start in dev mode (hot-reload)
bun run dev

# Start in production mode
bun run start

# Type-check
bun run typecheck
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_PORT` | `4096` | Port for the OpenCode HTTP server |
| `COGNEE_MCP_URL` | `http://localhost:8000/mcp/` | cognee MCP endpoint |
| `COGNEE_API_TOKEN` | *(empty)* | Bearer token for authenticated MCP calls |
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key (or other provider) |
| `OPENAI_API_KEY` | *(optional)* | OpenAI API key |

## Directory Structure

```
opencode-agent/
├── Dockerfile
├── package.json
├── bunfig.toml
├── tsconfig.json
└── src/
    ├── index.ts    # Entry point: start server, verify MCP, keep alive
    └── config.ts   # Build ServerOptions + OpenCode config (MCP, agents)
```
