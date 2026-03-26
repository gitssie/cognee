<template>
  <div class="row no-wrap full-height">

    <!-- Left Panel: Project List -->
    <div class="project-sidebar column">
      <q-toolbar class="bg-grey-1">
        <q-toolbar-title class="text-subtitle2 text-weight-bold">Projects</q-toolbar-title>
        <q-btn flat round dense icon="add" size="sm" @click="showAddProjectDialog = true">
          <q-tooltip>Add project</q-tooltip>
        </q-btn>
      </q-toolbar>
      <q-separator />

      <q-scroll-area class="col">
        <q-list padding>
          <!-- Global Rules -->
          <q-item
            clickable v-ripple
            :active="selectedProject === null"
            active-class="bg-primary text-white"
            class="rounded-borders q-mx-xs q-my-xs"
            @click="selectProject(null)"
          >
            <q-item-section avatar>
              <q-icon name="public" size="20px" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="text-weight-medium">Global Rules</q-item-label>
              <q-item-label caption :class="selectedProject === null ? 'text-white opacity-70' : 'text-grey-6'">
                {{ globalRulesCount }} rules
              </q-item-label>
            </q-item-section>
          </q-item>

          <q-separator class="q-my-sm q-mx-md" />
          <q-item-label header class="text-caption text-grey-5 text-uppercase q-py-xs">
            Git Projects
          </q-item-label>

          <!-- Project items -->
          <q-item
            v-for="project in projects"
            :key="project.gitUrl"
            clickable v-ripple
            :active="selectedProject?.gitUrl === project.gitUrl"
            active-class="bg-primary text-white"
            class="rounded-borders q-mx-xs q-my-xs"
            @click="selectProject(project)"
          >
            <q-item-section avatar>
              <q-icon name="folder_special" size="20px" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="text-weight-medium ellipsis">{{ project.name }}</q-item-label>
              <q-item-label
                caption
                class="ellipsis"
                :class="selectedProject?.gitUrl === project.gitUrl ? 'text-white opacity-70' : 'text-grey-6'"
              >
                {{ rulesForProject(project.gitUrl).length }} rules
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                flat round dense icon="more_vert" size="xs"
                :color="selectedProject?.gitUrl === project.gitUrl ? 'white' : 'grey-6'"
                @click.stop
              >
                <q-menu>
                  <q-list style="min-width: 140px;">
                    <q-item clickable v-close-popup @click="removeProject(project)">
                      <q-item-section avatar>
                        <q-icon name="delete" color="negative" size="18px" />
                      </q-item-section>
                      <q-item-section>Remove</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </q-item-section>
          </q-item>

          <!-- Empty projects state -->
          <div v-if="projects.length === 0" class="q-pa-md text-center text-grey-5 text-caption">
            No projects yet.<br />Add a Git project to get started.
          </div>

        </q-list>
      </q-scroll-area>
    </div>

    <!-- Right Panel: Rules -->
    <div class="col column">

      <!-- Rules Toolbar -->
      <q-toolbar class="bg-grey-1">
        <q-icon name="public" v-if="selectedProject === null" class="q-mr-sm text-grey-6" />
        <q-icon name="folder_special" v-else class="q-mr-sm text-grey-6" />
        <q-toolbar-title class="text-subtitle2 text-weight-bold">
          {{ selectedProject === null ? 'Global Rules' : selectedProject.name }}
          <span class="text-weight-regular text-grey-6 q-ml-xs">({{ currentRules.length }})</span>
        </q-toolbar-title>
        <q-btn color="primary" icon="add" label="Add Rule" size="sm" unelevated @click="showAddRuleDialog = true" />
      </q-toolbar>

      <q-separator />

      <!-- Loading State -->
      <div v-if="loadingRules" class="col column flex-center">
        <q-spinner color="primary" size="40px" />
        <div class="text-caption text-grey-5 q-mt-sm">Loading rules...</div>
      </div>

      <!-- Rules Table -->
      <div v-else-if="currentRules.length > 0" class="col q-pa-md" style="overflow: hidden;">
        <q-virtual-scroll
          type="table"
          style="max-height: 100%"
          :virtual-scroll-item-size="48"
          :virtual-scroll-sticky-size-start="48"
          :items="currentRules"
        >
          <template v-slot:before>
            <thead class="thead-sticky text-left">
              <tr>
                <th style="width: 40px;">#</th>
                <th>Rule</th>
                <th style="width: 48px;"></th>
              </tr>
            </thead>
          </template>

          <template v-slot="{ item: rule, index }">
            <tr :key="rule.id">
              <td class="text-grey-5 text-caption">{{ index + 1 }}</td>
              <td>{{ rule.text }}</td>
              <td>
                <q-btn flat round dense icon="delete" color="negative" size="sm" @click="handleDeleteRule(rule.id)">
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
          {{ selectedProject === null ? 'Add global coding rules for all projects' : 'Add rules specific to this project' }}
        </div>
        <q-btn
          outline color="primary" icon="add" label="Add First Rule"
          class="q-mt-lg" size="sm"
          @click="showAddRuleDialog = true"
        />
      </div>

    </div>

    <!-- Add Project Dialog -->
    <q-dialog v-model="showAddProjectDialog">
      <q-card style="min-width: 420px;">
        <q-toolbar>
          <q-toolbar-title>Add Git Project</q-toolbar-title>
          <q-btn flat round dense icon="close" @click="showAddProjectDialog = false" />
        </q-toolbar>
        <q-separator />
        <q-card-section class="q-pt-md">
          <q-input
            v-model="newProjectUrl"
            outlined dense
            label="Git Repository"
            placeholder="https://github.com/org/repo  or  git@github.com:org/repo.git  or  /local/path"
            hint="http/https/ssh URLs are normalized automatically"
            :error="!!projectUrlError"
            :error-message="projectUrlError"
            @keyup.enter="handleAddProject"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddProjectDialog = false" />
          <q-btn
            unelevated color="primary" label="Add Project"
            @click="handleAddProject"
            :disable="!newProjectUrl.trim()"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Rule Dialog -->
    <q-dialog v-model="showAddRuleDialog" maximized>
      <q-card class="column full-height">
        <q-toolbar>
          <q-toolbar-title>
            Add Rule
            <span class="text-caption text-grey-5 q-ml-sm">
              → {{ selectedProject === null ? 'Global Rules' : selectedProject.name }}
            </span>
          </q-toolbar-title>
          <q-btn flat round dense icon="close" @click="showAddRuleDialog = false" />
        </q-toolbar>
        <q-separator />
        <q-card-section class="col q-pt-sm" style="overflow: hidden;">
          <div class="text-caption text-grey-6 q-mb-sm">
            Describe the rule in natural language. The AI will extract the formal rule.
          </div>
          <MdEditor
            v-model="newRuleText"
            language="en-US"
            :preview="false"
            :toolbars="toolbars"
            style="height: calc(100% - 24px);"
            placeholder="# Rule Title&#10;&#10;Describe your coding rule here...&#10;&#10;```python&#10;# Example&#10;def good_function():&#10;    pass&#10;```"
          />
        </q-card-section>
        <q-card-actions align="right" class="q-pt-none">
          <q-btn flat label="Cancel" @click="showAddRuleDialog = false" />
          <q-btn
            unelevated color="primary" label="Add Rule"
            @click="handleAddRule"
            :loading="addingRule"
            :disable="!newRuleText.trim()"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { MdEditor, type ToolbarNames } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { RulesService, type Rule } from 'src/services/rules';

const $q = useQuasar();

// ── Types ──────────────────────────────────────────────────────────────────

interface Project {
  gitUrl: string;
  name: string;
}

// ── localStorage helpers ───────────────────────────────────────────────────

const STORAGE_KEY = 'cognee_code_rule_projects';

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

function saveProjects(list: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// ── State ──────────────────────────────────────────────────────────────────

const projects = ref<Project[]>(loadProjects());
const selectedProject = ref<Project | null>(null);

// rules cache: null = global, gitUrl string = project
const rulesCache = ref<Map<string | null, Rule[]>>(new Map());
const loadingRules = ref(false);

const showAddProjectDialog = ref(false);
const showAddRuleDialog = ref(false);
const newProjectUrl = ref('');
const projectUrlError = ref('');
const newRuleText = ref('');
const addingRule = ref(false);

// ── Computed ───────────────────────────────────────────────────────────────

const cacheKey = computed<string | null>(() => selectedProject.value?.gitUrl ?? null);

const currentRules = computed<Rule[]>(() => rulesCache.value.get(cacheKey.value) ?? []);

const globalRulesCount = computed(() => rulesCache.value.get(null)?.length ?? 0);

function rulesForProject(gitUrl: string): Rule[] {
  return rulesCache.value.get(gitUrl) ?? [];
}

// ── Data fetching ──────────────────────────────────────────────────────────

async function fetchRules(gitUrl: string | null) {
  loadingRules.value = true;
  try {
    const rules = await RulesService.getRules(gitUrl ?? undefined);
    rulesCache.value.set(gitUrl, rules);
    // trigger reactivity on Map mutation
    rulesCache.value = new Map(rulesCache.value);
  } catch (err) {
    console.error('Failed to fetch rules', err);
    $q.notify({ color: 'negative', message: 'Failed to load rules' });
  } finally {
    loadingRules.value = false;
  }
}

// ── Watchers ───────────────────────────────────────────────────────────────

watch(
  cacheKey,
  (key) => {
    if (!rulesCache.value.has(key)) {
      void fetchRules(key);
    }
  },
  { immediate: true },
);

watch(projects, (list) => saveProjects(list), { deep: true });

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(() => {
  // Pre-warm global rules on first load
  void fetchRules(null);
});

// ── Methods ────────────────────────────────────────────────────────────────

function selectProject(project: Project | null) {
  selectedProject.value = project;
}

/**
 * Normalize a Git remote URL to a canonical form for deduplication.
 *
 * Supported inputs:
 *   - https://github.com/org/repo.git  → https://github.com/org/repo
 *   - http://github.com/org/repo.git   → https://github.com/org/repo
 *   - git@github.com:org/repo.git      → https://github.com/org/repo
 *   - /local/path/to/repo              → unchanged (local paths are used as-is)
 *
 * Returns the canonical string used as the project key.
 */
function canonicalizeGitUrl(raw: string): string {
  const s = raw.trim();

  // Local file path — keep as-is
  if (s.startsWith('/') || /^[A-Za-z]:[/\\]/.test(s)) return s;

  // SSH  git@host:org/repo.git  →  https://host/org/repo
  const sshMatch = s.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;

  // HTTP/HTTPS — upgrade to https and strip .git
  const httpMatch = s.match(/^https?:\/\/(.+?)(?:\.git)?$/);
  if (httpMatch) return `https://${httpMatch[1]}`;

  // Fallback — return as-is
  return s;
}

function extractRepoName(canonical: string): string {
  // Local path → use last two segments
  if (canonical.startsWith('/') || /^[A-Za-z]:[/\\]/.test(canonical)) {
    const parts = canonical.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.slice(-2).join('/') || canonical;
  }
  // https://host/org/repo → org/repo
  const match = canonical.match(/^https?:\/\/[^/]+\/(.+)/);
  if (match) return match[1] ?? canonical;
  return canonical;
}

function handleAddProject() {
  const raw = newProjectUrl.value.trim();
  if (!raw) return;

  // Validate: must be http/https/ssh URL or absolute local path
  const isNetwork = /^(https?:\/\/|git@)/.test(raw);
  const isLocalPath = raw.startsWith('/') || /^[A-Za-z]:[/\\]/.test(raw);
  if (!isNetwork && !isLocalPath) {
    projectUrlError.value = 'Please enter a Git remote URL (https/ssh) or an absolute local path';
    return;
  }

  const url = canonicalizeGitUrl(raw);

  if (projects.value.some((p) => p.gitUrl === url)) {
    projectUrlError.value = 'This project is already added';
    return;
  }

  const newProject: Project = { gitUrl: url, name: extractRepoName(url) };
  projects.value.push(newProject);

  selectedProject.value = newProject;
  newProjectUrl.value = '';
  projectUrlError.value = '';
  showAddProjectDialog.value = false;

  $q.notify({ color: 'positive', message: `Project "${newProject.name}" added` });
}

function removeProject(project: Project) {
  $q.dialog({
    title: 'Remove Project',
    message: `Remove "${project.name}" from the list? Rules will not be deleted.`,
    cancel: true,
    persistent: false,
  }).onOk(() => {
    projects.value = projects.value.filter((p) => p.gitUrl !== project.gitUrl);
    rulesCache.value.delete(project.gitUrl);
    rulesCache.value = new Map(rulesCache.value);
    if (selectedProject.value?.gitUrl === project.gitUrl) {
      selectedProject.value = null;
    }
    $q.notify({ color: 'info', message: `Project "${project.name}" removed` });
  });
}

async function handleAddRule() {
  if (!newRuleText.value.trim()) return;
  addingRule.value = true;

  try {
    await RulesService.addRule(
      newRuleText.value.trim(),
      selectedProject.value?.gitUrl,
    );
    // Refresh the current panel's rules
    await fetchRules(cacheKey.value);
    showAddRuleDialog.value = false;
    newRuleText.value = '';
    $q.notify({ color: 'positive', message: 'Rule added' });
  } catch (err) {
    console.error('Failed to add rule', err);
    $q.notify({ color: 'negative', message: 'Failed to add rule' });
  } finally {
    addingRule.value = false;
  }
}

async function handleDeleteRule(ruleId: string) {
  try {
    await RulesService.deleteRule(ruleId);
    // Update cache locally (optimistic) then re-fetch to be safe
    const key = cacheKey.value;
    const updated = (rulesCache.value.get(key) ?? []).filter((r) => r.id !== ruleId);
    rulesCache.value.set(key, updated);
    rulesCache.value = new Map(rulesCache.value);
    $q.notify({ color: 'positive', message: 'Rule deleted' });
  } catch (err) {
    console.error('Failed to delete rule', err);
    $q.notify({ color: 'negative', message: 'Failed to delete rule' });
  }
}

// ── Toolbar ────────────────────────────────────────────────────────────────

const toolbars: ToolbarNames[] = [
  'bold', 'italic', 'strikeThrough', '-',
  'title', 'quote', 'unorderedList', 'orderedList', 'task', '-',
  'codeRow', 'code', 'link', '-',
  'revoke', 'next', '=',
  'preview', 'fullscreen',
];
</script>

<style scoped>
.project-sidebar {
  width: 280px;
  min-width: 220px;
  max-width: 320px;
  border-right: 1px solid #e0e0e0;
}

.rounded-borders {
  border-radius: 8px;
}

.thead-sticky th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: white;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
