<template>
  <div class="column full-height">
    <!-- Header -->
    <div class="q-pa-md row items-center justify-between bg-grey-1">
      <div class="text-subtitle1 text-weight-bold">Knowledge Bases</div>
      <q-btn round flat icon="add" color="primary" @click="$emit('create')">
        <q-tooltip>Create New Dataset</q-tooltip>
      </q-btn>
    </div>

    <q-separator />

    <!-- Search -->
    <div class="q-px-md q-py-sm">
      <q-input dense outlined v-model="search" placeholder="Search..." class="bg-white">
        <template v-slot:append>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <!-- List -->
    <q-scroll-area class="col">
      <q-list separator>
        <q-item
          v-for="ds in filteredDatasets"
          :key="ds.id"
          clickable
          v-ripple
          :active="selectedId === ds.id"
          active-class="bg-blue-1 text-primary"
          @click="$emit('select', ds)"
        >
          <q-item-section avatar>
            <q-icon name="folder" :color="selectedId === ds.id ? 'primary' : 'grey'" />
          </q-item-section>

          <q-item-section>
            <q-item-label class="row items-center">
              <span>{{ ds.name }}</span>
              <!-- Status Badge -->
              <q-badge 
                v-if="getDatasetStatus(ds) !== 'empty'"
                :color="getStatusColor(getDatasetStatus(ds))" 
                :label="getStatusLabel(getDatasetStatus(ds))"
                class="q-ml-sm"
                rounded
              />
            </q-item-label>
            <q-item-label caption class="row items-center q-gutter-xs">
              <span>{{ formatDate(ds.created_at) }}</span>
              <!-- Processing indicator -->
              <q-spinner-dots 
                v-if="getDatasetStatus(ds) === 'processing'" 
                color="secondary" 
                size="14px"
              />
            </q-item-label>
          </q-item-section>

          <q-item-section side>
            <q-btn flat round dense icon="more_vert" @click.stop>
              <q-menu>
                <q-list style="min-width: 100px">
                  <q-item
                    clickable
                    v-close-popup
                    @click="$emit('delete', ds.id)"
                    class="text-negative"
                  >
                    <q-item-section avatar><q-icon name="delete" /></q-item-section>
                    <q-item-section>Delete</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </q-item-section>
        </q-item>

        <div v-if="filteredDatasets.length === 0" class="text-center q-pa-md text-grey">
          No datasets found
        </div>
      </q-list>
    </q-scroll-area>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { DatasetStatus, type Dataset, type DatasetWithStatus } from 'src/services/knowledge';
import { date } from 'quasar';

const props = defineProps<{
  datasets: (Dataset | DatasetWithStatus)[];
  selectedId?: string | undefined;
  loading?: boolean;
}>();

defineEmits<{
  (e: 'create'): void;
  (e: 'delete', id: string): void;
  (e: 'select', dataset: Dataset | DatasetWithStatus): void;
}>();

const search = ref('');

const filteredDatasets = computed(() => {
  if (!search.value) return props.datasets;
  const term = search.value.toLowerCase();
  return props.datasets.filter((d) => d.name.toLowerCase().includes(term));
});

function formatDate(isoString: string) {
  return date.formatDate(isoString, 'MMM D, YYYY');
}

function getDatasetStatus(ds: Dataset | DatasetWithStatus): DatasetStatus {
  if ('status' in ds) {
    return ds.status;
  }
  return DatasetStatus.PENDING;
}

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
</script>
