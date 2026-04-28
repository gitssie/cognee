# Microsandbox + OpenCode per-user isolation plan

## Goal

Run one isolated OpenCode runtime per user by booting `ghcr.io/anomalyco/opencode:latest` inside a microsandbox microVM.

This replaces the long-term need for one shared OpenCode process. Each user gets separate:

- CPU and memory limits.
- OpenCode server process.
- Project workspace.
- OpenCode auth/config/session state.
- Network policy and secret boundary.

## Verified baseline

Local smoke test:

```bash
./scripts/test-msb-opencode.sh
```

Result:

```text
1.14.28
```

This confirms `msb` can pull and run the official OpenCode OCI image:

```text
ghcr.io/anomalyco/opencode:latest
```

Important note: microsandbox pulls images from OCI registries and does not read Docker daemon local images directly. If we later need a custom image, publish it to a registry or a local registry first.

## Relevant capabilities

### OpenCode

OpenCode supports a headless server:

```bash
opencode serve --hostname 0.0.0.0 --port 4096
```

The server exposes:

- `GET /global/health`
- `GET /doc`
- sessions, messages, files, MCP, provider/auth, agent APIs

`OPENCODE_SERVER_PASSWORD` can enable HTTP basic auth.

## Source-confirmed OpenCode behavior

The following decisions are based on the local OpenCode source tree at:

```text
/root/workspace/github/opencode/packages/opencode/src
```

### Confirmed API routes

| Behavior | Source | Confirmed detail |
| --- | --- | --- |
| Health | `server/routes/global.ts` | `GET /global/health` returns `{ healthy: true, version }` |
| Instance event stream | `server/routes/instance/event.ts` | `GET /event` streams all `Bus` events and sends `server.connected` + heartbeat |
| Session list | `server/routes/instance/session.ts` + `session/session.ts` | `GET /session` returns sessions sorted by `time_updated DESC`; `start` filters by `time_updated >= start` |
| Session status | `server/routes/instance/session.ts` | `GET /session/status` returns the current `SessionStatus` map |
| Prompt | `server/routes/instance/session.ts` | `POST /session/:sessionID/message` calls `SessionPrompt.prompt` |
| Async prompt | `server/routes/instance/session.ts` | `POST /session/:sessionID/prompt_async` starts prompt execution and returns `204` |
| Abort | `server/routes/instance/session.ts` | `POST /session/:sessionID/abort` cancels active execution |

### Confirmed activity semantics

OpenCode has two different concepts that must not be mixed:

1. **Currently active execution** — held in `SessionStatus` runtime state.
2. **Recently updated session metadata** — held in `Session.Info.time.updated` / DB `time_updated`.

Confirmed from `session/status.ts`:

```typescript
type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" };
```

Confirmed state behavior:

- `SessionStatus.list()` returns a runtime `Map<sessionID, status>`.
- `SessionStatus.get(sessionID)` returns `{ type: "idle" }` when a session is not in the map.
- `SessionStatus.set(sessionID, { type: "busy" })` publishes `session.status` and stores the session in the map.
- `SessionStatus.set(sessionID, { type: "idle" })` publishes `session.status`, publishes deprecated `session.idle`, and deletes the session from the map.

Confirmed from `session/run-state.ts` and `session/processor.ts`:

- A session becomes active when the runner/processor sets status to `busy`.
- A session becomes inactive when the runner goes idle or processing halts and sets status to `idle`.
- `busy` and `retry` must be treated as active; missing/idle means not active.

Confirmed from `session/prompt.ts` and `session/session.ts`:

- `SessionPrompt.prompt()` calls `sessions.touch(sessionID)` after creating the user message.
- `sessions.touch()` patches `time.updated = Date.now()`.
- `Session.list({ start })` filters by `time_updated >= start` and sorts by `time_updated DESC`.
- Therefore `time.updated` is useful for “recently used” TTL decisions, but it is not a reliable indicator of currently running work.

Confirmed from `session/session.sql.ts`:

- `session` table has indexes on `project_id`, `workspace_id`, and `parent_id`.
- There is no dedicated `time_updated` or `(project_id, time_updated)` index in the current source.
- Therefore repeatedly scanning all sessions via `session.list()` is not the primary activity detector for large histories.

### Activity decision rule

Use this rule in implementation:

```text
active session = any /session/status entry where status.type is busy or retry
recent session = any /session entry where time.updated >= now - idleTtl
reclaimable sandbox = no active sessions AND no host request in flight AND no recent session/event activity
```

Never decide sandbox reclamation from `session.list()` alone.

### Scalable activity detection

Do not loop through every session. Use a layered, short-circuit strategy:

1. **Hot active check:** call `/session/status`.
   - This returns only the runtime status map, not all historical sessions.
   - If any value is `busy` or `retry`, keep the sandbox.
2. **Host-side activity clock:** maintain `runtime.lastActivityAt` in our DB.
   - Update it on every proxied user request.
   - Update it from SSE events such as `session.status`, `session.idle`, `message.updated`, `message.part.*`, `session.updated`.
   - This avoids querying historical sessions on every cleanup tick.
3. **Cold-start reconciliation:** when the manager restarts or loses SSE state, query OpenCode once using `session.list({ start: now - idleTtl, limit: 1 })`.
   - If it returns at least one session, treat the sandbox as recently used.
   - Do not enumerate sessions; `limit: 1` is enough.
4. **Optional optimization:** if histories become large, add an upstream/local OpenCode optimization:
   - DB index: `(project_id, time_updated)` or `(directory, time_updated)`.
   - endpoint: `GET /session/recent?start=<ms>&limit=1` or `GET /session/activity` returning max `time_updated` and active statuses.

Preferred cleanup check:

```typescript
async function shouldKeepSandbox(runtime: OpenCodeSandboxRuntime) {
  if (runtime.activeRequestCount > 0) return true;

  const activeSessionIds = await getActiveSessionIds(runtime.client);
  if (activeSessionIds.length > 0) return true;

  // Fast path: use our own activity clock, maintained by proxy + SSE watcher.
  if (Date.now() - runtime.lastActivityAt.getTime() < idleTtlMs) return true;

  // Slow path: only when our event watcher was disconnected or manager restarted.
  if (runtime.needsColdActivityRecheck) {
    const recent = await runtime.client.session.list({
      query: { start: Date.now() - idleTtlMs, limit: 1 },
    });
    if ((recent.data ?? []).length > 0) return true;
  }

  return false;
}
```

This gives O(active sessions) for live work and O(1) application-side checks for normal idle cleanup. The historical session query is only a fallback/reconciliation step.

### Microsandbox

Microsandbox supports:

- OCI images from registries.
- Detached sandboxes via `createDetached()`.
- Port publishing via `.port(host, guest)`.
- CPU/memory limits via `.cpus()` and `.memory()`.
- Persistent volumes.
- Per-sandbox network policies.
- Secret injection via `secretEnv(...)` / secret APIs.
- Lifecycle operations: get/list/start/stop/kill/remove.
- Metrics via `sandbox.metrics()`.

## Proposed architecture

```text
Cognee Code Server
  └─ OpenCodeSandboxManager
      ├─ ensureSandbox(userId, projectId)
      ├─ getOpenCodeBaseUrl(userId, projectId)
      ├─ stopSandbox(userId, projectId)
      └─ collectMetrics(userId, projectId)

Microsandbox runtime
  ├─ sandbox: opencode-u_<user>-p_<project>
  │   ├─ image: ghcr.io/anomalyco/opencode:latest
  │   ├─ command: opencode serve --hostname 0.0.0.0 --port 4096
  │   ├─ port: 127.0.0.1:<allocatedPort> -> 4096
  │   ├─ volume: user/project workspace
  │   └─ secrets: provider keys
  └─ sandbox: opencode-u_<another>-p_<project>
```

The host server should own sandbox lifecycle. OpenCode should not spawn sandboxes by itself.

## Deployment topology when using microsandbox

Important: `msb` is a host runtime, not something that magically exists inside `ghcr.io/anomalyco/opencode:latest` or the current `opencode-agent` Docker image.

If `opencode-agent` continues to run as a normal Docker container, it should not directly spawn microsandbox VMs unless that container is explicitly prepared with `msb`, `/dev/kvm`, and elevated privileges. The safer production design is to split orchestration from the containerized app.

### Recommended topology: host-side Sandbox Supervisor

```text
Linux host with KVM
  ├─ opencode-agent container
  │   └─ calls Sandbox Supervisor over localhost/private network
  ├─ Sandbox Supervisor process (host-native Node/TS service)
  │   ├─ has microsandbox SDK / msb installed
  │   ├─ owns Sandbox.builder(...).createDetached()
  │   ├─ allocates ports and mounts host workspace paths
  │   └─ watches activity + stops/restarts sandboxes
  └─ microsandbox microVMs
      ├─ opencode for user A/project X
      └─ opencode for user B/project Y
```

Responsibilities:

| Component | Responsibility |
| --- | --- |
| `opencode-agent` container | Business API, auth, routing, calling supervisor, proxying to per-user OpenCode |
| Sandbox Supervisor | All `msb`/microsandbox lifecycle operations |
| OpenCode sandbox | Official `ghcr.io/anomalyco/opencode:latest` runtime per user/project |

Why this is preferred:

- No privileged `opencode-agent` container.
- `msb` can use host KVM directly.
- Host workspace paths are resolved and mounted by the host process that can actually see them.
- Failure boundary is cleaner: if `opencode-agent` restarts, sandboxes can keep running detached.

Supervisor minimal API:

```text
POST /runtimes/ensure      { userId, projectId, workspaceKey } -> { baseUrl, auth, sandboxName }
POST /runtimes/touch       { userId, projectId }
POST /runtimes/stop        { userId, projectId, reason }
DELETE /runtimes           { userId, projectId }
GET /runtimes/:id/status   -> sandbox + opencode status
GET /runtimes/:id/metrics  -> microsandbox metrics
```

`opencode-agent` should never run `msb` commands directly in this topology. It only calls the supervisor.

### Development topology: host-run agent

For local development, the simplest path is:

```text
run opencode-agent directly on host with Node/Bun
install msb on host
use microsandbox SDK directly from opencode-agent
```

This is good for iteration, but production should still prefer a supervisor boundary.

### Alternative: privileged container with msb installed

Microsandbox documentation says Docker deployment requires Linux KVM and running the container with:

```bash
docker run --privileged --device /dev/kvm ...
```

So it is technically possible to build an `opencode-agent-with-msb` image and run it as privileged:

```text
opencode-agent container
  ├─ includes msb / microsandbox SDK native dependencies
  ├─ has /dev/kvm mounted
  ├─ runs with --privileged or equivalent capabilities
  └─ creates microVMs from inside the container
```

This is not the recommended default because it expands the privilege of the main application container and complicates host path mounts. Use only if deployment constraints require everything containerized.

### Alternative: microsandbox sidecar container

Microsandbox publishes a container image, but it is still a CLI/runtime container, not a complete long-running orchestration API for our app. To use it cleanly, wrap it with the same Sandbox Supervisor API:

```text
opencode-agent container -> sandbox-supervisor container -> microsandbox runtime -> OpenCode microVMs
```

The supervisor container would still need `/dev/kvm`, persistent `/root/.microsandbox`, and access to the host workspace mount root.

### Startup sequence with supervisor

```text
1. Host boots Sandbox Supervisor.
2. Supervisor verifies:
   - msb/microsandbox SDK is installed
   - /dev/kvm is available
   - ghcr.io/anomalyco/opencode:latest is pulled or pullable
   - workspace mount root exists
3. opencode-agent starts normally in Docker.
4. User request arrives.
5. opencode-agent calls supervisor /runtimes/ensure.
6. Supervisor resolves host workspace path and creates/starts sandbox.
7. Supervisor waits for OpenCode /global/health.
8. Supervisor returns localhost/private baseUrl + auth metadata.
9. opencode-agent proxies request to that OpenCode server.
```

This answers the key deployment question: Docker starts `opencode-agent`; the host-side supervisor starts the per-user OpenCode sandboxes.

## Runtime identity

Sandbox name should be deterministic and safe:

```text
opencode-u_<safeUserId>-p_<safeProjectId>
```

Rules:

- Keep names short.
- Replace unsafe characters with `-`.
- Include project ID if users can work on multiple projects.
- Store the mapping in DB: `user_id`, `project_id`, `sandbox_name`, `host_port`, `status`, `created_at`, `last_seen_at`.

## Port allocation

OpenCode listens on guest port `4096`.

The host must allocate a free local port per sandbox:

```text
127.0.0.1:<hostPort> -> 4096
```

Recommended:

- Allocate from a managed range, e.g. `42000-45999`.
- Persist port ownership in DB.
- Verify `/global/health` after boot.
- Never expose sandbox ports publicly; keep host binding local.

## Workspace and state

Use per-user/project persistence:

```text
~/.cognee-code/sandboxes/<userId>/<projectId>/workspace  -> /workspace
~/.cognee-code/sandboxes/<userId>/<projectId>/opencode   -> /root/.local/share/opencode
```

OpenCode should run with workdir `/workspace`.

This gives each user isolated OpenCode state while keeping data durable across sandbox restarts.

## Host workspace mount management

The sandbox workspace is not arbitrary. It must be derived from the host-side workspace root configured by `opencode-agent`.

Current router config shape:

```json
{
  "router": {
    "rootDir": ".opencode-router",
    "workspaceDir": "workspaces"
  },
  "channels": {
    "wecom": {
      "accounts": [
        {
          "directory": "per-peer://workspaces"
        }
      ]
    }
  }
}
```

So the host workspace root resolves to:

```text
<opencode-agent-project-root>/.opencode-router/workspaces
```

The sandbox manager should treat this as the only allowed mount root unless explicitly configured otherwise.

### Mount path resolver

Add a resolver before creating any sandbox:

```typescript
type WorkspaceMount = {
  userId: string;
  projectId: string;
  peerId?: string;
  hostWorkspaceRoot: string;
  hostWorkspacePath: string;
  guestWorkspacePath: "/workspace";
  readonly: false;
};
```

Resolution rules:

```text
hostWorkspaceRoot = resolve(OPENCODE_AGENT_ROOT, router.rootDir, router.workspaceDir)
safeWorkspaceName = sanitize(userId + "-" + projectId or peerId)
hostWorkspacePath = resolve(hostWorkspaceRoot, safeWorkspaceName)
assert hostWorkspacePath startsWith hostWorkspaceRoot
mkdir -p hostWorkspacePath
mount hostWorkspacePath -> /workspace
```

Never mount a user-provided absolute path directly. If a user/project already has an existing directory binding, normalize it and verify it stays under the allowed root.

### Relation to `per-peer://workspaces`

`per-peer://workspaces` means the host maps each peer/user to a child directory under the configured workspace root. In the microsandbox design, that host directory becomes the bind mount:

```text
host:  .opencode-router/workspaces/<safe-peer-or-user-project>
guest: /workspace
```

OpenCode inside the VM only sees `/workspace`. It should not know or receive the host absolute path.

### Mount table

Recommended mounts per sandbox:

| Host path | Guest path | Purpose | Lifetime |
| --- | --- | --- | --- |
| `.opencode-router/workspaces/<workspaceId>` | `/workspace` | User/project code working directory | persistent |
| `.opencode-router/sandbox-state/<workspaceId>/opencode` | `/root/.local/share/opencode` | OpenCode auth/session/cache state | persistent |
| `.opencode-router/sandbox-state/<workspaceId>/tmp` | `/tmp` or tmpfs | transient scratch | optional |

Keep OpenCode state separate from source workspace so cleanup policies can remove runtime state without deleting user code.

### Mount locking

Only one running sandbox should have a writable mount for a given host workspace path.

Before startup:

```text
acquire workspace lock by hostWorkspacePath
if another sandbox owns writable mount:
  reuse that sandbox if same user/project
  otherwise reject or start read-only clone
release lock after sandbox stopped/removed
```

This prevents two OpenCode instances from concurrently editing the same host directory.

### Mount consistency on restart

When an idle sandbox is stopped, keep the mount directories. On next request:

```text
load runtime record
resolve hostWorkspacePath again
verify path still exists and is under allowed root
start/recreate sandbox with the same mount
run opencode in /workspace
```

If the directory was deleted or moved, mark the runtime `stale_mount` and require the product layer to recreate or rebind the workspace.

### Mount cleanup policy

Separate cleanup by data type:

| Trigger | Workspace mount | OpenCode state mount | Sandbox record |
| --- | --- | --- | --- |
| idle TTL | keep | keep | mark stopped |
| user manually closes session | keep | keep or compact | mark stopped |
| project deleted | delete/archive | delete | remove |
| sandbox crashed | keep | keep | recreate |
| workspace rebind | keep old until migration completes | may reset | update record |

Never delete `.opencode-router/workspaces/<workspaceId>` as part of idle cleanup.

## Secrets

Preferred approach:

- Store provider keys in the host secret store.
- Inject them at sandbox creation time.
- Use microsandbox secret APIs when possible so real credentials do not permanently live in the VM.

For a first implementation, environment injection is acceptable only for local testing:

```typescript
.env("DEEPSEEK_API_KEY", deepseekKey)
```

For production, use allowlisted secret forwarding:

```typescript
.secretEnv("DEEPSEEK_API_KEY", deepseekKey, "api.deepseek.com")
```

Also set an OpenCode server password per sandbox:

```text
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=<random per sandbox password>
```

## Network policy

Default to public-only networking:

- Allow public LLM endpoints.
- Block host/private network access unless explicitly needed.
- Keep ingress restricted to the published OpenCode port.

If the sandbox must call host services, use explicit policy rather than broad `allowAll()`.

## TypeScript SDK sketch

```typescript
import { NetworkPolicy, Sandbox } from "microsandbox";

export async function startUserOpenCodeSandbox(input: {
  userId: string;
  projectId: string;
  hostPort: number;
  workspaceHostPath: string;
  opencodeStateHostPath: string;
  serverPassword: string;
  deepseekKey?: string;
}) {
  const sandboxName = `opencode-u_${input.userId}-p_${input.projectId}`
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .slice(0, 64);

  const builder = Sandbox.builder(sandboxName)
    .image("ghcr.io/anomalyco/opencode:latest")
    .cpus(1)
    .memory(1024)
    .workdir("/workspace")
    .port(input.hostPort, 4096)
    .volume("/workspace", (v) => v.bind(input.workspaceHostPath))
    .volume("/root/.local/share/opencode", (v) => v.bind(input.opencodeStateHostPath))
    .env("OPENCODE_SERVER_USERNAME", "opencode")
    .env("OPENCODE_SERVER_PASSWORD", input.serverPassword)
    .entrypoint(["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"])
    .network((n) => n.policy(NetworkPolicy.publicOnly()))
    .replace();

  if (input.deepseekKey) {
    builder.secretEnv("DEEPSEEK_API_KEY", input.deepseekKey, "api.deepseek.com");
  }

  return builder.createDetached();
}
```

Validate after creation:

```typescript
const response = await fetch(`http://127.0.0.1:${hostPort}/global/health`, {
  headers: {
    Authorization: `Basic ${Buffer.from(`opencode:${serverPassword}`).toString("base64")}`,
  },
});
```

## CLI prototype

For local manual testing:

```bash
msb pull ghcr.io/anomalyco/opencode:latest

msb create \
  --name opencode-user-demo \
  --replace \
  --cpus 1 \
  --memory 1G \
  --port 14196:4096 \
  --workdir /workspace \
  --volume "$PWD:/workspace" \
  --env OPENCODE_SERVER_USERNAME=opencode \
  --env OPENCODE_SERVER_PASSWORD=dev-password \
  --network-policy public-only \
  --entrypoint "opencode serve --hostname 0.0.0.0 --port 4096" \
  ghcr.io/anomalyco/opencode:latest

curl -u opencode:dev-password http://127.0.0.1:14196/global/health
```

If the CLI entrypoint form is unreliable for long-running server mode, use the TypeScript SDK as the source of truth and keep CLI tests as smoke checks only.

## Integration steps

1. Add `microsandbox` dependency to the host service that manages OpenCode sandboxes.
2. Add DB table/model for sandbox runtime records.
3. Implement `OpenCodeSandboxManager`:
   - deterministic sandbox name
   - port allocation
   - create/get/reconnect
   - health check
   - stop/remove
   - metrics
4. Add routing layer:
   - user request resolves to sandbox by `userId + projectId`
   - server proxies OpenCode API calls to `127.0.0.1:<hostPort>`
5. Add cleanup policy:
   - idle timeout
   - max lifetime
   - explicit user/project cleanup
6. Add observability:
   - sandbox status
   - OpenCode health
   - CPU/memory metrics
   - boot failures

## Runtime manager responsibilities

The integration must not only create sandboxes. It needs an always-on manager that treats each OpenCode sandbox as a resumable runtime.

### Runtime record

Persist one record per `userId + projectId`:

```typescript
type OpenCodeSandboxRuntime = {
  userId: string;
  projectId: string;
  sandboxName: string;
  image: "ghcr.io/anomalyco/opencode:latest";
  hostPort: number;
  serverUsername: "opencode";
  serverPasswordRef: string;
  workspacePath: string;
  opencodeStatePath: string;
  status: "starting" | "running" | "idle" | "draining" | "stopped" | "crashed";
  lastUserRequestAt: Date | null;
  lastOpenCodeEventAt: Date | null;
  lastHealthCheckAt: Date | null;
  lastSessionActivityAt: Date | null;
  lastActivityAt: Date;
  activeSessionIds: string[];
  activeSessionSince: Record<string, number>;
  activeRequestCount: number;
  needsColdActivityRecheck: boolean;
  lastKnownSessionIds: string[];
  createdAt: Date;
  updatedAt: Date;
};
```

Do not infer activity only from process existence. A sandbox can be `running` while all OpenCode sessions are inactive.

### Ensure-or-resume flow

Every user request should go through `ensureOpenCodeRuntime(userId, projectId)`:

```text
request received
  -> load runtime record
  -> if no record: allocate port + create sandbox + wait for /global/health
  -> if stopped: Sandbox.start(name) + wait for /global/health
  -> if crashed/missing: recreate with same volumes/state + wait for /global/health
  -> if running: health check; if unhealthy, restart/recreate
  -> create OpenCode client with baseUrl
  -> proxy/execute request
  -> update lastUserRequestAt + activeRequestCount
```

This means idle cleanup is reversible: stopping a sandbox must not delete the workspace or OpenCode state unless the user/project is explicitly deleted.

### OpenCode client SDK usage

Use the OpenCode client SDK in client-only mode after the sandbox is healthy:

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk";

function createSandboxOpenCodeClient(hostPort: number, password: string) {
  const auth = Buffer.from(`opencode:${password}`).toString("base64");

  return createOpencodeClient({
    baseUrl: `http://127.0.0.1:${hostPort}`,
    fetch: (input, init = {}) => fetch(input, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Basic ${auth}`,
      },
    }),
  });
}
```

Use the client for:

- `client.global.health()` to validate server readiness.
- `client.session.status()` / `GET /session/status` to detect currently active sessions.
- `client.session.list({ query: { start } })` to find recently updated sessions after the server restarts.
- `client.event.subscribe()` to track `session.status`, `session.idle`, `message.updated`, and `message.part.*` events in real time.
- `client.session.abort(...)` before forced shutdown if a request is stuck.

Do not use `client.session.list()` by itself as an "active session" detector. OpenCode server source shows session list is sorted/filtered by `Session.Info.time.updated`; this is useful for recent activity, but it does not mean the session is currently running.

OpenCode's current active state is exposed by `SessionStatus`:

```typescript
type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };
```

The server keeps a runtime `Map<sessionID, status>`. When a session becomes idle, it publishes `session.idle` and removes that session from the map. Therefore:

- active session = status is `busy` or `retry`.
- idle session = status missing from `/session/status` or explicit `idle` event.
- recently updated session = `session.time.updated` changed, useful only for idle TTL, not active execution.

### Activity model

Track activity at four layers:

| Layer | Signal | Storage field |
| --- | --- | --- |
| Host request | User sends/proxies a request to OpenCode | `lastUserRequestAt` |
| OpenCode active sessions | `session.status` is `busy` or `retry` | `activeSessionIds`, `activeSessionSince` |
| OpenCode event stream | `message.updated`, `message.part.updated`, `message.part.delta`, `session.updated` | `lastOpenCodeEventAt` |
| OpenCode recent sessions | `Session.Info.time.updated` from `session.list({ start })` | `lastSessionActivityAt` |

Effective activity timestamp:

```typescript
const effectiveLastActivityAt = maxDate(
  runtime.lastUserRequestAt,
  runtime.lastOpenCodeEventAt,
  runtime.lastSessionActivityAt,
);
```

A sandbox is reclaimable only when all are true:

- `activeRequestCount === 0`
- `activeSessionIds.length === 0`
- `/session/status` has no `busy` or `retry` entries
- no OpenCode event has been observed recently
- latest `Session.Info.time.updated` is older than `idleTtl`
- health check is not currently booting/restarting

If `/session/status` says any session is `busy` or `retry`, the sandbox is active even if no recent SSE event arrived.

### Idle cleanup policy

Recommended defaults:

```text
soft idle TTL: 15 minutes
hard max runtime: 6 hours
graceful stop timeout: 30 seconds
crashed runtime retry: 1 immediate recreate, then exponential backoff
```

Cleanup loop:

```text
every 60 seconds:
  list runtime records where status in running/idle
  refresh sandbox status via Sandbox.get(name)
  refresh OpenCode health via client.global.health()
  fetch /session/status
  if any status is busy/retry:
      mark runtime active
      update activeSessionIds
      skip idle cleanup
  query session.list({ start: now - idleTtl }) only to compute recent idle activity
  compute effectiveLastActivityAt
  if active and not expired: keep running
  if idle beyond soft TTL:
      mark draining
      stop event subscription
      stop sandbox gracefully
      mark stopped
      keep workspace/state/port reservation or release port by policy
  if max runtime exceeded:
      drain/stop even if idle detector missed events
```

Microsandbox also supports `.idleTimeout(seconds)` and `.maxDuration(seconds)`, but the application-level manager should still keep its own DB timestamps. The DB state is what allows correct resume/recreate after process restarts.

### Rehydration after stop

When a stopped user sends a new request:

1. Load the existing runtime record.
2. Reuse the same `sandboxName` and persistent volume paths.
3. Re-allocate a host port if it was released.
4. Call `Sandbox.start(name)` if microsandbox still has the stopped sandbox.
5. If `Sandbox.get(name)` fails, create a new sandbox with the same volume mounts.
6. Wait for `client.global.health()`.
7. Resume normal request proxying.

This gives the user the same workspace and OpenCode state after the sandbox process has been reclaimed.

### Event watcher

For running sandboxes, attach a lightweight watcher:

```typescript
async function watchOpenCodeActivity(runtime: OpenCodeSandboxRuntime) {
  const client = createSandboxOpenCodeClient(runtime.hostPort, loadPassword(runtime));
  const events = await client.event.subscribe();

  try {
    for await (const event of events.stream) {
      const now = new Date();

      if (event.type === "session.status") {
        const { sessionID, status } = event.properties as {
          sessionID: string;
          status: { type: "idle" | "busy" | "retry" };
        };

        if (status.type === "busy" || status.type === "retry") {
          await runtimeStore.markSessionActive(runtime.sandboxName, sessionID, now);
        } else {
          await runtimeStore.markSessionIdle(runtime.sandboxName, sessionID, now);
        }
        continue;
      }

      if (event.type === "session.idle") {
        const { sessionID } = event.properties as { sessionID: string };
        await runtimeStore.markSessionIdle(runtime.sandboxName, sessionID, now);
        continue;
      }

      if (
        event.type === "message.updated" ||
        event.type === "message.part.updated" ||
        event.type === "message.part.delta" ||
        event.type === "session.updated"
      ) {
        await runtimeStore.touch(runtime.sandboxName, { lastOpenCodeEventAt: now });
      }
    }
  } catch {
    await runtimeStore.markWatcherDisconnected(runtime.sandboxName);
  }
}
```

The watcher is best-effort. If the SSE stream disconnects, the cleanup loop must fall back to `/session/status`; session list polling alone is not sufficient.

### Active session detector

The cleanup loop should use a dedicated detector:

```typescript
async function getActiveSessionIds(client: OpenCodeClient): Promise<string[]> {
  const statuses = await client.session.status();
  return Object.entries(statuses.data ?? {})
    .filter(([, status]) => status.type === "busy" || status.type === "retry")
    .map(([sessionID]) => sessionID);
}
```

Fallback if SDK method naming differs:

```typescript
const response = await fetch(`${baseUrl}/session/status`, { headers: authHeaders });
const statuses = await response.json() as Record<string, SessionStatus>;
```

Then apply:

```typescript
const activeSessionIds = await getActiveSessionIds(client);
if (activeSessionIds.length > 0) {
  await runtimeStore.markRuntimeActive(runtime.sandboxName, activeSessionIds);
  return "keep-running";
}
```

Use `session.list({ start })` only after active status is empty:

```typescript
const recentSessions = await client.session.list({
  query: { start: Date.now() - idleTtlMs, limit: 1 },
});
if ((recentSessions.data ?? []).length > 0) {
  return "keep-running-recently-used";
}
```

This distinction matters: `time.updated` proves recent session metadata change; `SessionStatus` proves current execution.

### Request proxy guard

Before forwarding any request to OpenCode:

```text
increment activeRequestCount
touch lastUserRequestAt
ensure sandbox running and healthy
forward request
decrement activeRequestCount in finally
```

This prevents the cleanup loop from stopping a sandbox while a user request is in flight.

### Stop vs remove

Use different operations for different lifecycle intents:

| Intent | Operation | Data kept? |
| --- | --- | --- |
| Idle reclaim | `sandbox.stop()` / `Sandbox.start(name)` later | yes |
| Crash recovery | `kill()` then recreate with same volumes | yes |
| User/project deletion | `stop()` then `Sandbox.remove(name)` and delete volumes | no |
| Image/config rotation | drain old sandbox, start replacement, switch runtime record | yes |

Never call `remove()` for idle cleanup unless product explicitly wants to discard all sandbox runtime state.

## Manager interfaces

```typescript
interface OpenCodeSandboxManager {
  ensureRuntime(input: { userId: string; projectId: string }): Promise<OpenCodeRuntimeConnection>;
  getClient(input: { userId: string; projectId: string }): Promise<OpenCodeClient>;
  markUserActivity(input: { userId: string; projectId: string }): Promise<void>;
  cleanupIdleRuntimes(): Promise<void>;
  stopRuntime(input: { userId: string; projectId: string; reason: "idle" | "manual" }): Promise<void>;
  removeRuntime(input: { userId: string; projectId: string }): Promise<void>;
}
```

```typescript
type OpenCodeRuntimeConnection = {
  sandboxName: string;
  baseUrl: string;
  hostPort: number;
  client: OpenCodeClient;
  release: () => Promise<void>;
};
```

## Risks and open questions

- The official OpenCode image is enough for isolated OpenCode server usage, but our current `opencode-router`/WeCom integration is outside that image.
- Need confirm SDK `.entrypoint([...])` behavior with `opencode serve`; CLI smoke already confirms the image runs.
- Need decide whether workspaces are host bind mounts or microsandbox named volumes.
- Need decide whether one sandbox is per user or per user-project. Per user-project is safer.
- Need protect the published OpenCode port with basic auth and localhost-only access.

## Recommendation

Implement first milestone as:

```text
per user-project sandbox + official OpenCode image + TypeScript SDK manager + localhost proxy
```

Do not mix this with the current `opencode-agent` router process yet. Treat microsandbox OpenCode as a new runtime backend and migrate features into it incrementally.
