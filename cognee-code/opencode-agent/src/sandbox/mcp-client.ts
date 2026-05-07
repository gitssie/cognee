/**
 * MCP (Model Context Protocol) JSON-RPC client over HTTP.
 *
 * Talks to a sandbox MCP server (e.g. microsandbox-mcp with SSE transport)
 * using standard JSON-RPC `tools/call` requests. Modeled after OpenCode's
 * mcp-exa.ts pattern.
 *
 * Required MCP tools (must be provided by the sandbox MCP server):
 *   sandbox_create  — create/boot a named sandbox VM
 *   sandbox_inspect — get sandbox status and config
 *   sandbox_list    — list all sandboxes
 *   sandbox_stop    — stop a running sandbox
 *   sandbox_remove  — delete a stopped sandbox
 *   sandbox_exec    — run a command inside a sandbox
 *   sandbox_shell   — run a shell command inside a sandbox
 *
 * sandbox_create MUST support these additional parameters (microsandbox-mcp extensions):
 *   replace  (boolean)          — replace existing sandbox with same name
 *   network  (object)           — port mapping configuration
 *     hostPort  (number)        — host port to expose
 *     guestPort (number)        — guest port to forward to
 *     policy    ("allowAll")    — network policy
 *     dns       (string[])      — DNS nameservers
 */

const JSONRPC_VERSION = "2.0";

interface McpToolCallRequest {
  jsonrpc: string;
  id: number;
  method: "tools/call";
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface McpError {
  code: number;
  message: string;
}

interface McpResponse {
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: McpError;
}

/**
 * Parse SSE (Server-Sent Events) response body.
 * Extracts the first content[0].text from a `data:` line.
 */
function parseSse(body: string): string | undefined {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const parsed = JSON.parse(line.substring(6)) as McpResponse;
      const text = parsed.result?.content?.[0]?.text;
      if (text) return text;
      if (parsed.error) throw new Error(`MCP error: ${parsed.error.message}`);
    } catch (err) {
      // Not JSON, or no content — skip
      if (err instanceof SyntaxError) continue;
      throw err;
    }
  }
  return undefined;
}

/**
 * Parse a response body — tries JSON first, falls back to SSE.
 */
function parseResponse(body: string): unknown {
  // Try direct JSON response
  try {
    const json = JSON.parse(body) as McpResponse;
    if (json.error) {
      throw new Error(`MCP error: ${json.error.message}`);
    }
    const text = json.result?.content?.[0]?.text;
    if (text !== undefined) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return json.result;
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
  }

  // Try SSE
  const sseText = parseSse(body);
  if (sseText !== undefined) {
    try {
      return JSON.parse(sseText);
    } catch {
      return sseText;
    }
  }

  throw new Error(`Failed to parse MCP response: ${body.slice(0, 200)}`);
}

/** MCP client for calling sandbox management tools. */
export class McpSandboxClient {
  private nextId = 1;

  constructor(private readonly baseUrl: string) {}

  /**
   * Call an MCP tool by name with named arguments.
   * Returns the parsed result (content[0].text parsed as JSON, or raw text).
   */
  async callTool<T = unknown>(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const request: McpToolCallRequest = {
      jsonrpc: JSONRPC_VERSION,
      id: this.nextId++,
      method: "tools/call",
      params: { name: tool, arguments: args },
    };

    const url = this.baseUrl.replace(/\/+$/, "");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `MCP ${tool}: HTTP ${res.status} — ${body.slice(0, 200)}`,
      );
    }

    const body = await res.text();
    return parseResponse(body) as T;
  }
}

export default McpSandboxClient;
