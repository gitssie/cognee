/**
 * Admin proxy — HTTP reverse proxy that forwards AgentPage.vue (admin panel)
 * OpenCode API requests to the admin sandbox VM.
 *
 * In sandbox mode, there is no local OpenCode server. Each user runs in their
 * own microsandbox VM. The admin panel needs its own sandbox too.
 *
 * This proxy:
 *  1. Listens on a host port (default 4096, matching the OpenCode default)
 *  2. On first request, lazily creates the admin sandbox via SandboxManager
 *  3. Proxies all HTTP requests to the admin sandbox's OpenCode server
 *  4. Handles SSE (Server-Sent Events) for real-time agent streaming
 *
 * Flow:
 *   Agent.vue → admin-proxy(:4096) → admin sandbox VM (:42001 → :4096 inside VM)
 */

import http from "node:http";
import { Buffer } from "node:buffer";
import type { OpenCodeSandboxManager } from "./sandbox/types";

/** Identity string for the admin sandbox. Format: channel:identityId:peerKey */
const ADMIN_IDENTITY = "admin:admin:admin";

/** Skip these hop-by-hop headers when forwarding. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface AdminProxyConfig {
  /** Host port the proxy listens on. Default: 4096 (OpenCode default port). */
  port: number;
  /** Bind address. Default: 127.0.0.1. */
  host?: string;
}

/**
 * Start the admin HTTP reverse proxy.
 *
 * @param manager  OpenCodeSandboxManager instance (already created by builder)
 * @param config   Proxy listen configuration
 * @returns        Stop function — call to shut down the proxy server
 */
export function startAdminProxy(
  manager: OpenCodeSandboxManager,
  config: AdminProxyConfig,
): () => void {
  const host = config.host ?? "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    console.log(`[admin-proxy] ${req.method} ${req.url} received`);
    // ── CORS (same as health.ts) ───────────────────────────
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, PATCH, PUT, OPTIONS",
    );
    const reqHdr = req.headers["access-control-request-headers"];
    if (typeof reqHdr === "string" && reqHdr.trim()) {
      res.setHeader("Access-Control-Allow-Headers", reqHdr);
    } else {
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Lazy-create admin sandbox + forward ─────────────────
    try {
      // ensureRuntime creates the sandbox on first call, reuses on subsequent.
      console.log(`[admin-proxy] ensure admin sandbox start`);
      await manager.ensureRuntime(ADMIN_IDENTITY);
      console.log(`[admin-proxy] ensure admin sandbox done`);

      // Fetch runtime info for auth password.
      const rt = await manager.getRuntime(ADMIN_IDENTITY);
      console.log(`[admin-proxy] runtime status=${rt?.status ?? "missing"} port=${rt?.hostPort ?? "missing"}`);
      if (!rt?.serverPassword || !rt?.hostPort) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Admin sandbox not available" }));
        return;
      }

      const targetUrl = `http://127.0.0.1:${rt.hostPort}${req.url}`;
      console.log(`[admin-proxy] forward ${req.method} ${targetUrl}`);
      const basicAuth =
        "Basic " +
        Buffer.from(`opencode:${rt.serverPassword}`).toString("base64");

      // ── Build forward headers ──────────────────────────────
      const forwardHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(req.headers)) {
        const lower = key.toLowerCase();
        if (lower === "host" || lower === "authorization") continue;
        if (HOP_BY_HOP.has(lower)) continue;
        if (typeof val === "string") forwardHeaders[lower] = val;
        else if (Array.isArray(val)) forwardHeaders[lower] = val.join(", ");
      }
      forwardHeaders["authorization"] = basicAuth;

      // ── Read request body ──────────────────────────────────
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const body =
        chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      // ── Forward to admin sandbox ───────────────────────────
      const proxyRes = await fetch(targetUrl, {
        method: req.method ?? "GET",
        headers: forwardHeaders,
        body,
      });
      console.log(`[admin-proxy] response ${proxyRes.status} from ${targetUrl}`);

      // ── Write response ─────────────────────────────────────
      const responseHeaders: Record<string, string> = {};
      proxyRes.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
      res.writeHead(proxyRes.status, responseHeaders);

      if (proxyRes.body) {
        const reader = proxyRes.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch {
          // Client disconnected — normal for SSE / abort
        }
      }
      res.end();
    } catch (error) {
      console.error(`[admin-proxy] error`, error);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Admin proxy error",
            detail: String(error),
          }),
        );
      }
    }
  });

  server.listen(config.port, host, () => {
    console.log(
      `[opencode-agent] admin proxy listening on http://${host}:${config.port} (→ admin sandbox VM)`,
    );
  });

  return () => {
    server.close();
  };
}
