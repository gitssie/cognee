<template>
  <div class="column full-height q-pa-md bg-grey-2">
    <!-- Toolbar -->
    <div class="row items-center justify-between q-mb-md">
      <div>
        <div class="text-h5 text-weight-bold row items-center">
          {{ datasetName }}
          <!-- Dataset Status Badge -->
          <q-badge 
            v-if="datasetStatus && datasetStatus !== 'empty'"
            :color="getStatusColor(datasetStatus)" 
            :label="getStatusLabel(datasetStatus)"
            class="q-ml-sm"
            rounded
          />
        </div>
        <div class="text-caption text-grey-8">{{ dataItems.length }} items</div>
      </div>
      <div class="row q-gutter-sm">
        <q-input dense outlined v-model="filter" placeholder="Filter files..." bg-color="white">
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
            Re-process the knowledge graph
          </q-tooltip>
        </q-btn>
        <q-btn color="warning" icon="share" label="Share" @click="$emit('share')" unelevated text-color="dark" />
        <q-btn color="primary" icon="add" label="Add Content" @click="$emit('add')" unelevated />
      </div>
    </div>

    <!-- Status Banner - only show during processing or on error -->
    <q-banner 
      v-if="showStatusBanner" 
      :class="statusBannerClass"
      class="q-mb-md"
      rounded
    >
      <template v-slot:avatar>
        <q-icon :name="statusBannerIcon" :color="statusBannerIconColor" />
      </template>
      {{ statusBannerMessage }}
      <template v-slot:action v-if="datasetStatus === 'error'">
        <q-btn flat label="Retry" color="red" @click="$emit('cognify')" />
      </template>
    </q-banner>

    <!-- Content -->
    <q-card flat bordered class="col">
      <q-table
        :rows="dataItems"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :filter="filter"
        flat
        binary-state-sort
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
                    <q-item-section>Preview</q-item-section>
                  </q-item>
                  <q-item clickable v-close-popup @click="$emit('download', props.row)">
                    <q-item-section avatar><q-icon name="download" /></q-item-section>
                    <q-item-section>Download</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item clickable v-close-popup @click="$emit('delete', props.row.id)" class="text-negative">
                    <q-item-section avatar><q-icon name="delete" /></q-item-section>
                    <q-item-section>Delete</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </q-td>
        </template>
        
        <!-- Empty State -->
        <template v-slot:no-data>
          <div class="full-width row flex-center q-pa-xl text-grey-6 column">
            <q-icon name="folder_open" size="64px" class="q-mb-md" />
            <div class="text-h6">No files in this dataset</div>
            <div>Upload a file or add text to get started.</div>
            <q-btn flat color="primary" label="Add Content" class="q-mt-sm" @click="$emit('add')" />
          </div>
        </template>
      </q-table>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { DatasetStatus, DataItemStatus, getDataItemStatus, type DataItem } from 'src/services/knowledge';
import type { QTableColumn } from 'quasar';

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

// Computed properties for status display
const cognifyButtonLabel = computed(() => {
  if (props.datasetStatus === DatasetStatus.PROCESSING) {
    return 'Building...';
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
      return 'Building knowledge graph... This may take a few minutes.';
    case DatasetStatus.ERROR:
      return 'An error occurred while processing. Please try again.';
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
      return 'Ready';
    case DatasetStatus.PROCESSING:
      return 'Building...';
    case DatasetStatus.PENDING:
      return 'Pending';
    case DatasetStatus.ERROR:
      return 'Error';
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
  { name: 'name', required: true, label: 'Name', align: 'left', field: 'name', sortable: true },
  { name: 'type', align: 'left', label: 'Type', field: (row: DataItem) => getMimeType(row), sortable: true },
  { name: 'status', align: 'left', label: 'Status', field: 'status', sortable: true },
  { name: 'created_at', align: 'left', label: 'Added At', field: (row: DataItem) => getCreatedAt(row), sortable: true },
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
  return status === DataItemStatus.COMPLETED ? 'Ready' : 'Pending';
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
  if (!mime) return 'Unknown';
  if (mime === 'application/octet-stream') return 'File';
  return mime.split('/').pop()?.toUpperCase() || mime;
}
</script>
