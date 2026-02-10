<template>
  <q-page class="q-pa-md">
    <div class="text-h4 q-mb-md">Settings</div>

    <q-spinner v-if="loading" color="primary" size="3em" class="q-ma-xl" />

    <template v-else>
      <!-- LLM Configuration -->
      <q-card class="q-mb-md">
        <q-card-section>
          <div class="text-h6">LLM Configuration</div>
          <div class="text-subtitle2 text-grey">Configure your AI provider settings</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-select
            v-model="llmProvider"
            :options="llmProviders"
            label="Provider"
            outlined
            emit-value
            map-options
          />
          <q-input
            v-model="llmModel"
            label="Model"
            outlined
            hint="e.g., gpt-4o, claude-3-opus, llama3"
          />
          <q-input
            v-model="llmApiKey"
            label="API Key"
            type="password"
            outlined
            hint="Leave empty to keep existing key"
          />
        </q-card-section>
      </q-card>

      <!-- Vector DB Configuration -->
      <q-card class="q-mb-md">
        <q-card-section>
          <div class="text-h6">Vector Database</div>
          <div class="text-subtitle2 text-grey">Configure vector storage backend</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-select
            v-model="vectorProvider"
            :options="vectorProviders"
            label="Provider"
            outlined
            emit-value
            map-options
          />
          <q-input
            v-model="vectorUrl"
            label="URL"
            outlined
            hint="Connection URL (if applicable)"
          />
          <q-input
            v-model="vectorApiKey"
            label="API Key"
            type="password"
            outlined
            hint="Leave empty to keep existing key"
          />
        </q-card-section>
      </q-card>

      <!-- Sync Status -->
      <q-card class="q-mb-md">
        <q-card-section>
          <div class="text-h6">Cloud Sync</div>
          <div class="text-subtitle2 text-grey">Sync data to cloud storage</div>
        </q-card-section>

        <q-card-section>
          <div class="row items-center q-gutter-md">
            <div v-if="syncStatus">
              <q-badge :color="syncStatus.status === 'synced' ? 'positive' : 'warning'">
                {{ syncStatus.status }}
              </q-badge>
              <span v-if="syncStatus.last_sync" class="q-ml-sm text-grey">
                Last sync: {{ syncStatus.last_sync }}
              </span>
            </div>
            <q-btn color="secondary" label="Sync Now" icon="sync" @click="triggerSync" :loading="syncing" />
          </div>
        </q-card-section>
      </q-card>

      <!-- Save Button -->
      <div class="row justify-end">
        <q-btn color="primary" label="Save Settings" icon="save" size="lg" @click="saveSettings" :loading="saving" />
      </div>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { SettingsService, type LLMProvider, type VectorDBProvider, type LLMConfigInput, type VectorDBConfigInput } from 'src/services/settings';
import { SyncService, type SyncStatus } from 'src/services/sync';

const $q = useQuasar();

const loading = ref(true);
const saving = ref(false);
const syncing = ref(false);

// LLM settings
const llmProvider = ref<LLMProvider>('openai');
const llmModel = ref('');
const llmApiKey = ref('');

// Vector DB settings
const vectorProvider = ref<VectorDBProvider>('lancedb');
const vectorUrl = ref('');
const vectorApiKey = ref('');

// Sync status
const syncStatus = ref<SyncStatus | null>(null);

const llmProviders = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Ollama (Local)', value: 'ollama' },
  { label: 'Google Gemini', value: 'gemini' },
  { label: 'Mistral', value: 'mistral' },
];

const vectorProviders = [
  { label: 'LanceDB (Local)', value: 'lancedb' },
  { label: 'ChromaDB', value: 'chromadb' },
  { label: 'PGVector', value: 'pgvector' },
];

async function loadSettings() {
  loading.value = true;
  try {
    const [settings, status] = await Promise.all([
      SettingsService.getSettings(),
      SyncService.getStatus().catch(() => null),
    ]);

    // LLM
    llmProvider.value = settings.llm.provider;
    llmModel.value = settings.llm.model || '';
    // Don't load API key for security

    // Vector DB
    vectorProvider.value = settings.vector_db.provider;
    vectorUrl.value = settings.vector_db.url || '';

    // Sync
    syncStatus.value = status;
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to load settings' });
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  try {
    const llmConfig: LLMConfigInput = { provider: llmProvider.value };
    if (llmModel.value) llmConfig.model = llmModel.value;
    if (llmApiKey.value) llmConfig.api_key = llmApiKey.value;

    const vectorConfig: VectorDBConfigInput = { provider: vectorProvider.value };
    if (vectorUrl.value) vectorConfig.url = vectorUrl.value;
    if (vectorApiKey.value) vectorConfig.api_key = vectorApiKey.value;

    await SettingsService.saveSettings({
      llm: llmConfig,
      vector_db: vectorConfig,
    });
    $q.notify({ color: 'positive', message: 'Settings saved successfully' });
    // Clear sensitive fields
    llmApiKey.value = '';
    vectorApiKey.value = '';
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to save settings' });
  } finally {
    saving.value = false;
  }
}

async function triggerSync() {
  syncing.value = true;
  try {
    const result = await SyncService.sync();
    $q.notify({ color: 'positive', message: result.message || 'Sync started' });
    // Refresh status
    syncStatus.value = await SyncService.getStatus().catch(() => null);
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to start sync' });
  } finally {
    syncing.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});
</script>
