<template>
  <div class="column no-wrap full-height">

    <!-- Toolbar -->
    <q-toolbar class="bg-grey-1">
      <q-icon :name="projectIcon" class="q-mr-sm text-grey-6" />
      <q-toolbar-title class="text-subtitle2 text-weight-bold">
        {{ title }}
        <span class="text-weight-regular text-grey-6 q-ml-xs">({{ rules.length }})</span>
      </q-toolbar-title>
      <q-btn color="primary" icon="add" label="Add Rule" size="sm" unelevated @click="showAddDialog = true" />
    </q-toolbar>
    <q-separator />

    <!-- Loading -->
    <div v-if="loading" class="col column flex-center">
      <q-spinner color="primary" size="40px" />
      <div class="text-caption text-grey-5 q-mt-sm">Loading rules...</div>
    </div>

    <!-- Rules Table -->
    <div v-else-if="rules.length > 0" class="col q-pa-md" style="overflow: hidden;">
      <q-virtual-scroll
        type="table"
        style="max-height: 100%"
        :virtual-scroll-item-size="48"
        :virtual-scroll-sticky-size-start="48"
        :items="rules"
      >
        <template #before>
          <thead class="thead-sticky text-left">
            <tr>
              <th style="width: 40px;">#</th>
              <th>Rule</th>
              <th style="width: 48px;"></th>
            </tr>
          </thead>
        </template>

        <template #default="{ item: rule, index }">
          <tr :key="rule.id">
            <td class="text-grey-5 text-caption">{{ index + 1 }}</td>
            <td>{{ rule.text }}</td>
            <td>
              <q-btn flat round dense icon="delete" color="negative" size="sm" @click="handleDelete(rule.id)">
                <q-tooltip>Delete rule</q-tooltip>
              </q-btn>
            </td>
          </tr>
        </template>
      </q-virtual-scroll>
    </div>

    <!-- Empty State -->
    <div v-else class="col column flex-center text-grey-5">
      <q-icon name="rule" size="56px" color="grey-4" class="q-mb-md" />
      <div class="text-subtitle2">No rules yet</div>
      <div class="text-caption q-mt-xs">
        {{ projectId ? 'Add rules specific to this project' : 'Add global coding rules for all projects' }}
      </div>
      <q-btn
        outline color="primary" icon="add" label="Add First Rule"
        class="q-mt-lg" size="sm"
        @click="showAddDialog = true"
      />
    </div>

    <!-- Add Rule Dialog -->
    <q-dialog v-model="showAddDialog">
      <q-card style="width: 700px; max-width: 95vw;" class="column">
        <q-toolbar>
          <q-toolbar-title>
            Add Rule
            <span class="text-caption text-grey-5 q-ml-sm">→ {{ title }}</span>
          </q-toolbar-title>
          <q-btn flat round dense icon="close" @click="showAddDialog = false" />
        </q-toolbar>
        <q-separator />
        <q-card-section class="q-pt-sm" style="min-height: 0;">
          <div class="text-caption text-grey-6 q-mb-sm">
            Describe the rule in natural language. Be specific and clear.
          </div>
          <MdEditor
            v-model="newRuleText"
            language="en-US"
            :preview="false"
            :toolbars="toolbars"
            style="height: 300px;"
            placeholder="# Rule Title&#10;&#10;Describe your coding rule here...&#10;&#10;```python&#10;# Example&#10;def good_function():&#10;    pass&#10;```"
          />
        </q-card-section>
        <q-card-actions align="right" class="q-pt-none q-pb-md q-pr-md">
          <q-btn flat label="Cancel" @click="showAddDialog = false" />
          <q-btn
            unelevated color="primary" label="Add Rule"
            :loading="adding"
            :disable="!newRuleText.trim()"
            @click="handleAdd"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import { MdEditor, type ToolbarNames } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { RulesService, type Rule } from 'src/services/rules';

const props = defineProps<{
  projectId?: string | null;
  projectName?: string | null;
}>();

const $q = useQuasar();

const rules = ref<Rule[]>([]);
const loading = ref(false);
const showAddDialog = ref(false);
const newRuleText = ref('');
const adding = ref(false);

const title = computed(() =>
  props.projectName ? props.projectName : 'Global Rules'
);

const projectIcon = computed(() =>
  props.projectId ? 'folder_special' : 'public'
);

const toolbars: ToolbarNames[] = [
  'bold', 'italic', 'strikeThrough', '-',
  'title', 'quote', 'unorderedList', 'orderedList', 'task', '-',
  'codeRow', 'code', 'link', '-',
  'revoke', 'next', '=',
  'preview', 'fullscreen',
];

async function fetchRules() {
  loading.value = true;
  try {
    rules.value = await RulesService.getRules(props.projectId ?? undefined);
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to load rules' });
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.projectId,
  () => void fetchRules(),
  { immediate: true },
);

async function handleAdd() {
  if (!newRuleText.value.trim()) return;
  adding.value = true;
  try {
    await RulesService.addRule(newRuleText.value.trim(), props.projectId ?? undefined);
    await fetchRules();
    showAddDialog.value = false;
    newRuleText.value = '';
    $q.notify({ color: 'positive', message: 'Rule added' });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to add rule' });
  } finally {
    adding.value = false;
  }
}

async function handleDelete(ruleId: string) {
  try {
    await RulesService.deleteRule(ruleId, props.projectId ?? undefined);
    rules.value = rules.value.filter((r) => r.id !== ruleId);
    $q.notify({ color: 'positive', message: 'Rule deleted' });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to delete rule' });
  }
}
</script>

<style scoped>
.thead-sticky th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: white;
}
</style>
