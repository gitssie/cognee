<template>
  <div class="column no-wrap full-height">
    <!-- Sidebar Header -->
    <q-toolbar class="bg-grey-1">
      <q-toolbar-title class="text-subtitle2 text-weight-bold">Projects</q-toolbar-title>
      <q-btn flat round dense icon="add" size="sm" @click="showDialog = true">
        <q-tooltip>New project</q-tooltip>
      </q-btn>
    </q-toolbar>
    <q-separator />

    <!-- Search -->
    <div class="q-pa-sm">
      <q-input
        v-model="search"
        dense outlined
        placeholder="Search projects..."
        bg-color="white"
        clearable
      >
        <template #prepend>
          <q-icon name="search" size="16px" />
        </template>
      </q-input>
    </div>

    <!-- Project List -->
    <q-scroll-area class="col">
      <q-list padding>

        <!-- Global Rules item -->
        <q-item
          clickable v-ripple
          :active="modelValue === null"
          active-class="bg-primary text-white"
          class="rounded-borders q-mx-xs q-my-xs"
          @click="$emit('update:modelValue', null)"
        >
          <q-item-section avatar>
            <q-icon name="public" size="20px" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="text-weight-medium">Global Rules</q-item-label>
            <q-item-label
              caption
              :class="modelValue === null ? 'text-white opacity-70' : 'text-grey-6'"
            >
              No project context
            </q-item-label>
          </q-item-section>
        </q-item>

        <q-separator class="q-my-sm q-mx-md" />
        <q-item-label header class="text-caption text-grey-5 text-uppercase q-py-xs">
          My Projects
        </q-item-label>

        <!-- Loading skeleton -->
        <template v-if="loading">
          <q-item v-for="n in 3" :key="n" class="q-mx-xs q-my-xs">
            <q-item-section avatar>
              <q-skeleton type="QAvatar" size="20px" />
            </q-item-section>
            <q-item-section>
              <q-skeleton type="text" width="80%" />
              <q-skeleton type="text" width="50%" />
            </q-item-section>
          </q-item>
        </template>

        <!-- Project items -->
        <template v-else>
          <q-item
            v-for="project in filteredProjects"
            :key="project.id"
            clickable v-ripple
            :active="modelValue?.id === project.id"
            active-class="bg-primary text-white"
            class="rounded-borders q-mx-xs q-my-xs"
            @click="$emit('update:modelValue', project)"
          >
            <q-item-section avatar>
              <q-icon :name="typeIcon(project.type)" size="20px" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="text-weight-medium ellipsis">{{ project.name }}</q-item-label>
              <q-item-label
                caption
                class="ellipsis"
                :class="modelValue?.id === project.id ? 'text-white opacity-70' : 'text-grey-6'"
              >
                {{ typeLabel(project) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                flat round dense icon="more_vert" size="xs"
                :color="modelValue?.id === project.id ? 'white' : 'grey-6'"
                @click.stop
              >
                <q-menu>
                  <q-list style="min-width: 160px;">
                    <q-item clickable v-close-popup @click="$emit('rename', project)">
                      <q-item-section avatar>
                        <q-icon name="edit" size="18px" />
                      </q-item-section>
                      <q-item-section>Rename</q-item-section>
                    </q-item>
                    <q-separator />
                    <q-item clickable v-close-popup @click="$emit('delete', project)" class="text-negative">
                      <q-item-section avatar>
                        <q-icon name="delete" color="negative" size="18px" />
                      </q-item-section>
                      <q-item-section>Delete</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </q-item-section>
          </q-item>

          <!-- Empty state -->
          <div
            v-if="filteredProjects.length === 0 && !loading"
            class="q-pa-md text-center text-grey-5 text-caption"
          >
            <template v-if="search">No projects match "{{ search }}"</template>
            <template v-else>No projects yet.<br />Click + to create one.</template>
          </div>
        </template>

      </q-list>
    </q-scroll-area>

    <!-- New Project Dialog -->
    <q-dialog v-model="showDialog" @hide="resetForm">
      <q-card style="min-width: 460px;">
        <q-toolbar>
          <q-toolbar-title>New Project</q-toolbar-title>
          <q-btn flat round dense icon="close" @click="showDialog = false" />
        </q-toolbar>
        <q-separator />
        <q-card-section class="q-gutter-md q-pt-md">

          <!-- Name -->
          <q-input
            v-model="form.name"
            outlined dense
            label="Project Name *"
            placeholder="e.g. Backend API"
            :error="!!formErrors.name"
            :error-message="formErrors.name"
            @keyup.enter="handleCreate"
          />

          <!-- Type -->
          <q-select
            v-model="form.type"
            outlined dense
            label="Type"
            :options="typeOptions"
            emit-value map-options
          />

          <!-- Git URL (type=git) -->
          <q-input
            v-if="form.type === 'git'"
            v-model="form.remote_url"
            outlined dense
            label="Git Remote URL"
            placeholder="https://github.com/org/repo"
            :error="!!formErrors.remote_url"
            :error-message="formErrors.remote_url"
          />

          <!-- Local Path (type=file) -->
          <q-input
            v-if="form.type === 'file'"
            v-model="form.local_path"
            outlined dense
            label="Local Path"
            placeholder="/home/user/project"
          />

          <!-- OpenCode Project ID (optional) -->
          <q-input
            v-model="form.opencode_project_id"
            outlined dense
            label="OpenCode Project ID (optional)"
            placeholder="Git root commit hash from OpenCode"
          >
            <template #hint>
              Paste the project ID shown in OpenCode to auto-link rules to this project.
            </template>
          </q-input>

        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showDialog = false" />
          <q-btn
            unelevated color="primary" label="Create"
            :loading="creating"
            :disable="!form.name.trim()"
            @click="handleCreate"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import { ProjectsService, type Project, type CreateProjectInput, type ProjectType } from 'src/services/projects';

const props = defineProps<{
  modelValue: Project | null;
  projects: Project[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Project | null): void;
  (e: 'projectCreated', project: Project): void;
  (e: 'rename', project: Project): void;
  (e: 'delete', project: Project): void;
}>();

const $q = useQuasar();

const search = ref('');
const showDialog = ref(false);
const creating = ref(false);

const form = ref<CreateProjectInput>({
  name: '',
  type: 'general',
  opencode_project_id: null,
  remote_url: null,
  local_path: null,
});

const formErrors = ref<{ name?: string; remote_url?: string }>({});

const typeOptions = [
  { label: 'General', value: 'general' },
  { label: 'Git Repository', value: 'git' },
  { label: 'Local Files', value: 'file' },
];

const filteredProjects = computed(() => {
  const q = search.value.toLowerCase().trim();
  if (!q) return props.projects;
  return props.projects.filter((p) => p.name.toLowerCase().includes(q));
});

function typeIcon(type: ProjectType): string {
  switch (type) {
    case 'git': return 'source';
    case 'file': return 'folder';
    default: return 'folder_special';
  }
}

function typeLabel(project: Project): string {
  switch (project.type) {
    case 'git': return project.remote_url ?? 'git';
    case 'file': return project.local_path ?? 'local';
    default: return 'general';
  }
}

function resetForm() {
  form.value = { name: '', type: 'general', opencode_project_id: null, remote_url: null, local_path: null };
  formErrors.value = {};
}

async function handleCreate() {
  formErrors.value = {};
  if (!form.value.name.trim()) {
    formErrors.value.name = 'Name is required';
    return;
  }
  if (form.value.type === 'git' && form.value.remote_url) {
    const isValid = /^(https?:\/\/|git@)/.test(form.value.remote_url.trim());
    if (!isValid) {
      formErrors.value.remote_url = 'Enter a valid git URL (https/ssh)';
      return;
    }
  }

  creating.value = true;
  try {
    const project = await ProjectsService.createProject(form.value);
    showDialog.value = false;
    emit('projectCreated', project);
    $q.notify({ color: 'positive', message: `Project "${project.name}" created` });
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to create project' });
  } finally {
    creating.value = false;
  }
}
</script>

<style lang="scss" scoped>
.rounded-borders {
  border-radius: 8px;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
