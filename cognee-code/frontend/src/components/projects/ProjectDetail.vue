<template>
  <div class="column no-wrap full-height">

    <!-- Project Header Toolbar -->
    <q-toolbar class="bg-white" style="border-bottom: 1px solid #e0e0e0;">
      <q-icon :name="projectIcon" size="22px" class="q-mr-sm text-primary" />
      <q-toolbar-title class="text-h6 text-weight-bold">
        {{ project ? project.name : 'Global Rules' }}
      </q-toolbar-title>

      <!-- Type Badge -->
      <q-chip
        v-if="project"
        dense outline size="sm"
        :color="typeBadgeColor"
        :icon="projectIcon"
        class="q-mr-md"
      >
        {{ typeBadgeLabel }}
      </q-chip>

      <!-- Actions -->
      <template v-if="project">
        <q-btn flat round dense icon="edit" size="sm" class="text-grey-6" @click="$emit('rename', project)">
          <q-tooltip>Rename project</q-tooltip>
        </q-btn>
        <q-btn flat round dense icon="delete" size="sm" class="text-negative q-ml-xs" @click="$emit('delete', project)">
          <q-tooltip>Delete project</q-tooltip>
        </q-btn>
      </template>
    </q-toolbar>

    <!-- Tabs (only show for actual projects) -->
    <template v-if="project">
      <q-tabs
        v-model="activeTab"
        dense align="left"
        class="bg-grey-1 text-grey-7"
        active-color="primary"
        indicator-color="primary"
        style="border-bottom: 1px solid #e0e0e0;"
      >
        <q-tab name="rules" icon="rule" label="Rules" />
        <q-tab name="dataset" icon="dataset" label="Dataset" />
      </q-tabs>

      <q-tab-panels v-model="activeTab" animated class="col bg-transparent">
        <q-tab-panel name="rules" class="q-pa-none full-height">
          <ProjectRules :project-id="project.id" :project-name="project.name" />
        </q-tab-panel>
        <q-tab-panel name="dataset" class="q-pa-none full-height">
          <ProjectDocuments
            :project-id="project.id"
            :dataset-id="project.dataset_id"
            :dataset-name="project.name"
          />
        </q-tab-panel>
      </q-tab-panels>
    </template>

    <!-- Global Rules (no tabs) -->
    <template v-else>
      <div class="col">
        <ProjectRules :project-id="null" :project-name="null" />
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Project } from 'src/services/projects';
import ProjectRules from './ProjectRules.vue';
import ProjectDocuments from './ProjectDocuments.vue';

const props = defineProps<{
  project: Project | null;
}>();

defineEmits<{
  (e: 'rename', project: Project): void;
  (e: 'delete', project: Project): void;
}>();

const activeTab = ref('rules');

// Reset to rules tab when switching projects
    watch(() => props.project?.id, () => {
  activeTab.value = 'rules';
});

const projectIcon = computed(() => {
  switch (props.project?.type) {
    case 'git': return 'source';
    case 'file': return 'folder';
    case 'general': return 'folder_special';
    default: return 'public';
  }
});

const typeBadgeColor = computed(() => {
  switch (props.project?.type) {
    case 'git': return 'blue';
    case 'file': return 'teal';
    default: return 'grey';
  }
});

const typeBadgeLabel = computed(() => {
  switch (props.project?.type) {
    case 'git': return 'Git';
    case 'file': return 'Local Files';
    default: return 'General';
  }
});
</script>
