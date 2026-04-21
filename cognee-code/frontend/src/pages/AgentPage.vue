<template>
  <q-page class="agent-page-root fit">
    <UILayout container view="hhr lpr ffr" class="agent-layout-shell">
      <UILayoutHeader bordered class="agent-page-header" :height-hint="60">
      <q-toolbar class="q-px-md q-py-xs">
        <div class="col min-width-0">
          <div v-if="currentParentSession" class="text-caption text-grey-6 row items-center no-wrap breadcrumb-row">
            <q-btn
              flat
              dense
              no-caps
              size="sm"
              class="breadcrumb-parent-btn q-px-none"
              color="grey-7"
              :label="getSessionLabel(currentParentSession)"
              @click="handleSwitchSession(currentParentSession.id)"
            />
            <q-icon name="chevron_right" size="16px" color="grey-5" />
          </div>
          <div class="text-subtitle2 text-weight-medium text-dark ellipsis">
            {{ currentSessionLabel }}
          </div>
        </div>

        <div v-if="isLoading" class="row items-center no-wrap text-caption text-grey-6 q-gutter-xs">
          <q-spinner-dots size="16px" color="primary" />
          <span>{{ sessionStatus === 'retry' ? t('agent.retrying') : t('agentReasoning.thinking') }}</span>
        </div>
      </q-toolbar>
      </UILayoutHeader>

      <UILayoutDrawer
        side="right"
        :width="260"
        bordered
        behavior="desktop"
        :model-value="true"
        class="session-sidebar"
      >
      <div class="sidebar-header row items-center no-wrap q-px-md">
        <q-item-label class="text-grey-7 text-uppercase text-weight-bold font-xs col">
          {{ t('agent.sessions') }}
        </q-item-label>
        <q-btn flat round dense icon="add" color="grey-6" size="sm" @click="createNewSession">
          <q-tooltip>{{ t('agent.newSession') }}</q-tooltip>
        </q-btn>
      </div>

      <q-separator color="grey-3" />

      <div class="session-sidebar__body">
        <q-virtual-scroll
          :items="sessionList"
          :virtual-scroll-item-size="56"
          class="session-list-scroll"
        >
          <template v-slot="{ item: session }">
            <div v-if="!session" class="text-caption text-grey-5 text-center q-py-lg">
              {{ t('agent.noSessions') }}
            </div>
            <q-item
              v-else
              :key="session.id"
              clickable
              v-ripple
              :active="isSessionActive(session)"
              active-class="session-item--active"
              class="session-item q-my-xs q-mx-sm"
              @click="handleSwitchSession(session.id)"
            >
              <q-item-section avatar class="session-item__tree-icon">
                <q-icon
                  name="chat_bubble_outline"
                  size="16px"
                  :color="isSessionActive(session) ? 'white' : 'grey-5'"
                />
              </q-item-section>

              <q-item-section>
                <q-item-label
                  lines="1"
                  class="text-caption text-weight-medium"
                  :class="isSessionActive(session) ? 'text-white' : 'text-grey-8'"
                >
                  {{ getSessionLabel(session) }}
                </q-item-label>
                <q-item-label caption :class="isSessionActive(session) ? 'text-blue-3' : 'text-grey-5'">
                  {{ formatSessionTime(session.time) }}
                </q-item-label>
              </q-item-section>

              <q-item-section side class="session-item__delete">
                <q-btn
                  flat
                  round
                  dense
                  icon="close"
                  size="xs"
                  :color="isSessionActive(session) ? 'white' : 'grey-5'"
                  @click.stop="deleteSession(session.id)"
                >
                  <q-tooltip>{{ t('agent.deleteSession') }}</q-tooltip>
                </q-btn>
              </q-item-section>
            </q-item>
          </template>
        </q-virtual-scroll>
      </div>
      </UILayoutDrawer>

      <UILayoutPageContainer>
        <UILayoutPage class="agent-page">
        <div class="chat-area relative-position">
          <div class="chat-body">
            <div ref="messagesAreaRef" class="messages-area relative-position">
              <q-inner-loading :showing="isSessionSwitching" color="primary" />
              <div v-if="!isSessionSwitching && displayMessages.length === 0" class="welcome-section">
                <q-avatar size="64px" color="primary" text-color="white">
                  <q-icon name="smart_toy" size="36px" />
                </q-avatar>
                <div class="text-h5 text-weight-bold q-mt-md text-dark">{{ t('agent.title') }}</div>
                <div class="text-body2 text-grey-6 q-mt-xs">
                  {{ t('agent.subtitle') }}
                </div>
                <div class="suggestions q-mt-xl row q-col-gutter-sm justify-center">
                  <div v-for="s in suggestions" :key="s" class="col-auto">
                    <q-btn
                      outline
                      no-caps
                      unelevated
                      color="grey-6"
                      :label="s"
                      class="suggestion-chip"
                      @click="useSuggestion(s)"
                    />
                  </div>
                </div>
              </div>

              <q-infinite-scroll
                v-else
                ref="infiniteScrollRef"
                reverse
                :scroll-target="messagesAreaRef ?? undefined"
                :disable="historyExhausted || historyLoading"
                @load="onLoadHistory"
              >
                <template v-slot:loading>
                  <div class="row justify-center q-py-sm">
                    <q-spinner-dots size="24px" color="grey-5" />
                  </div>
                </template>

                <div v-for="turn in displayTurns" :key="turn.user.id" class="message-turn q-px-lg q-pt-sm">
                  <q-chat-message sent bg-color="primary" text-color="white">
                    <template v-slot:avatar>
                      <q-avatar color="primary" text-color="white" size="36px" class="q-ml-sm">
                        <q-icon name="person" size="20px" />
                      </q-avatar>
                    </template>
                    <template v-slot:default>
                      <div class="user-message-content">
                        <div v-if="getUserComments(turn.user).length > 0" class="user-comments q-mb-sm">
                          <div v-for="comment in getUserComments(turn.user)" :key="comment.id" class="user-comment-card">
                            <div class="row items-center q-gutter-xs text-caption text-blue-grey-2">
                              <q-icon name="comment" size="14px" />
                              <span class="text-weight-medium">{{ t('agent.context') }}</span>
                              <span v-if="comment.path" class="ellipsis user-comment-path">{{ comment.path }}</span>
                            </div>
                            <div v-if="comment.preview" class="user-comment-preview text-caption q-mt-xs">{{ comment.preview }}</div>
                            <div class="q-mt-xs">{{ comment.comment }}</div>
                          </div>
                        </div>
                        <div v-if="getUserContextFiles(turn.user).length > 0" class="user-context-files q-mb-sm">
                          <div class="text-caption text-blue-grey-2 q-mb-xs">{{ t('agent.context') }}</div>
                          <div class="row q-col-gutter-xs q-row-gutter-xs">
                            <div v-for="attachment in getUserContextFiles(turn.user)" :key="attachment.id" class="col-auto">
                              <div class="user-context-chip">
                                <q-icon :name="attachment.mime.includes('image') ? 'image' : 'description'" size="14px" />
                                <span class="ellipsis">{{ attachment.filename || t('agent.attachment') }}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div v-if="getUserAttachments(turn.user).length > 0" class="user-attachments q-mb-sm">
                          <div v-for="attachment in getUserAttachments(turn.user)" :key="attachment.id" class="user-attachment-chip">
                            <img
                              v-if="attachment.mime.includes('image')"
                              :src="attachment.url"
                              :alt="attachment.filename || t('agent.attachment')"
                              class="user-attachment-image"
                            >
                            <template v-else>
                              <q-icon name="attach_file" size="14px" />
                              <span class="ellipsis">{{ attachment.filename || t('agent.attachment') }}</span>
                            </template>
                          </div>
                        </div>
                        <AgentUserMessageBody
                          v-if="getUserMessageText(turn.user)"
                          :text="getUserMessageText(turn.user)"
                          :references="getUserContextFiles(turn.user)"
                          :agents="getUserAgentMentions(turn.user)"
                        />
                        <div v-if="getUserMetaLabel(turn.user) || canRevertTurn(turn.user)" class="user-message-footer q-mt-sm row items-center justify-between q-gutter-sm">
                          <div v-if="getUserMetaLabel(turn.user)" class="user-message-meta">{{ getUserMetaLabel(turn.user) }}</div>
                          <div class="row items-center q-gutter-xs">
                            <q-btn flat dense round size="sm" icon="content_copy" color="white" class="user-turn-action" @click="copyTurn(turn.user)">
                              <q-tooltip>{{ t('shared.copy') }}</q-tooltip>
                            </q-btn>
                            <q-btn v-if="canRevertTurn(turn.user)" flat dense round size="sm" icon="history" color="white" class="user-turn-action" @click="revertTurn(turn.user)">
                              <q-tooltip>{{ t('agent.restore') }}</q-tooltip>
                            </q-btn>
                          </div>
                        </div>
                      </div>
                    </template>
                  </q-chat-message>

                  <q-chat-message v-if="turn.assistant || shouldShowAssistantPlaceholder(turn)" size="11" bg-color="grey-1">
                    <template v-slot:avatar>
                      <q-avatar color="grey-8" text-color="white" size="36px" class="q-mr-sm">
                        <q-icon name="smart_toy" size="20px" />
                      </q-avatar>
                    </template>
                    <template v-slot:default>
                      <div v-if="turn.assistant" class="assistant-content">
                        <div v-if="shouldShowAssistantPlaceholder(turn)" class="row items-center q-gutter-xs thinking-indicator">
                          <q-spinner-dots size="16px" color="grey-5" />
                          <span class="text-caption text-grey-5">
                            {{ sessionStatus === 'retry' ? t('agent.retrying') : getAssistantThinkingLabel(turn) }}
                          </span>
                        </div>
                        <template v-for="part in turn.assistant.parts" :key="part.id">
                          <AgentReasoning
                            v-if="part.type === 'reasoning' && (partText.get(part.id) ?? part.text ?? '').trim()"
                            :part="part"
                            :text="partText.get(part.id) ?? part.text ?? ''"
                          />
                          <AgentToolCall
                            v-else-if="part.type === 'tool' && !shouldHideToolPart(part)"
                            :part="part"
                            :attention-call-id="activeAttentionCallId"
                            :child-session-label="getToolChildSessionLabel(part)"
                            @open-child-session="handleSwitchSession"
                          />
                          <AgentFilePart v-else-if="part.type === 'file'" :part="part" />
                          <AgentSubtaskPart v-else-if="part.type === 'subtask'" :part="part" />
                          <AgentSimplePart v-else-if="part.type === 'agent'" icon="smart_toy" title="Agent" :description="part.name" />
                          <AgentSimplePart v-else-if="part.type === 'snapshot'" icon="history" title="Snapshot" :description="part.snapshot" />
                          <AgentSimplePart v-else-if="part.type === 'retry'" icon="refresh" title="Retry" :description="`Attempt ${part.attempt}: ${formatRetryError(part.error)}`" />
                          <AgentSimplePart v-else-if="part.type === 'compaction'" icon="compress" title="Compaction" :description="part.auto ? 'Automatic compaction' : 'Manual compaction'" />
                          <div v-else-if="part.type === 'text'" class="text-part">
                            <MarkdownRender
                              :content="partText.get(part.id) ?? part.text ?? ''"
                              :final="!(isLoading && isActiveAssistantTurn(turn))"
                            />
                            <q-spinner-dots
                              v-if="isLoading && isActiveAssistantTurn(turn) && part.id === getLastTextPartId(turn.assistant)"
                              size="1em"
                              color="primary"
                            />
                          </div>
                        </template>

                        <div v-if="getTurnMetaLabel(turn) || getAssistantCopyText(turn.assistant)" class="assistant-turn-footer row items-center justify-between q-gutter-sm q-mt-sm">
                          <div v-if="getTurnMetaLabel(turn)" class="turn-meta-label text-caption text-grey-5">
                            {{ getTurnMetaLabel(turn) }}
                          </div>
                          <q-btn
                            v-if="getAssistantCopyText(turn.assistant)"
                            flat
                            dense
                            round
                            size="sm"
                            icon="content_copy"
                            color="grey-6"
                            class="assistant-turn-action"
                            @click="copyAssistantTurn(turn.assistant)"
                          >
                            <q-tooltip>{{ t('shared.copy') }}</q-tooltip>
                          </q-btn>
                        </div>
                      </div>
                      <div v-else class="assistant-content">
                        <div class="row items-center q-gutter-xs thinking-indicator">
                          <q-spinner-dots size="16px" color="grey-5" />
                          <span class="text-caption text-grey-5">{{ sessionStatus === 'retry' ? t('agent.retrying') : t('agentReasoning.thinking') }}</span>
                        </div>
                      </div>
                    </template>
                  </q-chat-message>
                </div>

                <div style="height: 24px" />
              </q-infinite-scroll>
            </div>
          </div>
        </div>
        </UILayoutPage>
      </UILayoutPageContainer>

      <UILayoutFooter bordered class="agent-page-footer" :height-hint="140">
      <div class="input-area">
        <div class="input-container">
          <AgentQuestion
            v-if="pendingQuestion"
            :request="pendingQuestion"
            :on-reply="replyToQuestion"
            :on-reject="rejectQuestion"
          />

          <div v-if="sessionTodos.length > 0" class="todo-dock q-mb-sm">
            <div class="row items-center justify-between q-mb-xs">
              <div class="text-caption text-grey-7 text-weight-medium">
                {{ t('agent.todoProgress', { done: completedTodoCount, total: sessionTodos.length }) }}
              </div>
              <div v-if="activeTodoLabel" class="text-caption text-grey-6 ellipsis todo-dock__preview">
                {{ activeTodoLabel }}
              </div>
            </div>
            <div class="todo-dock__list">
              <div v-for="todo in sessionTodos" :key="todo.content" class="todo-dock__item row no-wrap items-start q-gutter-sm">
                <q-icon
                  :name="todo.status === 'completed' ? 'check_circle' : todo.status === 'in_progress' ? 'more_horiz' : todo.status === 'cancelled' ? 'cancel' : 'radio_button_unchecked'"
                  :color="todo.status === 'completed' ? 'positive' : todo.status === 'in_progress' ? 'primary' : todo.status === 'cancelled' ? 'grey-5' : 'grey-4'"
                  size="16px"
                  class="q-mt-xs"
                />
                <div class="col text-body2" :class="{ 'text-grey-5': todo.status === 'completed' || todo.status === 'cancelled' }">
                  {{ todo.content }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="revertMessagePreview" class="revert-dock q-mb-sm row items-center justify-between q-gutter-sm">
            <div class="col min-width-0">
              <div class="text-caption text-grey-6">{{ t('agent.revertActive') }}</div>
              <div class="text-body2 text-weight-medium ellipsis">{{ revertMessagePreview }}</div>
            </div>
            <div class="row items-center q-gutter-sm">
              <q-btn flat dense no-caps size="sm" color="warning" :label="t('agent.restore')" @click="restoreRevert" />
              <q-icon name="history" size="18px" color="warning" />
            </div>
          </div>

          <div v-if="currentQueuedFollowups.length > 0" class="followup-dock q-mb-sm">
            <button type="button" class="followup-dock__header row items-center justify-between q-gutter-sm" @click="followupCollapsed = !followupCollapsed">
              <div class="text-caption text-grey-7 text-weight-medium">
                {{ currentQueuedFollowups.length === 1 ? t('agent.followupOne') : t('agent.followupMany', { count: currentQueuedFollowups.length }) }}
              </div>
              <div v-if="followupCollapsed" class="text-caption text-grey-6 ellipsis followup-dock__preview">
                {{ currentQueuedFollowups[0] ? getFollowupPreview(currentQueuedFollowups[0]) : '' }}
              </div>
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="expand_more"
                color="grey-6"
                class="followup-dock__toggle"
                :class="{ 'followup-dock__toggle--collapsed': followupCollapsed }"
                @click.stop="followupCollapsed = !followupCollapsed"
              />
            </button>
            <div v-if="followupsPaused" class="text-caption text-warning q-mb-sm q-mt-xs">
              {{ t('agent.followupPaused') }}
            </div>
            <div v-if="!followupCollapsed" class="followup-dock__list">
              <div v-for="item in currentQueuedFollowups" :key="item.id" class="followup-dock__item row items-center q-gutter-sm">
                <div class="col min-width-0">
                  <div class="text-body2 ellipsis">{{ getFollowupPreview(item) }}</div>
                  <div v-if="failedFollowupId[sessionId || ''] === item.id" class="text-caption text-negative q-mt-xs">
                    {{ t('agent.followupFailed') }}
                  </div>
                </div>
                <q-btn dense no-caps size="sm" color="primary" :loading="sendingFollowupId === item.id" :label="t('agent.sendNow')" @click="sendQueuedFollowup(item.id, true)" />
                <q-btn flat dense no-caps size="sm" color="grey-7" :disable="sendingFollowupId === item.id" :label="t('common.edit')" @click="editQueuedFollowup(item.id)" />
              </div>
            </div>
          </div>

          <AgentPermission
            v-if="pendingPermission"
            :request="pendingPermission"
            :on-respond="replyToPermission"
          />

          <AgentPromptInput
            v-if="!currentParentSession"
            ref="inputRef"
            :draft="draftInputMessage"
            :loading="isLoading"
            :connected="isConnected"
            :disabled="isLoading"
            :attachments="pendingAttachments"
            :selected-datasets="selectedDatasets"
            :dataset-options="datasetOptions"
            @submit="submitDraftMessage"
            @abort="abortSession"
            @toggle-dataset="toggleDataset"
            @clear-datasets="selectedDatasets = []"
            @remove-attachment="removeAttachment"
            @attach-files="onFilesSelected"
          />
          <div v-else class="child-session-input-disabled text-body2 text-grey-7">
            <span>{{ t('agent.childInputDisabled') }}</span>
            <q-btn
              flat
              dense
              no-caps
              color="primary"
              class="q-ml-sm"
              :label="t('agent.backToParent')"
              @click="handleSwitchSession(currentParentSession.id)"
            />
          </div>
        </div>
      </div>
    </UILayoutFooter>
    </UILayout>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useQuasar, QInfiniteScroll } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { AgentPart, FilePart, TextPart, ToolPart } from '@opencode-ai/sdk/v2';
import { MarkdownRender } from 'markstream-vue';
import 'markstream-vue/index.css';
import AgentToolCall from 'src/components/AgentToolCall.vue';
import AgentReasoning from 'src/components/AgentReasoning.vue';
import AgentQuestion from 'src/components/AgentQuestion.vue';
import AgentPermission from 'src/components/AgentPermission.vue';
import AgentFilePart from 'src/components/AgentFilePart.vue';
import AgentPromptInput from 'src/components/AgentPromptInput.vue';
import AgentSubtaskPart from 'src/components/AgentSubtaskPart.vue';
import AgentSimplePart from 'src/components/AgentSimplePart.vue';
import AgentUserMessageBody from 'src/components/AgentUserMessageBody.vue';
import { UILayout, UILayoutDrawer, UILayoutFooter, UILayoutHeader, UILayoutPage, UILayoutPageContainer } from 'src/components/ui/layout';
import type { SessionItem } from 'src/services/agents';
import { useAgentSession, type DisplayMessage } from 'src/composables/useAgentSession';

type DisplayTurn = {
  user: DisplayMessage;
  assistant: DisplayMessage | null;
};

// ── UI refs ───────────────────────────────────────────────────────────────────

const $q = useQuasar();
const { t } = useI18n();
const followupCollapsed = ref(false);
const isSessionSwitching = ref(false);
const messagesAreaRef = ref<HTMLElement | null>(null);
const infiniteScrollRef = ref<QInfiniteScroll | null>(null);
const inputRef = ref<{ focus: () => void; setDraft: (value: string) => void } | null>(null);
const draftInputMessage = ref('');

const currentParentSession = computed<SessionItem | null>(() => {
  if (!sessionId.value) return null;

  const sessions = getAllSessions();
  const session = sessions.find((item) => item.id === sessionId.value);
  return session?.parentID
    ? sessions.find((item) => item.id === session.parentID) ?? null
    : null;
});

function getChildTaskDescription(session: SessionItem): string {
  const parentId = session.parentID;
  if (!parentId) return '';

  const parentEntries = sessionMessages.value[parentId] ?? [];
  for (let entryIndex = parentEntries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const parts = parentEntries[entryIndex]?.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part?.type !== 'tool' || part.tool !== 'task') continue;

      const state = part.state as {
        metadata?: Record<string, unknown>;
        input?: Record<string, unknown>;
      };
      const metadataSessionId = typeof state.metadata?.sessionId === 'string' ? state.metadata.sessionId : undefined;
      if (metadataSessionId !== session.id) continue;

      const description = state.input?.description;
      if (typeof description === 'string' && description.trim()) {
        return description.trim();
      }
    }
  }

  return '';
}

function getSessionLabel(session: SessionItem): string {
  const childDescription = getChildTaskDescription(session);
  if (childDescription) return childDescription;

  const title = session.title?.trim();
  if (!title) return t('agent.untitled');
  return title.replace(/\s+\(@[^)]+ subagent\)$/, '');
}

function isSessionActive(session: SessionItem): boolean {
  if (!sessionId.value) return false;
  if (session.id === sessionId.value) return true;
  return currentParentSession.value?.id === session.id;
}

function getAllSessions(): SessionItem[] {
  const nested = Object.values(childSessions.value).flatMap((items) => items);
  return [...sessionList.value, ...nested];
}

function getToolChildSessionLabel(part: ToolPart): string | null {
  if (part.tool !== 'task') return null;

  const metadata = (part.state as { metadata?: Record<string, unknown> }).metadata;
  const childSessionId = typeof metadata?.sessionId === 'string' ? metadata.sessionId : undefined;
  if (!childSessionId) return null;

  const childSession = getAllSessions().find((session) => session.id === childSessionId);
  return childSession ? getSessionLabel(childSession) : null;
}

function cleanHeadingText(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .trim();
}

function extractHeading(text: string): string {
  const markdown = text.replace(/\r\n?/g, '\n');

  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (html?.[1]) {
    const value = cleanHeadingText(html[1].replace(/<[^>]+>/g, ' '));
    if (value) return value;
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m);
  if (atx?.[1]) {
    const value = cleanHeadingText(atx[1]);
    if (value) return value;
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m);
  if (setext?.[1]) {
    const value = cleanHeadingText(setext[1]);
    if (value) return value;
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m);
  if (strong?.[1]) {
    const value = cleanHeadingText(strong[1]);
    if (value) return value;
  }

  return '';
}

function getAssistantTurnHeading(message: DisplayMessage): string {
  if (message.role !== 'assistant') return '';

  const reasoningPart = message.parts.find((part) => (
    part.type === 'reasoning' && (partText.value.get(part.id) ?? part.text ?? '').trim()
  ));
  if (reasoningPart?.type === 'reasoning') {
    const heading = extractHeading(partText.value.get(reasoningPart.id) ?? reasoningPart.text ?? '');
    if (heading) return heading;
  }

  return '';
}

function getAssistantThinkingLabel(turn: DisplayTurn): string {
  const heading = turn.assistant ? getAssistantTurnHeading(turn.assistant) : '';
  if (heading) return heading;
  return t('agentReasoning.thinking');
}

function getLastTextPartId(message: DisplayMessage): string | undefined {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part?.type === 'text') {
      return part.id;
    }
  }
  return undefined;
}

function formatTurnDuration(ms?: number): string {
  if (typeof ms !== 'number' || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getTurnMetaLabel(turn: DisplayTurn): string {
  const created = formatSessionTime(turn.user.time);
  const assistantTime = turn.assistant?.info?.time;
  const completed = assistantTime && 'completed' in assistantTime ? assistantTime.completed : undefined;
  const started = turn.user.info?.time?.created;
  const assistantInfo = turn.assistant?.info?.role === 'assistant' ? turn.assistant.info : undefined;
  const provider = assistantInfo?.providerID;
  const model = assistantInfo?.modelID;
  const agent = assistantInfo?.agent;
  const head = [agent, provider && model ? `${provider}/${model}` : model].filter(Boolean).join(' · ');

  if (typeof completed === 'number' && typeof started === 'number' && completed >= started) {
    const duration = formatTurnDuration(completed - started);
    const items = [head, created, duration].filter(Boolean);
    if (items.length > 0) return items.join(' · ');
  }

  return [head, created].filter(Boolean).join(' · ');
}

function getAssistantCopyText(message: DisplayMessage | null): string {
  if (!message || message.role !== 'assistant') return '';

  return message.parts
    .flatMap((part) => {
      if (part.type === 'text') {
        return [partText.value.get(part.id) ?? part.text ?? ''];
      }
      if (part.type === 'reasoning' && part.text?.trim()) {
        return [part.text];
      }
      return [];
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n');
}

function copyAssistantTurn(message: DisplayMessage | null) {
  const text = getAssistantCopyText(message);
  if (!text) return;
  void navigator.clipboard.writeText(text);
}

function shouldShowAssistantPlaceholder(turn: DisplayTurn): boolean {
  if (!isActiveAssistantTurn(turn)) return false;
  if (!isLoading.value) return false;
  if (sessionStatus.value === 'retry') return false;
  return getVisibleAssistantPartCount(turn.assistant) === 0;
}

function isActiveAssistantTurn(turn: DisplayTurn): boolean {
  return displayTurns.value.at(-1)?.user.id === turn.user.id;
}

function isVisibleAssistantPart(part: DisplayMessage['parts'][number]): boolean {
  if (part.type === 'tool') return !shouldHideToolPart(part);
  if (part.type === 'text' || part.type === 'reasoning') {
    return !!(partText.value.get(part.id) ?? part.text ?? '').trim();
  }
  return true;
}

function getVisibleAssistantPartCount(message: DisplayMessage | null): number {
  if (!message || message.role !== 'assistant') return 0;
  return message.parts.filter((part) => isVisibleAssistantPart(part)).length;
}

function shouldHideToolPart(part: ToolPart): boolean {
  if (part.tool === 'todowrite') return true;
  return part.tool === 'question' && (part.state.status === 'pending' || part.state.status === 'running');
}

const currentSessionLabel = computed(() => {
  if (!sessionId.value) return t('agent.untitled');

  const activeSession = getAllSessions().find((session) => session.id === sessionId.value);
  return activeSession ? getSessionLabel(activeSession) : t('agent.untitled');
});

const currentSessionItem = computed<SessionItem | null>(() => {
  if (!sessionId.value) return null;

  return getAllSessions().find((session) => session.id === sessionId.value) ?? null;
});

const activeAttentionCallId = computed(() => {
  return pendingPermission.value?.tool?.callID ?? pendingQuestion.value?.tool?.callID ?? null;
});

const completedTodoCount = computed(() => sessionTodos.value.filter((todo) => todo.status === 'completed').length);

const activeTodoLabel = computed(() => {
  return sessionTodos.value.find((todo) => todo.status === 'in_progress')?.content
    ?? sessionTodos.value.find((todo) => todo.status === 'pending')?.content
    ?? sessionTodos.value.at(-1)?.content
    ?? '';
});

const revertMessagePreview = computed(() => {
  const revertMessageId = currentSessionItem.value?.revert?.messageID;
  if (!revertMessageId) return '';

  const revertedMessage = displayMessages.value.find((message) => message.id === revertMessageId && message.role === 'user');
  if (!revertedMessage) return revertMessageId;

  const text = getUserMessageText(revertedMessage).trim();
  return text || revertMessageId;
});

const displayTurns = computed<DisplayTurn[]>(() => {
  const turns: DisplayTurn[] = [];
  const revertMessageId = currentSessionItem.value?.revert?.messageID;

  for (const message of displayMessages.value) {
    if (message.role === 'user') {
      if (revertMessageId && message.id >= revertMessageId) {
        continue;
      }
      turns.push({ user: message, assistant: null });
      continue;
    }

    const userId = message.id.replace(/^asst:/, '');
    const existing = turns.find((turn) => turn.user.id === userId);
    if (existing) {
      existing.assistant = message;
    }
  }

  return turns;
});

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
  historyLoading,
  inputMessage,
  isLoading,
  isConnected,
  sessionId,
  sessionStatus,
  sessionList,
  childSessions,
  sessionMessages,
  selectedDatasets,
  pendingAttachments,
  currentQueuedFollowups,
  failedFollowupId,
  followupsPaused,
  sendingFollowupId,
  partText,
  pendingQuestion,
  pendingPermission,
  sessionTodos,
  datasetOptions,
  loadAgents,
  loadCommands,
  loadDatasets,
  loadSessionList,
  loadOlderMessages,
  switchSession,
  createNewSession,
  deleteSession,
  toggleDataset,
  addAttachment,
  removeAttachment,
  sendMessage,
  sendQueuedFollowup,
  editQueuedFollowup,
  getFollowupPreview,
  abortSession,
  replyToQuestion,
  rejectQuestion,
  replyToPermission,
  restoreRevert,
  revertMessage,
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
  t('agent.askDocs'),
  t('agent.summarizeBase'),
  t('agent.mainTopics'),
];

// ── UI helpers ────────────────────────────────────────────────────────────────

function getUserMessageText(msg: DisplayMessage): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
    .map(p => p.text)
    .join('');
}

function getUserAttachments(msg: DisplayMessage): FilePart[] {
  return msg.parts.filter((part): part is FilePart => part.type === 'file' && part.url.startsWith('data:'));
}

function getUserContextFiles(msg: DisplayMessage): FilePart[] {
  return msg.parts.filter((part): part is FilePart => part.type === 'file' && !part.url.startsWith('data:'));
}

type UserComment = {
  id: string;
  path?: string;
  comment: string;
  preview?: string;
};

function getUserComments(msg: DisplayMessage): UserComment[] {
  return msg.parts.flatMap((part) => {
    if (part.type !== 'text' || !part.synthetic) return [];

    const metadata = (part as TextPart & { metadata?: Record<string, unknown> }).metadata;
    const raw = metadata && typeof metadata === 'object'
      ? (metadata as { opencodeComment?: unknown }).opencodeComment
      : undefined;

    if (!raw || typeof raw !== 'object') return [];

    const path = typeof (raw as { path?: unknown }).path === 'string'
      ? (raw as { path: string }).path
      : undefined;
    const comment = typeof (raw as { comment?: unknown }).comment === 'string'
      ? (raw as { comment: string }).comment.trim()
      : '';
    const preview = typeof (raw as { preview?: unknown }).preview === 'string'
      ? (raw as { preview: string }).preview
      : undefined;

    if (!comment) return [];

    return [{
      id: part.id,
      ...(path ? { path } : {}),
      comment,
      ...(preview ? { preview } : {}),
    }];
  });
}

function getUserAgentMentions(msg: DisplayMessage): AgentPart[] {
  return msg.parts.filter((part): part is AgentPart => part.type === 'agent');
}

function getUserMetaLabel(msg: DisplayMessage): string {
  const items = [
    ...getUserAgentMentions(msg).map((part) => `@${part.name}`),
    formatSessionTime(msg.time),
  ].filter(Boolean);

  return items.join(' · ');
}

function canRevertTurn(msg: DisplayMessage): boolean {
  if (!currentSessionItem.value) return false;
  return currentSessionItem.value.revert?.messageID !== msg.id;
}

function revertTurn(msg: DisplayMessage) {
  void revertMessage(msg.id);
}

function copyTurn(msg: DisplayMessage) {
  const parts = [
    ...getUserComments(msg).map((comment) => comment.comment),
    getUserMessageText(msg),
  ].filter((value) => value.trim());

  if (parts.length === 0) return;

  void navigator.clipboard.writeText(parts.join('\n\n'));
}

function formatSessionTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return t('agent.justNow');
  if (diff < 3_600_000) return t('agent.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('agent.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatRetryError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') return error.message;
    if ('name' in error && typeof error.name === 'string') return error.name;
    try {
      return JSON.stringify(error);
    } catch {
      return t('agentTool.unserializable');
    }
  }
  if (error == null) return 'Unknown error';
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') return String(error);
  return 'Unknown error';
}

/**
 * Called by q-infinite-scroll when the user scrolls to the top.
 * Load older messages until exhausted.
 */
function onLoadHistory(_index: number, done: (stop?: boolean) => void) {
  void loadOlderMessages()
    .then((hasMore) => done(!hasMore))
    .catch(() => done(true));
}

function useSuggestion(s: string) {
  inputRef.value?.setDraft(s);
  void submitDraftMessage(s);
}

async function submitDraftMessage(value: string) {
  const next = value;
  if (!next.trim() && pendingAttachments.value.length === 0) return;
  inputMessage.value = next;
  inputRef.value?.setDraft('');
  await sendMessage();
}

async function handleSwitchSession(sid: string) {
  if (!sid || sid === sessionId.value) return;

  isSessionSwitching.value = true;
  try {
    await switchSession(sid);
  } finally {
    isSessionSwitching.value = false;
  }
}

function onFilesSelected(files: File[]) {
  if (files.length === 0) return;

  void Promise.all(files.map((file) => addAttachment(file)))
    .catch(() => {
      $q.notify({ color: 'negative', message: 'Failed to attach file', icon: 'error' });
    });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  void loadAgents();
  void loadCommands();
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

.agent-layout-shell {
  flex: 1;
  height: 100%;
  min-height: 0;
}

.agent-page-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.agent-page {
  background: #f0f2f5;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.agent-page-header {
  background: rgba(240, 242, 245, 0.92);
  backdrop-filter: blur(8px);
}

.agent-page-footer {
  background: #f0f2f5;
}

// ── Chat area ─────────────────────────────────────────────────────────────────

.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #f0f2f5;
}

.chat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.breadcrumb-row {
  min-width: 0;
}

.breadcrumb-parent-btn {
  min-width: 0;

  :deep(.q-btn__content) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    max-width: 240px;
  }
}

.related-session-row {
  max-width: 100%;
}

.related-session-btn {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.25);
  max-width: 240px;

  :deep(.q-btn__content) {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.related-session-btn--active {
  background: rgba(25, 118, 210, 0.1);
  border-color: rgba(25, 118, 210, 0.25);
}

.messages-area {
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow-y: auto;

  :deep(.q-infinite-scroll) {
    min-height: 100%;
  }
}

.input-area {
  flex-shrink: 0;
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

.user-message-content {
  max-width: 100%;
  word-break: break-word;
  overflow-wrap: break-word;
}

.user-attachments {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-comments {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-comment-card {
  max-width: min(100%, 520px);
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.user-comment-path {
  max-width: 260px;
}

.user-comment-preview {
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.12);
  color: rgba(255, 255, 255, 0.82);
  white-space: pre-wrap;
}

.user-context-files {
  max-width: 100%;
}

.user-context-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-size: 12px;
  line-height: 1.3;
}

.user-attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(100%, 320px);
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.22);
  font-size: 12px;
  line-height: 1.3;
}

.user-attachment-image {
  display: block;
  width: 120px;
  max-width: min(100%, 220px);
  max-height: 120px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.24);
}

.user-message-footer {
  min-height: 24px;
}

.user-message-meta {
  font-size: 12px;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.72);
}

.user-turn-action {
  background: rgba(255, 255, 255, 0.12);
}

.assistant-turn-footer {
  min-height: 24px;
}

.assistant-turn-action {
  background: rgba(148, 163, 184, 0.08);
}

.assistant-turn-heading {
  margin: 0 0 8px;
  font-weight: 600;
  letter-spacing: 0.01em;
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

.todo-dock {
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(255, 255, 255, 0.85);
  border-radius: 14px;
  padding: 10px 12px;
}

.todo-dock__preview {
  max-width: 55%;
}

.todo-dock__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
}

.todo-dock__item {
  align-items: flex-start;
}

.revert-dock {
  border: 1px solid rgba(245, 158, 11, 0.25);
  background: rgba(255, 251, 235, 0.92);
  border-radius: 14px;
  padding: 10px 12px;
}

.followup-dock {
  border: 1px solid rgba(59, 130, 246, 0.2);
  background: rgba(239, 246, 255, 0.92);
  border-radius: 14px;
  padding: 10px 12px;
}

.followup-dock__header {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}

.followup-dock__preview {
  max-width: 55%;
}

.followup-dock__toggle {
  transition: transform 0.15s ease;
}

.followup-dock__toggle--collapsed {
  transform: rotate(180deg);
}

.followup-dock__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
}

.followup-dock__item {
  min-width: 0;
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

.hidden-file-input {
  display: none;
}

.attachment-chip-row {
  max-width: 100%;
}

.attachment-chip {
  max-width: 240px;

  :deep(.q-chip__content) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
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
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.session-sidebar__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.session-list-scroll {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.child-session-input-disabled {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(255, 255, 255, 0.92);
  padding: 14px 16px;
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

.session-item--child {
  position: relative;
}

.session-item__tree-icon {
  min-width: 24px;
}
</style>
