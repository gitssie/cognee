<template>
  <q-page class="agent-page" :style-fn="pageFn">
    <div class="page-layout">

      <!-- ── Chat area ──────────────────────────────────────────────────── -->
      <div class="chat-area">

        <!-- Messages -->
        <div
          ref="messagesAreaRef"
          class="messages-area"
          :style="messagesAreaStyle"
        >
          <!-- Welcome / empty state -->
          <div v-if="displayMessages.length === 0" class="welcome-section">
            <q-avatar size="64px" color="primary" text-color="white">
              <q-icon name="smart_toy" size="36px" />
            </q-avatar>
            <div class="text-h5 text-weight-bold q-mt-md text-dark">Cognee AI Agent</div>
            <div class="text-body2 text-grey-6 q-mt-xs">
              Ask questions about your knowledge base
            </div>
            <div class="suggestions q-mt-xl row q-col-gutter-sm justify-center">
              <div v-for="s in suggestions" :key="s" class="col-auto">
                <q-btn
                  outline no-caps unelevated
                  color="grey-6"
                  :label="s"
                  class="suggestion-chip"
                  @click="useSuggestion(s)"
                />
              </div>
            </div>
          </div>

          <!-- Message list (reverse infinite scroll: scrolled to bottom by default,
               @load fires when user scrolls to top — reserved for future history pagination) -->
          <q-infinite-scroll
            v-else
            ref="infiniteScrollRef"
            reverse
            :scroll-target="messagesAreaRef ?? undefined"
            :disable="historyExhausted"
            @load="onLoadHistory"
          >
            <template v-slot:loading>
              <div class="row justify-center q-py-sm">
                <q-spinner-dots size="24px" color="grey-5" />
              </div>
            </template>

            <div v-for="msgRaw in displayMessages" :key="(msgRaw as DisplayMessage).id" class="message-row q-px-lg q-pt-sm">

              <!-- User message -->
              <q-chat-message
                v-if="(msgRaw as DisplayMessage).role === 'user'"
                sent
                bg-color="primary"
                text-color="white"
              >
                <template v-slot:avatar>
                  <q-avatar color="primary" text-color="white" size="36px" class="q-ml-sm">
                    <q-icon name="person" size="20px" />
                  </q-avatar>
                </template>
                <template v-slot:default>
                  <div>{{ getUserMessageText(msgRaw as DisplayMessage) }}</div>
                </template>
              </q-chat-message>

              <!-- Assistant message -->
              <q-chat-message
                v-else
                size="11"
                bg-color="grey-1"
              >
                <template v-slot:avatar>
                  <q-avatar color="grey-8" text-color="white" size="36px" class="q-mr-sm">
                    <q-icon name="smart_toy" size="20px" />
                  </q-avatar>
                </template>
                <template v-slot:default>
                  <div class="assistant-content">
                    <!-- Thinking state: no parts yet -->
                    <div v-if="(msgRaw as DisplayMessage).parts.length === 0 && isLoading" class="row items-center q-gutter-xs thinking-indicator">
                      <q-spinner-dots size="16px" color="grey-5" />
                      <span class="text-caption text-grey-5">Thinking…</span>
                    </div>
                    <!-- Render parts in their original order -->
                    <template v-for="part in (msgRaw as DisplayMessage).parts" :key="part.id">
                      <AgentReasoning v-if="part.type === 'reasoning'" :part="part" />
                      <AgentToolCall v-else-if="part.type === 'tool'" :part="part" />
                      <div v-else-if="part.type === 'text'" class="text-part">
                        <MarkdownRender
                          :content="partText.get(part.id) ?? part.text ?? ''"
                          :final="(msgRaw as DisplayMessage).final"
                        />
                        <q-spinner-dots
                          v-if="isLoading && !(msgRaw as DisplayMessage).final && part.id === (msgRaw as DisplayMessage).parts.filter(p => p.type === 'text').at(-1)?.id"
                          size="1em"
                          color="primary"
                        />
                      </div>
                    </template>
                  </div>
                </template>
              </q-chat-message>

            </div>

            <div style="height: 24px" />
          </q-infinite-scroll>
        </div>

        <!-- Input area -->
        <div class="input-area">
          <div class="input-container">

            <!-- Question dock (shown above input when AI asks a question) -->
            <AgentQuestion
              v-if="pendingQuestion"
              :request="pendingQuestion"
              :on-reply="replyToQuestion"
              :on-reject="rejectQuestion"
            />

            <!-- Permission dock (shown above input when AI requests permission) -->
            <AgentPermission
              v-if="pendingPermission"
              :request="pendingPermission"
              :on-respond="replyToPermission"
            />

            <!-- Unified input card -->
            <div class="input-card">

              <!-- Textarea -->
              <q-input
                ref="inputRef"
                v-model="inputMessage"
                placeholder="Ask anything about your knowledge base…"
                borderless autogrow :maxlength="4000"
                :disable="isLoading"
                class="chat-input"
                @keydown="handleKeydown"
              />

              <!-- Bottom action bar inside the card -->
              <div class="input-actions row items-center no-wrap q-gutter-xs">

                <!-- Inline chip picker: selected chips + add button -->
                <template v-if="selectedDatasets.length > 0">
                  <q-chip
                    v-for="id in selectedDatasets"
                    :key="id"
                    dense removable
                    color="primary"
                    text-color="white"
                    icon="folder_open"
                    size="sm"
                    class="dataset-chip"
                    @remove="toggleDataset(id)"
                  >
                    {{ datasetOptions.find(o => o.value === id)?.label ?? id }}
                  </q-chip>
                  <!-- Add more -->
                  <q-btn round flat dense icon="add" size="xs" color="grey-5" class="dataset-add-btn">
                    <q-menu anchor="top left" self="bottom left" :offset="[0, 4]">
                      <q-list style="min-width: 200px">
                        <q-item-label header class="text-caption text-grey-6 q-pt-sm q-pb-xs">Add dataset</q-item-label>
                        <q-item
                          v-for="opt in datasetOptions.filter(o => !selectedDatasets.includes(o.value))"
                          :key="opt.value"
                          clickable v-close-popup
                          @click="toggleDataset(opt.value)"
                        >
                          <q-item-section avatar>
                            <q-icon name="folder_open" size="14px" color="grey-6" />
                          </q-item-section>
                          <q-item-section>
                            <q-item-label class="text-caption">{{ opt.label }}</q-item-label>
                          </q-item-section>
                        </q-item>
                        <q-item v-if="datasetOptions.filter(o => !selectedDatasets.includes(o.value)).length === 0">
                          <q-item-section class="text-grey text-caption">All added</q-item-section>
                        </q-item>
                        <q-separator />
                        <q-item clickable v-close-popup @click="selectedDatasets = []">
                          <q-item-section class="text-caption text-negative">Clear all</q-item-section>
                        </q-item>
                      </q-list>
                    </q-menu>
                  </q-btn>
                </template>

                <!-- Empty state: click to pick datasets -->
                <template v-else>
                  <q-btn flat dense no-caps size="sm" class="dataset-empty-btn q-px-xs">
                    <q-icon name="folder_open" size="14px" color="grey-6" class="q-mr-xs" />
                    <span class="text-grey-6" style="font-size:12px">All datasets</span>
                    <q-menu anchor="top left" self="bottom left" :offset="[0, 4]">
                      <q-list style="min-width: 200px">
                        <q-item-label header class="text-caption text-grey-6 q-pt-sm q-pb-xs">Filter by dataset</q-item-label>
                        <q-item
                          v-for="opt in datasetOptions"
                          :key="opt.value"
                          clickable v-close-popup
                          @click="toggleDataset(opt.value)"
                        >
                          <q-item-section avatar>
                            <q-icon name="folder_open" size="14px" color="grey-6" />
                          </q-item-section>
                          <q-item-section>
                            <q-item-label class="text-caption">{{ opt.label }}</q-item-label>
                          </q-item-section>
                        </q-item>
                        <q-item v-if="datasetOptions.length === 0">
                          <q-item-section class="text-grey text-caption">No datasets</q-item-section>
                        </q-item>
                      </q-list>
                    </q-menu>
                  </q-btn>
                </template>

                <q-space />

                <!-- Connection dot -->
                <q-icon
                  name="circle"
                  :color="isConnected ? 'positive' : 'grey-4'"
                  size="8px"
                  class="q-mr-xs"
                >
                  <q-tooltip>{{ isConnected ? 'Connected' : 'Connecting…' }}</q-tooltip>
                </q-icon>

                <!-- Send / Stop button -->
                <q-btn
                  round unelevated
                  :icon="isLoading ? 'stop' : 'arrow_upward'"
                  :color="(inputMessage.trim() || isLoading) ? 'primary' : 'grey-3'"
                  :text-color="(inputMessage.trim() || isLoading) ? 'white' : 'grey-5'"
                  :disable="!inputMessage.trim() && !isLoading"
                  size="sm"
                  class="send-btn"
                  @click="isLoading ? abortSession() : sendMessage()"
                >
                  <q-tooltip>{{ isLoading ? 'Stop' : 'Send (Enter)' }}</q-tooltip>
                </q-btn>
              </div>
            </div>

            <div class="text-caption text-grey-5 text-center q-mt-xs">
              Enter to send &nbsp;·&nbsp; Shift+Enter for new line
            </div>
          </div>
        </div>
      </div>

      <!-- ── Session sidebar ────────────────────────────────────────────── -->
      <div class="session-sidebar">

        <!-- Header -->
        <div class="sidebar-header row items-center no-wrap q-px-md">
          <q-item-label class="text-grey-7 text-uppercase text-weight-bold font-xs col">
            Sessions
          </q-item-label>
          <q-btn flat round dense icon="add" color="grey-6" size="sm" @click="createNewSession">
            <q-tooltip>New session</q-tooltip>
          </q-btn>
        </div>

        <q-separator color="grey-3" />

        <q-virtual-scroll
          :items="sessionList.length > 0 ? sessionList : [{ id: '__empty__', title: '', time: new Date() }]"
          :virtual-scroll-item-size="56"
          :style="{ height: sessionListHeight }"
          class="session-list-scroll"
        >
          <template v-slot="{ item: sessRaw }">
            <div v-if="(sessRaw as SessionItem).id === '__empty__'" class="text-caption text-grey-5 text-center q-py-lg">
              No sessions yet
            </div>
            <q-item
              v-else
              :key="(sessRaw as SessionItem).id"
              clickable v-ripple
              :active="(sessRaw as SessionItem).id === sessionId"
              active-class="session-item--active"
              class="session-item q-my-xs q-mx-sm"
              @click="switchSession((sessRaw as SessionItem).id)"
            >
              <q-item-section>
                <q-item-label
                  lines="1"
                  class="text-caption text-weight-medium"
                  :class="(sessRaw as SessionItem).id === sessionId ? 'text-white' : 'text-grey-8'"
                >
                  {{ (sessRaw as SessionItem).title || 'Untitled' }}
                </q-item-label>
                <q-item-label caption :class="(sessRaw as SessionItem).id === sessionId ? 'text-blue-3' : 'text-grey-5'">
                  {{ formatSessionTime((sessRaw as SessionItem).time) }}
                </q-item-label>
              </q-item-section>

              <q-item-section side class="session-item__delete">
                <q-btn
                  flat round dense icon="close" size="xs"
                  :color="(sessRaw as SessionItem).id === sessionId ? 'white' : 'grey-5'"
                  @click.stop="deleteSession((sessRaw as SessionItem).id)"
                >
                  <q-tooltip>Delete</q-tooltip>
                </q-btn>
              </q-item-section>
            </q-item>
          </template>
        </q-virtual-scroll>
      </div>

    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useQuasar, QInfiniteScroll, QInput } from 'quasar';
import { createOpencodeClient } from '@opencode-ai/sdk';
import type { TextPart, ToolPart, ToolStateRunning, ReasoningPart, EventSessionError, Message } from '@opencode-ai/sdk';
import { createOpencodeClient as createOpencodeClientV2 } from '@opencode-ai/sdk/v2';
import type { QuestionRequest, PermissionRequest, QuestionAnswer } from '@opencode-ai/sdk/v2';
import { MarkdownRender } from 'markstream-vue';
import 'markstream-vue/index.css';
import AgentToolCall from 'src/components/AgentToolCall.vue';
import AgentReasoning from 'src/components/AgentReasoning.vue';
import AgentQuestion from 'src/components/AgentQuestion.vue';
import AgentPermission from 'src/components/AgentPermission.vue';
import { KnowledgeService, type Dataset } from 'src/services/knowledge';

// ── Types ─────────────────────────────────────────────────────────────────────

type DisplayPart = TextPart | ToolPart | ReasoningPart;

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  time: Date;
  parts: DisplayPart[];
  /** true once session.idle fires — tells MarkdownRender stream is complete */
  final: boolean;
}

interface SessionItem {
  id: string;
  title: string;
  time: Date;
}

/** Shape of each entry returned by client.session.messages */
type RawMessageEntry = {
  info: Message & { sessionID?: string; parentID?: string; time?: { created?: number } };
  parts: DisplayPart[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENCODE_BASE_URL = import.meta.env.VITE_OPENCODE_URL ?? 'http://localhost:4097';
const AGENT_NAME = 'cognee-coder';

// ── Refs ──────────────────────────────────────────────────────────────────────

const $q = useQuasar();
const messagesAreaRef = ref<HTMLElement | null>(null);
const infiniteScrollRef = ref<QInfiniteScroll | null>(null);
const inputRef = ref<QInput | null>(null);

const pageHeight = ref(0);
const inputAreaHeight = 150;

function pageFn(offset: number, height: number) {
  pageHeight.value = height - offset;
  return { minHeight: pageHeight.value + 'px' };
}

const messagesAreaStyle = computed(() => {
  if (pageHeight.value === 0) return {};
  return { height: `${pageHeight.value - inputAreaHeight}px` };
});

const sessionListHeight = computed(() =>
  pageHeight.value > 0 ? `${pageHeight.value - inputAreaHeight}px` : '70vh'
);

// Chat state
const displayMessages = ref<DisplayMessage[]>([]);
/** Set to true once all history is loaded — stops q-infinite-scroll from triggering again */
const historyExhausted = ref(false);
const inputMessage = ref('');
const isLoading = ref(false);
const isConnected = ref(false);
const sessionId = ref<string | null>(null);

// Session list
const sessionList = ref<SessionItem[]>([]);

// Datasets
const datasets = ref<Dataset[]>([]);
const selectedDatasets = ref<string[]>([]);

// ── OpenCode client ───────────────────────────────────────────────────────────

const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
const clientV2 = createOpencodeClientV2({ baseUrl: OPENCODE_BASE_URL });

let sseAbort: AbortController | null = null;
/**
 * Maps server messageID → displayMessages entry id.
 * - For user messages: displayId = server messageID (1:1)
 * - For assistant messages: displayId = parentID (many server msgs → one display entry)
 */
const msgToDisplayId = new Map<string, string>();

/** Per-part accumulated text (reactive map, updated on each delta event) */
const partText = ref<Map<string, string>>(new Map());

/** Pending question request from the AI (shown above input area) */
const pendingQuestion = ref<QuestionRequest | null>(null);
/** Pending permission request from the AI (shown above input area) */
const pendingPermission = ref<PermissionRequest | null>(null);

// ── Computed ──────────────────────────────────────────────────────────────────

const datasetOptions = computed(() =>
  datasets.value.map(ds => ({ value: ds.id, label: ds.name }))
);

// ── Suggestions ───────────────────────────────────────────────────────────────

const suggestions = [
  'What documents do I have?',
  'Summarize my knowledge base',
  'What are the main topics?',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the plain text of a user message (joining all text parts). */
function getUserMessageText(msg: DisplayMessage): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function formatSessionTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function scrollToBottom() {
  const el = messagesAreaRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function scrollToBottomNow() {
  void nextTick(() => scrollToBottom());
}

/** Returns true when the scroll container is within 80px of the bottom. */
function isAtBottom(): boolean {
  const el = messagesAreaRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

/** Scroll to bottom only when the user hasn't scrolled up to read history. */
function scrollIfAtBottom() {
  if (isAtBottom()) scrollToBottomNow();
}

/**
 * Called by q-infinite-scroll when the user scrolls to the top.
 * Currently we load all messages at once, so there is nothing more to fetch —
 * call done(true) immediately to stop further triggers.
 * When the API gains pagination support, implement incremental loading here.
 */
function onLoadHistory(_index: number, done: (stop?: boolean) => void) {
  done(true);
}

function toggleDataset(id: string) {
  const idx = selectedDatasets.value.indexOf(id);
  if (idx === -1) {
    selectedDatasets.value.push(id);
  } else {
    selectedDatasets.value.splice(idx, 1);
  }
}

function buildSystemPromptInjection(): string | undefined {
  if (selectedDatasets.value.length === 0) return undefined;
  const names = selectedDatasets.value.map(id => {
    const ds = datasets.value.find(d => d.id === id);
    return ds ? ds.name : id;
  });
  const namesJson = JSON.stringify(names);
  return `## MANDATORY Knowledge Base Constraints

The user has selected specific datasets. You MUST pass the following dataset names as the \`datasets\` argument on EVERY call to the \`search\` MCP tool. Never omit this argument.

datasets: ${namesJson}

Example of a correctly formed search call:
\`\`\`
search(search_query="...", search_type="CHUNKS", top_k=10, datasets=${namesJson})
\`\`\`

Failure to include \`datasets\` in every search call is an error.`;
}

// ── Session list ──────────────────────────────────────────────────────────────

/** Resets all per-session chat state. Call before switching / deleting a session. */
function resetChatState() {
  displayMessages.value = [];
  historyExhausted.value = false;
  msgToDisplayId.clear();
  partText.value = new Map();
  pendingQuestion.value = null;
  pendingPermission.value = null;
}

/** Upsert a session entry — updates in-place if exists, prepends if new. */
function upsertSession(item: SessionItem) {
  const existing = sessionList.value.find(s => s.id === item.id);
  if (existing) {
    existing.title = item.title || existing.title;
    existing.time = item.time;
  } else {
    sessionList.value.unshift(item);
  }
}

async function loadSessionList() {
  try {
    const res = await client.session.list({ query: { roots: 'true' } as { directory?: string } });
    const list = res.data ?? [];
    const fetched = (list as { id: string; title?: string; time?: { created?: number } }[])
      .map(s => ({
        id: s.id,
        title: s.title ?? 'Untitled',
        time: new Date(s.time?.created ?? Date.now()),
      }))
      .sort((a, b) => b.time.getTime() - a.time.getTime());
    // Merge: keep any locally-added sessions that aren't in the remote list yet
    const fetchedIds = new Set(fetched.map(s => s.id));
    const localOnly = sessionList.value.filter(s => !fetchedIds.has(s.id));
    sessionList.value = [...localOnly, ...fetched].sort((a, b) => b.time.getTime() - a.time.getTime());
  } catch {
    // silent
  }
}

async function loadSessionMessages(sid: string) {
  resetChatState();
  // Reset infinite scroll index so it can trigger again on next session load
  infiniteScrollRef.value?.reset();
  try {
    const res = await client.session.messages({ path: { id: sid } });
    const msgs = res.data ?? [];

    for (const entry of msgs as RawMessageEntry[]) {
      const { info, parts } = entry;
      if (!info?.id || !info?.role) continue;

      const displayParts = parts.filter(
        (p): p is TextPart | ToolPart | ReasoningPart =>
          p.type === 'text' || p.type === 'tool' || p.type === 'reasoning'
      );

      // Pre-parse historical text parts (final=true, stream is already complete)
      for (const p of displayParts) {
        if (p.type === 'text') {
          partText.value.set(p.id, p.text);
        }
      }

      if (info.role === 'user') {
        // User message: own id is the display id
        msgToDisplayId.set(info.id, info.id);
        displayMessages.value.push({
          id: info.id,
          role: 'user',
          time: new Date(info.time?.created ?? Date.now()),
          parts: displayParts,
          final: true,
        });
      } else {
        // Assistant message: group by parentID.
        // Prefix with "asst:" so the display id never collides with the user
        // message that has the same id as parentID.
        const displayId = `asst:${info.parentID ?? info.id}`;
        msgToDisplayId.set(info.id, displayId);
        const existing = displayMessages.value.find(m => m.id === displayId);
        if (existing) {
          existing.parts.push(...displayParts);
        } else {
          displayMessages.value.push({
            id: displayId,
            role: 'assistant',
            time: new Date(info.time?.created ?? Date.now()),
            parts: displayParts,
            final: true,
          });
        }
      }
    }
    // All messages loaded — mark history exhausted so infinite scroll stops triggering.
    historyExhausted.value = true;
    await nextTick();
    scrollToBottomNow();

    // Restore any pending question/permission for this session after page reload
    try {
      const [qRes, pRes] = await Promise.all([
        clientV2.question.list(),
        clientV2.permission.list(),
      ]);
      const questions: QuestionRequest[] = (qRes as { data?: QuestionRequest[] }).data ?? [];
      const permissions: PermissionRequest[] = (pRes as { data?: PermissionRequest[] }).data ?? [];

      // Find any tool part with status 'running' (called and awaiting permission)
      const allParts = displayMessages.value.flatMap(m => m.parts);
      const runningToolParts = allParts.filter(
        (p): p is ToolPart => p.type === 'tool' && p.state.status === 'running'
      );

      // Convert running tool parts that have no live permission request to 'error'
      // (mirrors backend processor.ts behavior when a session ends mid-tool)
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
      // Match permission to a running tool part by callID, or fall back to sessionID match
      const runningCallIDs = new Set(runningToolParts.filter(p => p.state.status === 'running').map(p => p.callID));
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
    const session = unwrapSession(await client.session.create({}));
    upsertSession({
      id: session.id,
      title: session.title ?? 'Untitled',
      time: new Date(session.time?.created ?? Date.now()),
    });
    sessionId.value = session.id;
    resetChatState();
    void nextTick(() => { inputRef.value?.focus(); });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to create session', icon: 'error' });
  }
}

async function deleteSession(sid: string) {
  try {
    await client.session.delete({ path: { id: sid } });
    sessionList.value = sessionList.value.filter(s => s.id !== sid);
    if (sessionId.value === sid) {
      sessionId.value = null;
      resetChatState();
    }
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to delete session', icon: 'error' });
  }
}

// ── Session management ────────────────────────────────────────────────────────

type RawSession = { id: string; title?: string; time?: { created?: number } };

/** The SDK wraps the response in `{ data }` but the type doesn't always reflect it. */
function unwrapSession(res: unknown): RawSession {
  return ((res as { data?: RawSession }).data ?? res) as RawSession;
}

async function ensureSession(): Promise<string> {
  if (sessionId.value) return sessionId.value;
  const session = unwrapSession(await client.session.create({}));
  sessionId.value = session.id;
  upsertSession({
    id: session.id,
    title: session.title ?? 'Untitled',
    time: new Date(session.time?.created ?? Date.now()),
  });
  return session.id;
}

// ── SSE subscription ──────────────────────────────────────────────────────────

function startEventSubscription() {
  sseAbort = new AbortController();

  void (async () => {
    try {
      const result = await client.event.subscribe({});
      for await (const event of result.stream) {
        if (sseAbort?.signal.aborted) break;
        handleEvent(event);
      }
    } catch {
      // AbortError or connection closed — not fatal
    }
  })();
}

function handleEvent(raw: unknown) {
  const ev = raw as { type?: string; properties?: unknown };
  if (!ev?.type) return;

  if (ev.type === 'server.connected') {
    isConnected.value = true;

  } else if (ev.type === 'session.updated') {
    const e = ev as { properties: { info: { id: string; title?: string; time?: { created?: number }; parentID?: string } } };
    const info = e.properties?.info;
    if (!info?.id) return;
    if (info.parentID) return;  // skip sub-agent sessions
    upsertSession({
      id: info.id,
      title: info.title ?? 'Untitled',
      time: new Date(info.time?.created ?? Date.now()),
    });

  } else if (ev.type === 'message.updated') {
    type InfoShape = { id: string; role: 'user' | 'assistant'; sessionID?: string; parentID?: string; time?: { created?: number } };
    const e = ev as { type: string; properties: { info: InfoShape } };
    const { info } = e.properties;
    if (!info?.id || !info?.role) return;
    if (info.sessionID && info.sessionID !== sessionId.value) return;

    if (info.role === 'user') {
      msgToDisplayId.set(info.id, info.id);
      if (!displayMessages.value.find(m => m.id === info.id)) {
        displayMessages.value.push({ id: info.id, role: 'user', time: new Date(info.time?.created ?? Date.now()), parts: [], final: false });
        scrollToBottomNow();
      }
    } else {
      // Assistant: display entry key = "asst:" + parentID so it never
      // collides with the user message that owns the same id as parentID.
      const displayId = `asst:${info.parentID ?? info.id}`;
      msgToDisplayId.set(info.id, displayId);
      if (!displayMessages.value.find(m => m.id === displayId)) {
        displayMessages.value.push({ id: displayId, role: 'assistant', time: new Date(info.time?.created ?? Date.now()), parts: [], final: false });
        scrollToBottomNow();
      }
    }

  } else if (ev.type === 'message.part.delta') {
    // Incremental delta: update the relevant part in-place, then re-parse text nodes
    const e = ev as { type: string; properties: { sessionID: string; messageID: string; partID: string; field: string; delta: string } };
    const { sessionID, messageID, partID, field, delta } = e.properties;
    if (sessionID && sessionID !== sessionId.value) return;
    if (field !== 'text') return;

    // Accumulate delta into partText buffer
    const prev = partText.value.get(partID) ?? '';
    const accumulated = prev + delta;
    partText.value.set(partID, accumulated);

    // Update reasoning part text in-place (Vue 3 reactive proxy tracks property mutations)
    const displayId = msgToDisplayId.get(messageID);
    if (displayId) {
      const msg = displayMessages.value.find(m => m.id === displayId);
      if (msg) {
        const part = msg.parts.find(p => p.id === partID);
        if (part?.type === 'reasoning') {
          (part as ReasoningPart).text = accumulated;
        }
      }
    }

    scrollIfAtBottom();

  } else if (ev.type === 'message.part.updated') {
    const e = ev as { type: string; properties: { part: TextPart | ToolPart | ReasoningPart } };
    const { part } = e.properties;
    if (!part) return;
    if (part.type !== 'text' && part.type !== 'tool' && part.type !== 'reasoning') return;
    if (part.sessionID && part.sessionID !== sessionId.value) return;

    // Resolve display entry via msgToDisplayId
    let displayId = msgToDisplayId.get(part.messageID);
    if (!displayId) {
      displayId = `asst:${part.messageID}`;
      msgToDisplayId.set(part.messageID, displayId);
      displayMessages.value.push({ id: displayId, role: 'assistant', time: new Date(), parts: [], final: false });
    }

    let msg = displayMessages.value.find(m => m.id === displayId);
    if (!msg) {
      msg = { id: displayId, role: 'assistant', time: new Date(), parts: [], final: false };
      displayMessages.value.push(msg);
    }

    const idx = msg.parts.findIndex(p => p.id === part.id);
    if (idx === -1) {
      // New part: push it. For text/reasoning, delta events accumulate text separately,
      // so preserve whatever is in the buffer rather than using the potentially empty server value.
      if (part.type === 'text' || part.type === 'reasoning') {
        const bufferedText = partText.value.get(part.id);
        if (bufferedText) {
          part.text = bufferedText;
        }
      }
      msg.parts.push(part);
    } else {
      // Existing part: update metadata but preserve delta-accumulated text
      if (part.type === 'text' || part.type === 'reasoning') {
        const bufferedText = partText.value.get(part.id);
        // Use the longer of buffered vs server text (server may trim on completion)
        if (bufferedText && bufferedText.length > (part.text?.length ?? 0)) {
          part.text = bufferedText;
        }
      }
      msg.parts.splice(idx, 1, part);
    }

    // Fallback: if no delta events have populated partText yet (e.g. non-streaming load),
    // seed the buffer from part.text
    if (part.type === 'text' && !partText.value.has(part.id) && part.text) {
      partText.value.set(part.id, part.text);
    }

    scrollIfAtBottom();

  } else if (ev.type === 'session.idle') {
    isLoading.value = false;
    for (const m of displayMessages.value) {
      if (m.role === 'assistant') m.final = true;
    }
    // Finalize streaming — MarkdownRender handles final settle via the `final` prop
    scrollToBottomNow();

  } else if (ev.type === 'session.error') {
    const e = ev as EventSessionError;
    isLoading.value = false;
    const errMsg = typeof e.properties.error === 'string' ? e.properties.error : 'Agent error';
    $q.notify({ color: 'negative', message: errMsg, icon: 'error' });

  } else if (ev.type === 'question.asked') {
    const q = (ev as { type: string; properties: QuestionRequest }).properties;
    if (q.sessionID === sessionId.value) {
      pendingQuestion.value = q;
    }

  } else if (ev.type === 'question.replied' || ev.type === 'question.rejected') {
    const props = (ev as { type: string; properties: { sessionID: string; requestID: string } }).properties;
    if (pendingQuestion.value?.id === props.requestID) {
      pendingQuestion.value = null;
    }

  } else if (ev.type === 'permission.asked') {
    const p = (ev as { type: string; properties: PermissionRequest }).properties;
    if (p.sessionID === sessionId.value) {
      pendingPermission.value = p;
    }

  } else if (ev.type === 'permission.replied') {
    const props = (ev as { type: string; properties: { sessionID: string; requestID: string } }).properties;
    if (pendingPermission.value?.id === props.requestID) {
      pendingPermission.value = null;
    }
  }
}

// ── Send message ──────────────────────────────────────────────────────────────

async function sendMessage() {
  const text = inputMessage.value.trim();
  if (!text || isLoading.value) return;

  // Handle /compact slash command
  if (text === '/compact') {
    inputMessage.value = '';
    await runCompact();
    return;
  }

  inputMessage.value = '';
  isLoading.value = true;

  try {
    const sid = await ensureSession();

    const system = buildSystemPromptInjection();
    await client.session.promptAsync({
      path: { id: sid },
      body: {
        agent: AGENT_NAME,
        parts: [{ type: 'text', text }],
        ...(system ? { system } : {}),
      },
    });
  } catch (err) {
    isLoading.value = false;
    $q.notify({
      color: 'negative',
      message: (err instanceof Error ? err.message : null) ?? 'Failed to send message. Is the OpenCode agent running?',
      icon: 'error',
    });
  }
}

async function runCompact() {
  if (!sessionId.value) {
    $q.notify({ color: 'warning', message: 'No active session to compact', icon: 'info' });
    return;
  }

  // Find providerID/modelID from the last assistant message
  let providerID = '';
  let modelID = '';
  try {
    const res = await client.session.messages({ path: { id: sessionId.value } });
    const msgs = (res.data ?? res) as { info: { role?: string; providerID?: string; modelID?: string } }[];
    const lastAsst = [...msgs].reverse().find(m => m.info?.role === 'assistant' && m.info?.providerID);
    if (lastAsst?.info?.providerID && lastAsst?.info?.modelID) {
      providerID = lastAsst.info.providerID;
      modelID = lastAsst.info.modelID;
    }
  } catch {
    // fall through — will notify below
  }

  if (!providerID || !modelID) {
    $q.notify({ color: 'warning', message: 'Cannot determine model for compaction — send a message first', icon: 'info' });
    return;
  }

  $q.notify({ color: 'info', message: 'Compacting session…', icon: 'compress', timeout: 2000 });

  try {
    await client.session.summarize({
      path: { id: sessionId.value },
      body: { providerID, modelID },
    });
    $q.notify({ color: 'positive', message: 'Session compacted', icon: 'check' });
  } catch (err) {
    $q.notify({
      color: 'negative',
      message: (err instanceof Error ? err.message : null) ?? 'Compaction failed',
      icon: 'error',
    });
  }
}

async function abortSession() {
  if (!sessionId.value) return;
  try {
    await client.session.abort({ path: { id: sessionId.value } });
  } catch {
    // ignore
  }
  isLoading.value = false;
}

// ── Question / Permission callbacks ───────────────────────────────────────────

async function replyToQuestion(requestID: string, answers: QuestionAnswer[]) {
  try {
    await clientV2.question.reply({ requestID, answers });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to reply to question', icon: 'error' });
  }
}

async function rejectQuestion(requestID: string) {
  try {
    await clientV2.question.reject({ requestID });
  } catch {
    // silent — dock is dismissed regardless
  }
  pendingQuestion.value = null;
}

async function replyToPermission(requestID: string, reply: 'once' | 'always' | 'reject') {
  try {
    await clientV2.permission.reply({ requestID, reply });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to respond to permission', icon: 'error' });
  }
}

// ── Input handling ────────────────────────────────────────────────────────────

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (inputMessage.value.trim() && !isLoading.value) {
      void sendMessage();
    }
  }
}

function useSuggestion(s: string) {
  inputMessage.value = s;
  void sendMessage();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function loadDatasets() {
  try {
    datasets.value = await KnowledgeService.getDatasets();
  } catch {
    // silent
  }
}

onMounted(() => {
  void loadDatasets();
  void loadSessionList();
  void startEventSubscription();
  void nextTick(() => {
    inputRef.value?.focus();
  });
});

onUnmounted(() => {
  sseAbort?.abort();
});
</script>

<style lang="scss" scoped>
// ── Page shell ────────────────────────────────────────────────────────────────

.agent-page {
  background: #f0f2f5;
}

.page-layout {
  display: flex;
  flex-direction: row;
  height: 100%;
  min-height: inherit;
}

// ── Chat area ─────────────────────────────────────────────────────────────────

.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #f0f2f5;
}

.messages-area {
  width: 100%;
  overflow-y: auto;
}

// ── Welcome / empty state ─────────────────────────────────────────────────────

.welcome-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 48px 24px;
}

.suggestions {
  max-width: 640px;
}

.suggestion-chip {
  border-radius: 20px;
  font-size: 13px;
  padding: 6px 14px;
  border-color: #d0d5dd;

  &:hover {
    border-color: $primary;
    color: $primary;
    background: rgba(25, 118, 210, 0.05);
  }
}

// ── Message row (virtual scroll item) ────────────────────────────────────────

.message-row {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;

  // Sent (user) message: shrink bubble to content width, flush right
  :deep(.q-message-container.reverse > div:not(.q-message-avatar)) {
    max-width: 75%;
  }
}

// ── Text part (markdown) ──────────────────────────────────────────────────────

.assistant-content {
  max-width: 100%;
  word-break: break-word;
  overflow-wrap: break-word;
}

.thinking-indicator {
  padding: 2px 0 6px;
}

.text-part {
  font-size: 14px;
  line-height: 1.65;
  color: #1e293b;
  word-break: break-word;
  overflow-wrap: break-word;

  :deep(p) {
    margin: 0 0 10px;
    &:last-child { margin-bottom: 0; }
  }

  :deep(h1), :deep(h2), :deep(h3), :deep(h4) {
    margin: 12px 0 6px;
    font-weight: 600;
    line-height: 1.3;
  }

  :deep(code) {
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.08);
    padding: 1px 5px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', monospace;
    font-size: 0.875em;
    word-break: break-all;
  }

  :deep(pre) {
    background: #1e1e2e;
    color: #cdd6f4;
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 10px 0;
    font-size: 0.875em;
    max-height: 400px;

    code {
      background: none;
      border: none;
      padding: 0;
      color: inherit;
      word-break: normal;
    }
  }

  :deep(ul), :deep(ol) {
    padding-left: 22px;
    margin: 4px 0 10px;
    li { margin-bottom: 3px; }
  }

  :deep(blockquote) {
    border-left: 3px solid $primary;
    margin: 8px 0;
    padding: 6px 12px;
    color: $grey-7;
    background: rgba(25, 118, 210, 0.04);
    border-radius: 0 6px 6px 0;
  }

  :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
    font-size: 13px;

    th, td {
      border: 1px solid $grey-3;
      padding: 6px 10px;
      text-align: left;
    }

    th { background: $grey-2; font-weight: 600; }
    tr:nth-child(even) { background: $grey-1; }
  }
}

// ── Input area ────────────────────────────────────────────────────────────────

.input-area {
  background: #f0f2f5;
  padding: 12px 20px 16px;
  border-top: 1px solid #e2e8f0;
}

.input-container {
  position: relative;
  max-width: 1080px;
  margin: 0 auto;
}

// Unified card wrapping textarea + action bar
.input-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 4px 12px 8px;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus-within {
    border-color: $primary;
    box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.1);
  }
}

.chat-input {
  :deep(.q-field__control) {
    padding: 0;
    min-height: unset;
  }

  :deep(textarea) {
    font-size: 14px;
    min-height: 40px;
    max-height: 180px;
    padding-top: 10px;
    padding-bottom: 4px;
    line-height: 1.5;
    resize: none;
  }
}

.input-actions {
  min-height: 36px;
}

.dataset-chip {
  max-width: 160px;

  :deep(.q-chip__content) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }
}

.dataset-add-btn {
  width: 20px;
  height: 20px;
  min-width: unset;
}

.dataset-empty-btn {
  border-radius: 8px;
  padding: 2px 6px;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}

.send-btn {
  width: 32px;
  height: 32px;
  margin: 4px 2px;
  transition: background 0.15s;
}

// ── Session sidebar ───────────────────────────────────────────────────────────

.session-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.sidebar-header {
  height: 49px;

  .font-xs {
    font-size: 0.7rem;
    letter-spacing: 0.08em;
  }
}

.session-item {
  border-radius: 8px;
  transition: background 0.12s;

  // Only show delete button on hover / when active
  .session-item__delete {
    opacity: 0;
    transition: opacity 0.12s;
  }

  &:hover .session-item__delete,
  &.session-item--active .session-item__delete {
    opacity: 1;
  }

  &.session-item--active {
    background: $primary;
  }
}
</style>
