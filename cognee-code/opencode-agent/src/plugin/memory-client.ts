/**
 * cognee Python Backend HTTP client for the OpenCode Plugin.
 * Wraps all cognee memory API calls with timeout and error handling.
 */

const COGNEE_BASE_URL = process.env.COGNEE_API_URL ?? "http://localhost:8000"
const COGNEE_TOKEN = process.env.COGNEE_API_TOKEN

export interface MemorySearchResult {
  content: string
  score?: number
  metadata?: Record<string, unknown>
}

export class CogneeMemoryClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(baseUrl = COGNEE_BASE_URL, token?: string) {
    this.baseUrl = baseUrl
    this.headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  /** Semantic search over the knowledge graph. Used before every LLM call. */
  async search(
    query: string,
    options?: {
      searchType?: "GRAPH_COMPLETION" | "SUMMARIES" | "CHUNKS"
      datasets?: string[]
      limit?: number
    },
  ): Promise<MemorySearchResult[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/search`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          query,
          search_type: options?.searchType ?? "GRAPH_COMPLETION",
          datasets: options?.datasets,
        }),
        signal: AbortSignal.timeout(3000),
      })
      if (!resp.ok) return []
      const data = await resp.json()
      const results: MemorySearchResult[] = Array.isArray(data) ? data : []
      return results.slice(0, options?.limit ?? 5)
    } catch {
      return []
    }
  }

  /** Read all long-term AI memory (coding rules, project conventions). */
  async readMemory(): Promise<string> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/memory`, {
        headers: this.headers,
        signal: AbortSignal.timeout(3000),
      })
      if (!resp.ok) return ""
      const data = await resp.json()
      return typeof data === "string" ? data : JSON.stringify(data)
    } catch {
      return ""
    }
  }

  /** Write a long-term memory entry (coding rule, convention). */
  async writeMemory(content: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/v1/memory`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      // Fire-and-forget; failures are silent
    }
  }

  /** Add text/code to the knowledge graph (async pipeline). */
  async cognify(text: string, datasetName = "agent-memory"): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/v1/add`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ text, dataset_name: datasetName }),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      // Fire-and-forget
    }
  }

  /** Save an interaction and extract reusable coding rules. */
  async saveInteraction(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/v1/interactions`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          session_id: sessionId,
          user_message: userMessage,
          assistant_response: assistantResponse,
        }),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      // Fire-and-forget
    }
  }
}

export const memoryClient = new CogneeMemoryClient(COGNEE_BASE_URL, COGNEE_TOKEN)
