<template>
  <div class="q-pa-md">
    <div class="text-h4 q-mb-md">{{ t('searchPage.title') }}</div>
    
    <!-- Search Input Section -->
    <q-card class="q-mb-md">
      <q-card-section>
        <div class="row q-col-gutter-md">
          <!-- Query Input -->
          <div class="col-12">
            <q-input
              v-model="searchPayload.query"
              :label="t('searchPage.query')"
              outlined
              autofocus
              @keyup.enter="performSearch"
            >
              <template v-slot:prepend>
                <q-icon name="search" />
              </template>
              <template v-slot:append>
                <q-btn 
                  color="primary" 
                  :label="t('common.search')" 
                  unelevated
                  :loading="loading"
                  @click="performSearch"
                />
              </template>
            </q-input>
          </div>
        </div>
      </q-card-section>

      <q-separator />
      <q-card-section>
        <div class="row q-col-gutter-md">
          <!-- Dataset Filter -->
          <div class="col-12 col-md-8">
            <q-select
              v-model="selectedDatasetId"
              :options="datasetOptions"
               :label="t('searchPage.requiredDataset')"
              outlined
              dense
              emit-value
              map-options
              :clearable="false"
              :rules="[datasetRequiredRule]"
            >
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">{{ t('searchPage.noDatasetsAvailable') }}</q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>

          <div class="col-12 col-md-2">
            <q-select
              v-model="searchPayload.recall_mode"
              :options="recallModeOptions"
              :label="t('searchPage.recallMode')"
              outlined
              dense
              emit-value
              map-options
              :clearable="false"
            />
            <div class="text-caption text-grey-6 q-mt-xs">
              {{ t('searchPage.modeDefaultThreshold', { threshold: selectedModeDefaultThresholdLabel }) }}
            </div>
          </div>

          <!-- Top K -->
          <div class="col-12 col-md-2">
            <q-input
              v-model.number="searchPayload.top_k"
              type="number"
              :label="t('searchPage.maxResults')"
              outlined
              dense
              :min="1"
              :max="100"
            />
          </div>

          <div class="col-12 col-md-2">
            <q-input
              v-model.number="searchPayload.threshold"
              type="number"
              :label="t('searchPage.threshold')"
              outlined
              dense
              :min="0"
              :max="1"
              :step="0.05"
              clearable
            />
          </div>

          <!-- Advanced Toggle -->
          <div class="col-12 col-md-2 flex items-center">
            <q-btn 
              flat 
              dense 
              :icon="showAdvanced ? 'expand_less' : 'expand_more'"
               :label="showAdvanced ? t('searchPage.less') : t('searchPage.more')"
              @click="showAdvanced = !showAdvanced"
            />
          </div>
        </div>

        <!-- Advanced Options -->
        <q-slide-transition>
          <div v-show="showAdvanced" class="q-mt-md">
            <div class="row q-col-gutter-md">
              <!-- Options Row -->
              <div class="col-12">
                <div class="row q-gutter-md">
                  <q-checkbox
                    v-model="searchPayload.verbose"
                      :label="t('searchPage.verboseResults')"
                  />
                </div>
              </div>
            </div>
          </div>
        </q-slide-transition>
      </q-card-section>
    </q-card>

    <!-- Results Section -->
    <q-card class="results-section">
      <q-card-section>
        <!-- Loading State -->
        <div v-if="loading" class="column items-center q-pa-lg">
          <q-spinner-orbit size="60px" color="primary" />
          <div class="text-h6 text-grey-8 q-mt-lg">{{ t('searchPage.searching') }}</div>
          <div class="text-caption text-grey-5 q-mt-sm">{{ t('searchPage.searchingHint') }}</div>
        </div>

        <!-- Results List -->
        <template v-else-if="results.length > 0">
          <div class="flex items-center justify-between q-mb-md">
            <div class="text-h6">
              <q-icon name="check_circle" color="positive" class="q-mr-sm" />
              {{ t('searchPage.resultsFound', { count: results.length }) }}
            </div>
            <q-btn flat dense icon="content_copy" :label="t('searchPage.copyAll')" @click="copyAllResults" />
          </div>

          <q-list bordered separator class="rounded-borders">
            <q-expansion-item
              v-for="(result, index) in results"
              :key="index"
              :label="getResultTitle(result, index)"
               :caption="result.dataset_name ? t('searchPage.datasetCaption', { name: result.dataset_name }) : undefined"
              expand-separator
              default-opened
            >
              <q-card>
                <q-card-section>
                  <div class="result-content">
                    <!-- Main Result -->
                    <div v-if="result.search_result" class="q-mb-md">
                      <div class="text-weight-medium text-grey-7 q-mb-xs">{{ t('searchPage.result') }}:</div>
                      <div class="result-text" v-html="formatResult(result.search_result)"></div>
                    </div>

                    <!-- Verbose: Text Result (LLM completion) -->
                    <div v-if="result.text_result" class="q-mb-md">
                      <div class="text-weight-medium text-grey-7 q-mb-xs">{{ t('searchPage.completion') }}:</div>
                      <div class="result-text" v-html="formatResult(result.text_result)"></div>
                    </div>

                    <!-- Verbose: Context Result -->
                    <div v-if="result.context_result" class="q-mb-md">
                      <div class="text-weight-medium text-grey-7 q-mb-xs">{{ t('searchPage.context') }}:</div>
                      <div class="result-text text-grey-8">{{ formatContext(result.context_result) }}</div>
                    </div>

                    <!-- Verbose: Objects Result -->
                    <div v-if="result.objects_result && searchPayload.verbose">
                      <div class="text-weight-medium text-grey-7 q-mb-xs">{{ t('searchPage.rawObjects') }}:</div>
                      <pre class="result-raw">{{ JSON.stringify(result.objects_result, null, 2) }}</pre>
                    </div>
                  </div>
                </q-card-section>
                <q-separator />
                <q-card-actions align="right">
                  <q-btn flat dense icon="content_copy" :label="t('searchPage.copy')" @click="copyResult(result)" />
                </q-card-actions>
              </q-card>
            </q-expansion-item>
          </q-list>
        </template>
        
        <!-- Empty State (after search) -->
        <div v-else-if="searched" class="column items-center q-pa-lg text-grey">
          <q-icon name="search_off" size="64px" color="grey-4" />
          <div class="text-h6 q-mt-md">{{ t('searchPage.noResults') }}</div>
          <div class="text-caption">{{ t('searchPage.differentQuery') }}</div>
        </div>

        <!-- Initial State (before search) -->
        <div v-else class="column items-center q-pa-lg text-grey-5">
          <q-icon name="manage_search" size="64px" color="grey-3" />
          <div class="text-subtitle1 q-mt-md">{{ t('searchPage.enterQuery') }}</div>
          <div class="text-caption">{{ t('searchPage.resultsAppear') }}</div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Search History -->
    <div v-if="!searched && history.length > 0" class="q-mt-lg">
        <div class="text-h6 q-mb-sm">{{ t('searchPage.recentSearches') }}</div>
      <q-list bordered separator class="rounded-borders">
        <q-item 
          v-for="item in history" 
          :key="item.id" 
          clickable 
          @click="useHistoryQuery(item.text)"
        >
          <q-item-section avatar>
            <q-icon name="history" color="grey" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ item.text }}</q-item-label>
            <q-item-label caption>{{ formatDate(item.createdAt) }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-icon name="arrow_forward" color="grey" />
          </q-item-section>
        </q-item>
      </q-list>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useQuasar, copyToClipboard } from 'quasar';
import { useI18n } from 'vue-i18n';
import { 
  SearchService, 
  type SearchPayload, 
  type SearchResult,
  type SearchHistoryItem 
} from 'src/services/search';
import { KnowledgeService, type Dataset } from 'src/services/knowledge';

const $q = useQuasar();
const { t } = useI18n();

// State
const searchPayload = ref<SearchPayload>({
  query: '',
  recall_mode: 'balanced',
  top_k: 10,
  verbose: false,
});

const selectedDatasetId = ref<string | null>(null);
const results = ref<SearchResult[]>([]);
const history = ref<SearchHistoryItem[]>([]);
const datasets = ref<Dataset[]>([]);
const loading = ref(false);
const searched = ref(false);
const showAdvanced = ref(false);

// Computed
const datasetOptions = computed(() => {
  return datasets.value.map(ds => ({
    value: ds.id,
    label: ds.name,
  }));
});

const recallModeOptions = computed(() => [
  { value: 'balanced', label: t('searchPage.recallModeBalanced') },
  { value: 'semantic', label: t('searchPage.recallModeSemantic') },
  { value: 'recent', label: t('searchPage.recallModeRecent') },
  { value: 'deep', label: t('searchPage.recallModeDeep') },
]);

const recallModeDefaultThresholds: Record<string, number | null> = {
  balanced: null,
  semantic: 0.3,
  recent: 0.2,
  deep: 0.1,
};

const selectedModeDefaultThresholdLabel = computed(() => {
  const mode = searchPayload.value.recall_mode ?? 'balanced';
  const threshold = recallModeDefaultThresholds[mode];
  return threshold === null ? t('searchPage.engineDefaultThreshold') : String(threshold);
});

const datasetRequiredRule = (value: string | null) => !!value || t('searchPage.datasetRequiredMessage');

watch(selectedDatasetId, (newVal) => {
  searchPayload.value.dataset_ids = newVal ? [newVal] : [];
});

// Methods
async function loadDatasets() {
  try {
    datasets.value = await KnowledgeService.getDatasets();
    if (!selectedDatasetId.value && datasets.value.length > 0) {
      selectedDatasetId.value = datasets.value[0]?.id ?? null;
    }
  } catch {
    // Silent fail - datasets are optional
  }
}

async function loadHistory() {
  try {
    history.value = await SearchService.getHistory();
  } catch {
    // Silent fail - history is optional
  }
}

async function performSearch() {
  if (!searchPayload.value.query.trim()) {
    $q.notify({
      color: 'warning',
      message: 'Please enter a search query',
      icon: 'warning',
    });
    return;
  }

  if (!selectedDatasetId.value) {
    $q.notify({
      color: 'warning',
      message: t('searchPage.datasetRequiredMessage'),
      icon: 'warning',
    });
    return;
  }
  
  loading.value = true;
  searched.value = true;
  results.value = []; // Clear previous results immediately
  
  try {
    // Build payload (only include non-default values)
    const payload: SearchPayload = {
      query: searchPayload.value.query,
    };

    if (searchPayload.value.dataset_ids && searchPayload.value.dataset_ids.length > 0) {
      payload.dataset_ids = searchPayload.value.dataset_ids;
    }
    if (searchPayload.value.top_k && searchPayload.value.top_k !== 10) {
      payload.top_k = searchPayload.value.top_k;
    }
    if (searchPayload.value.recall_mode) {
      payload.recall_mode = searchPayload.value.recall_mode;
    }
    if (typeof searchPayload.value.threshold === 'number') {
      payload.threshold = searchPayload.value.threshold;
    }
    if (searchPayload.value.verbose) {
      payload.verbose = true;
    }

    results.value = await SearchService.search(payload);
    
    // Refresh history after search
    void loadHistory();
  } catch {
    $q.notify({
      color: 'negative',
      message: 'Search failed. Please try again.',
      icon: 'report_problem',
    });
    results.value = [];
  } finally {
    loading.value = false;
  }
}

function getResultTitle(result: SearchResult, index: number): string {
  if (result.dataset_name) {
    return `Result ${index + 1} - ${result.dataset_name}`;
  }
  return `Result ${index + 1}`;
}

function formatResult(result: unknown): string {
  if (typeof result === 'string') {
    // Convert markdown-like content to basic HTML
    return result.replace(/\n/g, '<br>');
  }
  if (Array.isArray(result)) {
    return result.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('<br><br>');
  }
  return JSON.stringify(result, null, 2);
}

function formatContext(context: string | string[]): string {
  if (Array.isArray(context)) {
    return context.join('\n\n');
  }
  return context;
}

function formatDate(dateStr: string | number): string {
  // Handle both timestamp (number) and ISO string formats
  const timestamp = typeof dateStr === 'string' ? parseInt(dateStr, 10) : dateStr;
  // Check if it's a valid timestamp (milliseconds)
  if (!isNaN(timestamp) && timestamp > 1000000000000) {
    return new Date(timestamp).toLocaleString();
  }
  // Try parsing as ISO string
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toLocaleString();
  }
  return String(dateStr);
}

function useHistoryQuery(query: string) {
  searchPayload.value.query = query;
  void performSearch();
}

/**
 * Get the primary text content from a result for copying
 */
function getResultText(result: SearchResult): string {
  // Try search_result first (non-verbose mode)
  if (result.search_result) {
    return typeof result.search_result === 'string' 
      ? result.search_result 
      : JSON.stringify(result.search_result, null, 2);
  }
  // Try text_result (verbose mode completion)
  if (result.text_result) {
    return Array.isArray(result.text_result) 
      ? result.text_result.join('\n\n') 
      : result.text_result;
  }
  // Try context_result
  if (result.context_result) {
    return Array.isArray(result.context_result)
      ? result.context_result.join('\n\n')
      : result.context_result;
  }
  // Fallback to full JSON
  return JSON.stringify(result, null, 2);
}

async function copyResult(result: SearchResult) {
  const text = getResultText(result);
  
  await copyToClipboard(text);
  $q.notify({
    color: 'positive',
    message: 'Copied to clipboard',
    icon: 'check',
  });
}

async function copyAllResults() {
  const text = results.value.map(r => getResultText(r)).join('\n\n---\n\n');
  
  await copyToClipboard(text);
  $q.notify({
    color: 'positive',
    message: 'All results copied to clipboard',
    icon: 'check',
  });
}

// Lifecycle
onMounted(() => {
  void loadDatasets();
  void loadHistory();
});
</script>

<style lang="scss" scoped>
.result-content {
  font-size: 0.95rem;
  line-height: 1.6;
}

.result-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.result-raw {
  background: $grey-2;
  padding: 12px;
  border-radius: 4px;
  font-size: 0.85rem;
  overflow-x: auto;
  max-height: 300px;
}

// Make chips smaller in dataset filter
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
