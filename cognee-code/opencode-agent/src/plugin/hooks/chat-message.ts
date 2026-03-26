import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { getRulesByProjectId, resolveProject, saveRules, learnFromSummary } from "../cognee-client"

// Sessions that have already had rules injected — no need to repeat
const injectedSessions = new Set<string>()

/**
 * Parse explicit coding rules from the compaction summary text.
 * Looks for a trailing "## Explicit Coding Rules" section and extracts
 * each list item as a rule string.
 */
function parseExplicitRules(summaryText: string): string[] {
  const marker = "## Explicit Coding Rules"
  const idx = summaryText.lastIndexOf(marker)
  if (idx === -1) return []

  const section = summaryText.slice(idx + marker.length).trim()
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
}

/**
 * Create the event hook.
 * - session.deleted: clean up injectedSessions to free memory
 * - session.compacted: parse explicit rules from the summary and save them directly
 */
export function createEventHook(
  client: PluginInput["client"],
  opencodeProjectId: string,
): NonNullable<Hooks["event"]> {
  return async ({ event }) => {
    if (event.type === "session.deleted") {
      injectedSessions.delete(event.properties.info.id)
    } else if (event.type === "session.compacted") {
      const sessionID = event.properties.sessionID
      injectedSessions.delete(sessionID)

      // Parse explicit rules from the compaction summary and save directly (no LLM)
      try {
        const project = await resolveProject(opencodeProjectId)
        if (!project) return

        const result = await client.session.messages({ path: { id: sessionID } })
        if (!result.data) return

        // Find the last completed summary (compaction) assistant message
        const summaryMsg = [...result.data].reverse().find(
          (m) =>
            m.info.role === "assistant" &&
            (m.info as any).summary === true &&
            (m.info as any).finish !== undefined,
        )
        if (!summaryMsg) return

        // Extract text content from the summary message parts
        const summaryText = summaryMsg.parts
          .filter((p): p is typeof p & { type: "text"; text: string } => p.type === "text" && "text" in p)
          .map((p) => p.text)
          .join("\n")
          .trim()

        if (!summaryText) return

        // 1. Parse explicit coding rules from the structured trailing section
        const rules = parseExplicitRules(summaryText)
        if (rules.length > 0) {
          await saveRules(rules, project.id)
        }

        // 2. Fire-and-forget knowledge learning from the summary (backend handles async LLM extraction)
        await learnFromSummary(summaryText, project.id)
      } catch {
        await client.tui
          .showToast({
            body: {
              title: "Cognee",
              message: "Failed to save rules from session summary",
              variant: "warning",
              duration: 3000,
            },
          })
          .catch(() => {})
      }
    }
  }
}

/**
 * Create the experimental.session.compacting hook.
 * Appends a format directive to the compaction prompt so the LLM will emit
 * any user-specified coding rules in a parseable trailing section.
 */
export function createCompactingHook(): NonNullable<Hooks["experimental.session.compacting"]> {
  return async (_input, output) => {
    output.context.push(
      [
        "## Coding Rules Extraction",
        "If the user has explicitly specified any coding rules during this conversation",
        '(e.g. "always do X", "never use Y", "rule: Z"), list them at the very end of',
        "your summary under the following section — and only if there are such rules:",
        "",
        "## Explicit Coding Rules",
        "- <rule 1>",
        "- <rule 2>",
        "",
        "Do NOT infer or invent rules. Only include rules the user stated directly.",
      ].join("\n"),
    )
  }
}

/**
 * Create the chat.message hook.
 * On the first user message of each session, injects project coding rules
 * (hard constraints) and a dataset search hint into message.system.
 * Subsequent messages in the same session are skipped.
 */
export function createChatMessageHook(
  opencodeProjectId: string,
): NonNullable<Hooks["chat.message"]> {
  return async (input, output) => {
    const sessionID = input.sessionID
    if (injectedSessions.has(sessionID)) return

    try {
      const project = await resolveProject(opencodeProjectId)
      if (!project) return // project not registered in cognee-code

      const items = await getRulesByProjectId(project.id)
      const rules = items.map((r) => r.text)

      const parts: string[] = []

      if (rules.length > 0) {
        parts.push(
          [
            "## Coding Rules (MUST follow)",
            "The following rules are mandatory for this project. Apply them to all code you generate:",
            ...rules.map((r, i) => `${i + 1}. ${r}`),
          ].join("\n"),
        )
      }

      parts.push(
        [
          "## Knowledge Base",
          `Project: ${project.name} (dataset: ${project.name})`,
          `Use the \`search\` MCP tool to query project knowledge: search(search_query="...", search_type="GRAPH_COMPLETION", datasets=["${project.name}"])`,
        ].join("\n"),
      )

      output.message.system = (output.message.system ? output.message.system + "\n\n" : "") + parts.join("\n\n")
      injectedSessions.add(sessionID)
    } catch {
      // fail silently — never block LLM calls
    }
  }
}
