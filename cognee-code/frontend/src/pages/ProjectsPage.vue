<template>
  <q-page class="projects-page">
    <div class="row no-wrap full-height">

      <!-- Left: Project Sidebar -->
      <div class="project-sidebar column">
        <ProjectSidebar
          v-model="selectedProject"
          :projects="projects"
          :loading="loadingProjects"
          @project-created="handleProjectCreated"
          @rename="handleRenameRequest"
          @delete="handleDeleteRequest"
        />
      </div>

      <!-- Right: Project Detail -->
      <div class="col column">
        <ProjectDetail
          :project="selectedProject"
          @rename="handleRenameRequest"
          @delete="handleDeleteRequest"
        />
      </div>

    </div>

    <!-- Rename Dialog -->
    <q-dialog v-model="showRenameDialog">
      <q-card style="min-width: 380px;">
        <q-toolbar>
          <q-toolbar-title>{{ t('projects.renameProject') }}</q-toolbar-title>
          <q-btn flat round dense icon="close" @click="showRenameDialog = false" />
        </q-toolbar>
        <q-separator />
        <q-card-section class="q-pt-md">
          <q-input
            v-model="renameValue"
            outlined dense
            :label="t('projects.newName')"
            :error="!!renameError"
            :error-message="renameError"
            @keyup.enter="confirmRename"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="t('common.cancel')" @click="showRenameDialog = false" />
          <q-btn
            unelevated color="primary" :label="t('projects.rename')"
            :loading="renaming"
            :disable="!renameValue.trim()"
            @click="confirmRename"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { ProjectsService, type Project } from 'src/services/projects';
import ProjectSidebar from 'components/projects/ProjectSidebar.vue';
import ProjectDetail from 'components/projects/ProjectDetail.vue';

defineOptions({ name: 'ProjectsPage' });

const $q = useQuasar();
const { t } = useI18n();

const projects = ref<Project[]>([]);
const loadingProjects = ref(false);
const selectedProject = ref<Project | null>(null);

// ── Rename ─────────────────────────────────────────────────────────────────

const showRenameDialog = ref(false);
const renameTarget = ref<Project | null>(null);
const renameValue = ref('');
const renameError = ref('');
const renaming = ref(false);

function handleRenameRequest(project: Project) {
  renameTarget.value = project;
  renameValue.value = project.name;
  renameError.value = '';
  showRenameDialog.value = true;
}

async function confirmRename() {
  if (!renameTarget.value || !renameValue.value.trim()) return;
  if (renameValue.value.trim() === renameTarget.value.name) {
    showRenameDialog.value = false;
    return;
  }
  renaming.value = true;
  try {
    const updated = await ProjectsService.updateProject(renameTarget.value.id, {
      name: renameValue.value.trim(),
    });
    const idx = projects.value.findIndex((p) => p.id === updated.id);
    if (idx !== -1) projects.value[idx] = updated;
    if (selectedProject.value?.id === updated.id) selectedProject.value = updated;
    showRenameDialog.value = false;
    $q.notify({ color: 'positive', message: t('projects.renamedTo', { name: updated.name }) });
  } catch {
    $q.notify({ color: 'negative', message: t('projects.renameFailed') });
  } finally {
    renaming.value = false;
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────

function handleDeleteRequest(project: Project) {
  $q.dialog({
    title: t('projects.deleteProject'),
    message: t('projects.deleteProjectConfirm', { name: project.name }),
    cancel: true,
    persistent: true,
    ok: { label: t('common.delete'), color: 'negative', unelevated: true },
  }).onOk(() => void (async () => {
    try {
      await ProjectsService.deleteProject(project.id);
      projects.value = projects.value.filter((p) => p.id !== project.id);
      if (selectedProject.value?.id === project.id) selectedProject.value = null;
      $q.notify({ color: 'positive', message: t('projects.projectDeleted', { name: project.name }) });
    } catch {
      $q.notify({ color: 'negative', message: t('projects.deleteProjectFailed') });
    }
  })());
}

// ── Create ─────────────────────────────────────────────────────────────────

function handleProjectCreated(project: Project) {
  projects.value.push(project);
  selectedProject.value = project;
}

// ── Load ───────────────────────────────────────────────────────────────────

onMounted(async () => {
  loadingProjects.value = true;
  try {
    projects.value = await ProjectsService.getProjects();
  } catch {
    $q.notify({ color: 'negative', message: t('projects.failedLoadProjects') });
  } finally {
    loadingProjects.value = false;
  }
});
</script>

<style lang="scss" scoped>
.projects-page {
  height: calc(100vh - 50px);
}

.project-sidebar {
  width: 280px;
  min-width: 220px;
  max-width: 320px;
  border-right: 1px solid #e0e0e0;
}
</style>
