/**
 * Ambient type declarations for opencode internal modules.
 * Build-time stubs — real implementations resolved at runtime inside the opencode bun process.
 */

// ── opencode/session/message-v2 ──────────────────────────────────────────────
declare module "opencode/session/message-v2" {
  export interface TextPart {
    type: "text"
    id: string
    sessionID: string
    messageID: string
    text: string
    synthetic?: boolean
    ignored?: boolean
  }

  export interface CompactionPart {
    type: "compaction"
    id: string
    sessionID: string
    messageID: string
    auto: boolean
  }

  export type Part = TextPart | CompactionPart | { type: string; [key: string]: unknown }

  export interface UserInfo {
    role: "user"
    id: string
    sessionID: string
    model: { providerID: string; modelID: string }
    agent: string
    variant?: string
  }

  export interface AssistantInfo {
    role: "assistant"
    id: string
    sessionID: string
    parentID: string
    summary?: boolean
    finish?: string
    agent?: string
    mode?: string
    modelID: string
    providerID: string
  }

  export type Info = UserInfo | AssistantInfo

  export interface WithParts {
    info: Info
    parts: Part[]
  }

  export type User = UserInfo & {
    time: { created: number }
    system?: string
    tools?: Record<string, boolean>
  }

  export type Assistant = AssistantInfo & {
    cost: number
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    time: { created: number; completed?: number }
    error?: any
  }

  export const MessageV2: {
    stream(sessionID: string): AsyncIterable<WithParts>
    filterCompacted(stream: AsyncIterable<WithParts>): Promise<WithParts[]>
    toModelMessages(messages: WithParts[], model: any): any[]
  }

  export namespace MessageV2 {
    export type { TextPart, CompactionPart, Part, UserInfo, AssistantInfo, Info, WithParts, User, Assistant }
  }
}

// ── opencode/session ─────────────────────────────────────────────────────────
declare module "opencode/session" {
  import type { MessageV2 } from "opencode/session/message-v2"

  export const Session: {
    updateMessage(msg: Record<string, any>): Promise<Record<string, any>>
    updatePart(part: Record<string, any>): Promise<Record<string, any>>
    messages(input: { sessionID: string; limit?: number }): Promise<MessageV2.WithParts[]>
  }
}

// ── opencode/session/processor ───────────────────────────────────────────────
declare module "opencode/session/processor" {
  import type { MessageV2 } from "opencode/session/message-v2"

  export const SessionProcessor: {
    create(input: {
      assistantMessage: MessageV2.Assistant
      sessionID: string
      model: any
      abort: AbortSignal
    }): {
      message: MessageV2.Assistant
      process(input: {
        user: MessageV2.User
        agent: any
        abort: AbortSignal
        sessionID: string
        tools: Record<string, any>
        system: string[]
        messages: any[]
        model: any
        toolChoice?: "auto" | "required" | "none"
      }): Promise<"continue" | "compact" | "stop">
    }
  }
}

// ── opencode/provider/provider ───────────────────────────────────────────────
declare module "opencode/provider/provider" {
  export const Provider: {
    getModel(providerID: string, modelID: string): Promise<any>
    defaultModel(): Promise<{ providerID: string; modelID: string }>
  }
}

// ── opencode/project/instance ────────────────────────────────────────────────
declare module "opencode/project/instance" {
  export const Instance: {
    worktree: string
    directory: string
  }
}

// ── opencode/id/id ───────────────────────────────────────────────────────────
declare module "opencode/id/id" {
  export const Identifier: {
    ascending(prefix: string): string
  }
}

// ── opencode/agent/agent ─────────────────────────────────────────────────────
declare module "opencode/agent/agent" {
  export interface AgentInfo {
    name: string
    description?: string
    mode: "subagent" | "primary" | "all"
    prompt?: string
    model?: { providerID: string; modelID: string }
    temperature?: number
    steps?: number
    permission?: Record<string, any>
    options?: Record<string, any>
  }

  export const Agent: {
    get(name: string): Promise<AgentInfo | undefined>
    defaultAgent(): Promise<string>
  }
}

// ── opencode/tool/read ────────────────────────────────────────────────────────
declare module "opencode/tool/read" {
  export const ReadTool: { id: string; init(ctx?: any): Promise<any> }
}

// ── opencode/tool/write ───────────────────────────────────────────────────────
declare module "opencode/tool/write" {
  export const WriteTool: { id: string; init(ctx?: any): Promise<any> }
}

// ── opencode/tool/edit ────────────────────────────────────────────────────────
declare module "opencode/tool/edit" {
  export const EditTool: { id: string; init(ctx?: any): Promise<any> }
}

// ── ai (Vercel AI SDK) ────────────────────────────────────────────────────────
declare module "ai" {
  export function tool(input: {
    description: string
    inputSchema: any
    execute(args: any, opts: any): Promise<any>
  }): any

  export function jsonSchema(schema: any): any
}
