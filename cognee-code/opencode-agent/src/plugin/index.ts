import type { Plugin } from "@opencode-ai/plugin";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const CONTEXT_MD_FILENAME = "Context.md";

const EMPTY_TEMPLATE = `# AGENT CONTEXT MEMORY

## [Section A: User-Defined Rules — PERMANENT]
<!-- Max 15 items. User-mandated behavioral constraints ("you must always...", "never...", "remember that...").
     These are COMMANDS, not preferences. NEVER delete unless user explicitly revokes. -->

## [Section B: Active Context — CURRENT TASK]
<!-- Max 10 items. The current goal, active files, decisions in progress, open questions.
     Reflector: REPLACE this section entirely based on the latest summary. -->

## [Section C: Experience Snapshots — ROLLING LOG]
<!-- Max 15 items. One-line factual conclusions from past work.
     Reflector: ADD new entries at the top. If count exceeds 15, DELETE the oldest entry. -->

## [Section D: User Profile — BACKGROUND]
<!-- Max 12 items. Facts about the user: tech stack, preferences, working style.
     Format: <category>: <fact>
     Reflector: UPSERT by category key. -->
`;

export const CogneeMemoryPlugin: Plugin = async (input) => {
    return {
        async event({ event }) {
            if (event.type !== "session.compacted") return;

            const sessionID = (event.properties as { sessionID: string }).sessionID;
            const contextMdPath = `${input.worktree}/${CONTEXT_MD_FILENAME}`;

            try {
                // Get messages via SDK
                const messagesResp = await input.client.session.messages({
                    path: { id: sessionID },
                });
                const messageList: Array<{ info: any; parts: Array<any> }> =
                    (messagesResp as any)?.data ?? (Array.isArray(messagesResp) ? messagesResp : []);

                // Find the summary message (last assistant message with summary=true)
                const summaryMsg = [...messageList]
                    .reverse()
                    .find((m) => m.info?.role === "assistant" && m.info?.summary === true);

                if (!summaryMsg) return;

                const summaryText = summaryMsg.parts
                    .filter((p: any) => p.type === "text")
                    .map((p: any) => p.text ?? "")
                    .join("\n")
                    .trim();

                if (!summaryText) return;

                // Read existing Context.md or use empty template
                const existing = existsSync(contextMdPath)
                    ? readFileSync(contextMdPath, "utf8")
                    : EMPTY_TEMPLATE;

                const updatePrompt = [
                    `You are a memory archivist. Update the Context.md file based on the compaction summary below.`,
                    ``,
                    `## Current Context.md content:`,
                    `\`\`\``,
                    existing,
                    `\`\`\``,
                    ``,
                    `## Compaction Summary:`,
                    summaryText,
                    ``,
                    `## Rules:`,
                    `- Section A (max 15): User-mandated rules. Only add/replace, never delete unless user revokes.`,
                    `- Section B (max 10): REPLACE entirely with current task state from summary.`,
                    `- Section C (max 15): ADD 1-3 new factual conclusions at top. Drop oldest if > 15.`,
                    `- Section D (max 12): UPSERT facts by category key.`,
                    ``,
                    `Output ONLY the complete updated file contents, nothing else.`,
                ].join("\n");

                // Create ephemeral session for the update
                const newSessionResp = await input.client.session.create({});
                const newSessionID: string =
                    (newSessionResp as any)?.data?.id ?? (newSessionResp as any)?.id;
                if (!newSessionID) return;

                try {
                    const result = await input.client.session.prompt({
                        path: { id: newSessionID },
                        body: {
                            model: { providerID: "github-copilot", modelID: "claude-sonnet-4.6" },
                            parts: [{ type: "text", text: updatePrompt }],
                        },
                    });

                    const parts: Array<any> =
                        (result as any)?.data?.parts ?? (result as any)?.parts ?? [];
                    const updatedContent = parts
                        .filter((p: any) => p.type === "text")
                        .map((p: any) => p.text ?? "")
                        .join("");

                    if (updatedContent.includes("# AGENT CONTEXT MEMORY")) {
                        writeFileSync(contextMdPath, updatedContent, "utf8");
                    }
                } finally {
                    await input.client.session
                        .delete({ path: { id: newSessionID } })
                        .catch(() => {});
                }
            } catch (e) {
                console.error("[CogneeMemoryPlugin] Failed to update Context.md:", e);
            }
        },
    };
};

export default CogneeMemoryPlugin;
