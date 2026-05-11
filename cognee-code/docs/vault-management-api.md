# Vault Management API

MuninnDB has two different API surfaces for vaults:

1. **Vault-scoped data APIs** operate inside a vault, for example `POST /api/engrams?vault=default`.
2. **Vault management APIs** create, configure, rename, clear, delete, import, export, and rebuild vaults.

Vault management is primarily exposed through the **admin REST API** under `/api/admin/vaults/...`. MCP tools are not used for vault lifecycle management; MCP tools only accept a `vault` parameter to choose the target vault for memory operations.

---

## Authentication model

Most vault management endpoints require an authenticated **admin web session cookie**. Log in through the web UI first, or use the CLI, which attaches the stored admin session automatically.

Admin REST endpoints do **not** use HTTP Basic auth. A request like this will fail:

```bash
curl -X PUT http://127.0.0.1:8475/api/admin/vaults/config \
  -u root:password \
  -H "Content-Type: application/json" \
  -d '{"name":"test-vault","public":true}'
```

Expected failure:

```json
{"error":{"code":"AUTH_FAILED","message":"admin session required"}}
```

First obtain a `muninn_session` cookie from the UI login endpoint, then send that cookie to the admin API.

Default local ports:

| Service | Default URL | Purpose |
|---|---|---|
| REST/admin API | `http://127.0.0.1:8475` | `/api/admin/vaults/...` management endpoints |
| Web UI/login API | `http://127.0.0.1:8476` | `/api/auth/login` creates the admin session cookie |

Login with curl and save cookies:

```bash
curl -sS -c muninn.cookies \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:8476/api/auth/login \
  -d '{"username":"root","password":"password"}'
```

Successful response:

```json
{"status":"ok"}
```

Then use the cookie jar against the REST/admin API:

```bash
curl -sS -b muninn.cookies \
  -H "Content-Type: application/json" \
  -X PUT http://127.0.0.1:8475/api/admin/vaults/config \
  -d '{"name":"test-vault","public":true}'
```

Response:

```json
{"name":"test-vault","public":true}
```

One-liner if you want to avoid a cookie file:

```bash
SESSION=$(curl -sS -i \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:8476/api/auth/login \
  -d '{"username":"root","password":"password"}' \
  | awk -F'[=;]' '/muninn_session=/ {print $2; exit}')

curl -sS \
  -H "Cookie: muninn_session=${SESSION}" \
  -H "Content-Type: application/json" \
  -X PUT http://127.0.0.1:8475/api/admin/vaults/config \
  -d '{"name":"test-vault","public":true}'
```

If your server is bound to different ports, adjust both URLs. The CLI follows the same split: `MUNINNDB_ADMIN_URL` points at the REST/admin API and `MUNINNDB_UI_URL` points at the login endpoint.

The non-admin list endpoint is an exception:

```http
GET /api/vaults
```

It uses the regular vault middleware and can be called by authenticated clients that are allowed to read vault metadata.

Admin endpoints use the admin middleware:

```http
/api/admin/vaults/...
```

They are intended for operators, the web UI, and the `muninn vault ...` CLI commands.

---

## Quick usage matrix

| Operation | HTTP API | CLI equivalent | Notes |
|---|---|---|---|
| List vaults | `GET /api/vaults` | `muninn vault list` | Merges engine-registered vaults with auth-config-only vaults. |
| Create vault / set access policy | `PUT /api/admin/vaults/config` | `muninn vault create <name> [--public]` | Writes `VaultConfig`; this is how empty vaults are registered. |
| Lock/open vault | `PUT /api/admin/vaults/config` | Web UI / direct API | `public:false` locks, `public:true` opens unauthenticated access. |
| Clear vault data | `POST /api/admin/vaults/{name}/clear` | `muninn vault clear <name>` | Removes engrams but keeps the vault name. |
| Delete vault | `DELETE /api/admin/vaults/{name}` | `muninn vault delete <name>` | Removes data, vault name registration, and auth config. |
| Rename vault | `POST /api/admin/vaults/{name}/rename` | `muninn vault rename <old> <new>` | Metadata-only; engram data is not rewritten. |
| Clone vault | `POST /api/admin/vaults/{name}/clone` | `muninn vault clone <src> <dst>` | Starts an async job. |
| Merge vault | `POST /api/admin/vaults/{name}/merge-into` | `muninn vault merge <src> <dst>` | Starts an async job. |
| Check async job | `GET /api/admin/vaults/{name}/job-status?job_id=...` | CLI polls automatically | Used by clone, merge, import, and re-embed jobs. |
| Export vault archive | `GET /api/admin/vaults/{name}/export` | `muninn vault export <name>` | Returns `.muninn` archive. |
| Import vault archive | `POST /api/admin/vaults/import?vault=<name>` | `muninn vault import <name>` | Starts an async import job. |
| Export Markdown | `GET /api/admin/vaults/{name}/export-markdown` | `muninn vault export-markdown <name>` | Returns Markdown export. |
| Reindex FTS | `POST /api/admin/vaults/{name}/reindex-fts` | `muninn vault reindex-fts <name>` | Rebuilds full-text index. |
| Re-embed vault | `POST /api/admin/vaults/{name}/reembed` | `muninn vault reembed <name>` | Starts background embedding refresh. |
| Vault plasticity | `GET/PUT /api/admin/vault/{name}/plasticity` | Web UI / direct API | Updates per-vault cognitive pipeline config. |

---

## List vaults

```bash
curl http://127.0.0.1:8475/api/vaults \
  -H "Authorization: Bearer mk_xK9m..."
```

Response:

```json
["default", "project-notes", "agent-memory"]
```

Implementation detail: the handler merges vault names from the engine with vault configs in the auth store. This is why a vault created through `PUT /api/admin/vaults/config` appears in the list even before it contains any engrams.

Code paths:

- Route: `internal/transport/rest/server.go`
- Handler: `handleListVaults`
- Engine: `Engine.ListVaults`
- Auth config merge: `auth.Store.ListVaultConfigs`

---

## Create a vault or update vault access policy

Use `PUT /api/admin/vaults/config`.

```bash
curl -X PUT http://127.0.0.1:8475/api/admin/vaults/config \
  -H "Content-Type: application/json" \
  -b muninn.cookies \
  -d '{
    "name": "project-notes",
    "public": false
  }'
```

Response:

```json
{
  "name": "project-notes",
  "public": false
}
```

The same endpoint also changes access policy:

```bash
# Open the vault: no API key required.
curl -X PUT http://127.0.0.1:8475/api/admin/vaults/config \
  -H "Content-Type: application/json" \
  -b muninn.cookies \
  -d '{"name":"project-notes","public":true}'

# Lock the vault: API key required.
curl -X PUT http://127.0.0.1:8475/api/admin/vaults/config \
  -H "Content-Type: application/json" \
  -b muninn.cookies \
  -d '{"name":"project-notes","public":false}'
```

Important behavior:

- New non-default vaults are fail-closed by default (`public:false`).
- The endpoint writes `auth.VaultConfig` into the auth store.
- It does not need to write an engram to make the vault visible in `GET /api/vaults`.
- Similar-name collisions return `409` with `code: "VAULT_NAME_COLLISION"` unless `?force=true` is supplied.

Collision override:

```bash
curl -X PUT 'http://127.0.0.1:8475/api/admin/vaults/config?force=true' \
  -H "Content-Type: application/json" \
  -b muninn.cookies \
  -d '{"name":"project_notes","public":false}'
```

CLI equivalent:

```bash
muninn vault create project-notes
muninn vault create public-notes --public
```

Code paths:

- Route: `PUT /api/admin/vaults/config`
- Handler: `handleSetVaultConfig`
- Auth type: `internal/auth/types.go` → `VaultConfig`
- Persistence: `internal/auth/vault_config.go` → `SetVaultConfig`
- CLI: `cmd/muninn/vault.go` → `runVaultCreate`
- Web UI: `web/static/js/app.js` → `submitNewVault`

---

## Clear a vault

Clear removes all engrams from the vault but keeps the vault registered.

```bash
curl -X POST http://127.0.0.1:8475/api/admin/vaults/project-notes/clear \
  -b muninn.cookies
```

Response: `204 No Content`

To clear the protected `default` vault, include the explicit confirmation header:

```bash
curl -X POST http://127.0.0.1:8475/api/admin/vaults/default/clear \
  -H "X-Allow-Default: true" \
  -b muninn.cookies
```

CLI equivalent:

```bash
muninn vault clear project-notes
muninn vault clear default --force
```

Code paths:

- Handler: `handleClearVault`
- Engine: `Engine.ClearVault`
- Storage lifecycle: `store.ClearVault`

---

## Delete a vault

Delete removes the vault data, vault name registration, and auth configuration.

```bash
curl -X DELETE http://127.0.0.1:8475/api/admin/vaults/project-notes \
  -b muninn.cookies
```

Response: `204 No Content`

Deleting `default` also requires `X-Allow-Default: true`:

```bash
curl -X DELETE http://127.0.0.1:8475/api/admin/vaults/default \
  -H "X-Allow-Default: true" \
  -b muninn.cookies
```

CLI equivalent:

```bash
muninn vault delete project-notes
muninn vault delete default --force
```

Important behavior:

- If a clone or merge job is actively targeting the vault, deletion returns `409`.
- If a vault exists only in auth config and has no engram data yet, the REST handler can still remove that config-only vault.

Code paths:

- Handler: `handleDeleteVault`
- Engine: `Engine.DeleteVault`
- Auth config cleanup: `auth.Store.DeleteVaultConfig`

---

## Rename a vault

```bash
curl -X POST http://127.0.0.1:8475/api/admin/vaults/project-notes/rename \
  -H "Content-Type: application/json" \
  -b muninn.cookies \
  -d '{"new_name":"research-notes"}'
```

Response:

```json
{
  "old_name": "project-notes",
  "new_name": "research-notes"
}
```

Important behavior:

- Rename is metadata-only; engram bodies are not rewritten.
- The storage vault name index is renamed.
- The auth `VaultConfig` is renamed if present.
- Similar-name collisions return `409` unless `?force=true` is supplied.

CLI equivalent:

```bash
muninn vault rename project-notes research-notes
```

Code paths:

- Handler: `handleRenameVault`
- Engine: `Engine.RenameVault`
- Auth config: `auth.Store.RenameVaultConfig`
- Web UI: `renameVault`

---

## Clone a vault

Clone starts an asynchronous job.

```bash
curl -X POST http://127.0.0.1:8475/api/admin/vaults/research-notes/clone \
  -H "Content-Type: application/json" \
  -b muninn.cookies \
  -d '{"new_name":"research-notes-copy"}'
```

Response:

```json
{
  "job_id": "42",
  "status": "running"
}
```

Poll job status:

```bash
curl 'http://127.0.0.1:8475/api/admin/vaults/research-notes/job-status?job_id=42' \
  -b muninn.cookies
```

CLI equivalent:

```bash
muninn vault clone research-notes research-notes-copy
```

Code paths:

- Handler: `handleCloneVault`
- Engine: `Engine.StartClone`
- Async jobs: `internal/engine/vaultjob`

---

## Merge vaults

Merge starts an asynchronous job that copies memories from a source vault into a target vault.

```bash
curl -X POST http://127.0.0.1:8475/api/admin/vaults/research-notes/merge-into \
  -H "Content-Type: application/json" \
  -b muninn.cookies \
  -d '{
    "target": "default",
    "delete_source": false
  }'
```

Response:

```json
{
  "job_id": "43",
  "status": "running"
}
```

CLI equivalent:

```bash
muninn vault merge research-notes default
muninn vault merge research-notes default --delete-source
```

Code paths:

- Handler: `handleMergeVault`
- Engine: `Engine.StartMerge`

---

## Export and import

Export a `.muninn` archive:

```bash
curl -L http://127.0.0.1:8475/api/admin/vaults/research-notes/export \
  -b muninn.cookies \
  -o research-notes.muninn
```

Import an archive into a target vault:

```bash
curl -X POST 'http://127.0.0.1:8475/api/admin/vaults/import?vault=imported-notes' \
  -b muninn.cookies \
  --data-binary @research-notes.muninn
```

Export as Markdown:

```bash
curl -L http://127.0.0.1:8475/api/admin/vaults/research-notes/export-markdown \
  -b muninn.cookies \
  -o research-notes.md
```

CLI equivalents:

```bash
muninn vault export research-notes -o research-notes.muninn
muninn vault import imported-notes research-notes.muninn
muninn vault export-markdown research-notes -o research-notes.md
```

Code paths:

- Export handler: `handleExportVault`
- Import handler: `handleImportVault`
- Markdown handler: `handleExportVaultMarkdown`
- Engine: `ExportVault`, `StartImport`

---

## Rebuild search/index state

Rebuild full-text search index:

```bash
curl -X POST http://127.0.0.1:8475/api/admin/vaults/research-notes/reindex-fts \
  -b muninn.cookies
```

Refresh embeddings:

```bash
curl -X POST http://127.0.0.1:8475/api/admin/vaults/research-notes/reembed \
  -b muninn.cookies
```

CLI equivalents:

```bash
muninn vault reindex-fts research-notes
muninn vault reembed research-notes
```

Code paths:

- FTS: `handleReindexFTSVault` → `Engine.ReindexFTSVault`
- Embeddings: `handleReembedVault` → `Engine.StartReembedVault`

---

## Per-vault plasticity

Plasticity controls how a vault learns and retrieves memory.

Get config:

```bash
curl http://127.0.0.1:8475/api/admin/vault/research-notes/plasticity \
  -b muninn.cookies
```

Update config:

```bash
curl -X PUT http://127.0.0.1:8475/api/admin/vault/research-notes/plasticity \
  -H "Content-Type: application/json" \
  -b muninn.cookies \
  -d '{
    "preset": "knowledge-graph",
    "temporal_halflife": 60,
    "traversal_profile": "causal"
  }'
```

Code paths:

- Handlers: `handleGetVaultPlasticity`, `handlePutVaultPlasticity`
- Storage: embedded inside `auth.VaultConfig.Plasticity`

---

## MCP and SDK notes

MCP does not expose vault CRUD tools. Its tools accept an optional `vault` parameter, or use a session-pinned vault. Examples include remember, recall, read, forget, link, traverse, and entity tools.

The Go SDK currently exposes `ListVaults()` for vault discovery through `GET /api/vaults`. Full admin lifecycle operations are available through the REST admin API and the CLI.

---

## Where to modify code

If you need to change vault management behavior, these are the usual files:

| Area | Files |
|---|---|
| REST route registration | `internal/transport/rest/server.go` |
| REST admin handlers | `internal/transport/rest/admin_handlers.go` |
| REST request/response types | `internal/transport/rest/types.go` |
| OpenAPI spec | `internal/transport/rest/openapi.yaml` |
| Core lifecycle | `internal/engine/engine_vault.go` |
| Clone/merge jobs | `internal/engine/engine_clone.go` |
| FTS rebuild | `internal/engine/engine_reindex_fts.go` |
| Embedding refresh | `internal/engine/engine_reembed.go` |
| Auth config model | `internal/auth/types.go` |
| Auth config persistence | `internal/auth/vault_config.go` |
| CLI commands | `cmd/muninn/vault.go` |
| Web UI calls | `web/static/js/app.js` |
| Go SDK list support | `sdk/go/muninn/client.go` |

When adding or changing REST endpoints, update `internal/transport/rest/openapi.yaml` as well.

---

## Recommended approach

- Use the CLI for day-to-day operations: `muninn vault create/list/delete/clear/rename/clone/merge/export/import/reindex-fts/reembed`.
- Use admin REST directly for automation and web UI integration.
- Use MCP only for memory operations inside a vault, not for vault lifecycle management.
- Treat `PUT /api/admin/vaults/config` as the canonical create/configure endpoint.
