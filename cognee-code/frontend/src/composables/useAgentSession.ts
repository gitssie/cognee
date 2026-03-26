import { ref, computed, nextTick } from 'vue';
import type {
  Event,
  UserMessage,
  AssistantMessage,
  QuestionRequest,
  PermissionRequest,
  QuestionAnswer,
  TextPart,
  ToolPart,
  ReasoningPart,
  ToolStateRunning,
  TextPartInput,
} from '@opencode-ai/sdk/v2';
import { AgentService } from 'src/services/agents';
import type { DisplayPart, SessionItem } from 'src/services/agents';
import { KnowledgeService } from 'src/services/knowledge';
import type { Dataset } from 'src/services/knowledge';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  time: Date;
  parts: DisplayPart[];
  /** The raw SDK message that originated this display entry (last write wins) */
  info?: UserMessage | AssistantMessage;
}

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

  // ── Session list ────────────────────────────────────────────────────────────

  const sessionList = ref<SessionItem[]>([]);

  // ── Dataset state ───────────────────────────────────────────────────────────

  const datasets = ref<Dataset[]>([]);
  const selectedDatasets = ref<string[]>([]);
  /** Snapshot of selectedDatasets at the time of the last injection; null means "needs inject" */
  let lastInjectedDatasets: string[] | null = null;

  // ── Internal bookkeeping ────────────────────────────────────────────────────

  let sseAbort: AbortController | null = null;

  /** Per-part accumulated delta text */
  const partText = ref<Map<string, string>>(new Map());

  const pendingQuestion = ref<QuestionRequest | null>(null);
  const pendingPermission = ref<PermissionRequest | null>(null);

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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function resetChatState() {
    displayMessages.value = [];
    historyExhausted.value = false;
    partText.value = new Map();
    pendingQuestion.value = null;
    pendingPermission.value = null;
    curUserMessage.value = null;
    curAsstMessage.value = null;
  }

  function upsertSession(item: SessionItem) {
    const existing = sessionList.value.find(s => s.id === item.id);
    if (existing) {
      existing.title = item.title || existing.title;
      existing.time = item.time;
    } else {
      sessionList.value.unshift(item);
    }
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

  /**
   * Find or create an assistant display-message entry by its display ID.
   * Used both during history load and during live streaming.
   */
  function getOrCreateAsstDisplayMsg(displayId: string, time: Date): DisplayMessage {
    let msg = displayMessages.value.find(m => m.id === displayId);
    if (!msg) {
      msg = { id: displayId, role: 'assistant', time, parts: [] };
      displayMessages.value.push(msg);
    }
    return msg;
  }

  // ── Session operations ────────────────────────────────────────────────────

  async function loadSessionList() {
    try {
      const fetched = await AgentService.listSessions();
      const fetchedIds = new Set(fetched.map(s => s.id));
      const localOnly = sessionList.value.filter(s => !fetchedIds.has(s.id));
      sessionList.value = [...localOnly, ...fetched].sort((a, b) => b.time.getTime() - a.time.getTime());
    } catch {
      // silent
    }
  }

  async function loadSessionMessages(sid: string) {
    resetChatState();
    try {
      const msgs = await AgentService.loadMessages(sid);

      for (const entry of msgs) {
        const { info, parts } = entry;
        if (!info?.id || !info?.role) continue;

        const displayParts = parts.filter(
          (p): p is TextPart | ToolPart | ReasoningPart =>
            (p.type === 'text' || p.type === 'tool' || p.type === 'reasoning') &&
            !(p.type === 'text' && (p.synthetic || p.ignored))
        );

        for (const p of displayParts) {
          if (p.type === 'text') partText.value.set(p.id, p.text);
        }

        if (info.role === 'user') {
          const userInfo = info as UserMessage;
          displayMessages.value.push({
            id: userInfo.id,
            role: 'user',
            time: new Date(userInfo.time?.created ?? Date.now()),
            parts: displayParts,
            info: userInfo,
          });
        } else {
          // Group all assistant messages for the same user turn under one display entry.
          // parentID of an assistant message is the user message ID that triggered it.
          const asstInfo = info as AssistantMessage;
          const displayId = `asst:${asstInfo.parentID}`;
          const msg = getOrCreateAsstDisplayMsg(displayId, new Date(asstInfo.time?.created ?? Date.now()));
          msg.parts.push(...displayParts);
          msg.info = asstInfo;
        }
      }

      historyExhausted.value = true;
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
      await AgentService.deleteSession(sid);
      sessionList.value = sessionList.value.filter(s => s.id !== sid);
      if (sessionId.value === sid) {
        sessionId.value = null;
        resetChatState();
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
        if (info.parentID) break; // skip sub-agent sessions from the sidebar list
        upsertSession({
          id: info.id,
          title: info.title ?? 'Untitled',
          time: new Date(info.time?.created ?? Date.now()),
        });
        break;
      }

      case 'message.updated': {
        const info = event.properties.info;

        if (info.role === 'user') {
          // Only track user messages from the root session
          if (info.sessionID !== sessionId.value) break;

          curUserMessage.value = info;
          curAsstMessage.value = null;

          if (!displayMessages.value.find(m => m.id === info.id)) {
            displayMessages.value.push({
              id: info.id,
              role: 'user',
              time: new Date(info.time.created),
              parts: [],
              info,
            });
            scrollToBottomNow();
          }
        } else {
          // AssistantMessage: accept if it belongs to the current turn
          if (info.parentID !== curUserMessage.value?.id) break;

          curAsstMessage.value = info;

          // All assistant messages for this turn share one display entry keyed by user message ID
          const displayId = `asst:${info.parentID}`;

          if (!displayMessages.value.find(m => m.id === displayId)) {
            displayMessages.value.push({
              id: displayId,
              role: 'assistant',
              time: new Date(info.time.created),
              parts: [],
              info,
            });
            scrollToBottomNow();
          } else {
            const existing = displayMessages.value.find(m => m.id === displayId);
            if (existing) existing.info = info;
          }
        }
        break;
      }

      case 'message.part.delta': {
        const { partID, field, delta } = event.properties;

        // Only accumulate deltas when a turn is active
        if (curUserMessage.value === null) break;
        if (field !== 'text') break;

        const accumulated = (partText.value.get(partID) ?? '') + delta;
        partText.value.set(partID, accumulated);

        // Update reasoning part text in-place in the current turn's display entry
        const displayId = `asst:${curUserMessage.value.id}`;
        const msg = displayMessages.value.find(m => m.id === displayId);
        const part = msg?.parts.find(p => p.id === partID);
        if (part?.type === 'reasoning') {
          part.text = accumulated;
        }
        scrollIfAtBottom();
        break;
      }

      case 'message.part.updated': {
        const { part } = event.properties;
        if (!part) break;
        if (part.type !== 'text' && part.type !== 'tool' && part.type !== 'reasoning') break;

        // Skip synthetic or ignored parts — they are sent to the LLM but not shown in UI
        if (part.type === 'text' && (part.synthetic || part.ignored)) break;

        // Only accept parts when a turn is active
        if (curUserMessage.value === null) break;

        // Display entry: user parts use their messageID; assistant parts use asst:<userMsgID>
        const userMsg = displayMessages.value.find(m => m.id === part.messageID && m.role === 'user');
        const displayId = userMsg ? part.messageID : `asst:${curUserMessage.value.id}`;

        let msg = displayMessages.value.find(m => m.id === displayId);
        if (!msg) {
          msg = { id: displayId, role: 'assistant', time: new Date(), parts: [] };
          displayMessages.value.push(msg);
        }

        const idx = msg.parts.findIndex(p => p.id === part.id);
        if (idx === -1) {
          if (part.type === 'text' || part.type === 'reasoning') {
            const buffered = partText.value.get(part.id);
            if (buffered) part.text = buffered;
          }
          msg.parts.push(part);
        } else {
          if (part.type === 'text' || part.type === 'reasoning') {
            const buffered = partText.value.get(part.id);
            if (buffered && buffered.length > (part.text?.length ?? 0)) part.text = buffered;
          }
          msg.parts.splice(idx, 1, part);
        }

        if (part.type === 'text' && !partText.value.has(part.id) && part.text) {
          partText.value.set(part.id, part.text);
        }
        scrollIfAtBottom();
        break;
      }

      case 'session.idle': {
        isLoading.value = false;
        curUserMessage.value = null;
        curAsstMessage.value = null;
        scrollToBottomNow();
        break;
      }

      case 'session.error': {
        isLoading.value = false;
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

  function getSelectedDatasetNames(): string[] {
    return selectedDatasets.value.map(id => datasets.value.find(d => d.id === id)?.name ?? id);
  }

  function buildDatasetReminderText(): string {
    const namesJson = JSON.stringify(getSelectedDatasetNames());
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

  /** Build the parts array for a user message. Prepends a synthetic dataset reminder part when selection has changed. */
  function buildMessageParts(userInput: string): TextPartInput[] {
    const userPart: TextPartInput = { type: 'text', text: userInput };

    if (!hasDatasetSelectionChanged()) return [userPart];

    lastInjectedDatasets = [...selectedDatasets.value];

    if (selectedDatasets.value.length === 0) return [userPart];

    const reminderPart: TextPartInput = {
      type: 'text',
      text: buildDatasetReminderText(),
      synthetic: true,
    };
    return [reminderPart, userPart];
  }

  async function sendMessage() {
    const text = inputMessage.value.trim();
    if (!text || isLoading.value) return;

    if (text === '/compact') {
      inputMessage.value = '';
      await runCompact();
      return;
    }

    inputMessage.value = '';
    isLoading.value = true;

    try {
      const sid = await ensureSession();
      await AgentService.promptAsync(sid, buildMessageParts(text));
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

  // ── Dataset actions ───────────────────────────────────────────────────────

  async function loadDatasets() {
    try {
      datasets.value = await KnowledgeService.getDatasets();
    } catch {
      // silent
    }
  }

  // ── Expose ────────────────────────────────────────────────────────────────

  return {
    // State
    displayMessages,
    historyExhausted,
    inputMessage,
    isLoading,
    isConnected,
    sessionId,
    sessionList,
    datasets,
    selectedDatasets,
    partText,
    pendingQuestion,
    pendingPermission,
    curUserMessage,
    curAsstMessage,
    // Computed
    datasetOptions,
    // Actions
    loadDatasets,
    loadSessionList,
    switchSession,
    createNewSession,
    deleteSession,
    toggleDataset,
    sendMessage,
    abortSession,
    replyToQuestion,
    rejectQuestion,
    replyToPermission,
    startEventSubscription,
    stopEventSubscription,
  };
}
