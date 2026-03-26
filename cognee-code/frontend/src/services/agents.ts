import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import type {
  Event,
  UserMessage,
  AssistantMessage,
  TextPart,
  ToolPart,
  ReasoningPart,
  QuestionRequest,
  PermissionRequest,
  QuestionAnswer,
  TextPartInput,
} from '@opencode-ai/sdk/v2';

// ── Constants ──────────────────────────────────────────────────────────────────

const OPENCODE_BASE_URL = import.meta.env.VITE_OPENCODE_URL ?? 'http://localhost:4097';
export const AGENT_NAME = 'cognee-coder';

// ── Types ──────────────────────────────────────────────────────────────────────

export type { UserMessage, AssistantMessage };

export type DisplayPart = TextPart | ToolPart | ReasoningPart;

export interface SessionItem {
  id: string;
  title: string;
  time: Date;
}

/** Shape of each entry returned by client.session.messages */
export type RawMessageEntry = {
  info: (UserMessage | AssistantMessage) & { time?: { created?: number } };
  parts: DisplayPart[];
};

// ── SDK Client (single shared v2 instance) ────────────────────────────────────

export const opencodeClient = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });

// ── Session operations ─────────────────────────────────────────────────────────

export const AgentService = {
  // ── Session CRUD ──────────────────────────────────────────────────────────

  async createSession(): Promise<SessionItem> {
    const res = await opencodeClient.session.create({});
    const session = (res.data ?? res) as { id: string; title?: string; time?: { created?: number } };
    return {
      id: session.id,
      title: session.title ?? 'Untitled',
      time: new Date(session.time?.created ?? Date.now()),
    };
  },

  async listSessions(): Promise<SessionItem[]> {
    const res = await opencodeClient.session.list({ roots: true });
    const list = (res.data ?? []) as { id: string; title?: string; time?: { created?: number } }[];
    return list
      .map(s => ({
        id: s.id,
        title: s.title ?? 'Untitled',
        time: new Date(s.time?.created ?? Date.now()),
      }))
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  },

  async deleteSession(sessionId: string): Promise<void> {
    await opencodeClient.session.delete({ sessionID: sessionId });
  },

  // ── Message operations ────────────────────────────────────────────────────

  async loadMessages(sessionId: string): Promise<RawMessageEntry[]> {
    const res = await opencodeClient.session.messages({ sessionID: sessionId });
    return (res.data ?? []) as RawMessageEntry[];
  },

  async promptAsync(sessionId: string, parts: TextPartInput[]): Promise<void> {
    await opencodeClient.session.promptAsync({
      sessionID: sessionId,
      agent: AGENT_NAME,
      parts,
    });
  },

  async abort(sessionId: string): Promise<void> {
    await opencodeClient.session.abort({ sessionID: sessionId });
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
