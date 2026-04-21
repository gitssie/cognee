import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import type {
  Agent,
  AgentPartInput,
  Event,
  FilePartInput,
  Part,
  Session,
  UserMessage,
  AssistantMessage,
  Command,
  QuestionRequest,
  PermissionRequest,
  QuestionAnswer,
  Todo,
  TextPartInput,
} from '@opencode-ai/sdk/v2';

// ── Constants ──────────────────────────────────────────────────────────────────

const OPENCODE_BASE_URL = (import.meta.env.VITE_OPENCODE_URL ?? '/opencode').replace(/\/+$/, '');
export const AGENT_NAME = 'cognee-coder';

// ── Types ──────────────────────────────────────────────────────────────────────

export type { UserMessage, AssistantMessage };

export type DisplayPart = Part;

export interface SessionItem {
  id: string;
  title: string;
  time: Date;
  parentID?: string;
  revert?: Session['revert'];
}

export interface PromptOptions {
  model?: {
    providerID: string;
    modelID: string;
  };
  messageID?: string;
  variant?: string;
  system?: string;
  tools?: Record<string, boolean>;
  noReply?: boolean;
}

export type PromptPartInput = TextPartInput | AgentPartInput | FilePartInput;

/** Shape of each entry returned by client.session.messages */
export type RawMessageEntry = {
  info: (UserMessage | AssistantMessage) & { time?: { created?: number } };
  parts: DisplayPart[];
};

// ── SDK Client (single shared v2 instance) ────────────────────────────────────

export const opencodeClient = createOpencodeClient({
  baseUrl: OPENCODE_BASE_URL,
  throwOnError: true,
});

// ── Session operations ─────────────────────────────────────────────────────────

export const AgentService = {
  mapSession(session: { id: string; title?: string; parentID?: string; time?: { created?: number }; revert?: Session['revert'] }): SessionItem {
    return {
      id: session.id,
      title: session.title ?? 'Untitled',
      time: new Date(session.time?.created ?? Date.now()),
      ...(session.parentID ? { parentID: session.parentID } : {}),
      ...(session.revert ? { revert: session.revert } : {}),
    };
  },

  // ── Session CRUD ──────────────────────────────────────────────────────────

  async createSession(): Promise<SessionItem> {
    const res = await opencodeClient.session.create({});
    const session = (res.data ?? res) as { id: string; title?: string; time?: { created?: number } };
    return this.mapSession(session);
  },

  async listSessions(): Promise<SessionItem[]> {
    const res = await opencodeClient.session.list({ roots: true });
    const list = (res.data ?? []) as { id: string; title?: string; time?: { created?: number } }[];
    return list
      .map((s) => this.mapSession(s))
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  },

  async deleteSession(sessionId: string): Promise<void> {
    await opencodeClient.session.delete({ sessionID: sessionId });
  },

  async getSession(sessionId: string): Promise<SessionItem> {
    const res = await opencodeClient.session.get({ sessionID: sessionId });
    const session = (res.data ?? res) as Session;
    return this.mapSession(session);
  },

  // ── Message operations ────────────────────────────────────────────────────

  async loadMessages(sessionId: string, options?: { limit?: number; before?: string }): Promise<RawMessageEntry[]> {
    const res = await opencodeClient.session.messages({
      sessionID: sessionId,
      ...(options?.limit ? { limit: options.limit } : {}),
      ...(options?.before ? { before: options.before } : {}),
    });
    return (res.data ?? []) as RawMessageEntry[];
  },

  async loadTodos(sessionId: string): Promise<Todo[]> {
    const res = await opencodeClient.session.todo({ sessionID: sessionId });
    return res.data ?? [];
  },

  async listCommands(): Promise<Command[]> {
    const res = await opencodeClient.command.list();
    return ((res as { data?: Command[] }).data ?? []);
  },

  async listAgents(): Promise<Agent[]> {
    const res = await opencodeClient.app.agents();
    return ((res as { data?: Agent[] }).data ?? []);
  },

  async promptAsync(sessionId: string, parts: PromptPartInput[], options?: PromptOptions): Promise<void> {
    await opencodeClient.session.promptAsync({
      sessionID: sessionId,
      agent: AGENT_NAME,
      ...(options?.messageID ? { messageID: options.messageID } : {}),
      parts,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.variant ? { variant: options.variant } : {}),
      ...(options?.system ? { system: options.system } : {}),
      ...(options?.tools ? { tools: options.tools } : {}),
      ...(options?.noReply !== undefined ? { noReply: options.noReply } : {}),
    });
  },

  async runCommand(sessionId: string, command: string, args: string, options?: Omit<PromptOptions, 'system' | 'tools' | 'noReply'> & { parts?: FilePartInput[] }): Promise<void> {
    await opencodeClient.session.command({
      sessionID: sessionId,
      command,
      arguments: args,
      agent: AGENT_NAME,
      ...(options?.parts?.length ? { parts: options.parts } : {}),
      ...(options?.model ? { model: `${options.model.providerID}/${options.model.modelID}` } : {}),
      ...(options?.variant ? { variant: options.variant } : {}),
    });
  },

  async abort(sessionId: string): Promise<void> {
    await opencodeClient.session.abort({ sessionID: sessionId });
  },

  async revertMessage(sessionId: string, messageId: string, partId?: string): Promise<void> {
    await opencodeClient.session.revert({
      sessionID: sessionId,
      messageID: messageId,
      ...(partId ? { partID: partId } : {}),
    });
  },

  async unrevert(sessionId: string): Promise<void> {
    await opencodeClient.session.unrevert({ sessionID: sessionId });
  },

  // ── Compact (summarize) ───────────────────────────────────────────────────

  /**
   * Finds the providerID/modelID from the last assistant message in the session,
   * then calls summarize. Throws if model info cannot be determined.
   */
  async compact(sessionId: string): Promise<void> {
    const res = await opencodeClient.session.messages({ sessionID: sessionId });
    const msgs = (res.data ?? []) as { info: { role?: string; providerID?: string; modelID?: string } }[];
    const lastAsst = [...msgs].reverse().find(m => m.info?.role === 'assistant' && m.info?.providerID);

    if (!lastAsst?.info?.providerID || !lastAsst?.info?.modelID) {
      throw new Error('Cannot determine model for compaction — send a message first');
    }

    await opencodeClient.session.summarize({
      sessionID: sessionId,
      providerID: lastAsst.info.providerID,
      modelID: lastAsst.info.modelID,
    });
  },

  // ── SSE event subscription ────────────────────────────────────────────────

  /**
   * Opens the OpenCode SSE event stream.
   * Returns the async iterable so the caller can iterate with `for await`.
   */
  async subscribeToEvents(): Promise<AsyncIterable<Event>> {
    const result = await opencodeClient.event.subscribe();
    return result.stream as AsyncIterable<Event>;
  },

  // ── Question / Permission ─────────────────────────────────────────────────

  async listPendingQuestions(): Promise<QuestionRequest[]> {
    const res = await opencodeClient.question.list();
    return ((res as { data?: QuestionRequest[] }).data ?? []);
  },

  async listPendingPermissions(): Promise<PermissionRequest[]> {
    const res = await opencodeClient.permission.list();
    return ((res as { data?: PermissionRequest[] }).data ?? []);
  },

  async replyToQuestion(requestID: string, answers: QuestionAnswer[]): Promise<void> {
    await opencodeClient.question.reply({ requestID, answers });
  },

  async rejectQuestion(requestID: string): Promise<void> {
    await opencodeClient.question.reject({ requestID });
  },

  async replyToPermission(requestID: string, reply: 'once' | 'always' | 'reject'): Promise<void> {
    await opencodeClient.permission.reply({ requestID, reply });
  },
};
