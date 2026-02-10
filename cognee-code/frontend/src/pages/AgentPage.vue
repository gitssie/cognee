<template>
  <q-page class="agent-page">
    <!-- Chat Container -->
    <div class="chat-container">
      <!-- Messages Area -->
      <div ref="messagesContainer" class="messages-area">
        <!-- Welcome Message (when no messages) -->
        <div v-if="messages.length === 0" class="welcome-section">
          <div class="text-center">
            <q-avatar size="80px" color="primary" text-color="white" icon="smart_toy" />
            <div class="text-h4 q-mt-lg text-weight-bold">Cognee AI Agent</div>
            <div class="text-subtitle1 text-grey-6 q-mt-sm">
              Ask questions about your knowledge base
            </div>
          </div>

          <!-- Quick Start Suggestions -->
          <div class="suggestions q-mt-xl">
            <div class="text-caption text-grey-5 q-mb-md text-center">Try asking:</div>
            <div class="row q-col-gutter-md justify-center">
              <div 
                v-for="suggestion in suggestions" 
                :key="suggestion"
                class="col-auto"
              >
                <q-btn
                  outline
                  color="grey-7"
                  :label="suggestion"
                  no-caps
                  class="suggestion-btn"
                  @click="useSuggestion(suggestion)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Chat Messages -->
        <div v-else class="messages-list">
          <div
            v-for="message in messages"
            :key="message.id"
            class="message-wrapper"
            :class="{ 'user-message': message.role === 'user' }"
          >
            <div class="message-row">
              <!-- Avatar -->
              <q-avatar 
                :color="message.role === 'user' ? 'grey-4' : 'primary'" 
                :text-color="message.role === 'user' ? 'grey-8' : 'white'"
                size="36px"
                class="message-avatar"
              >
                <q-icon :name="message.role === 'user' ? 'person' : 'smart_toy'" size="20px" />
              </q-avatar>

              <!-- Message Content -->
              <div class="message-content">
                <div class="message-header">
                  <span class="text-weight-medium">
                    {{ message.role === 'user' ? 'You' : 'Cognee AI' }}
                  </span>
                  <span class="text-caption text-grey-5 q-ml-sm">
                    {{ formatTime(message.timestamp) }}
                  </span>
                </div>
                <div class="message-text" :class="{ 'loading-text': message.loading }">
                  <template v-if="message.loading">
                    <q-spinner-dots size="24px" color="primary" />
                    <span class="text-grey-6 q-ml-sm">Thinking...</span>
                  </template>
                  <template v-else>
                    <div v-html="formatMessageContent(message.content)"></div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Input Area (Fixed at bottom) -->
      <div class="input-area">
        <div class="input-container">
          <!-- Settings Bar -->
          <div class="settings-bar">
            <q-select
              v-model="selectedDatasets"
              :options="datasetOptions"
              label="Datasets"
              outlined
              dense
              multiple
              emit-value
              map-options
              use-chips
              clearable
              class="dataset-select"
              style="min-width: 200px"
            >
              <template v-slot:prepend>
                <q-icon name="folder" size="sm" />
              </template>
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">No datasets</q-item-section>
                </q-item>
              </template>
            </q-select>

            <q-select
              v-model="searchType"
              :options="searchTypeOptions"
              label="Mode"
              outlined
              dense
              emit-value
              map-options
              style="min-width: 160px"
            >
              <template v-slot:prepend>
                <q-icon name="tune" size="sm" />
              </template>
            </q-select>
          </div>

          <!-- Message Input -->
          <div class="message-input-wrapper">
            <q-input
              ref="inputRef"
              v-model="inputMessage"
              placeholder="Ask anything about your knowledge base..."
              outlined
              autogrow
              :maxlength="4000"
              :disable="isLoading"
              class="message-input"
              @keydown="handleKeydown"
            >
              <template v-slot:append>
                <q-btn
                  round
                  flat
                  :icon="isLoading ? 'stop' : 'send'"
                  :color="inputMessage.trim() ? 'primary' : 'grey-5'"
                  :disable="!inputMessage.trim() && !isLoading"
                  @click="isLoading ? cancelRequest() : sendMessage()"
                >
                  <q-tooltip>{{ isLoading ? 'Stop' : 'Send message' }}</q-tooltip>
                </q-btn>
              </template>
            </q-input>
          </div>

          <div class="text-caption text-grey-5 text-center q-mt-sm">
            Press Enter to send, Shift+Enter for new line
          </div>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useQuasar, QInput } from 'quasar';
import { ChatService, ChatSearchType, type ChatMessage } from 'src/services/chat';
import { KnowledgeService, type Dataset } from 'src/services/knowledge';

const $q = useQuasar();

// Refs
const messagesContainer = ref<HTMLElement | null>(null);
const inputRef = ref<QInput | null>(null);

// State
const messages = ref<ChatMessage[]>([]);
const inputMessage = ref('');
const isLoading = ref(false);
const datasets = ref<Dataset[]>([]);
const selectedDatasets = ref<string[]>([]);
const searchType = ref<ChatSearchType>(ChatSearchType.GRAPH_COMPLETION);

// Abort controller for canceling requests
let abortController: AbortController | null = null;

// Suggestions for empty state
const suggestions = [
  'What documents do I have?',
  'Summarize my knowledge base',
  'What are the main topics?',
];

// Computed
const datasetOptions = computed(() => {
  return datasets.value.map(ds => ({
    value: ds.id,
    label: ds.name,
  }));
});

const searchTypeOptions = [
  { value: ChatSearchType.GRAPH_COMPLETION, label: 'Knowledge Graph' },
  { value: ChatSearchType.RAG_COMPLETION, label: 'RAG' },
  { value: ChatSearchType.GRAPH_COMPLETION_COT, label: 'Chain of Thought' },
];

// Watch messages to auto-scroll
watch(messages, () => {
  void nextTick(() => {
    scrollToBottom();
  });
}, { deep: true });

// Methods
async function loadDatasets() {
  try {
    datasets.value = await KnowledgeService.getDatasets();
  } catch {
    // Silent fail
  }
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMessageContent(content: string): string {
  // Basic markdown-like formatting
  return content
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (inputMessage.value.trim() && !isLoading.value) {
      void sendMessage();
    }
  }
}

function useSuggestion(suggestion: string) {
  inputMessage.value = suggestion;
  void sendMessage();
}

async function sendMessage() {
  const messageText = inputMessage.value.trim();
  if (!messageText) return;

  // Add user message
  const userMessage: ChatMessage = {
    id: ChatService.generateMessageId(),
    role: 'user',
    content: messageText,
    timestamp: new Date(),
  };
  messages.value.push(userMessage);

  // Clear input
  inputMessage.value = '';

  // Add loading message
  const loadingMessage: ChatMessage = {
    id: ChatService.generateMessageId(),
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    loading: true,
  };
  messages.value.push(loadingMessage);

  isLoading.value = true;
  abortController = new AbortController();

  try {
    const request: Parameters<typeof ChatService.sendMessage>[0] = {
      query: messageText,
      search_type: searchType.value,
    };
    if (selectedDatasets.value.length > 0) {
      request.dataset_ids = selectedDatasets.value;
    }
    const response = await ChatService.sendMessage(request);

    // Replace loading message with actual response
    const loadingIndex = messages.value.findIndex(m => m.id === loadingMessage.id);
    if (loadingIndex !== -1) {
      messages.value[loadingIndex] = {
        ...loadingMessage,
        content: response,
        loading: false,
      };
    }
  } catch (error) {
    // Remove loading message on error
    const loadingIndex = messages.value.findIndex(m => m.id === loadingMessage.id);
    if (loadingIndex !== -1) {
      messages.value.splice(loadingIndex, 1);
    }

    // Check if it was cancelled
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }

    $q.notify({
      color: 'negative',
      message: 'Failed to get response. Please try again.',
      icon: 'error',
    });
  } finally {
    isLoading.value = false;
    abortController = null;
  }
}

function cancelRequest() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  isLoading.value = false;

  // Remove loading message
  const loadingIndex = messages.value.findIndex(m => m.loading);
  if (loadingIndex !== -1) {
    messages.value.splice(loadingIndex, 1);
  }
}

// Lifecycle
onMounted(() => {
  void loadDatasets();
  
  // Focus input
  void nextTick(() => {
    inputRef.value?.focus();
  });
});
</script>

<style lang="scss" scoped>
.agent-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  height: 100%;
}

.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  padding-bottom: 16px;
}

.welcome-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 40px 20px;
}

.suggestions {
  max-width: 600px;
}

.suggestion-btn {
  border-radius: 20px;
  padding: 8px 16px;
  
  &:hover {
    background-color: rgba(25, 118, 210, 0.08);
    border-color: $primary;
  }
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.message-wrapper {
  &.user-message {
    .message-row {
      background-color: $grey-1;
      border-radius: 12px;
      padding: 16px;
    }
  }
}

.message-row {
  display: flex;
  gap: 16px;
  padding: 8px 0;
}

.message-avatar {
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  min-width: 0;
}

.message-header {
  margin-bottom: 8px;
}

.message-text {
  line-height: 1.6;
  word-break: break-word;
  
  &.loading-text {
    display: flex;
    align-items: center;
  }
  
  :deep(code) {
    background-color: $grey-2;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.9em;
  }
  
  :deep(strong) {
    font-weight: 600;
  }
}

.input-area {
  border-top: 1px solid $grey-3;
  background: white;
  padding: 16px 24px 24px;
}

.input-container {
  max-width: 800px;
  margin: 0 auto;
}

.settings-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.message-input-wrapper {
  .message-input {
    :deep(.q-field__control) {
      border-radius: 24px;
      padding-right: 8px;
    }
    
    :deep(textarea) {
      max-height: 200px;
    }
  }
}

// Smaller chips in dataset select
.dataset-select {
  :deep(.q-chip) {
    font-size: 11px;
    height: 20px;
    padding: 0 6px;
    
    .q-chip__content {
      padding: 0;
    }
    
    .q-chip__icon {
      font-size: 14px;
      margin-left: 2px;
    }
  }
}
</style>
