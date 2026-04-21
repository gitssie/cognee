<template>
  <div class="column no-wrap full-height bg-grey-2">
    <!-- Toolbar -->
    <q-toolbar class="bg-grey-2 q-pa-md q-pb-none" style="height: auto; flex-shrink: 0;">
      <div>
        <div class="text-h5 text-weight-bold row items-center">
          {{ datasetName }}
          <!-- Dataset Status Badge — hide during loading to avoid flash -->
          <q-badge 
            v-if="!loading && datasetStatus && datasetStatus !== 'empty'"
            :color="getStatusColor(datasetStatus)" 
            :label="getStatusLabel(datasetStatus)"
            class="q-ml-sm"
            rounded
          />
          <q-skeleton v-if="loading" type="QBadge" class="q-ml-sm" />
        </div>
        <div class="text-caption text-grey-8">
          <span v-if="!loading">{{ t('knowledge.itemsCount', { count: dataItems.length }) }}</span>
          <q-skeleton v-else type="text" width="60px" />
        </div>
      </div>
      <q-space />
      <div class="row q-gutter-sm">
        <q-input dense outlined v-model="filter" :placeholder="t('knowledge.filterFiles')" bg-color="white">
          <template v-slot:prepend>
            <q-icon name="search" />
          </template>
        </q-input>
        <q-btn 
          color="secondary" 
          icon="auto_graph" 
          :label="cognifyButtonLabel"
          :loading="datasetStatus === 'processing'"
          @click="$emit('cognify')" 
          unelevated 
        >
          <q-tooltip v-if="datasetStatus === 'completed'">
            {{ t('knowledge.reprocessGraph') }}
          </q-tooltip>
        </q-btn>
        <q-btn color="warning" icon="share" :label="t('common.share')" @click="$emit('share')" unelevated text-color="dark" />
        <q-btn color="primary" icon="add" :label="t('common.addContent')" @click="$emit('add')" unelevated />
      </div>
    </q-toolbar>

    <!-- Status Banner - only show during processing or on error -->
    <q-banner 
      v-if="showStatusBanner" 
      :class="statusBannerClass"
      class="q-mx-md q-mt-sm"
      rounded
    >
      <template v-slot:avatar>
        <q-icon :name="statusBannerIcon" :color="statusBannerIconColor" />
      </template>
      {{ statusBannerMessage }}
      <template v-slot:action v-if="datasetStatus === 'error'">
        <q-btn flat :label="t('common.retry')" color="red" @click="$emit('cognify')" />
      </template>
    </q-banner>

    <!-- Content: fills remaining height, table scrolls inside -->
    <div class="col q-pa-md column no-wrap" style="min-height: 0;">
      <q-card flat bordered class="col column no-wrap" style="min-height: 0;">
        <q-table
          :rows="dataItems"
          :columns="columns"
          row-key="id"
          :loading="loading"
          :filter="filter"
          flat
          binary-state-sort
          virtual-scroll
          class="col"
          :rows-per-page-options="[0]"
        >
        <!-- Custom File Name with Icon -->
        <template v-slot:body-cell-name="props">
          <q-td :props="props">
            <div class="row items-center">
              <q-avatar size="sm" :color="getIconColor(getMimeType(props.row))" text-color="white" :icon="getIcon(getMimeType(props.row))" class="q-mr-sm" />
              <span class="text-weight-medium">{{ props.row.name }}</span>
            </div>
          </q-td>
        </template>

        <!-- Status / Type Badge -->
        <template v-slot:body-cell-type="props">
          <q-td :props="props">
            <q-chip dense outline size="sm" :color="getIconColor(getMimeType(props.row))">
              {{ formatMime(getMimeType(props.row)) }}
            </q-chip>
          </q-td>
        </template>

        <!-- Data Item Status -->
        <template v-slot:body-cell-status="props">
          <q-td :props="props">
            <q-chip 
              dense 
              size="sm" 
              :color="getItemStatusColor(getItemStatus(props.row))"
              :outline="getItemStatus(props.row) !== DataItemStatus.COMPLETED"
              :icon="getItemStatusIcon(getItemStatus(props.row))"
            >
              {{ getItemStatusLabel(getItemStatus(props.row)) }}
            </q-chip>
          </q-td>
        </template>

        <!-- Actions -->
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn flat round dense color="grey-7" icon="more_horiz">
              <q-menu>
                <q-list style="min-width: 150px">
                  <q-item clickable v-close-popup @click="$emit('preview', props.row)">
                    <q-item-section avatar><q-icon name="visibility" /></q-item-section>
                    <q-item-section>{{ t('common.preview') }}</q-item-section>
                  </q-item>
                  <q-item clickable v-close-popup @click="$emit('download', props.row)">
                    <q-item-section avatar><q-icon name="download" /></q-item-section>
                    <q-item-section>{{ t('common.download') }}</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item clickable v-close-popup @click="$emit('delete', props.row.id)" class="text-negative">
                    <q-item-section avatar><q-icon name="delete" /></q-item-section>
                    <q-item-section>{{ t('common.delete') }}</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </q-td>
        </template>
        
        <!-- Empty State -->
        <template v-slot:no-data>
          <div v-if="!loading" class="full-width row flex-center q-pa-xl text-grey-6 column">
            <q-icon name="folder_open" size="64px" class="q-mb-md" />
            <div class="text-h6">{{ t('knowledge.noFiles') }}</div>
            <div>{{ t('knowledge.uploadToStart') }}</div>
            <q-btn flat color="primary" :label="t('common.addContent')" class="q-mt-sm" @click="$emit('add')" />
          </div>
        </template>
        </q-table>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { DatasetStatus, DataItemStatus, getDataItemStatus, type DataItem } from 'src/services/knowledge';
import type { QTableColumn } from 'quasar';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  datasetName: string;
  datasetId?: string;
  dataItems: DataItem[];
  loading?: boolean;
  datasetStatus?: DatasetStatus;
}>();

defineEmits<{
  (e: 'back'): void;
  (e: 'add'): void;
  (e: 'cognify'): void;
  (e: 'delete', id: string): void;
  (e: 'download', item: DataItem): void;
  (e: 'preview', item: DataItem): void;
  (e: 'share'): void;
  (e: 'reset-status'): void;
}>();

const filter = ref('');
const { t } = useI18n();

// Computed properties for status display
const cognifyButtonLabel = computed(() => {
  if (props.datasetStatus === DatasetStatus.PROCESSING) {
    return t('knowledge.building');
  }
  return 'Cognify';
});

const showStatusBanner = computed(() => {
  if (!props.datasetStatus) return false;
  if (props.dataItems.length === 0) return false;
  // Only show banner during active processing or on error
  return props.datasetStatus === DatasetStatus.PROCESSING ||
         props.datasetStatus === DatasetStatus.ERROR;
});

const statusBannerClass = computed(() => {
  switch (props.datasetStatus) {
    case DatasetStatus.PROCESSING:
      return 'bg-secondary text-white';
    case DatasetStatus.ERROR:
      return 'bg-red-1 text-red-9';
    default:
      return 'bg-grey-2';
  }
});

const statusBannerIcon = computed(() => {
  switch (props.datasetStatus) {
    case DatasetStatus.PROCESSING:
      return 'hourglass_empty';
    case DatasetStatus.ERROR:
      return 'error';
    default:
      return 'info';
  }
});

const statusBannerIconColor = computed(() => {
  switch (props.datasetStatus) {
    case DatasetStatus.PROCESSING:
      return 'white';
    case DatasetStatus.ERROR:
      return 'red-9';
    default:
      return 'grey';
  }
});

const statusBannerMessage = computed(() => {
  switch (props.datasetStatus) {
    case DatasetStatus.PROCESSING:
      return t('knowledge.buildGraphProcessing');
    case DatasetStatus.ERROR:
      return t('knowledge.processingError');
    default:
      return '';
  }
});

// Helper functions
function getStatusColor(status: DatasetStatus): string {
  switch (status) {
    case DatasetStatus.COMPLETED:
      return 'positive';
    case DatasetStatus.PROCESSING:
      return 'secondary';
    case DatasetStatus.PENDING:
      return 'warning';
    case DatasetStatus.ERROR:
      return 'negative';
    case DatasetStatus.EMPTY:
      return 'grey';
    default:
      return 'grey';
  }
}

function getStatusLabel(status: DatasetStatus): string {
  switch (status) {
    case DatasetStatus.COMPLETED:
      return t('knowledge.ready');
    case DatasetStatus.PROCESSING:
      return t('knowledge.building');
    case DatasetStatus.PENDING:
      return t('knowledge.pending');
    case DatasetStatus.ERROR:
      return t('knowledge.error');
    case DatasetStatus.EMPTY:
      return '';
    default:
      return '';
  }
}

// Helper to get mime type (supports both snake_case and camelCase)
function getMimeType(row: DataItem): string | undefined {
  return row.mime_type || row.mimeType;
}

// Helper to get created date (supports both snake_case and camelCase)
function getCreatedAt(row: DataItem): string {
  const dateStr = row.created_at || row.createdAt;
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString();
}

const columns: QTableColumn[] = [
  { name: 'name', required: true, label: t('knowledge.name'), align: 'left', field: 'name', sortable: true },
  { name: 'type', align: 'left', label: t('knowledge.type'), field: (row: DataItem) => getMimeType(row), sortable: true },
  { name: 'status', align: 'left', label: t('knowledge.status'), field: 'status', sortable: true },
  { name: 'created_at', align: 'left', label: t('knowledge.addedAt'), field: (row: DataItem) => getCreatedAt(row), sortable: true },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
];

// Helper to get data item processing status
function getItemStatus(row: DataItem): DataItemStatus {
  return getDataItemStatus(row, props.datasetId);
}

function getItemStatusColor(status: DataItemStatus): string {
  return status === DataItemStatus.COMPLETED ? 'positive' : 'grey';
}

function getItemStatusLabel(status: DataItemStatus): string {
  return status === DataItemStatus.COMPLETED ? t('knowledge.ready') : t('knowledge.pending');
}

function getItemStatusIcon(status: DataItemStatus): string {
  return status === DataItemStatus.COMPLETED ? 'check_circle' : 'schedule';
}

function getIcon(mime?: string) {
  if (!mime) return 'help_outline';
  if (mime.includes('text')) return 'description';
  if (mime.includes('image')) return 'image';
  if (mime.includes('pdf')) return 'picture_as_pdf';
  return 'insert_drive_file';
}

function getIconColor(mime?: string) {
  if (!mime) return 'grey';
  if (mime.includes('text')) return 'blue';
  if (mime.includes('image')) return 'purple';
  if (mime.includes('pdf')) return 'red';
  return 'teal';
}

function formatMime(mime?: string) {
  if (!mime) return t('knowledge.unknown');
  if (mime === 'application/octet-stream') return t('knowledge.file');
  return mime.split('/').pop()?.toUpperCase() || mime;
}
</script>
