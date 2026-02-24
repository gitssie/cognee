import { spawn } from "node:child_process"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { buildOpencodeArgs, buildOpencodeEnv } from "./config"

const controller = new AbortController()

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.error(`[opencode-agent] Received ${sig}, shutting down...`)
    controller.abort()
  })
}

const { args, port } = buildOpencodeArgs()
const env = buildOpencodeEnv()

// Use the resolved native binary path from env to avoid running the CJS
// wrapper through Node.js in ESM mode (which breaks require()).
const opencodeBin = env.OPENCODE_BIN_PATH ?? "opencode"
console.error(`[opencode-agent] Starting OpenCode server on port ${port}...`)

const proc = spawn(opencodeBin, args, {
  signal: controller.signal,
  env,
})

// Forward opencode logs to our stderr in real-time
proc.stderr.pipe(process.stderr)

// Parse the server URL from stdout, then keep forwarding stdout too
const serverUrl = await new Promise<string>((resolve, reject) => {
  const timeout = Number(process.env.OPENCODE_TIMEOUT ?? 15_000)
  const id = setTimeout(() => {
    reject(new Error(`Timeout waiting for opencode server to start after ${timeout}ms`))
  }, timeout)

  let buf = ""
  proc.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString()
    const lines = buf.split("\n")
    // Keep the last incomplete line in buf
    buf = lines.pop() ?? ""
    for (const line of lines) {
      process.stdout.write(line + "\n")
      if (line.startsWith("opencode server listening")) {
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (match) {
          clearTimeout(id)
          resolve(match[1]!)
        }
      }
    }
  })

  proc.on("exit", (code) => {
    clearTimeout(id)
    reject(new Error(`opencode exited with code ${code}`))
  })

  proc.on("error", (err) => {
    clearTimeout(id)
    reject(err)
  })

  controller.signal.addEventListener("abort", () => {
    clearTimeout(id)
    reject(new Error("Aborted"))
  })
})

// After URL is resolved, keep piping stdout
proc.stdout.pipe(process.stdout)

console.error(`[opencode-agent] OpenCode server ready at ${serverUrl}`)

const client = createOpencodeClient({ baseUrl: serverUrl })
try {
  const mcpStatus = await client.mcp.status()
  const connections = (mcpStatus as Record<string, unknown>)?.data ?? mcpStatus
  console.error("[opencode-agent] MCP connections:", JSON.stringify(connections, null, 2))
} catch (e) {
  console.error("[opencode-agent] Could not check MCP status:", e)
}

await new Promise<void>((resolve) => {
  controller.signal.addEventListener("abort", () => {
    proc.kill()
    resolve()
  })
})

console.error("[opencode-agent] Shutdown complete.")
