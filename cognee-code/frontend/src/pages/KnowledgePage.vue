<template>
  <q-page class="knowledge-page">
    <!-- Two Column Layout -->
    <div class="row no-wrap full-height">
      <!-- Left: Dataset List (Fixed Width) -->
      <div class="dataset-sidebar">
        <DatasetList
          :datasets="datasets"
          :selected-id="currentDataset?.id"
          :loading="loading"
          @create="showCreateDialog = true"
          @delete="deleteDataset"
          @select="selectDataset"
        />
      </div>

      <!-- Right: Main Content (Flexible) -->
      <div class="col">
        <div v-if="currentDataset" class="full-height">
          <DataList
            :dataset-name="currentDataset.name"
            :dataset-id="currentDataset.id"
            :data-items="dataItems"
            :loading="dataLoading"
            :dataset-status="currentDatasetStatus"
            @add="showAddDataDialog = true"
            @share="showShareDialog = true"
            @cognify="handleCognify"
            @delete="confirmDeleteData"
            @download="downloadData"
            @preview="previewData"
            @back="currentDataset = null"
            @reset-status="handleResetStatus"
          />
        </div>

        <!-- Empty Selection State -->
        <div v-else class="full-height row flex-center bg-grey-1 text-grey-6 column">
          <q-icon name="library_books" size="80px" color="grey-4" />
          <div class="text-h5 q-mt-md">{{ t('knowledge.selectBase') }}</div>
          <div class="text-subtitle1 q-mb-lg">{{ t('knowledge.chooseOrCreate') }}</div>

          <q-card flat bordered class="q-pa-md" style="max-width: 400px;">
            <div class="text-subtitle2 text-grey-8 q-mb-sm">{{ t('knowledge.quickStart') }}</div>
            <div class="column q-gutter-sm">
              <q-btn unelevated color="primary" :label="`1. ${t('knowledge.createBase')}`" icon="add" @click="showCreateDialog = true" class="full-width" />
              <div class="text-caption text-grey-6 text-center">{{ t('knowledge.thenSelect') }}</div>
            </div>
          </q-card>

          <div class="text-caption text-grey-5 q-mt-lg">
            <q-icon name="info" size="xs" class="q-mr-xs" />
            {{ t('knowledge.afterCreating') }}
          </div>
        </div>
      </div>
    </div>

    <CreateDatasetDialog
      ref="createDatasetDialogRef"
      v-model="showCreateDialog"
      :loading="creatingDataset"
      @create="createDataset"
    />

    <AddDataDialog
      ref="addDataDialogRef"
      v-model="showAddDataDialog"
      @add-text="addText"
      @add-url="addUrl"
      @add-file="addFile"
    />

    <ShareDatasetDialog
      v-model="showShareDialog"
      :dataset-id="currentDataset?.id || ''"
    />

    <!-- File Preview Dialog -->
    <FilePreviewDialog
      v-model="showPreviewDialog"
      :file-name="previewItem?.name || ''"
      :mime-type="previewItem?.mime_type ?? previewItem?.mimeType ?? ''"
      :content="previewContent"
      @download="downloadPreviewItem"
    />

    <!-- Cognify Progress Dialog - can be dismissed, processing continues in background -->
    <q-dialog v-model="isCognifying">
      <q-card style="min-width: 350px">
        <q-toolbar>
          <q-toolbar-title>{{ t('knowledge.buildingGraph') }}</q-toolbar-title>
          <q-btn icon="close" flat round dense v-close-popup />
        </q-toolbar>

        <q-card-section class="q-pt-none">
          <div class="column flex-center q-pa-md">
            <q-circular-progress
              indeterminate
              size="50px"
              color="secondary"
              class="q-mb-md"
            />
            <div class="text-subtitle1">{{ cognifyStatus }}</div>
            <div class="text-caption text-grey-6 q-mt-sm">
              {{ t('knowledge.processingContinues') }}
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Auto-Cognify Prompt Dialog -->
    <q-dialog v-model="showCognifyPrompt">
      <q-card style="min-width: 400px">
        <q-toolbar class="bg-grey-1">
          <q-toolbar-title>{{ t('knowledge.buildGraph') }}</q-toolbar-title>
          <q-btn flat round dense icon="close" v-close-popup />
        </q-toolbar>
        <q-separator />

        <q-card-section class="q-pt-none">
          <div class="text-body1">
            {{ t('knowledge.addedNewContent', { name: currentDataset?.name ?? '' }) }}
          </div>
          <div class="text-body2 text-grey-7 q-mt-sm">
            {{ t('knowledge.runCognify') }}
          </div>
          <ul class="text-body2 text-grey-7 q-mt-xs">
            <li>{{ t('knowledge.extractEntities') }}</li>
            <li>{{ t('knowledge.buildKnowledgeGraph') }}</li>
            <li>{{ t('knowledge.enableSemanticSearch') }}</li>
          </ul>

          <div v-if="isMuninnProvider" class="q-mt-md q-gutter-sm">
            <div class="text-subtitle2">{{ t('knowledge.muninnChunkSettings') }}</div>
            <q-input
              v-model.number="muninnChunkSize"
              type="number"
              dense
              outlined
              :label="t('knowledge.chunkSize')"
              :hint="t('knowledge.chunkSizeHint')"
            />
            <q-input
              v-model.number="muninnChunkOverlapRatio"
              type="number"
              dense
              outlined
              :label="t('knowledge.chunkOverlapRatio')"
              :hint="t('knowledge.chunkOverlapHint')"
              :step="0.01"
            />
            <q-input
              v-model.number="muninnMaxTextLength"
              type="number"
              dense
              outlined
              :label="t('knowledge.maxTextLength')"
              :hint="t('knowledge.maxTextLengthHint')"
            />
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat :label="t('common.later')" color="grey" v-close-popup />
          <q-btn unelevated :label="t('common.buildNow')" color="secondary" icon="auto_graph" @click="handleCognifyFromPrompt" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, onUnmounted } from 'vue';
import { useQuasar } from 'quasar';
import type { EventBus } from 'quasar';
import { useI18n } from 'vue-i18n';
import { KnowledgeService, DatasetStatus } from 'src/services/knowledge';
import type { Dataset, DataItem, DatasetWithStatus, PipelineRunStatus, RuntimeConfig } from 'src/services/knowledge';
import { CognifyService } from 'src/services/cognify';
import type { CognifyOptions } from 'src/services/cognify';
import type { PipelineEventPayload } from 'src/services/sse';
import DatasetList from 'components/knowledge/DatasetList.vue';
import DataList from 'components/knowledge/DataList.vue';
import CreateDatasetDialog from 'components/knowledge/CreateDatasetDialog.vue';
import AddDataDialog from 'components/knowledge/AddDataDialog.vue';
import ShareDatasetDialog from 'components/knowledge/ShareDatasetDialog.vue';
import FilePreviewDialog from 'components/knowledge/FilePreviewDialog.vue';

const $q = useQuasar();
const { t } = useI18n();
const bus = inject<EventBus>('sseBus')!;

// Dialog refs for controlled closing after successful operations
const createDatasetDialogRef = ref<InstanceType<typeof CreateDatasetDialog> | null>(null);
const addDataDialogRef = ref<InstanceType<typeof AddDataDialog> | null>(null);

const MUNINN_DEFAULT_CHUNK_SIZE = 4096;
const MUNINN_DEFAULT_CHUNK_OVERLAP_RATIO = 0.08;
const MUNINN_DEFAULT_MAX_TEXT_LENGTH = 16384;

const vectorDbProvider = ref<string>('');
const datasets = ref<DatasetWithStatus[]>([]);
const currentDataset = ref<DatasetWithStatus | null>(null);
const dataItems = ref<DataItem[]>([]);
const loading = ref(false);
const dataLoading = ref(false);
const creatingDataset = ref(false);
const showCreateDialog = ref(false);
const showAddDataDialog = ref(false);
const showShareDialog = ref(false);
const showCognifyPrompt = ref(false);
const muninnChunkSize = ref<number>(MUNINN_DEFAULT_CHUNK_SIZE);
const muninnChunkOverlapRatio = ref<number>(MUNINN_DEFAULT_CHUNK_OVERLAP_RATIO);
const muninnMaxTextLength = ref<number>(MUNINN_DEFAULT_MAX_TEXT_LENGTH);

// Preview state
const showPreviewDialog = ref(false);
const previewItem = ref<DataItem | null>(null);
const previewContent = ref<Blob | null>(null);

const isCognifying = ref(false);
const cognifyStatus = ref('');

// Pipeline SSE handlers — keyed by the global bus event names
let onPipelineUpdate: ((payload: PipelineEventPayload) => void) | null = null;
let onPipelineDone: ((payload: PipelineEventPayload) => void) | null = null;
let onPipelineError: ((payload: PipelineEventPayload) => void) | null = null;

// Track the active cognify run so we can filter pipeline events
let activeCognifyRunId: string | null = null;

// Computed: current dataset status
// Return PENDING while data is loading to avoid flashing the previous dataset's status
const currentDatasetStatus = computed(() => {
  if (!currentDataset.value) return DatasetStatus.EMPTY;
  if (dataLoading.value) return DatasetStatus.PENDING;
  return currentDataset.value.status || DatasetStatus.PENDING;
});

const isMuninnProvider = computed(() => vectorDbProvider.value === 'muninn');

function getCognifyOptions(): CognifyOptions | undefined {
  if (!isMuninnProvider.value) {
    return undefined;
  }

  return {
    chunks_per_batch: muninnChunkSize.value,
  };
}

function applyMuninnDefaults(cfg: RuntimeConfig) {
  const muninn = cfg.muninn;
  if (!muninn) {
    return;
  }

  muninnChunkSize.value = muninn.default_chunk_size;
  muninnChunkOverlapRatio.value = muninn.default_chunk_overlap_ratio;
  muninnMaxTextLength.value = muninn.max_text_length;
}

async function loadDatasets() {
  try {
    loading.value = true;
    const rawDatasets = await KnowledgeService.getDatasets();
    datasets.value = await KnowledgeService.enrichDatasetsWithStatus(rawDatasets);

    // Update current dataset status if selected
    if (currentDataset.value) {
      const updated = datasets.value.find(d => d.id === currentDataset.value?.id);
      if (updated) {
        currentDataset.value = updated;
      }
    }
  } catch {
    $q.notify({ type: 'negative', message: t('knowledge.failedLoadDatasets') });
  } finally {
    loading.value = false;
  }
}

async function refreshDatasetStatus() {
  if (datasets.value.length === 0) return;

  try {
    const statusResponse = await KnowledgeService.getDatasetStatusDetails(datasets.value.map(d => d.id));

    // Update status for each dataset
    datasets.value = datasets.value.map(dataset => {
      const statusInfo = statusResponse[dataset.id];
      const pipelineStatus = statusInfo?.status as PipelineRunStatus | undefined;
      const statusUpdatedAt = statusInfo?.created_at;
      const newStatus = pipelineStatus ? KnowledgeService.getSimplifiedStatus(pipelineStatus) : DatasetStatus.EMPTY;
      const result: DatasetWithStatus = {
        ...dataset,
        status: newStatus,
      };
      if (statusUpdatedAt !== undefined) {
        result.statusUpdatedAt = statusUpdatedAt;
      }
      if (pipelineStatus !== undefined) {
        result.pipelineStatus = pipelineStatus;
      }
      return result;
    });

    // Update current dataset if selected
    if (currentDataset.value) {
      const updated = datasets.value.find(d => d.id === currentDataset.value?.id);
      if (updated) {
        currentDataset.value = updated;
      }
    }
  } catch {
    // Silent fail for status refresh
  }
}

function startPipelineListeners() {
  stopPipelineListeners();

  onPipelineUpdate = (payload: PipelineEventPayload) => {
    // Update dataset status for the relevant dataset
    if (payload.dataset_id) {
      datasets.value = datasets.value.map(dataset => {
        if (dataset.id !== payload.dataset_id) return dataset;
        const pipelineStatus = payload.status as PipelineRunStatus;
        const result: DatasetWithStatus = {
          ...dataset,
          status: KnowledgeService.getSimplifiedStatus(pipelineStatus),
          pipelineStatus,
        };
        return result;
      });
      if (currentDataset.value?.id === payload.dataset_id) {
        const updated = datasets.value.find(d => d.id === payload.dataset_id);
        if (updated) currentDataset.value = updated;
      }
    }
    // Update cognify dialog status if this is our active run
    if (activeCognifyRunId && payload.pipeline_run_id === activeCognifyRunId) {
      cognifyStatus.value = formatStatus(payload.status);
    }
  };
  bus.on('pipeline:update', onPipelineUpdate);

  onPipelineDone = (payload: PipelineEventPayload) => {
    if (payload.dataset_id) {
      datasets.value = datasets.value.map(dataset => {
        if (dataset.id !== payload.dataset_id) return dataset;
        const pipelineStatus = payload.status as PipelineRunStatus;
        return {
          ...dataset,
          status: KnowledgeService.getSimplifiedStatus(pipelineStatus),
          pipelineStatus,
        };
      });
      if (currentDataset.value?.id === payload.dataset_id) {
        const updated = datasets.value.find(d => d.id === payload.dataset_id);
        if (updated) currentDataset.value = updated;
      }
      // Always refresh status and data items when SSE signals completion
      void refreshDatasetStatus();
      if (currentDataset.value?.id === payload.dataset_id) {
        void loadData(payload.dataset_id);
      }
    }
    if (activeCognifyRunId && payload.pipeline_run_id === activeCognifyRunId) {
      activeCognifyRunId = null;
      isCognifying.value = false;
      $q.notify({ type: 'positive', message: 'Knowledge graph built successfully!' });
    }
  };
  bus.on('pipeline:done', onPipelineDone);

  onPipelineError = (payload: PipelineEventPayload) => {
    if (payload.dataset_id) {
      datasets.value = datasets.value.map(dataset => {
        if (dataset.id !== payload.dataset_id) return dataset;
        const pipelineStatus = payload.status as PipelineRunStatus;
        return {
          ...dataset,
          status: KnowledgeService.getSimplifiedStatus(pipelineStatus),
          pipelineStatus,
        };
      });
      if (currentDataset.value?.id === payload.dataset_id) {
        const updated = datasets.value.find(d => d.id === payload.dataset_id);
        if (updated) currentDataset.value = updated;
      }
      // Always refresh status on error
      void refreshDatasetStatus();
    }
    if (activeCognifyRunId && payload.pipeline_run_id === activeCognifyRunId) {
      activeCognifyRunId = null;
      isCognifying.value = false;
      const errMsg = payload.error ? `Cognify failed: ${payload.error}` : 'Cognify failed.';
      $q.notify({ type: 'negative', message: errMsg, timeout: 10000 });
    }
  };
  bus.on('pipeline:error', onPipelineError);
}

function stopPipelineListeners() {
  if (onPipelineUpdate) { bus.off('pipeline:update', onPipelineUpdate); onPipelineUpdate = null; }
  if (onPipelineDone)   { bus.off('pipeline:done',   onPipelineDone);   onPipelineDone = null; }
  if (onPipelineError)  { bus.off('pipeline:error',  onPipelineError);  onPipelineError = null; }
}

async function createDataset(
  name: string,
  vaultApiKey: string | null,
) {
  try {
    creatingDataset.value = true;
    const newDs = await KnowledgeService.createDataset(name, vaultApiKey);
    await loadDatasets();
    // Find the enriched version
    const enriched = datasets.value.find(d => d.id === newDs.id);
    if (enriched) {
      await selectDataset(enriched);
    }
    createDatasetDialogRef.value?.close();
    $q.notify({ type: 'positive', message: 'Dataset created' });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to create dataset' });
  } finally {
    creatingDataset.value = false;
  }
}

function deleteDataset(id: string) {
  $q.dialog({
    title: 'Confirm',
    message: 'Are you sure you want to delete this dataset? All data will be lost.',
    cancel: true,
    persistent: true
  }).onOk(() => {
    void performDeleteDataset(id);
  });
}

async function performDeleteDataset(id: string) {
  loading.value = true;
  try {
    await KnowledgeService.deleteDataset(id);
    if (currentDataset.value?.id === id) {
      currentDataset.value = null;
    }
    await loadDatasets();
    $q.notify({ type: 'positive', message: 'Dataset deleted' });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to delete dataset' });
  } finally {
    loading.value = false;
  }
}

async function selectDataset(dataset: Dataset | DatasetWithStatus) {
  // Convert to DatasetWithStatus if needed
  const enriched = datasets.value.find(d => d.id === dataset.id);
  // Clear stale data immediately to prevent showing the previous dataset's items
  dataItems.value = [];
  currentDataset.value = enriched || { ...dataset, status: DatasetStatus.PENDING };
  await loadData(dataset.id);
}

async function loadData(datasetId: string) {
  try {
    dataLoading.value = true;
    dataItems.value = await KnowledgeService.getData(datasetId);
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to load data' });
  } finally {
    dataLoading.value = false;
  }
}

async function addText(text: string) {
  if (!currentDataset.value) return;
  try {
    dataLoading.value = true;
    await KnowledgeService.addTextData(currentDataset.value.id, text);
    await loadData(currentDataset.value.id);
    addDataDialogRef.value?.close();
    $q.notify({ type: 'positive', message: 'Text added' });
    // Prompt for cognify
    promptForCognify();
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to add text' });
  } finally {
    dataLoading.value = false;
  }
}

async function addUrl(url: string) {
  if (!currentDataset.value) return;
  try {
    dataLoading.value = true;
    await KnowledgeService.addUrlData(currentDataset.value.id, url);
    await loadData(currentDataset.value.id);
    addDataDialogRef.value?.close();
    $q.notify({ type: 'positive', message: 'URL added' });
    // Prompt for cognify
    promptForCognify();
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to add URL' });
  } finally {
    dataLoading.value = false;
  }
}

async function addFile(file: File) {
  if (!currentDataset.value) return;
  try {
    dataLoading.value = true;
    await KnowledgeService.uploadFile(currentDataset.value.id, file);
    await loadData(currentDataset.value.id);
    addDataDialogRef.value?.close();
    $q.notify({ type: 'positive', message: 'File uploaded' });
    // Prompt for cognify
    promptForCognify();
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to upload file' });
  } finally {
    dataLoading.value = false;
  }
}

function promptForCognify() {
  // Show prompt if dataset is not already processed
  if (currentDataset.value && currentDataset.value.status !== DatasetStatus.COMPLETED) {
    showCognifyPrompt.value = true;
  }
}

function handleCognifyFromPrompt() {
  showCognifyPrompt.value = false;
  void startCognify();
}

function confirmDeleteData(dataId: string) {
  $q.dialog({
    title: 'Delete Data',
    message: 'Are you sure you want to delete this file? This action cannot be undone.',
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void performDeleteData(dataId);
  });
}

async function performDeleteData(dataId: string) {
  if (!currentDataset.value) return;
  try {
    dataLoading.value = true;
    await KnowledgeService.deleteData(currentDataset.value.id, dataId);
    await loadData(currentDataset.value.id);
    $q.notify({ type: 'positive', message: 'Data deleted' });
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to delete data' });
  } finally {
    dataLoading.value = false;
  }
}

async function downloadData(item: DataItem) {
  if (!currentDataset.value) return;
  try {
    const blob = await KnowledgeService.downloadRawData(currentDataset.value.id, item.id);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = item.name || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to download file' });
  }
}

async function previewData(item: DataItem) {
  if (!currentDataset.value) return;
  previewItem.value = item;
  previewContent.value = null;
  showPreviewDialog.value = true;

  try {
    const blob = await KnowledgeService.downloadRawData(currentDataset.value.id, item.id);
    previewContent.value = blob;
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to load file for preview' });
  }
}

function downloadPreviewItem() {
  if (previewItem.value) {
    void downloadData(previewItem.value);
  }
}

async function handleResetStatus() {
  if (!currentDataset.value) return;

  try {
    dataLoading.value = true;
    await KnowledgeService.resetDatasetStatus([currentDataset.value.id]);
    $q.notify({ type: 'positive', message: 'Status reset. You can now retry processing.' });

    // Refresh status
    await refreshDatasetStatus();

    // Optionally auto-start cognify after reset
    void handleCognify();
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to reset status' });
  } finally {
    dataLoading.value = false;
  }
}

async function handleCognify() {
  if (isMuninnProvider.value) {
    showCognifyPrompt.value = true;
    return;
  }

  await startCognify();
}

async function startCognify() {
  if (!currentDataset.value) return;

  try {
    isCognifying.value = true;
    cognifyStatus.value = 'Starting...';

    // Don't update local status here - let the backend status be the source of truth
    // The WebSocket will send real-time status updates

    const result = await CognifyService.cognify(currentDataset.value.id, getCognifyOptions());

    if (result && result.length > 0 && result[0]) {
      const info = result[0];
      const runId = info.pipeline_run_id;

      // Check if pipeline already completed (all files were already processed)
      if (info.status === 'PipelineRunCompleted') {
        $q.notify({ type: 'info', message: 'All data already processed.' });
        isCognifying.value = false;
        void refreshDatasetStatus();
        void loadData(currentDataset.value.id);
      } else {
        activeCognifyRunId = runId;
      }
    } else {
      $q.notify({ type: 'warning', message: 'No pipeline info returned.' });
      isCognifying.value = false;
    }
  } catch (err) {
    console.error(err);
    $q.notify({ type: 'negative', message: 'Failed to start Cognify' });
    isCognifying.value = false;
  }
}

function formatStatus(status: string): string {
  // Convert DATASET_PROCESSING_STARTED to "Processing Started"
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Dataset ', '');
}

onMounted(() => {
  startPipelineListeners();
  void loadDatasets();
  void KnowledgeService.getConfig().then(cfg => {
    vectorDbProvider.value = cfg.vector_db_provider;
    applyMuninnDefaults(cfg);
  }).catch(() => { /* non-critical */ });
});

onUnmounted(() => {
  stopPipelineListeners();
});
</script>

<style lang="scss" scoped>
.knowledge-page {
  height: calc(100vh - 50px);
}

.dataset-sidebar {
  width: 300px;
  min-width: 250px;
  max-width: 350px;
  border-right: 1px solid #e0e0e0;
}

.full-height {
  height: 100%;
}
</style>
