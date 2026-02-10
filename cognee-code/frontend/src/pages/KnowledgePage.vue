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
          <div class="text-h5 q-mt-md">Select a Knowledge Base</div>
          <div class="text-subtitle1 q-mb-lg">Choose from the left sidebar, or create a new one</div>
          
          <q-card flat bordered class="q-pa-md" style="max-width: 400px;">
            <div class="text-subtitle2 text-grey-8 q-mb-sm">Quick Start:</div>
            <div class="column q-gutter-sm">
              <q-btn unelevated color="primary" label="1. Create Knowledge Base" icon="add" @click="showCreateDialog = true" class="full-width" />
              <div class="text-caption text-grey-6 text-center">Then select it to add files, text or URLs</div>
            </div>
          </q-card>
          
          <div class="text-caption text-grey-5 q-mt-lg">
            <q-icon name="info" size="xs" class="q-mr-xs" />
            After creating a Knowledge Base, click "Add Content" to upload files
          </div>
        </div>
      </div>
    </div>

    <CreateDatasetDialog 
      ref="createDatasetDialogRef"
      v-model="showCreateDialog"
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
        <q-card-section class="row items-center">
          <div class="text-h6">Building Knowledge Graph</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

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
              Processing continues in background. You can close this dialog.
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Auto-Cognify Prompt Dialog -->
    <q-dialog v-model="showCognifyPrompt">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Build Knowledge Graph?</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="text-body1">
            You've added new content to <strong>{{ currentDataset?.name }}</strong>.
          </div>
          <div class="text-body2 text-grey-7 q-mt-sm">
            Run Cognify to process the data and make it searchable. This will:
          </div>
          <ul class="text-body2 text-grey-7 q-mt-xs">
            <li>Extract entities and relationships</li>
            <li>Build the knowledge graph</li>
            <li>Enable semantic search</li>
          </ul>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Later" color="grey" v-close-popup />
          <q-btn unelevated label="Build Now" color="secondary" icon="auto_graph" @click="handleCognifyFromPrompt" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useQuasar } from 'quasar';
import { KnowledgeService, DatasetStatus, PipelineRunStatus } from 'src/services/knowledge';
import type { Dataset, DataItem, DatasetWithStatus } from 'src/services/knowledge';
import { CognifyService } from 'src/services/cognify';
import type { PipelineRunInfo } from 'src/services/cognify';
import DatasetList from 'components/knowledge/DatasetList.vue';
import DataList from 'components/knowledge/DataList.vue';
import CreateDatasetDialog from 'components/knowledge/CreateDatasetDialog.vue';
import AddDataDialog from 'components/knowledge/AddDataDialog.vue';
import ShareDatasetDialog from 'components/knowledge/ShareDatasetDialog.vue';
import FilePreviewDialog from 'components/knowledge/FilePreviewDialog.vue';

const $q = useQuasar();

// Dialog refs for controlled closing after successful operations
const createDatasetDialogRef = ref<InstanceType<typeof CreateDatasetDialog> | null>(null);
const addDataDialogRef = ref<InstanceType<typeof AddDataDialog> | null>(null);

const datasets = ref<DatasetWithStatus[]>([]);
const currentDataset = ref<DatasetWithStatus | null>(null);
const dataItems = ref<DataItem[]>([]);
const loading = ref(false);
const dataLoading = ref(false);
const showCreateDialog = ref(false);
const showAddDataDialog = ref(false);
const showShareDialog = ref(false);
const showCognifyPrompt = ref(false);

// Preview state
const showPreviewDialog = ref(false);
const previewItem = ref<DataItem | null>(null);
const previewContent = ref<Blob | null>(null);

const isCognifying = ref(false);
const cognifyStatus = ref('');

// Status polling interval
let statusPollInterval: ReturnType<typeof setInterval> | null = null;

// Computed: current dataset status
const currentDatasetStatus = computed(() => {
  if (!currentDataset.value) return DatasetStatus.EMPTY;
  return currentDataset.value.status || DatasetStatus.PENDING;
});

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
    $q.notify({ type: 'negative', message: 'Failed to load datasets' });
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
      const newStatus = KnowledgeService.getSimplifiedStatus(pipelineStatus);
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

function startStatusPolling() {
  if (statusPollInterval) return;
  statusPollInterval = setInterval(() => {
    void refreshDatasetStatus();
  }, 5000); // Poll every 5 seconds
}

function stopStatusPolling() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
}

// Watch for processing datasets to start/stop polling
watch(() => datasets.value.some(d => d.status === DatasetStatus.PROCESSING), (hasProcessing) => {
  if (hasProcessing) {
    startStatusPolling();
  } else {
    stopStatusPolling();
  }
});

async function createDataset(name: string) {
  try {
    loading.value = true;
    const newDs = await KnowledgeService.createDataset(name);
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
    loading.value = false;
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
  void handleCognify();
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
  if (!currentDataset.value) return;
  
  try {
    isCognifying.value = true;
    cognifyStatus.value = 'Starting...';
    
    // Don't update local status here - let the backend status be the source of truth
    // The WebSocket will send real-time status updates
    
    // In background mode, response is list of PipelineRunInfo
    const result = await CognifyService.cognify(currentDataset.value.id);
    
    if (result && result.length > 0 && result[0]) {
      // In background mode, result is a list
      const info = result[0];
      const runId = info.pipeline_run_id;
      
      // Check if pipeline already completed (all files were already processed)
      if (info.status === 'PipelineRunCompleted') {
        $q.notify({ type: 'info', message: 'All data already processed.' });
        isCognifying.value = false;
        void refreshDatasetStatus();
        void loadData(currentDataset.value.id);
      } else {
        connectToCognifyStream(runId);
      }
    } else if (typeof result === 'object' && result !== null) {
       // Just in case it returns the dict format (datasetId -> info)
       const values = Object.values(result as unknown as Record<string, PipelineRunInfo>);
       if (values.length > 0 && values[0]) {
           const info = values[0];
           const runId = info.pipeline_run_id;
           
           // Check if pipeline already completed
           if (info.status === 'PipelineRunCompleted') {
             $q.notify({ type: 'info', message: 'All data already processed.' });
             isCognifying.value = false;
             void refreshDatasetStatus();
             void loadData(currentDataset.value.id);
           } else {
             connectToCognifyStream(runId);
           }
       } else {
           $q.notify({ type: 'warning', message: 'No pipeline info returned.' });
           isCognifying.value = false;
       }
    } else {
        $q.notify({ type: 'warning', message: 'Unexpected response format.' });
        isCognifying.value = false;
    }
  } catch (err) {
    console.error(err);
    $q.notify({ type: 'negative', message: 'Failed to start Cognify' });
    isCognifying.value = false;
  }
}

function connectToCognifyStream(runId: string) {
  const wsUrl = CognifyService.getWebSocketUrl(runId);
  const socket = new WebSocket(wsUrl);
  
  socket.onopen = () => {
    cognifyStatus.value = 'Processing...';
  };
  
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as { status?: string };
      // data structure: { pipeline_run_id, status, payload }
      if (data.status) {
          cognifyStatus.value = formatStatus(data.status);
          
          // Update local dataset status in real-time based on WebSocket message
          if (currentDataset.value) {
            const pipelineStatus = data.status as PipelineRunStatus;
            const newSimplifiedStatus = KnowledgeService.getSimplifiedStatus(pipelineStatus);
            currentDataset.value = {
              ...currentDataset.value,
              status: newSimplifiedStatus,
              pipelineStatus: pipelineStatus,
            };
          }
          
          // Close dialog and refresh data when pipeline completes or errors
          if (data.status === PipelineRunStatus.DATASET_PROCESSING_COMPLETED as string ||
              data.status === PipelineRunStatus.DATASET_PROCESSING_ERRORED as string) {
            void refreshDatasetStatus();
            if (currentDataset.value) {
              void loadData(currentDataset.value.id); // Also refresh data items to show updated file statuses
            }
            isCognifying.value = false;
          }
      }
    } catch (e) {
      console.error('Error parsing WS message', e);
    }
  };
  
  socket.onclose = (event) => {
      isCognifying.value = false;
      if (event.code === 1000) {
          $q.notify({ type: 'positive', message: 'Knowledge graph built successfully!' });
          // Refresh status (in case onmessage didn't catch it)
          void refreshDatasetStatus();
      }
  };
  
  socket.onerror = (error) => {
      console.error('WebSocket Error:', error);
      $q.notify({ type: 'negative', message: 'Cognify connection error.' });
      isCognifying.value = false;
  };
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
  void loadDatasets();
});

onUnmounted(() => {
  stopStatusPolling();
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
