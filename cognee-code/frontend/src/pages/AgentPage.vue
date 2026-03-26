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
                           :final="!(isLoading && (msgRaw as DisplayMessage).id === `asst:${curUserMessage?.id}`)"
                         />
                         <q-spinner-dots
                           v-if="isLoading && (msgRaw as DisplayMessage).id === `asst:${curUserMessage?.id}` && part.id === (msgRaw as DisplayMessage).parts.filter(p => p.type === 'text').at(-1)?.id"
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
import type { TextPart } from '@opencode-ai/sdk/v2';
import { MarkdownRender } from 'markstream-vue';
import 'markstream-vue/index.css';
import AgentToolCall from 'src/components/AgentToolCall.vue';
import AgentReasoning from 'src/components/AgentReasoning.vue';
import AgentQuestion from 'src/components/AgentQuestion.vue';
import AgentPermission from 'src/components/AgentPermission.vue';
import type { SessionItem } from 'src/services/agents';
import { useAgentSession, type DisplayMessage } from 'src/composables/useAgentSession';

// ── UI refs ───────────────────────────────────────────────────────────────────

const $q = useQuasar();
const messagesAreaRef = ref<HTMLElement | null>(null);
const infiniteScrollRef = ref<QInfiniteScroll | null>(null);
const inputRef = ref<QInput | null>(null);

// ── Layout ────────────────────────────────────────────────────────────────────

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

// ── Scroll helpers ────────────────────────────────────────────────────────────

function scrollToBottom() {
  const el = messagesAreaRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function scrollToBottomNow() {
  void nextTick(() => scrollToBottom());
}

function isAtBottom(): boolean {
  const el = messagesAreaRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollIfAtBottom() {
  if (isAtBottom()) scrollToBottomNow();
}

// ── Composable ────────────────────────────────────────────────────────────────

const {
  displayMessages,
  historyExhausted,
  inputMessage,
  isLoading,
  isConnected,
  sessionId,
  sessionList,
  selectedDatasets,
  partText,
  pendingQuestion,
  pendingPermission,
  datasetOptions,
  curUserMessage,
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
} = useAgentSession(
  scrollToBottomNow,
  scrollIfAtBottom,
  (msg) => $q.notify({ color: 'negative', message: msg, icon: 'error' }),
  (msg, opts) => $q.notify({ color: 'info', message: msg, icon: opts?.icon ?? 'info', ...(opts?.timeout !== undefined ? { timeout: opts.timeout } : {}) }),
  (msg) => $q.notify({ color: 'positive', message: msg, icon: 'check' }),
  () => void nextTick(() => inputRef.value?.focus()),
);

// ── Suggestions ───────────────────────────────────────────────────────────────

const suggestions = [
  'What documents do I have?',
  'Summarize my knowledge base',
  'What are the main topics?',
];

// ── UI helpers ────────────────────────────────────────────────────────────────

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

/**
 * Called by q-infinite-scroll when the user scrolls to the top.
 * We load all messages at once, so call done(true) to stop further triggers.
 */
function onLoadHistory(_index: number, done: (stop?: boolean) => void) {
  done(true);
}

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

onMounted(() => {
  void loadDatasets();
  void loadSessionList();
  startEventSubscription();
  void nextTick(() => inputRef.value?.focus());
});

onUnmounted(() => {
  stopEventSubscription();
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
