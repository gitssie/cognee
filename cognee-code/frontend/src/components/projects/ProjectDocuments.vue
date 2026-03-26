<template>
  <div class="column no-wrap full-height">
    <DataList
      v-if="datasetId"
      :dataset-name="datasetName"
      :dataset-id="datasetId"
      :data-items="dataItems"
      :loading="loading"
      :dataset-status="datasetStatus"
      @add="showAddDataDialog = true"
      @cognify="handleCognify"
      @delete="confirmDeleteData"
      @download="downloadData"
      @preview="previewData"
      @share="() => {}"
      @reset-status="handleResetStatus"
    />

    <!-- No dataset context (global / no project selected) -->
    <div v-else class="col column flex-center text-grey-5">
      <q-icon name="dataset" size="56px" color="grey-4" class="q-mb-md" />
      <div class="text-subtitle2">No dataset</div>
      <div class="text-caption q-mt-xs">Select a project to view its dataset</div>
    </div>

    <!-- Add Data Dialog (reuse from knowledge) -->
    <AddDataDialog
      ref="addDataDialogRef"
      v-model="showAddDataDialog"
      @add-text="addText"
      @add-url="addUrl"
      @add-file="addFile"
    />

    <!-- File Preview Dialog -->
    <FilePreviewDialog
      v-model="showPreviewDialog"
      :file-name="previewItem?.name ?? ''"
      :mime-type="previewItem?.mime_type ?? previewItem?.mimeType ?? ''"
      :content="previewContent"
      @download="downloadPreviewItem"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import { KnowledgeService, DatasetStatus, type PipelineRunStatus } from 'src/services/knowledge';
import type { DataItem } from 'src/services/knowledge';
import { CognifyService } from 'src/services/cognify';
import DataList from 'components/knowledge/DataList.vue';
import AddDataDialog from 'components/knowledge/AddDataDialog.vue';
import FilePreviewDialog from 'components/knowledge/FilePreviewDialog.vue';

const props = defineProps<{
  projectId?: string | null;
  datasetId?: string | null;
  datasetName?: string;
}>();

const $q = useQuasar();

const dataItems = ref<DataItem[]>([]);
const loading = ref(false);
const datasetStatus = ref<DatasetStatus>(DatasetStatus.EMPTY);

const showAddDataDialog = ref(false);
const addDataDialogRef = ref<InstanceType<typeof AddDataDialog> | null>(null);

const showPreviewDialog = ref(false);
const previewItem = ref<DataItem | null>(null);
const previewContent = ref<Blob | null>(null);

const datasetId = computed(() => props.datasetId ?? null);
const datasetName = computed(() => props.datasetName ?? 'Project Dataset');

async function loadData() {
  if (!datasetId.value) {
    dataItems.value = [];
    return;
  }
  loading.value = true;
  try {
    dataItems.value = await KnowledgeService.getData(datasetId.value);
    // Load dataset status
    const statusMap = await KnowledgeService.getDatasetStatusDetails([datasetId.value]);
    const info = statusMap[datasetId.value];
    if (info?.status) {
      datasetStatus.value = KnowledgeService.getSimplifiedStatus(info.status as PipelineRunStatus);
    } else {
      datasetStatus.value = dataItems.value.length > 0 ? DatasetStatus.PENDING : DatasetStatus.EMPTY;
    }
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to load dataset' });
  } finally {
    loading.value = false;
  }
}

watch(() => props.datasetId, () => void loadData(), { immediate: true });

async function addText(text: string) {
  if (!datasetId.value) return;
  try {
    loading.value = true;
    await KnowledgeService.addTextData(datasetId.value, text);
    await loadData();
    addDataDialogRef.value?.close();
    $q.notify({ color: 'positive', message: 'Text added' });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to add text' });
  } finally {
    loading.value = false;
  }
}

async function addUrl(url: string) {
  if (!datasetId.value) return;
  try {
    loading.value = true;
    await KnowledgeService.addUrlData(datasetId.value, url);
    await loadData();
    addDataDialogRef.value?.close();
    $q.notify({ color: 'positive', message: 'URL added' });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to add URL' });
  } finally {
    loading.value = false;
  }
}

async function addFile(file: File) {
  if (!datasetId.value) return;
  try {
    loading.value = true;
    await KnowledgeService.uploadFile(datasetId.value, file);
    await loadData();
    addDataDialogRef.value?.close();
    $q.notify({ color: 'positive', message: 'File uploaded' });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to upload file' });
  } finally {
    loading.value = false;
  }
}

function confirmDeleteData(dataId: string) {
  $q.dialog({
    title: 'Delete Data',
    message: 'Delete this file? This cannot be undone.',
    cancel: true,
    persistent: true,
  }).onOk(() => void (async () => {
    if (!datasetId.value) return;
    try {
      loading.value = true;
      await KnowledgeService.deleteData(datasetId.value, dataId);
      await loadData();
      $q.notify({ color: 'positive', message: 'Data deleted' });
    } catch {
      $q.notify({ color: 'negative', message: 'Failed to delete data' });
    } finally {
      loading.value = false;
    }
  })());
}

async function downloadData(item: DataItem) {
  if (!datasetId.value) return;
  try {
    const blob = await KnowledgeService.downloadRawData(datasetId.value, item.id);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = item.name || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to download file' });
  }
}

async function previewData(item: DataItem) {
  if (!datasetId.value) return;
  previewItem.value = item;
  previewContent.value = null;
  showPreviewDialog.value = true;
  try {
    previewContent.value = await KnowledgeService.downloadRawData(datasetId.value, item.id);
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to load preview' });
  }
}

function downloadPreviewItem() {
  if (previewItem.value) void downloadData(previewItem.value);
}

async function handleCognify() {
  if (!datasetId.value) return;
  try {
    datasetStatus.value = DatasetStatus.PROCESSING;
    const result = await CognifyService.cognify(datasetId.value);
    if (result?.[0]?.status === 'PipelineRunCompleted') {
      $q.notify({ color: 'info', message: 'All data already processed.' });
      await loadData();
    }
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to start Cognify' });
    datasetStatus.value = DatasetStatus.ERROR;
  }
}

async function handleResetStatus() {
  if (!datasetId.value) return;
  try {
    await KnowledgeService.resetDatasetStatus([datasetId.value]);
    await loadData();
    void handleCognify();
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to reset status' });
  }
}
</script>
