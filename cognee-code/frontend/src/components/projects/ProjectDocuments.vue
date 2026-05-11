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
      <div class="text-subtitle2">{{ t('projects.noDataset') }}</div>
      <div class="text-caption q-mt-xs">{{ t('projects.selectProjectDataset') }}</div>
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

    <q-dialog v-model="showCognifyDialog">
      <q-card style="min-width: 400px">
        <q-toolbar class="bg-grey-1">
          <q-toolbar-title>{{ t('projects.buildKnowledgeGraph') }}</q-toolbar-title>
          <q-btn flat round dense icon="close" v-close-popup />
        </q-toolbar>
        <q-separator />

        <q-card-section class="q-pt-none">
          <div class="text-body1">
            {{ t('projects.buildKnowledgeGraphFor', { name: datasetName }) }}
          </div>

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
          <q-btn flat :label="t('common.cancel')" color="grey" v-close-popup />
          <q-btn unelevated :label="t('common.buildNow')" color="secondary" icon="auto_graph" @click="startCognify" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { KnowledgeService, DatasetStatus, type PipelineRunStatus } from 'src/services/knowledge';
import type { RuntimeConfig } from 'src/services/knowledge';
import type { DataItem } from 'src/services/knowledge';
import { CognifyService } from 'src/services/cognify';
import type { CognifyOptions } from 'src/services/cognify';
import DataList from 'components/knowledge/DataList.vue';
import AddDataDialog from 'components/knowledge/AddDataDialog.vue';
import FilePreviewDialog from 'components/knowledge/FilePreviewDialog.vue';

const props = defineProps<{
  projectId?: string | null;
  datasetId?: string | null;
  datasetName?: string;
}>();

const $q = useQuasar();
const { t } = useI18n();

const MUNINN_DEFAULT_CHUNK_SIZE = 4096;
const MUNINN_DEFAULT_CHUNK_OVERLAP_RATIO = 0.08;
const MUNINN_DEFAULT_MAX_TEXT_LENGTH = 16384;

const dataItems = ref<DataItem[]>([]);
const loading = ref(false);
const datasetStatus = ref<DatasetStatus>(DatasetStatus.EMPTY);
const vectorDbProvider = ref('');

const showAddDataDialog = ref(false);
const addDataDialogRef = ref<InstanceType<typeof AddDataDialog> | null>(null);
const showCognifyDialog = ref(false);

const showPreviewDialog = ref(false);
const previewItem = ref<DataItem | null>(null);
const previewContent = ref<Blob | null>(null);
const muninnChunkSize = ref<number>(MUNINN_DEFAULT_CHUNK_SIZE);
const muninnChunkOverlapRatio = ref<number>(MUNINN_DEFAULT_CHUNK_OVERLAP_RATIO);
const muninnMaxTextLength = ref<number>(MUNINN_DEFAULT_MAX_TEXT_LENGTH);

const datasetId = computed(() => props.datasetId ?? null);
const datasetName = computed(() => props.datasetName ?? t('projects.dataset'));
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

async function loadConfig() {
  try {
    const cfg = await KnowledgeService.getConfig();
    vectorDbProvider.value = cfg.vector_db_provider;
    applyMuninnDefaults(cfg);
  } catch {
    vectorDbProvider.value = '';
  }
}

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
    $q.notify({ color: 'negative', message: t('projects.failedLoadDataset') });
  } finally {
    loading.value = false;
  }
}

watch(() => props.datasetId, () => void loadData(), { immediate: true });
onMounted(() => { void loadConfig(); });

async function addText(text: string) {
  if (!datasetId.value) return;
  try {
    loading.value = true;
    await KnowledgeService.addTextData(datasetId.value, text);
    await loadData();
    addDataDialogRef.value?.close();
    $q.notify({ color: 'positive', message: t('projects.textAdded') });
  } catch {
    $q.notify({ color: 'negative', message: t('projects.failedAddText') });
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
    $q.notify({ color: 'positive', message: t('projects.urlAdded') });
  } catch {
    $q.notify({ color: 'negative', message: t('projects.failedAddUrl') });
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
    $q.notify({ color: 'positive', message: t('projects.fileUploaded') });
  } catch {
    $q.notify({ color: 'negative', message: t('projects.failedUploadFile') });
  } finally {
    loading.value = false;
  }
}

function confirmDeleteData(dataId: string) {
  $q.dialog({
    title: t('projects.deleteData'),
    message: t('projects.deleteDataConfirm'),
    cancel: true,
    persistent: true,
  }).onOk(() => void (async () => {
    if (!datasetId.value) return;
    try {
      loading.value = true;
      await KnowledgeService.deleteData(datasetId.value, dataId);
      await loadData();
      $q.notify({ color: 'positive', message: t('projects.dataDeleted') });
    } catch {
      $q.notify({ color: 'negative', message: t('projects.failedDeleteData') });
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
    $q.notify({ color: 'negative', message: t('projects.failedDownloadFile') });
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
    $q.notify({ color: 'negative', message: t('projects.failedLoadPreview') });
  }
}

function downloadPreviewItem() {
  if (previewItem.value) void downloadData(previewItem.value);
}

async function handleCognify() {
  if (!datasetId.value) return;
  if (isMuninnProvider.value) {
    showCognifyDialog.value = true;
    return;
  }

  await startCognify();
}

async function startCognify() {
  if (!datasetId.value) return;

  try {
    showCognifyDialog.value = false;
    datasetStatus.value = DatasetStatus.PROCESSING;
    const result = await CognifyService.cognify(datasetId.value, getCognifyOptions());
    if (result?.[0]?.status === 'PipelineRunCompleted') {
      $q.notify({ color: 'info', message: t('projects.allDataProcessed') });
      await loadData();
    }
  } catch {
    $q.notify({ color: 'negative', message: t('projects.failedStartCognify') });
    datasetStatus.value = DatasetStatus.ERROR;
  }
}

async function handleResetStatus() {
  if (!datasetId.value) return;
  try {
    await KnowledgeService.resetDatasetStatus([datasetId.value]);
    await loadData();
    void startCognify();
  } catch {
    $q.notify({ color: 'negative', message: t('projects.failedResetStatus') });
  }
}
</script>
