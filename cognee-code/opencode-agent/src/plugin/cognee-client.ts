const COGNEE_BASE_URL = process.env.COGNEE_API_URL ?? "http://localhost:8000"
const COGNEE_EMAIL = process.env.COGNEE_API_EMAIL ?? "default_user@example.com"
const COGNEE_PASSWORD = process.env.COGNEE_API_PASSWORD ?? "default_password"
const COOKIE_NAME = process.env.AUTH_TOKEN_COOKIE_NAME ?? "auth_token"

// Cached auth cookie — no TTL, re-acquired only on 401
let _cachedCookie: string | null = null

async function login(): Promise<string | null> {
  try {
    const resp = await fetch(`${COGNEE_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: COGNEE_EMAIL, password: COGNEE_PASSWORD }).toString(),
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return null
    // Extract the auth cookie from Set-Cookie header
    const setCookie = resp.headers.get("set-cookie") ?? ""
    const match = setCookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
    _cachedCookie = match ? `${COOKIE_NAME}=${match[1]}` : null
    return _cachedCookie
  } catch {
    return null
  }
}

async function getCookie(): Promise<string | null> {
  if (_cachedCookie) return _cachedCookie
  return login()
}

/**
 * Authenticated fetch using cookie transport.
 * Automatically re-logs in once on 401.
 */
async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const cookie = await getCookie()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
  }
  let resp = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(5000) })
  if (resp.status === 401) {
    _cachedCookie = null
    const newCookie = await login()
    const retryHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(newCookie ? { Cookie: newCookie } : {}),
    }
    resp = await fetch(url, { ...init, headers: retryHeaders, signal: AbortSignal.timeout(5000) })
  }
  return resp
}

export interface ProjectItem {
  id: string
  name: string
  type: string
  remote_url: string | null
  local_path: string | null
  opencode_project_id: string | null
  dataset_id: string
}

export interface RuleItem {
  id: string
  text: string
}

/** Get coding rules for a specific project */
export async function getRulesByProjectId(projectId: string): Promise<RuleItem[]> {
  const url = `${COGNEE_BASE_URL}/api/v1/rules?project_id=${projectId}`
  const resp = await apiFetch(url)
  if (!resp.ok) return []
  return resp.json()
}

/**
 * Save an explicit list of coding rules directly to the project's knowledge graph.
 * Calls POST /api/v1/rules/save — no LLM involved, pure persistence.
 */
export async function saveRules(rules: string[], projectId: string): Promise<void> {
  const url = `${COGNEE_BASE_URL}/api/v1/rules/save`
  await apiFetch(url, {
    method: "POST",
    body: JSON.stringify({ rules, project_id: projectId }),
  })
}

// Sections to keep when learning from a compaction summary.
// Only Discoveries and Instructions contain durable technical knowledge.
const KNOWLEDGE_SECTIONS = new Set(["## Discoveries", "## Instructions"])

// Sections to drop — task progress and file lists are transient noise.
const SKIP_SECTIONS = new Set(["## Goal", "## Accomplished", "## Relevant files / directories", "## Explicit Coding Rules"])

/**
 * Filter a compaction summary to keep only knowledge-relevant sections.
 * Keeps: ## Discoveries, ## Instructions
 * Drops: ## Goal, ## Accomplished, ## Relevant files / directories, ## Explicit Coding Rules
 */
function extractKnowledgeSections(summary: string): string {
  const lines = summary.split("\n")
  const kept: string[] = []
  let keep = false

  for (const line of lines) {
    const stripped = line.trim()
    if (stripped.startsWith("## ")) {
      const matchKeep = [...KNOWLEDGE_SECTIONS].some((s) => stripped.startsWith(s))
      const matchSkip = [...SKIP_SECTIONS].some((s) => stripped.startsWith(s))
      keep = matchKeep && !matchSkip
    }
    if (keep) kept.push(line)
  }
  return kept.join("\n").trim()
}

// Prompt guiding cognify's LLM to extract non-obvious technical learnings.
// Scoped to session notes (no file context), so file-specific examples are excluded.
const SESSION_LEARN_PROMPT = `Extract non-obvious, reusable technical learnings from the provided session notes.

Focus only on:
- Hidden relationships between modules, components, or systems
- Execution paths or behaviors that differ from how the code appears
- Non-obvious configuration, environment variables, or feature flags
- Debugging breakthroughs where error messages were misleading
- API or tool quirks and their workarounds
- Architectural decisions and constraints that affect how to extend the system
- Components or modules that must always be changed together

Do NOT include:
- Obvious facts from documentation
- Standard language or framework behavior
- Session-specific task progress or status updates
- Verbose narrative explanations
- Anything that only makes sense in the context of a single task`

/**
 * Extract non-obvious learnings from a compaction summary and store them in the
 * project's knowledge graph. Runs asynchronously on the backend (fire-and-forget).
 * Calls POST /api/v1/knowledge/learn.
 * Only sends ## Discoveries and ## Instructions sections — filters out transient progress info.
 */
export async function learnFromSummary(summaryText: string, projectId: string): Promise<void> {
  const knowledgeText = extractKnowledgeSections(summaryText)
  if (!knowledgeText) return

  const url = `${COGNEE_BASE_URL}/api/v1/knowledge/learn`
  await apiFetch(url, {
    method: "POST",
    body: JSON.stringify({
      summary: knowledgeText,
      project_id: projectId,
      custom_prompt: SESSION_LEARN_PROMPT,
    }),
  })
}

/**
 * Look up the cognee-code Project matching the given OpenCode project id.
 * OpenCode's project.id is derived from the root git commit hash,
 * so it's stable across branches and worktrees of the same repository.
 */
export async function resolveProject(opencodeProjectId: string): Promise<ProjectItem | null> {
  const url = `${COGNEE_BASE_URL}/api/v1/projects?opencode_project_id=${encodeURIComponent(opencodeProjectId)}`
  const resp = await apiFetch(url)
  if (!resp.ok) return null
  const projects: ProjectItem[] = await resp.json()
  return projects[0] ?? null
}

