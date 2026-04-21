<template>
  <q-page class="row no-wrap">
    <q-splitter v-model="splitterModel" :limits="[250, 400]" class="full-width" style="height: calc(100vh - 50px);">
      
      <!-- Notebook List -->
      <template v-slot:before>
        <div class="column full-height bg-grey-1">
           <div class="q-pa-md row items-center justify-between">
             <div class="text-h6">{{ t('notebook.notebooks') }}</div>
              <q-btn round flat icon="add" color="primary" @click="showCreateDialog = true">
                 <q-tooltip>{{ t('notebook.newNotebook') }}</q-tooltip>
              </q-btn>
           </div>
           <q-separator />
           <q-list separator v-if="!loading">
             <q-item 
               v-for="nb in notebooks" :key="nb.id"
               clickable 
               :active="currentNotebook?.id === nb.id"
               active-class="bg-blue-1 text-primary"
               @click="selectNotebook(nb)"
             >
               <q-item-section avatar>
                 <q-icon name="book" />
               </q-item-section>
               <q-item-section>
                 <q-item-label>{{ nb.name }}</q-item-label>
                 <q-item-label caption>{{ new Date(nb.created_at).toLocaleDateString() }}</q-item-label>
               </q-item-section>
               <q-item-section side>
                 <q-btn flat round dense icon="delete" color="grey" @click.stop="deleteNotebook(nb.id)" />
               </q-item-section>
             </q-item>
              <div v-if="notebooks.length === 0" class="text-center q-pa-md text-grey">{{ t('notebook.noNotebooksFound') }}</div>
           </q-list>
           <div v-else class="row justify-center q-pa-md">
              <q-spinner color="primary" />
           </div>
        </div>
      </template>

      <!-- Editor -->
      <template v-slot:after>
        <div v-if="currentNotebook" class="full-height column bg-white">
           <!-- Toolbar -->
           <div class="q-pa-md border-bottom row items-center q-gutter-sm bg-grey-1">
              <div class="text-h5 cursor-pointer row items-center">
                {{ currentNotebook.name }}
                <q-icon name="edit" size="xs" class="q-ml-sm text-grey" />
                <q-popup-edit v-model="currentNotebook.name" v-slot="scope" @save="updateNotebookName">
                  <q-input v-model="scope.value" dense autofocus counter @keyup.enter="scope.set" />
                </q-popup-edit>
              </div>
              <q-space />
               <q-btn flat icon="add" :label="t('notebook.markdown')" @click="addCell('markdown')" color="primary" />
               <q-btn flat icon="code" :label="t('notebook.code')" @click="addCell('code')" color="primary" />
           </div>
           
           <q-separator />

           <!-- Cells -->
           <q-scroll-area class="col q-pa-md bg-grey-2">
             <div v-for="(cell, index) in currentNotebook.cells" :key="cell.id" class="q-mb-md">
                <q-card flat bordered class="bg-white">
                   <!-- Cell Header -->
                   <q-bar class="bg-grey-3" dense>
                      <q-icon :name="cell.type === 'code' ? 'code' : 'article'" size="xs" />
                      <div class="text-caption text-weight-bold q-ml-xs">{{ cell.type.toUpperCase() }}</div>
                      <q-space />
                       <q-btn v-if="cell.type === 'code'" flat dense icon="play_arrow" color="green" :label="t('notebook.run')" @click="runCell(cell.id)" :loading="runningCells.has(cell.id)" />
                      <q-btn flat dense icon="delete" color="red" @click="deleteCell(index)" />
                   </q-bar>
                   
                   <!-- Cell Content -->
                   <q-card-section class="q-pa-none">
                      <template v-if="cell.type === 'markdown'">
                         <!-- Simple toggle for markdown edit/view -->
                         <div class="column">
                            <q-input 
                              v-if="editingCell === cell.id"
                              v-model="cell.content" 
                              type="textarea" 
                              autogrow 
                              filled 
                              class="q-pa-none"
                              bg-color="white"
                              @blur="saveNotebook" 
                            />
                            <div 
                              v-else 
                              class="q-pa-md cursor-pointer hover-bg-grey-1" 
                              @click="editingCell = cell.id"
                              style="min-height: 50px"
                            >
                                <MarkdownRender :content="cell.content || t('notebook.doubleClickToEdit')" />
                            </div>
                            <div v-if="editingCell === cell.id" class="row justify-end q-pa-xs bg-grey-3">
                               <q-btn flat dense :label="t('notebook.done')" size="sm" color="primary" @click="editingCell = null; saveNotebook()" />
                            </div>
                         </div>
                      </template>
                      
                      <template v-else>
                         <!-- Code Editor -->
                         <q-input 
                           v-model="cell.content" 
                           type="textarea" 
                           autogrow 
                           filled 
                           class="font-mono"
                           input-style="font-family: monospace"
                           bg-color="grey-1"
                           spellcheck="false"
                           @blur="saveNotebook"
                         />
                         <!-- Output -->
                         <div v-if="cellOutputs[cell.id]" class="bg-black text-white q-pa-sm font-mono text-caption scroll" style="max-height: 200px; font-family: monospace; white-space: pre-wrap;">
                            {{ cellOutputs[cell.id] }}
                         </div>
                         <div v-if="cellErrors[cell.id]" class="bg-red-1 text-red q-pa-sm font-mono text-caption scroll" style="max-height: 200px; font-family: monospace; white-space: pre-wrap;">
                            {{ cellErrors[cell.id] }}
                         </div>
                      </template>
                   </q-card-section>
                </q-card>
             </div>
             
             <div v-if="currentNotebook.cells.length === 0" class="text-center text-grey q-mt-xl">
                 <q-icon name="playlist_add" size="50px" />
                  <div class="text-subtitle1 q-mt-md">{{ t('notebook.addCellToStart') }}</div>
             </div>
           </q-scroll-area>
        </div>
        
        <div v-else class="full-height row flex-center bg-grey-1 text-grey-6 column">
           <q-icon name="menu_book" size="80px" color="grey-4" />
           <div class="text-h5 q-mt-md">{{ t('notebook.selectNotebook') }}</div>
           <q-btn unelevated color="primary" :label="t('notebook.createNotebook')" class="q-mt-lg" icon="add" @click="showCreateDialog = true" />
        </div>
      </template>
    </q-splitter>

    <q-dialog v-model="showCreateDialog">
       <q-card style="min-width: 300px">
          <q-card-section>
             <div class="text-h6">{{ t('notebook.newNotebook') }}</div>
          </q-card-section>
          <q-card-section>
             <q-input v-model="newNotebookName" :label="t('notebook.name')" autofocus @keyup.enter="createNotebook" />
          </q-card-section>
          <q-card-actions align="right">
             <q-btn flat :label="t('common.cancel')" v-close-popup />
             <q-btn color="primary" :label="t('common.create')" @click="createNotebook" />
          </q-card-actions>
       </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { NotebookService } from 'src/services/notebook';
import type { Notebook, NotebookCell } from 'src/services/notebook';
import { MarkdownRender } from 'markstream-vue';
import 'markstream-vue/index.css';
// import { v4 as uuidv4 } from 'uuid'; // Need UUID generator, or just use random string

const $q = useQuasar();
const { t } = useI18n();
const splitterModel = ref(250);

const notebooks = ref<Notebook[]>([]);
const currentNotebook = ref<Notebook | null>(null);
const loading = ref(false);
const showCreateDialog = ref(false);
const newNotebookName = ref('');

const runningCells = reactive(new Set<string>());
const cellOutputs = reactive<Record<string, string>>({});
const cellErrors = reactive<Record<string, string>>({});
const editingCell = ref<string | null>(null); // ID of markdown cell being edited

async function loadNotebooks() {
  loading.value = true;
  try {
    notebooks.value = await NotebookService.getNotebooks();
  } catch {
    $q.notify({ type: 'negative', message: t('notebook.failedLoadNotebooks') });
  } finally {
    loading.value = false;
  }
}

async function createNotebook() {
  if (!newNotebookName.value) return;
  try {
    const nb = await NotebookService.createNotebook(newNotebookName.value);
    await loadNotebooks();
    currentNotebook.value = nb;
    showCreateDialog.value = false;
    newNotebookName.value = '';
    $q.notify({ type: 'positive', message: t('notebook.notebookCreated') });
  } catch {
    $q.notify({ type: 'negative', message: t('notebook.failedCreateNotebook') });
  }
}

function deleteNotebook(id: string) {
    $q.dialog({
      title: t('notebook.confirm'),
      message: t('notebook.deleteNotebookConfirm'),
      cancel: true,
      persistent: true
    }).onOk(() => {
      void (async () => {
        try {
          await NotebookService.deleteNotebook(id);
          if (currentNotebook.value?.id === id) {
               currentNotebook.value = null;
          }
          await loadNotebooks();
          $q.notify({ type: 'positive', message: t('notebook.notebookDeleted') });
        } catch {
          $q.notify({ type: 'negative', message: t('notebook.failedDeleteNotebook') });
        }
      })();
    });
}

function selectNotebook(nb: Notebook) {
    currentNotebook.value = nb;
    // Reset outputs
    for (const key in cellOutputs) delete cellOutputs[key];
    for (const key in cellErrors) delete cellErrors[key];
}

async function updateNotebookName() {
    if (!currentNotebook.value) return;
    await saveNotebook();
}

async function saveNotebook() {
    if (!currentNotebook.value) return;
    try {
        // Backend expects full update
        await NotebookService.updateNotebook(
            currentNotebook.value.id, 
            currentNotebook.value.name, 
            currentNotebook.value.cells
        );
    } catch {
        $q.notify({ type: 'negative', message: t('notebook.failedSaveNotebook') });
    }
}

function addCell(type: 'markdown' | 'code') {
    if (!currentNotebook.value) return;
    const newCell: NotebookCell = {
        id: crypto.randomUUID(), // Browser native UUID
        type,
        name: type === 'code' ? t('notebook.code') : t('notebook.markdown'),
        content: ''
    };
    currentNotebook.value.cells.push(newCell);
    if (type === 'markdown') {
        editingCell.value = newCell.id;
    }
    void saveNotebook();
}

function deleteCell(index: number) {
    if (!currentNotebook.value) return;
    currentNotebook.value.cells.splice(index, 1);
    void saveNotebook();
}

async function runCell(cellId: string) {
    if (!currentNotebook.value) return;
    const cell = currentNotebook.value.cells.find(c => c.id === cellId);
    if (!cell) return;

    runningCells.add(cellId);
    delete cellOutputs[cellId];
    delete cellErrors[cellId];
    
    try {
        const response = await NotebookService.runCell(currentNotebook.value.id, cellId, cell.content);
        if (response.error) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cellErrors[cellId] = typeof response.error === 'object' ? JSON.stringify(response.error, null, 2) : String(response.error as any);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cellOutputs[cellId] = typeof response.result === 'object' ? JSON.stringify(response.result, null, 2) : String(response.result as any);
        }
    } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cellErrors[cellId] = 'Execution failed: ' + String(e as any);
    } finally {
        runningCells.delete(cellId);
    }
}

onMounted(() => {
    void loadNotebooks();
});
</script>

<style lang="scss" scoped>
.hover-bg-grey-1:hover {
    background-color: #f5f5f5;
}
</style>
