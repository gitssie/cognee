import { ref, computed, nextTick, watch } from 'vue';
import type {
  AgentPartInput,
  Event,
  FilePartInput,
  Part,
  Todo,
  UserMessage,
  AssistantMessage,
  QuestionRequest,
  PermissionRequest,
  QuestionAnswer,
  ToolPart,
  ToolStateRunning,
  TextPartInput,
} from '@opencode-ai/sdk/v2';
import { AgentService } from 'src/services/agents';
import type { DisplayPart, PromptPartInput, RawMessageEntry, SessionItem } from 'src/services/agents';
import { KnowledgeService } from 'src/services/knowledge';
import type { Dataset } from 'src/services/knowledge';
import { idGenerator } from 'src/utils/id';

const SKIPPED_ASSISTANT_PART_TYPES = new Set(['patch', 'step-start', 'step-finish']);
const STREAMED_TEXT_FIELDS = new Set(['text', 'reasoning_content', 'reasoning_details']);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  time: Date;
  parts: DisplayPart[];
  /** The raw SDK message that originated this display entry (last write wins) */
  info?: UserMessage | AssistantMessage;
}

export interface SessionMessageCache {
  info: UserMessage | AssistantMessage;
  parts: DisplayPart[];
}

export interface PendingAttachment {
  id: string;
  name: string;
  mime: string;
  url: string;
}

export interface QueuedFollowup {
  id: string;
  sessionId: string;
  text: string;
  attachments: PendingAttachment[];
  datasetIds: string[];
}

const OPTIMISTIC_PART_ID_PREFIX = 'optimistic:';

// ── Composable ────────────────────────────────────────────────────────────────

export function useAgentSession(
  scrollToBottomNow: () => void,
  scrollIfAtBottom: () => void,
  notifyError: (msg: string) => void,
  notifyInfo: (msg: string, opts?: { icon?: string; timeout?: number }) => void,
  notifySuccess: (msg: string) => void,
  focusInput: () => void,
) {
  // ── Chat state ──────────────────────────────────────────────────────────────

  const displayMessages = ref<DisplayMessage[]>([]);
  const historyExhausted = ref(false);
  const inputMessage = ref('');
  const isLoading = ref(false);
  const isConnected = ref(false);
  const sessionId = ref<string | null>(null);
  const sessionStatus = ref<'idle' | 'busy' | 'retry'>('idle');

  // ── Session list ────────────────────────────────────────────────────────────

  const sessionList = ref<SessionItem[]>([]);
  const childSessions = ref<Record<string, SessionItem[]>>({});
  const sessionMessages = ref<Record<string, SessionMessageCache[]>>({});
  const availableCommands = ref<string[]>([]);
  const availableAgents = ref<string[]>([]);

  // ── Dataset state ───────────────────────────────────────────────────────────

  const datasets = ref<Dataset[]>([]);
  const selectedDatasets = ref<string[]>([]);
  const pendingAttachments = ref<PendingAttachment[]>([]);
  const queuedFollowups = ref<Record<string, QueuedFollowup[]>>({});
  const failedFollowupId = ref<Record<string, string | undefined>>({});
  const pausedFollowups = ref<Record<string, boolean | undefined>>({});
  const sendingFollowupId = ref<string | null>(null);
  /** Snapshot of selectedDatasets at the time of the last injection; null means "needs inject" */
  let lastInjectedDatasets: string[] | null = null;

  // ── Internal bookkeeping ────────────────────────────────────────────────────

  let sseAbort: AbortController | null = null;

  /** Per-part accumulated delta text */
  const partText = ref<Map<string, string>>(new Map());
  const historyLoading = ref(false);

  const pendingQuestion = ref<QuestionRequest | null>(null);
  const pendingPermission = ref<PermissionRequest | null>(null);
  const sessionTodos = ref<Todo[]>([]);

  /**
   * The most recent UserMessage received in the active session.
   * Used to group all assistant output for the same user turn and to
   * accept permission/question requests from sub-sessions.
   */
  const curUserMessage = ref<UserMessage | null>(null);

  /**
   * The most recent AssistantMessage received for the current turn.
   * Its `parentID` equals `curUserMessage.id`.
   * The display-entry ID for all assistant output this turn is `asst:<curUserMessage.id>`.
   */
  const curAsstMessage = ref<AssistantMessage | null>(null);

  // ── Computed ────────────────────────────────────────────────────────────────

  const datasetOptions = computed(() =>
    datasets.value.map(ds => ({ value: ds.id, label: ds.name }))
  );

  const currentQueuedFollowups = computed(() => {
    if (!sessionId.value) return [];
    return queuedFollowups.value[sessionId.value] ?? [];
  });

  const nextQueuedFollowup = computed(() => currentQueuedFollowups.value[0] ?? null);

  const followupsPaused = computed(() => {
    if (!sessionId.value) return false;
    return !!pausedFollowups.value[sessionId.value];
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function resetChatState() {
    displayMessages.value = [];
    historyExhausted.value = false;
    partText.value = new Map();
    pendingQuestion.value = null;
    pendingPermission.value = null;
    sessionTodos.value = [];
    curUserMessage.value = null;
    curAsstMessage.value = null;
  }

  function cacheSessionMessages(sid: string, entries: RawMessageEntry[]) {
    sessionMessages.value = {
      ...sessionMessages.value,
      [sid]: entries
        .filter((entry): entry is SessionMessageCache => !!entry.info?.id && !!entry.info?.role)
        .map((entry) => ({
          info: entry.info,
          parts: entry.parts,
        })),
    };
  }

  function compareIds(left: string, right: string) {
    return left.localeCompare(right);
  }

  function compareParts(left: DisplayPart, right: DisplayPart) {
    return compareIds(left.id, right.id);
  }

  function getDisplayBaseId(message: DisplayMessage) {
    return message.role === 'assistant' ? message.id.replace(/^asst:/, '') : message.id;
  }

  function compareDisplayMessages(left: DisplayMessage, right: DisplayMessage) {
    const baseCompare = compareIds(getDisplayBaseId(left), getDisplayBaseId(right));
    if (baseCompare !== 0) return baseCompare;
    if (left.role !== right.role) return left.role === 'user' ? -1 : 1;
    return left.time.getTime() - right.time.getTime();
  }

  function sortDisplayMessages(messages: DisplayMessage[]) {
    return [...messages].sort(compareDisplayMessages);
  }

  function isOptimisticPart(part: DisplayPart) {
    return part.id.startsWith(OPTIMISTIC_PART_ID_PREFIX);
  }

  function syncCurrentTurnPointers(sid: string | null = sessionId.value) {
    if (!sid) {
      curUserMessage.value = null;
      curAsstMessage.value = null;
      return;
    }

    const entries = sessionMessages.value[sid] ?? [];
    const lastUser = [...entries].reverse().find((entry) => entry.info.role === 'user')?.info as UserMessage | undefined;

    curUserMessage.value = lastUser ?? null;
    if (!lastUser) {
      curAsstMessage.value = null;
      return;
    }

    const lastAssistantEntry = [...entries].reverse().find((entry) => (
      entry.info.role === 'assistant'
      && entry.info.parentID === lastUser.id
    ));
    const lastAssistant = lastAssistantEntry?.info.role === 'assistant' ? lastAssistantEntry.info : undefined;

    curAsstMessage.value = lastAssistant ?? null;
  }

  function refreshDisplayMessages(sid: string | null = sessionId.value) {
    if (!sid) {
      displayMessages.value = [];
      syncCurrentTurnPointers(null);
      return;
    }

    displayMessages.value = sortDisplayMessages(mapEntriesToDisplayMessages(sessionMessages.value[sid] ?? []));
    syncCurrentTurnPointers(sid);
  }

  function generateMessageId() {
    return idGenerator.ascending('message');
  }

  function cloneAttachments(items: PendingAttachment[]): PendingAttachment[] {
    return items.map((attachment) => ({ ...attachment }));
  }

  function setQueuedFollowups(sessionIdForQueue: string, items: QueuedFollowup[]) {
    queuedFollowups.value = {
      ...queuedFollowups.value,
      [sessionIdForQueue]: items,
    };
  }

  function setFollowupsPaused(sessionIdForQueue: string, paused: boolean | undefined) {
    pausedFollowups.value = {
      ...pausedFollowups.value,
      [sessionIdForQueue]: paused,
    };
  }

  function setFailedFollowupId(sessionIdForQueue: string, followupId: string | undefined) {
    failedFollowupId.value = {
      ...failedFollowupId.value,
      [sessionIdForQueue]: followupId,
    };
  }

  async function addAttachment(file: File) {
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    pendingAttachments.value.push({
      id: generateMessageId(),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      url: dataUrl,
    });
  }

  function removeAttachment(attachmentId: string) {
    pendingAttachments.value = pendingAttachments.value.filter((attachment) => attachment.id !== attachmentId);
  }

  function appendCachedPart(sessionIdForPart: string, messageId: string, part: DisplayPart) {
    const entries = sessionMessages.value[sessionIdForPart] ?? [];
    const entryIndex = entries.findIndex((item) => item.info.id === messageId);
    if (entryIndex === -1) return;

    const entry = entries[entryIndex];
    if (!entry) return;
    const realParts = entry.parts.filter((item) => !isOptimisticPart(item));
    const existingIndex = realParts.findIndex((item) => item.id === part.id);
    const nextParts = [...realParts];

    if (existingIndex === -1) {
      nextParts.push(part);
    } else {
      nextParts.splice(existingIndex, 1, part);
    }

    nextParts.sort(compareParts);
    const nextEntries = [...entries];
    nextEntries.splice(entryIndex, 1, {
      ...entry,
      parts: nextParts,
    });
    sessionMessages.value = {
      ...sessionMessages.value,
      [sessionIdForPart]: nextEntries,
    };
  }

  function removeCachedMessage(sessionIdForMessage: string, messageId: string) {
    const entries = sessionMessages.value[sessionIdForMessage] ?? [];
    sessionMessages.value = {
      ...sessionMessages.value,
      [sessionIdForMessage]: entries.filter((entry) => entry.info.id !== messageId),
    };
  }

  function removeCachedPart(sessionIdForPart: string, messageId: string, partId: string) {
    const entries = sessionMessages.value[sessionIdForPart] ?? [];
    const entryIndex = entries.findIndex((item) => item.info.id === messageId);
    if (entryIndex === -1) return;

    const entry = entries[entryIndex];
    if (!entry) return;
    const nextEntries = [...entries];
    nextEntries.splice(entryIndex, 1, {
      ...entry,
      parts: entry.parts.filter((part) => part.id !== partId),
    });
    sessionMessages.value = {
      ...sessionMessages.value,
      [sessionIdForPart]: nextEntries,
    };
  }

  function upsertCachedMessage(sessionIdForMessage: string, info: UserMessage | AssistantMessage) {
    const entries = sessionMessages.value[sessionIdForMessage] ?? [];
    const existingIndex = entries.findIndex((entry) => entry.info.id === info.id);
    const nextEntries = [...entries];

    if (existingIndex === -1) {
      nextEntries.push({ info, parts: [] });
    } else {
      const existing = nextEntries[existingIndex];
      if (!existing) return;
      nextEntries.splice(existingIndex, 1, {
        info,
        parts: existing.parts,
      });
    }

    nextEntries.sort((left, right) => compareIds(left.info.id, right.info.id));
    sessionMessages.value = {
      ...sessionMessages.value,
      [sessionIdForMessage]: nextEntries,
    };
  }

  function mergeCachedMessages(sessionIdForMessage: string, entries: RawMessageEntry[]) {
    const merged = new Map<string, SessionMessageCache>();

    for (const existing of sessionMessages.value[sessionIdForMessage] ?? []) {
      merged.set(existing.info.id, existing);
    }

    for (const entry of entries) {
      if (!entry.info?.id || !entry.info?.role) continue;
      merged.set(entry.info.id, {
        info: entry.info,
        parts: [...(entry.parts ?? [])].sort(compareParts),
      });
    }

    sessionMessages.value = {
      ...sessionMessages.value,
      [sessionIdForMessage]: [...merged.values()].sort((left, right) => compareIds(left.info.id, right.info.id)),
    };
  }

  function upsertSession(item: SessionItem) {
    const existing = sessionList.value.find(s => s.id === item.id);
    if (existing) {
      existing.title = item.title || existing.title;
      existing.time = item.time;
      if (item.parentID) {
        existing.parentID = item.parentID;
      } else {
        delete existing.parentID;
      }
    } else {
      sessionList.value.unshift(item);
    }
  }

  function replaceChildSessions(parentId: string, items: SessionItem[]) {
    childSessions.value = {
      ...childSessions.value,
      [parentId]: items,
    };
  }

  function upsertChildSession(parentId: string, item: SessionItem) {
    const current = childSessions.value[parentId] ?? [];
    const index = current.findIndex((session) => session.id === item.id);
    const next = [...current];
    if (index === -1) {
      next.push(item);
    } else {
      next.splice(index, 1, {
        ...next[index],
        ...item,
      });
    }
    next.sort((a, b) => a.time.getTime() - b.time.getTime());
    replaceChildSessions(parentId, next);
  }

  function removeSessionBranch(rootId: string) {
    const stack = [rootId];
    const removed = new Set<string>();

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || removed.has(current)) continue;
      removed.add(current);
      const children = childSessions.value[current] ?? [];
      for (const child of children) {
        stack.push(child.id);
      }
    }

    sessionList.value = sessionList.value.filter((session) => !removed.has(session.id));

    const nextChildren: Record<string, SessionItem[]> = {};
    for (const [parentId, items] of Object.entries(childSessions.value)) {
      if (removed.has(parentId)) continue;
      nextChildren[parentId] = items.filter((item) => !removed.has(item.id));
    }
    childSessions.value = nextChildren;
  }

  function findParentSessionId(targetId: string): string | null {
    const rootMatch = sessionList.value.find((session) => session.id === targetId);
    if (rootMatch?.parentID) return rootMatch.parentID;

    for (const [parentId, items] of Object.entries(childSessions.value)) {
      if (items.some((item) => item.id === targetId)) {
        return parentId;
      }
    }

    return null;
  }

  async function ensureSession(): Promise<string> {
    if (sessionId.value) return sessionId.value;
    const session = await AgentService.createSession();
    sessionId.value = session.id;
    upsertSession(session);
    return session.id;
  }

  function toggleDataset(id: string) {
    const idx = selectedDatasets.value.indexOf(id);
    if (idx === -1) {
      selectedDatasets.value.push(id);
    } else {
      selectedDatasets.value.splice(idx, 1);
    }
  }

  function mapEntriesToDisplayMessages(entries: DisplayPart extends never ? never : RawMessageEntry[]): DisplayMessage[] {
    const next: DisplayMessage[] = [];

    for (const entry of entries) {
      const { info, parts } = entry;
      if (!info?.id || !info?.role) continue;

      const displayParts = parts.filter((p: DisplayPart): p is Part => {
        if (SKIPPED_ASSISTANT_PART_TYPES.has(p.type)) return false;
        if (p.type !== 'text') return true;
        if (p.ignored) return false;
        if (info.role === 'assistant' && p.synthetic) return false;
        return true;
      });

      for (const p of displayParts) {
        if (p.type === 'text') partText.value.set(p.id, p.text);
      }

      if (info.role === 'user') {
        next.push({
          id: info.id,
          role: 'user',
          time: new Date(info.time?.created ?? Date.now()),
          parts: displayParts,
          info,
        });
        continue;
      }

      const asstInfo = info as AssistantMessage;
      const displayId = `asst:${asstInfo.parentID}`;
      const existing = next.find(m => m.id === displayId);
        if (existing) {
        existing.parts = [...existing.parts, ...displayParts].sort(compareParts);
        existing.info = asstInfo;
      } else {
        next.push({
          id: displayId,
          role: 'assistant',
          time: new Date(asstInfo.time?.created ?? Date.now()),
          parts: displayParts,
          info: asstInfo,
        });
      }
    }

    return sortDisplayMessages(next);
  }

  function upsertDisplayPartText(partId: string, text: string) {
    for (const message of displayMessages.value) {
      const part = message.parts.find((item) => item.id === partId);
      if (part?.type === 'reasoning' || part?.type === 'text') {
        part.text = text;
        break;
      }
    }
  }

  function createOptimisticDisplayParts(sessionID: string, messageID: string, parts: PromptPartInput[]): DisplayPart[] {
    return parts.map((part, index) => ({
      ...part,
      id: `${OPTIMISTIC_PART_ID_PREFIX}${messageID}:${index}`,
      sessionID,
      messageID,
    } as DisplayPart));
  }

  function addOptimisticPromptMessage(sessionID: string, messageID: string, parts: PromptPartInput[]) {
    const optimisticParts = createOptimisticDisplayParts(sessionID, messageID, parts);
    const info = {
      id: messageID,
      sessionID,
      role: 'user',
      time: { created: Date.now() },
    } as UserMessage;

    const entries = sessionMessages.value[sessionID] ?? [];
    const entryIndex = entries.findIndex((entry) => entry.info.id === messageID);
    const nextEntries = [...entries];

    if (entryIndex === -1) {
      nextEntries.push({ info, parts: optimisticParts });
    } else {
      nextEntries.splice(entryIndex, 1, { info, parts: optimisticParts });
    }

    nextEntries.sort((left, right) => compareIds(left.info.id, right.info.id));
    sessionMessages.value = {
      ...sessionMessages.value,
      [sessionID]: nextEntries,
    };

    if (sessionID === sessionId.value) {
      refreshDisplayMessages(sessionID);
    }
  }

  // ── Session operations ────────────────────────────────────────────────────

  async function loadSessionList() {
    try {
      const fetched = await AgentService.listSessions();
      const fetchedIds = new Set(fetched.map(s => s.id));
      const localOnly = sessionList.value.filter((s) => !s.parentID && !fetchedIds.has(s.id));
      sessionList.value = [...localOnly, ...fetched].sort((a, b) => b.time.getTime() - a.time.getTime());
    } catch {
      // silent
    }
  }

  async function loadCommands() {
    try {
      const commands = await AgentService.listCommands();
      availableCommands.value = commands.map((command) => command.name);
    } catch {
      availableCommands.value = [];
    }
  }

  async function loadAgents() {
    try {
      const agents = await AgentService.listAgents();
      availableAgents.value = agents.filter((agent) => !agent.hidden).map((agent) => agent.name);
    } catch {
      availableAgents.value = [];
    }
  }

  async function loadSessionMessages(sid: string) {
    resetChatState();
    try {
      const [msgs, todos, sessionInfo] = await Promise.all([
        AgentService.loadMessages(sid, { limit: 50 }),
        AgentService.loadTodos(sid).catch(() => []),
        AgentService.getSession(sid).catch(() => null),
      ]);
      cacheSessionMessages(sid, msgs);
      sessionTodos.value = todos;
      if (sessionInfo) {
        if (sessionInfo.parentID) {
          upsertChildSession(sessionInfo.parentID, sessionInfo);
        } else {
          upsertSession(sessionInfo);
        }
      }
      refreshDisplayMessages(sid);
      historyExhausted.value = msgs.length < 50;
      await nextTick();
      scrollToBottomNow();

      // Restore pending question/permission after page reload
      try {
        const [questions, permissions] = await Promise.all([
          AgentService.listPendingQuestions(),
          AgentService.listPendingPermissions(),
        ]);

        const allParts = displayMessages.value.flatMap(m => m.parts);
        const runningToolParts = allParts.filter(
          (p): p is ToolPart => p.type === 'tool' && p.state.status === 'running'
        );

        for (const toolPart of runningToolParts) {
          const hasLivePermission = permissions.some(
            (p: PermissionRequest) => p.tool?.callID === toolPart.callID && p.sessionID === sid
          );
          if (!hasLivePermission) {
            const runningState = toolPart.state as ToolStateRunning;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (toolPart as any).state = {
              status: 'error' as const,
              input: runningState.input,
              error: 'Tool execution aborted',
              time: { start: runningState.time.start, end: Date.now() },
            };
          }
        }

        const pendingQ = questions.find((q: QuestionRequest) => q.sessionID === sid);
        const runningCallIDs = new Set(
          runningToolParts.filter(p => p.state.status === 'running').map(p => p.callID)
        );
        const pendingP = permissions.find(
          (p: PermissionRequest) => p.sessionID === sid && (p.tool?.callID ? runningCallIDs.has(p.tool.callID) : true)
        );

        if (pendingQ) pendingQuestion.value = pendingQ;
        if (pendingP) pendingPermission.value = pendingP;
      } catch {
        // silent
      }
    } catch {
      // silent
    }
  }

  async function loadOlderMessages() {
    if (!sessionId.value || historyLoading.value || historyExhausted.value) {
      return false;
    }

    const oldestUser = displayMessages.value.find((message) => message.role === 'user');
    const before = oldestUser?.info?.id;
    if (!before) {
      historyExhausted.value = true;
      return false;
    }

    historyLoading.value = true;
    try {
      const older = await AgentService.loadMessages(sessionId.value, { limit: 50, before });
      if (!older.length) {
        historyExhausted.value = true;
        return false;
      }

      mergeCachedMessages(sessionId.value, older);
      refreshDisplayMessages(sessionId.value);
      historyExhausted.value = older.length < 50;
      return !historyExhausted.value;
    } catch {
      return false;
    } finally {
      historyLoading.value = false;
    }
  }

  async function switchSession(sid: string) {
    if (sid === sessionId.value) return;
    sessionId.value = sid;
    await loadSessionMessages(sid);
  }

  async function createNewSession() {
    try {
      const session = await AgentService.createSession();
      upsertSession(session);
      sessionId.value = session.id;
      resetChatState();
      void nextTick(() => focusInput());
    } catch {
      notifyError('Failed to create session');
    }
  }

  async function deleteSession(sid: string) {
    try {
      const parentId = findParentSessionId(sid);
      await AgentService.deleteSession(sid);
      removeSessionBranch(sid);

      if (sessionId.value === sid) {
        if (parentId) {
          sessionId.value = parentId;
          await loadSessionMessages(parentId);
        } else {
          const nextRoot = sessionList.value[0];
          if (nextRoot) {
            sessionId.value = nextRoot.id;
            await loadSessionMessages(nextRoot.id);
          } else {
            sessionId.value = null;
            resetChatState();
          }
        }
      }
    } catch {
      notifyError('Failed to delete session');
    }
  }

  // ── SSE event handling ────────────────────────────────────────────────────

  /**
   * Dispatch a typed SDK event.
   * `event` is typed as `Event` from `@opencode-ai/sdk/v2` which is the full
   * discriminated union.  Each branch narrows the type via the `type` field.
   */
  function handleEvent(event: Event) {
    switch (event.type) {

      case 'server.connected': {
        isConnected.value = true;
        break;
      }

      case 'session.updated': {
        const info = event.properties.info;
        const item = {
          id: info.id,
          title: info.title ?? 'Untitled',
          time: new Date(info.time?.created ?? Date.now()),
          ...(info.parentID ? { parentID: info.parentID } : {}),
          ...(info.revert ? { revert: info.revert } : {}),
        };

        if (info.parentID) {
          upsertChildSession(info.parentID, item);
        } else {
          upsertSession(item);
        }
        break;
      }

      case 'session.status': {
        const props = event.properties;
        if (props.sessionID !== sessionId.value) break;
        sessionStatus.value = props.status.type;
        isLoading.value = props.status.type === 'busy' || props.status.type === 'retry';
        break;
      }

      case 'message.updated': {
        const info = event.properties.info;
        const eventSessionId = info.sessionID;
        upsertCachedMessage(eventSessionId, info);

        if (eventSessionId === sessionId.value) {
          refreshDisplayMessages(eventSessionId);
          scrollToBottomNow();
        }
        break;
      }

      case 'message.removed': {
        const { sessionID, messageID } = event.properties;
        removeCachedMessage(sessionID, messageID);
        if (sessionID !== sessionId.value) break;

        refreshDisplayMessages(sessionID);

        break;
      }

      case 'message.part.delta': {
        const { partID, field, delta } = event.properties;

        if (!STREAMED_TEXT_FIELDS.has(field)) break;

        const accumulated = (partText.value.get(partID) ?? '') + delta;
        partText.value.set(partID, accumulated);

        upsertDisplayPartText(partID, accumulated);
        scrollIfAtBottom();
        break;
      }

      case 'message.part.updated': {
        const { part } = event.properties;
        if (!part) break;
        appendCachedPart(part.sessionID, part.messageID, part);

        if (part.sessionID === sessionId.value) {
          refreshDisplayMessages(part.sessionID);
        }

        if (SKIPPED_ASSISTANT_PART_TYPES.has(part.type)) break;

        if (part.type === 'text' && !partText.value.has(part.id) && part.text) {
          partText.value.set(part.id, part.text);
        }
        scrollIfAtBottom();
        break;
      }

      case 'message.part.removed': {
        const { messageID, partID } = event.properties;
        if (sessionId.value) {
          removeCachedPart(sessionId.value, messageID, partID);
          refreshDisplayMessages(sessionId.value);
        }

        partText.value.delete(partID);
        break;
      }

      case 'session.idle': {
        isLoading.value = false;
        sessionStatus.value = 'idle';
        curUserMessage.value = null;
        curAsstMessage.value = null;
        scrollToBottomNow();
        break;
      }

      case 'session.error': {
        isLoading.value = false;
        sessionStatus.value = 'idle';
        curUserMessage.value = null;
        curAsstMessage.value = null;
        const errMsg = typeof event.properties.error === 'string'
          ? event.properties.error
          : (event.properties.error as { message?: string })?.message ?? 'Agent error';
        notifyError(errMsg);
        break;
      }

      case 'question.asked': {
        const q = event.properties;
        // Accept from root session, or from any sub-session active during the current user turn
        if (q.sessionID === sessionId.value || curUserMessage.value !== null) {
          pendingQuestion.value = q;
        }
        break;
      }

      case 'question.replied': {
        if (pendingQuestion.value?.id === event.properties.requestID) pendingQuestion.value = null;
        break;
      }

      case 'question.rejected': {
        if (pendingQuestion.value?.id === event.properties.requestID) pendingQuestion.value = null;
        break;
      }

      case 'permission.asked': {
        const p = event.properties;
        // Accept from root session, or from any sub-session active during the current user turn
        if (p.sessionID === sessionId.value || curUserMessage.value !== null) {
          pendingPermission.value = p;
        }
        break;
      }

      case 'permission.replied': {
        if (pendingPermission.value?.id === event.properties.requestID) pendingPermission.value = null;
        break;
      }

      case 'todo.updated': {
        if (event.properties.sessionID !== sessionId.value) break;
        sessionTodos.value = event.properties.todos;
        break;
      }

      default:
        // All other events (lsp, pty, file, etc.) are intentionally ignored
        break;
    }
  }

  function startEventSubscription() {
    sseAbort = new AbortController();
    void (async () => {
      try {
        const stream = await AgentService.subscribeToEvents();
        for await (const event of stream) {
          if (sseAbort?.signal.aborted) break;
          handleEvent(event);
        }
      } catch {
        // AbortError or connection closed — not fatal
      }
    })();
  }

  function stopEventSubscription() {
    sseAbort?.abort();
    sseAbort = null;
  }

  // ── Message actions ───────────────────────────────────────────────────────

  function buildDatasetReminderText(datasetIds: string[] = selectedDatasets.value): string {
    const names = datasetIds.map(id => datasets.value.find(d => d.id === id)?.name ?? id);
    const namesJson = JSON.stringify(names);
    return `<system-reminder>
The following knowledge base datasets are available for this conversation: ${namesJson}
You can use the \`search\` MCP tool to query relevant information from these datasets when needed.
Usage: search(search_query="<your query>", search_type="GRAPH_COMPLETION", datasets=${namesJson})
</system-reminder>`;
  }

  function hasDatasetSelectionChanged(): boolean {
    if (lastInjectedDatasets === null) return true;
    return [...selectedDatasets.value].sort().join(',') !== [...lastInjectedDatasets].sort().join(',');
  }

  function buildPromptParts(userInput: string): PromptPartInput[] {
    const agentRegex = /(^|\s)@([a-zA-Z0-9._-]+)/g;
    const parts: PromptPartInput[] = [];
    let cursor = 0;

    for (const match of userInput.matchAll(agentRegex)) {
      const name = match[2];
      const prefix = match[1] ?? '';
      const start = match.index !== undefined ? match.index + prefix.length : -1;
      if (!name) continue;
      const end = start + name.length + 1;
      if (start < 0 || !availableAgents.value.includes(name)) continue;

      const textBefore = userInput.slice(cursor, start);
      if (textBefore) {
        parts.push({ type: 'text', text: textBefore });
      }

      const mention = userInput.slice(start, end);
      parts.push({
        type: 'agent',
        name,
        source: {
          value: mention,
          start,
          end,
        },
      } satisfies AgentPartInput);

      cursor = end;
    }

    const trailing = userInput.slice(cursor);
    if (trailing || parts.length === 0) {
      parts.push({ type: 'text', text: trailing || userInput });
    }

    return parts;
  }

  /** Build the parts array for a user message. Prepends a synthetic dataset reminder part when needed. */
  function buildMessageParts(
    userInput: string,
    options?: {
      attachments?: PendingAttachment[];
      datasetIds?: string[];
      forceDatasetReminder?: boolean;
      trackDatasetSelection?: boolean;
    },
  ): PromptPartInput[] {
    const userParts = buildPromptParts(userInput);
    const attachmentParts = buildAttachmentParts(options?.attachments);
    const datasetIds = options?.datasetIds ?? selectedDatasets.value;
    const forceDatasetReminder = options?.forceDatasetReminder ?? false;
    const trackDatasetSelection = options?.trackDatasetSelection ?? true;

    if (!forceDatasetReminder && !hasDatasetSelectionChanged()) return [...userParts, ...attachmentParts];

    if (trackDatasetSelection) {
      lastInjectedDatasets = [...datasetIds];
    }

    if (datasetIds.length === 0) return [...userParts, ...attachmentParts];

    const reminderPart: TextPartInput = {
      type: 'text',
      text: buildDatasetReminderText(datasetIds),
      synthetic: true,
    };
    return [reminderPart, ...userParts, ...attachmentParts];
  }

  function buildAttachmentParts(attachments: PendingAttachment[] = pendingAttachments.value): FilePartInput[] {
    return attachments.map((attachment) => ({
      type: 'file',
      mime: attachment.mime,
      url: attachment.url,
      filename: attachment.name,
    }));
  }

  function parseSlashCommand(text: string) {
    const [head, ...tail] = text.trim().split(' ');
    if (!head?.startsWith('/')) {
      return null;
    }

    const command = head.slice(1);
    if (!command || !availableCommands.value.includes(command)) {
      return null;
    }

    return {
      command,
      args: tail.join(' '),
    };
  }

  function queueFollowupDraft(sid: string, text: string, attachments: PendingAttachment[], datasetIds: string[]) {
    const next: QueuedFollowup = {
      id: generateMessageId(),
      sessionId: sid,
      text,
      attachments: cloneAttachments(attachments),
      datasetIds: [...datasetIds],
    };

    setQueuedFollowups(sid, [...(queuedFollowups.value[sid] ?? []), next]);
    setFailedFollowupId(sid, undefined);
    setFollowupsPaused(sid, undefined);
  }

  function removeQueuedFollowup(sid: string, followupId: string) {
    setQueuedFollowups(
      sid,
      (queuedFollowups.value[sid] ?? []).filter((item) => item.id !== followupId),
    );
  }

  function getFollowupPreview(item: QueuedFollowup): string {
    const firstLine = item.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (firstLine) return firstLine;
    return item.attachments.length > 0 ? '[Attachment]' : '';
  }

  async function dispatchDraft(input: {
    sid: string;
    text: string;
    attachments: PendingAttachment[];
    datasetIds: string[];
    forceDatasetReminder?: boolean;
  }): Promise<{ messageId?: string }> {
    const slash = input.text ? parseSlashCommand(input.text) : null;

    if (slash) {
      await AgentService.runCommand(input.sid, slash.command, slash.args, {
        parts: buildAttachmentParts(input.attachments),
      });
      return {};
    }

    const messageId = generateMessageId();
    const parts = buildMessageParts(input.text, {
      attachments: input.attachments,
      datasetIds: input.datasetIds,
      ...(input.forceDatasetReminder !== undefined ? { forceDatasetReminder: input.forceDatasetReminder } : {}),
      trackDatasetSelection: !input.forceDatasetReminder,
    });
    addOptimisticPromptMessage(input.sid, messageId, parts);

    try {
      await AgentService.promptAsync(input.sid, parts, { messageID: messageId });
      return { messageId };
    } catch (error) {
      removeCachedMessage(input.sid, messageId);
      if (input.sid === sessionId.value) {
        refreshDisplayMessages(input.sid);
      }
      throw error;
    }
  }

  async function sendQueuedFollowup(followupId: string, manual = false) {
    const sid = sessionId.value;
    if (!sid || sendingFollowupId.value) return;

    const item = (queuedFollowups.value[sid] ?? []).find((entry) => entry.id === followupId);
    if (!item) return;

    sendingFollowupId.value = followupId;
    isLoading.value = true;
    if (manual) setFollowupsPaused(sid, undefined);
    setFailedFollowupId(sid, undefined);

    try {
      await dispatchDraft({
        sid,
        text: item.text,
        attachments: item.attachments,
        datasetIds: item.datasetIds,
        forceDatasetReminder: item.datasetIds.length > 0,
      });
      removeQueuedFollowup(sid, followupId);
      if (manual) scrollToBottomNow();
    } catch (err) {
      isLoading.value = false;
      setFailedFollowupId(sid, followupId);
      notifyError((err instanceof Error ? err.message : null) ?? 'Failed to send queued follow-up');
    } finally {
      sendingFollowupId.value = null;
    }
  }

  function editQueuedFollowup(followupId: string) {
    const sid = sessionId.value;
    if (!sid || sendingFollowupId.value) return;

    const item = (queuedFollowups.value[sid] ?? []).find((entry) => entry.id === followupId);
    if (!item) return;

    removeQueuedFollowup(sid, followupId);
    if (failedFollowupId.value[sid] === followupId) {
      setFailedFollowupId(sid, undefined);
    }
    inputMessage.value = item.text;
    pendingAttachments.value = cloneAttachments(item.attachments);
    selectedDatasets.value = [...item.datasetIds];
    focusInput();
  }

  async function sendMessage() {
    const rawInput = inputMessage.value;
    const text = rawInput.trim();
    if (!text && pendingAttachments.value.length === 0) return;

    if (text === '/compact') {
      inputMessage.value = '';
      await runCompact();
      return;
    }

    const draftAttachments = cloneAttachments(pendingAttachments.value);
    const draftDatasetIds = [...selectedDatasets.value];

    inputMessage.value = '';

    if (isLoading.value && sessionId.value) {
      queueFollowupDraft(sessionId.value, text, draftAttachments, draftDatasetIds);
      pendingAttachments.value = [];
      return;
    }

    isLoading.value = true;

    try {
      const sid = await ensureSession();
      await dispatchDraft({
        sid,
        text: rawInput,
        attachments: draftAttachments,
        datasetIds: draftDatasetIds,
      });
      pendingAttachments.value = [];
    } catch (err) {
      isLoading.value = false;
      notifyError((err instanceof Error ? err.message : null) ?? 'Failed to send message. Is the OpenCode agent running?');
    }
  }

  async function runCompact() {
    if (!sessionId.value) {
      notifyInfo('No active session to compact', { icon: 'info' });
      return;
    }
    notifyInfo('Compacting session…', { icon: 'compress', timeout: 2000 });
    try {
      await AgentService.compact(sessionId.value);
      notifySuccess('Session compacted');
    } catch (err) {
      notifyError((err instanceof Error ? err.message : null) ?? 'Compaction failed');
    }
  }

  async function abortSession() {
    if (!sessionId.value) return;
    if ((queuedFollowups.value[sessionId.value] ?? []).length > 0) {
      setFollowupsPaused(sessionId.value, true);
    }
    try {
      await AgentService.abort(sessionId.value);
    } catch {
      // ignore
    }
    isLoading.value = false;
  }

  // ── Question / Permission ─────────────────────────────────────────────────

  async function replyToQuestion(requestID: string, answers: QuestionAnswer[]) {
    try {
      await AgentService.replyToQuestion(requestID, answers);
    } catch {
      notifyError('Failed to reply to question');
    }
  }

  async function rejectQuestion(requestID: string) {
    try {
      await AgentService.rejectQuestion(requestID);
    } catch {
      // silent
    }
    pendingQuestion.value = null;
  }

  async function replyToPermission(requestID: string, reply: 'once' | 'always' | 'reject') {
    try {
      await AgentService.replyToPermission(requestID, reply);
    } catch {
      notifyError('Failed to respond to permission');
    }
  }

  async function restoreRevert() {
    if (!sessionId.value) return;
    try {
      await AgentService.unrevert(sessionId.value);
      await loadSessionMessages(sessionId.value);
    } catch {
      notifyError('Failed to restore reverted session state');
    }
  }

  async function revertMessage(messageId: string, partId?: string) {
    if (!sessionId.value) return;
    try {
      await AgentService.revertMessage(sessionId.value, messageId, partId);
      await loadSessionMessages(sessionId.value);
    } catch {
      notifyError('Failed to revert message');
    }
  }

  const stopFollowupQueueWatch = watch(
    () => [sessionId.value, isLoading.value, nextQueuedFollowup.value?.id, sendingFollowupId.value, followupsPaused.value] as const,
    ([sid, loading, nextQueuedId, sending, paused]) => {
      if (!sid || loading || !nextQueuedId || sending || paused) return;
      if (failedFollowupId.value[sid] === nextQueuedId) return;
      void sendQueuedFollowup(nextQueuedId);
    },
  );
  void stopFollowupQueueWatch;

  // ── Dataset actions ───────────────────────────────────────────────────────

  async function loadDatasets() {
    try {
      datasets.value = await KnowledgeService.getDatasets();
    } catch {
      // silent
    }
  }

  // ── Expose ────────────────────────────────────────────────────────────────

  const followupBindings = {
    currentQueuedFollowups,
    failedFollowupId,
    followupsPaused,
    sendingFollowupId,
    sendQueuedFollowup,
    editQueuedFollowup,
    getFollowupPreview,
  };

  return {
    // State
    displayMessages,
    historyExhausted,
    inputMessage,
    isLoading,
    isConnected,
    sessionId,
    sessionStatus,
    sessionList,
    childSessions,
    sessionMessages,
    historyLoading,
    datasets,
    selectedDatasets,
    pendingAttachments,
    partText,
    pendingQuestion,
    pendingPermission,
    sessionTodos,
    curUserMessage,
    curAsstMessage,
    // Computed
    datasetOptions,
    // Actions
    loadDatasets,
    loadAgents,
    loadCommands,
    loadSessionList,
    loadOlderMessages,
    switchSession,
    createNewSession,
    deleteSession,
    toggleDataset,
    addAttachment,
    removeAttachment,
    sendMessage,
    abortSession,
    replyToQuestion,
    rejectQuestion,
    replyToPermission,
    revertMessage,
    restoreRevert,
    startEventSubscription,
    stopEventSubscription,
    ...followupBindings,
  };
}
