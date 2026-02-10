<template>
  <q-page class="q-pa-md">
    <div class="text-h4 q-mb-md">Graph Knowledge</div>

    <div class="q-gutter-y-md">
      <!-- Visualization Section -->
      <q-card>
        <q-card-section>
          <div class="text-h5">Knowledge Graph Visualization</div>
          <div class="text-subtitle2 text-grey">Visualize your dataset's knowledge graph</div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <div class="row q-gutter-md items-center q-mb-md">
            <q-select
              v-model="selectedDataset"
              :options="datasets"
              option-value="id"
              option-label="name"
              label="Select Dataset"
              outlined
              style="min-width: 300px;"
              emit-value
              map-options
              :loading="loadingDatasets"
            />
            <q-btn
              color="primary"
              label="Visualize"
              icon="visibility"
              @click="loadVisualization"
              :disable="!selectedDataset"
              :loading="loadingVisualization"
            />
          </div>

          <!-- Visualization Content - use iframe with srcdoc to properly render the full HTML page -->
          <div v-if="visualizationHtml" class="visualization-container">
            <iframe
              :srcdoc="visualizationHtml"
              class="visualization-frame"
              frameborder="0"
              allowfullscreen
            />
          </div>
          <div v-else-if="visualizationError" class="text-center text-negative q-pa-xl">
            <q-icon name="error" size="64px" class="q-mb-md" />
            <div class="text-h6">Failed to load visualization</div>
            <div class="text-body2">{{ visualizationError }}</div>
          </div>
          <div v-else-if="!loadingVisualization" class="text-center text-grey q-pa-xl">
            <q-icon name="hub" size="64px" class="q-mb-md" />
            <div class="text-h6">Select a dataset to visualize</div>
            <div class="text-body2">The knowledge graph will be displayed here</div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Ontology Management Section -->
      <q-card>
        <q-card-section>
          <div class="text-h5">Ontology Management</div>
          <div class="text-subtitle2 text-grey">Manage your OWL ontology files (M2)</div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <OntologyManager />
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import OntologyManager from 'components/OntologyManager.vue';
import { KnowledgeService, type Dataset } from 'src/services/knowledge';
import { VisualizeService } from 'src/services/visualize';

defineOptions({
  name: 'GraphKnowledgePage'
});

const $q = useQuasar();

const datasets = ref<Dataset[]>([]);
const selectedDataset = ref<string | null>(null);
const loadingDatasets = ref(false);
const loadingVisualization = ref(false);
const visualizationHtml = ref<string | null>(null);
const visualizationError = ref<string | null>(null);

async function loadDatasets() {
  loadingDatasets.value = true;
  try {
    datasets.value = await KnowledgeService.getDatasets();
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to load datasets' });
  } finally {
    loadingDatasets.value = false;
  }
}

async function loadVisualization() {
  if (!selectedDataset.value) return;
  loadingVisualization.value = true;
  visualizationError.value = null;
  visualizationHtml.value = null;
  
  try {
    const html = await VisualizeService.getVisualizationHtml(selectedDataset.value);
    visualizationHtml.value = html;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    visualizationError.value = errorMsg;
    $q.notify({ color: 'negative', message: 'Failed to load visualization' });
  } finally {
    loadingVisualization.value = false;
  }
}

onMounted(() => {
  void loadDatasets();
});
</script>

<style lang="scss" scoped>
.visualization-container {
  width: 100%;
  height: 600px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.visualization-frame {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
