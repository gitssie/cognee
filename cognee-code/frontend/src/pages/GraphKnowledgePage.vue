<template>
  <q-page class="q-pa-md">
    <div class="text-h4 q-mb-md">{{ t('graphPage.title') }}</div>

    <q-card>
      <q-toolbar class="bg-grey-1">
        <q-toolbar-title>{{ t('graphPage.visualizationTitle') }}</q-toolbar-title>
        <q-btn
          color="primary"
          icon="visibility"
          :label="t('graphPage.visualize')"
          unelevated
          :disable="!selectedDataset"
          :loading="loadingVisualization"
          @click="loadVisualization"
        />
      </q-toolbar>
      <q-separator />

      <q-card-section>
        <div class="row q-col-gutter-md q-mb-md">
          <div class="col-12 col-md-6">
            <q-select
              v-model="selectedDataset"
              :options="datasets"
              option-value="id"
              option-label="name"
              :label="t('graphPage.selectDataset')"
              outlined
              emit-value
              map-options
              :loading="loadingDatasets"
            />
          </div>
        </div>

        <div v-if="loadingVisualization" class="column items-center q-pa-xl text-grey">
          <q-spinner-orbit size="56px" color="primary" />
          <div class="q-mt-md">{{ t('graphPage.loadingGraph') }}</div>
        </div>

        <div v-else-if="visualizationError" class="text-center text-negative q-pa-xl">
          <q-icon name="error" size="64px" class="q-mb-md" />
          <div class="text-h6">{{ t('graphPage.failedVisualization') }}</div>
          <div class="text-body2">{{ visualizationError }}</div>
        </div>

        <div v-else-if="graph.nodes.length === 0" class="text-center text-grey q-pa-xl">
          <q-icon name="hub" size="64px" class="q-mb-md" />
          <div class="text-h6">{{ t('graphPage.selectDatasetHint') }}</div>
          <div class="text-body2">{{ t('graphPage.graphDisplayed') }}</div>
        </div>

        <div v-else class="graph-shell">
          <div class="graph-canvas">
            <svg viewBox="0 0 1000 680" class="graph-svg" role="img" aria-label="Muninn entity graph">
              <line
                v-for="edge in renderedEdges"
                :key="edge.key"
                :x1="edge.x1"
                :y1="edge.y1"
                :x2="edge.x2"
                :y2="edge.y2"
                class="graph-edge"
              />
              <text
                v-for="edge in renderedEdges"
                :key="`${edge.key}-label`"
                :x="edge.labelX"
                :y="edge.labelY"
                class="graph-edge-label"
              >
                {{ edge.label }}
              </text>

              <g v-for="node in renderedNodes" :key="node.id">
                <circle :cx="node.x" :cy="node.y" r="26" class="graph-node" />
                <text :x="node.x" :y="node.y + 42" class="graph-node-label">{{ node.label }}</text>
                <text :x="node.x" :y="node.y + 58" class="graph-node-type">{{ node.type }}</text>
              </g>
            </svg>
          </div>

          <div class="graph-sidebar">
            <div class="text-subtitle2 q-mb-sm">{{ t('graphPage.summary') }}</div>
            <div class="text-body2 text-grey-7 q-mb-md">
              {{ t('graphPage.summaryStats', { nodes: graph.nodes.length, edges: graph.edges.length }) }}
            </div>

            <q-list bordered separator>
              <q-item v-for="node in graph.nodes.slice(0, 12)" :key="node.id">
                <q-item-section>
                  <q-item-label>{{ node.label }}</q-item-label>
                  <q-item-label caption>{{ node.type }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { KnowledgeService, type Dataset } from 'src/services/knowledge';
import { VisualizeService, type DatasetGraphResponse } from 'src/services/visualize';

defineOptions({ name: 'GraphKnowledgePage' });

interface PositionedNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

interface PositionedEdge {
  key: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
}

const $q = useQuasar();
const { t } = useI18n();

const datasets = ref<Dataset[]>([]);
const selectedDataset = ref<string | null>(null);
const loadingDatasets = ref(false);
const loadingVisualization = ref(false);
const visualizationError = ref<string | null>(null);
const graph = ref<DatasetGraphResponse>({ nodes: [], edges: [] });

const renderedNodes = computed<PositionedNode[]>(() => {
  const source = graph.value.nodes;
  const count = source.length;
  if (count === 0) return [];

  const centerX = 500;
  const centerY = 320;
  const radius = Math.max(180, Math.min(280, 60 + count * 12));

  return source.map((node, index) => {
    const angle = (2 * Math.PI * index) / count - Math.PI / 2;
    return {
      ...node,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });
});

const renderedEdges = computed<PositionedEdge[]>(() => {
  const nodeMap = new Map(renderedNodes.value.map((node) => [node.id, node]));
  return graph.value.edges
    .map((edge, index) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return null;

      return {
        key: `${edge.source}-${edge.target}-${index}`,
        label: edge.label,
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y,
        labelX: (source.x + target.x) / 2,
        labelY: (source.y + target.y) / 2,
      };
    })
    .filter((edge): edge is PositionedEdge => edge !== null);
});

async function loadDatasets() {
  loadingDatasets.value = true;
  try {
    datasets.value = await KnowledgeService.getDatasets();
    if (!selectedDataset.value && datasets.value.length > 0) {
      selectedDataset.value = datasets.value[0]?.id ?? null;
    }
  } catch {
    $q.notify({ color: 'negative', message: t('knowledge.failedLoadDatasets') });
  } finally {
    loadingDatasets.value = false;
  }
}

async function loadVisualization() {
  if (!selectedDataset.value) return;

  loadingVisualization.value = true;
  visualizationError.value = null;
  try {
    graph.value = await VisualizeService.getDatasetGraph(selectedDataset.value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : t('knowledge.unknown');
    visualizationError.value = detail;
    graph.value = { nodes: [], edges: [] };
    $q.notify({ color: 'negative', message: t('graphPage.failedVisualization') });
  } finally {
    loadingVisualization.value = false;
  }
}

onMounted(() => {
  void loadDatasets();
});
</script>

<style lang="scss" scoped>
.graph-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
}

.graph-canvas {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  min-height: 680px;
  overflow: auto;
}

.graph-svg {
  width: 100%;
  height: 680px;
}

.graph-edge {
  stroke: #94a3b8;
  stroke-width: 1.5;
}

.graph-edge-label {
  fill: #64748b;
  font-size: 11px;
  text-anchor: middle;
}

.graph-node {
  fill: #1976d2;
  opacity: 0.9;
}

.graph-node-label {
  fill: #0f172a;
  font-size: 12px;
  font-weight: 600;
  text-anchor: middle;
}

.graph-node-type {
  fill: #64748b;
  font-size: 11px;
  text-anchor: middle;
}

.graph-sidebar {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 16px;
}

@media (max-width: 1023px) {
  .graph-shell {
    grid-template-columns: 1fr;
  }
}
</style>
