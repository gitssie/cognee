<template>
  <div class="q-pa-md">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">Rules ({{ rules.length }})</div>
      <q-btn color="primary" icon="add" label="Add Rule" @click="showAddDialog = true" />
    </div>

    <q-list bordered separator class="rounded-borders bg-white">
      <q-item v-for="(rule, index) in rules" :key="index">
        <q-item-section>
          <MarkdownRender :content="rule" />
        </q-item-section>
      </q-item>
      <q-item v-if="rules.length === 0 && !loading">
        <q-item-section class="text-grey italic text-center q-pa-md">No rules found.</q-item-section>
      </q-item>
      <q-item v-if="loading">
        <q-item-section class="text-center q-pa-md">
          <q-spinner color="primary" size="2em" />
        </q-item-section>
      </q-item>
    </q-list>

    <!-- Add Rule Dialog -->
    <q-dialog v-model="showAddDialog" maximized>
      <q-card class="column full-height">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Add Coding Rule</div>
          <q-space />
          <q-btn icon="close" flat round dense @click="showAddDialog = false" />
        </q-card-section>

        <q-card-section class="col q-pt-sm" style="overflow: hidden;">
          <div class="text-caption text-grey q-mb-sm">
            Describe the rule or memory using Markdown. The AI will extract the formal rule.
          </div>
          <MdEditor
            v-model="newRuleText"
            language="en-US"
            :preview="false"
            :toolbars="toolbars"
            style="height: calc(100% - 24px);"
            placeholder="# Rule Title&#10;&#10;Describe your coding rule here...&#10;&#10;## Examples&#10;&#10;```python&#10;# Good example&#10;def good_function():&#10;    pass&#10;```"
          />
        </q-card-section>

        <q-card-actions align="right" class="q-pt-none">
          <q-btn flat label="Cancel" @click="showAddDialog = false" />
          <q-btn color="primary" label="Add Rule" @click="handleAdd" :loading="adding" :disable="!newRuleText.trim()" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { MarkdownRender } from 'markstream-vue';
import 'markstream-vue/index.css';
import { MdEditor, type ToolbarNames } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { RulesService } from 'src/services/rules';

const $q = useQuasar();
const rules = ref<string[]>([]);
const loading = ref(false);
const showAddDialog = ref(false);
const newRuleText = ref('');
const adding = ref(false);

// Toolbar configuration - useful items for writing rules
const toolbars: ToolbarNames[] = [
  'bold', 'italic', 'strikeThrough',
  '-',
  'title', 'quote', 'unorderedList', 'orderedList', 'task',
  '-',
  'codeRow', 'code', 'link', 'table',
  '-',
  'revoke', 'next',
  '=',
  'preview', 'fullscreen'
];

async function fetchRules() {
  loading.value = true;
  try {
    rules.value = await RulesService.getRules();
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to load rules' });
  } finally {
    loading.value = false;
  }
}

async function handleAdd() {
  if (!newRuleText.value.trim()) return;
  adding.value = true;
  try {
    await RulesService.addRule(newRuleText.value);
    $q.notify({ color: 'positive', message: 'Rule added (extraction started)' });
    showAddDialog.value = false;
    newRuleText.value = '';
    setTimeout(() => { void fetchRules(); }, 2000);
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to add rule' });
  } finally {
    adding.value = false;
  }
}

onMounted(() => {
  void fetchRules();
});
</script>
