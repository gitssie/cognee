<template>
  <div class="q-pa-md">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">Ontologies</div>
      <q-btn color="primary" icon="add" label="Upload" @click="showUploadDialog = true" />
    </div>

    <q-table
      :rows="ontologyList"
      :columns="columns"
      row-key="ontology_key"
      :loading="loading"
      flat
      bordered
    >
      <template v-slot:body-cell-actions="props">
        <q-td :props="props" auto-width>
          <q-btn flat round color="primary" icon="visibility" @click="viewContent(props.row)" size="sm">
            <q-tooltip>View Content</q-tooltip>
          </q-btn>
          <q-btn flat round color="negative" icon="delete" @click="confirmDelete(props.row)" size="sm">
            <q-tooltip>Delete</q-tooltip>
          </q-btn>
        </q-td>
      </template>
    </q-table>

    <!-- Upload Dialog -->
    <q-dialog v-model="showUploadDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Upload Ontology</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-input
            v-model="uploadForm.key"
            label="Key (Unique Identifier)"
            filled
            :rules="[val => !!val || 'Key is required']"
          />
          <q-file
            v-model="uploadForm.file"
            label="OWL File"
            filled
            accept=".owl"
            :rules="[val => !!val || 'File is required']"
          >
            <template v-slot:prepend>
              <q-icon name="attach_file" />
            </template>
          </q-file>
          <q-input v-model="uploadForm.description" label="Description" filled type="textarea" autogrow />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Upload" @click="handleUpload" :loading="uploading" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Content Dialog -->
    <q-dialog v-model="showContentDialog" full-width>
      <q-card>
        <q-toolbar class="bg-primary text-white">
          <q-toolbar-title>{{ selectedOntology?.ontology_key }}</q-toolbar-title>
          <q-btn icon="close" flat round dense v-close-popup />
        </q-toolbar>
        <q-card-section class="scroll" style="max-height: 70vh">
          <pre>{{ ontologyContent }}</pre>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuasar, type QTableColumn } from 'quasar';
import { OntologyService, type OntologyMetadata } from 'src/services/ontology';

const $q = useQuasar();

const loading = ref(false);
const ontologies = ref<Record<string, OntologyMetadata>>({});
const showUploadDialog = ref(false);
const uploading = ref(false);
const showContentDialog = ref(false);
const selectedOntology = ref<OntologyMetadata | null>(null);
const ontologyContent = ref('');

const uploadForm = ref({
  key: '',
  file: null as File | null,
  description: '',
});

const ontologyList = computed(() => Object.values(ontologies.value));

const columns: QTableColumn[] = [
  { name: 'ontology_key', label: 'Key', field: 'ontology_key', align: 'left', sortable: true },
  { name: 'filename', label: 'Filename', field: 'filename', align: 'left', sortable: true },
  { name: 'size_bytes', label: 'Size (Bytes)', field: 'size_bytes', align: 'right', sortable: true },
  { name: 'uploaded_at', label: 'Uploaded At', field: 'uploaded_at', align: 'left', sortable: true },
  { name: 'description', label: 'Description', field: 'description', align: 'left' },
  { name: 'actions', label: 'Actions', field: 'actions', align: 'center' },
];

async function fetchOntologies() {
  loading.value = true;
  try {
    ontologies.value = await OntologyService.getOntologies();
  } catch {
    $q.notify({
      color: 'negative',
      message: 'Failed to load ontologies',
      icon: 'report_problem',
    });
  } finally {
    loading.value = false;
  }
}

async function handleUpload() {
  if (!uploadForm.value.key || !uploadForm.value.file) {
    $q.notify({ color: 'warning', message: 'Please fill required fields' });
    return;
  }

  uploading.value = true;
  try {
    const result = await OntologyService.uploadOntology(
      uploadForm.value.key,
      uploadForm.value.file,
      uploadForm.value.description
    );
    ontologies.value[result.ontology_key] = result;
    showUploadDialog.value = false;
    resetForm();
    $q.notify({ color: 'positive', message: 'Ontology uploaded successfully' });
  } catch (error) {
    const err = error as Error;
     $q.notify({
      color: 'negative',
      message: err.message || 'Upload failed',
      icon: 'report_problem',
    });
  } finally {
    uploading.value = false;
  }
}

function resetForm() {
  uploadForm.value = { key: '', file: null, description: '' };
}

function confirmDelete(row: OntologyMetadata) {
  $q.dialog({
    title: 'Confirm',
    message: `Are you sure you want to delete ontology '${row.ontology_key}'?`,
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void (async () => {
      try {
        await OntologyService.deleteOntology(row.ontology_key);
        delete ontologies.value[row.ontology_key];
        $q.notify({ color: 'positive', message: 'Ontology deleted' });
      } catch {
        $q.notify({ color: 'negative', message: 'Delete failed' });
      }
    })();
  });
}

async function viewContent(row: OntologyMetadata) {
    selectedOntology.value = row;
    try {
        ontologyContent.value = 'Loading...';
        showContentDialog.value = true;
        const content = await OntologyService.getOntologyContent(row.ontology_key);
        ontologyContent.value = content;
    } catch {
        ontologyContent.value = 'Failed to load content.';
    }
}

onMounted(() => {
  void fetchOntologies();
});
</script>
