<template>
  <div class="q-pa-md">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">{{ t('ontology.ontologies') }}</div>
      <q-btn color="primary" icon="add" :label="t('shared.upload')" @click="showUploadDialog = true" />
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
            <q-tooltip>{{ t('ontology.viewContent') }}</q-tooltip>
          </q-btn>
          <q-btn flat round color="negative" icon="delete" @click="confirmDelete(props.row)" size="sm">
            <q-tooltip>{{ t('common.delete') }}</q-tooltip>
          </q-btn>
        </q-td>
      </template>
    </q-table>

    <!-- Upload Dialog -->
    <q-dialog v-model="showUploadDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">{{ t('ontology.uploadOntology') }}</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-input
            v-model="uploadForm.key"
            :label="t('ontology.uniqueKey')"
            filled
            :rules="[val => !!val || t('ontology.keyRequired')]"
          />
          <q-file
            v-model="uploadForm.file"
            :label="t('ontology.owlFile')"
            filled
            accept=".owl"
            :rules="[val => !!val || t('ontology.fileRequired')]"
          >
            <template v-slot:prepend>
              <q-icon name="attach_file" />
            </template>
          </q-file>
          <q-input v-model="uploadForm.description" :label="t('shared.description')" filled type="textarea" autogrow />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat :label="t('common.cancel')" v-close-popup />
          <q-btn color="primary" :label="t('shared.upload')" @click="handleUpload" :loading="uploading" />
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
import { useI18n } from 'vue-i18n';
import { OntologyService, type OntologyMetadata } from 'src/services/ontology';

const $q = useQuasar();
const { t } = useI18n();

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
  { name: 'ontology_key', label: t('shared.key'), field: 'ontology_key', align: 'left', sortable: true },
  { name: 'filename', label: t('shared.filename'), field: 'filename', align: 'left', sortable: true },
  { name: 'size_bytes', label: t('shared.sizeBytes'), field: 'size_bytes', align: 'right', sortable: true },
  { name: 'uploaded_at', label: t('shared.uploadedAt'), field: 'uploaded_at', align: 'left', sortable: true },
  { name: 'description', label: t('shared.description'), field: 'description', align: 'left' },
  { name: 'actions', label: t('shared.actions'), field: 'actions', align: 'center' },
];

async function fetchOntologies() {
  loading.value = true;
  try {
    ontologies.value = await OntologyService.getOntologies();
  } catch {
    $q.notify({
      color: 'negative',
      message: t('ontology.failedLoadOntologies'),
      icon: 'report_problem',
    });
  } finally {
    loading.value = false;
  }
}

async function handleUpload() {
  if (!uploadForm.value.key || !uploadForm.value.file) {
    $q.notify({ color: 'warning', message: t('ontology.fillRequired') });
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
    $q.notify({ color: 'positive', message: t('ontology.uploadedSuccessfully') });
  } catch (error) {
    const err = error as Error;
     $q.notify({
      color: 'negative',
      message: err.message || t('ontology.uploadFailed'),
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
    title: t('shared.confirm'),
    message: t('ontology.confirmDelete', { key: row.ontology_key }),
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void (async () => {
      try {
        await OntologyService.deleteOntology(row.ontology_key);
        delete ontologies.value[row.ontology_key];
        $q.notify({ color: 'positive', message: t('ontology.ontologyDeleted') });
      } catch {
        $q.notify({ color: 'negative', message: t('ontology.deleteFailed') });
      }
    })();
  });
}

async function viewContent(row: OntologyMetadata) {
    selectedOntology.value = row;
    try {
        ontologyContent.value = t('shared.loading');
        showContentDialog.value = true;
        const content = await OntologyService.getOntologyContent(row.ontology_key);
        ontologyContent.value = content;
    } catch {
        ontologyContent.value = t('ontology.failedLoadContent');
    }
}

onMounted(() => {
  void fetchOntologies();
});
</script>
