import type { Plugin } from "@opencode-ai/plugin"
import { createChatMessageHook, createCompactingHook, createEventHook } from "./hooks/chat-message"

export const CogneeProjectPlugin: Plugin = async (input) => {
  console.log("[CogneeProjectPlugin] Init, directory:", input.directory)
  return {
    event: createEventHook(input.client, input.project.id),
    "chat.message": createChatMessageHook(input.project.id),
    "experimental.session.compacting": createCompactingHook(),
  }
}

export default CogneeProjectPlugin
