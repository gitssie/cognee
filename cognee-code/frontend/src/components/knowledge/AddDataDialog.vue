<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="min-width: 500px; max-width: 600px;">
      <q-toolbar>
        <q-toolbar-title>{{ t('knowledge.addContentTitle') }}</q-toolbar-title>
        <q-btn icon="close" flat round dense v-close-popup @click="onCancel" :disable="isUploading" />
      </q-toolbar>

      <q-separator />

      <!-- Upload Progress Overlay -->
      <div v-if="isUploading" class="upload-overlay">
        <div class="column items-center q-pa-xl">
          <q-circular-progress
            :value="Math.round(uploadProgress)"
            size="80px"
            :thickness="0.15"
            color="secondary"
            track-color="grey-3"
            show-value
            class="q-mb-md"
          >
            <span class="text-subtitle1 text-weight-bold">{{ Math.round(uploadProgress) }}%</span>
          </q-circular-progress>
          <div class="text-subtitle1 text-grey-8 q-mb-xs">{{ uploadStatusText }}</div>
          <div class="text-caption text-grey-6">{{ selectedFileName }}</div>
        </div>
      </div>

      <!-- Tabs -->
      <q-tabs 
        v-model="tab" 
        dense 
        class="text-grey bg-grey-1" 
        active-color="primary" 
        indicator-color="primary" 
        align="justify"
        :disable="isUploading"
      >
        <q-tab name="file" icon="upload_file" :label="t('knowledge.file')" />
        <q-tab name="text" icon="edit_note" :label="t('knowledge.addText')" />
        <q-tab name="url" icon="link" label="URL" />
      </q-tabs>

      <q-separator />

      <q-tab-panels v-model="tab" animated class="bg-white">
        <!-- File Upload Panel -->
        <q-tab-panel name="file" class="q-pa-md">
          <div 
            class="upload-zone column items-center justify-center q-pa-xl"
            :class="{ 'upload-zone-dragover': isDragOver }"
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="handleDrop"
          >
            <q-icon name="cloud_upload" size="64px" color="grey-5" class="q-mb-md" />
            <div class="text-subtitle1 text-grey-7 q-mb-sm">
              {{ t('knowledge.dragDropFiles') }}
            </div>
            <div class="text-caption text-grey-5 q-mb-md">{{ t('knowledge.or') }}</div>
            <q-file
              v-model="fileInput"
              :label="t('knowledge.browseFiles')"
              outlined
              dense
              class="file-input-btn"
              accept="*/*"
              @update:model-value="handleFileSelect"
            >
              <template v-slot:prepend>
                <q-icon name="folder_open" />
              </template>
            </q-file>
          </div>

          <!-- Selected File Preview -->
          <div v-if="fileInput" class="selected-file q-mt-md q-pa-sm bg-grey-1 rounded-borders">
            <div class="row items-center">
              <q-avatar size="40px" :color="getFileIconColor(fileInput)" text-color="white" class="q-mr-sm">
                <q-icon :name="getFileIcon(fileInput)" />
              </q-avatar>
              <div class="col">
                <div class="text-subtitle2 ellipsis">{{ fileInput.name }}</div>
                <div class="text-caption text-grey-6">{{ formatFileSize(fileInput.size) }}</div>
              </div>
              <q-btn flat round dense icon="close" color="grey" @click="fileInput = null" />
            </div>
          </div>

          <div class="text-caption text-grey-5 q-mt-md">
            {{ t('knowledge.supportedFormats') }}
          </div>
        </q-tab-panel>

        <!-- Text Input Panel -->
        <q-tab-panel name="text" class="q-pa-md">
          <q-input 
            v-model="textInput" 
            type="textarea" 
            :label="t('knowledge.enterTextContent')"
            outlined
            :rows="8"
            counter
            maxlength="100000"
          />
          <div class="text-caption text-grey-5 q-mt-sm">
            {{ t('knowledge.textContentHint') }}
          </div>
        </q-tab-panel>

        <!-- URL Input Panel -->
        <q-tab-panel name="url" class="q-pa-md">
          <q-input 
            v-model="urlInput" 
            :label="t('knowledge.enterUrl')"
            outlined
            :placeholder="t('knowledge.urlPlaceholder')"
          >
            <template v-slot:prepend>
              <q-icon name="link" />
            </template>
          </q-input>
          <div class="text-caption text-grey-5 q-mt-sm">
            {{ t('knowledge.urlHint') }}
          </div>
        </q-tab-panel>
      </q-tab-panels>

      <q-separator />

      <q-card-actions align="right" class="q-pa-md">
        <q-btn 
          flat 
          :label="t('common.cancel')" 
          color="grey" 
          @click="onCancel" 
          :disable="isUploading"
        />
        <q-btn 
          unelevated
          :label="submitButtonLabel"
          color="primary"
          :icon="submitButtonIcon"
          @click="onSubmit" 
          :disable="!isValid || isUploading"
          :loading="isUploading"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'add-text', text: string): void;
  (e: 'add-url', url: string): void;
  (e: 'add-file', file: File): void;
}>();

const tab = ref('file');
const textInput = ref('');
const urlInput = ref('');
const fileInput = ref<File | null>(null);
const isDragOver = ref(false);
const { t } = useI18n();

// Upload state - controlled by parent
const isUploading = ref(false);
const uploadProgress = ref(0);
const uploadStatusText = ref(t('knowledge.uploading'));

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const isValid = computed(() => {
  if (tab.value === 'text') return !!textInput.value.trim();
  if (tab.value === 'url') return isValidUrl(urlInput.value);
  if (tab.value === 'file') return !!fileInput.value;
  return false;
});

const submitButtonLabel = computed(() => {
  if (isUploading.value) return t('knowledge.uploading');
  switch (tab.value) {
    case 'file': return t('knowledge.uploadFile');
    case 'text': return t('knowledge.addText');
    case 'url': return t('knowledge.fetchUrl');
    default: return t('knowledge.add');
  }
});

const submitButtonIcon = computed(() => {
  switch (tab.value) {
    case 'file': return 'upload';
    case 'text': return 'add';
    case 'url': return 'download';
    default: return 'add';
  }
});

const selectedFileName = computed(() => {
  return fileInput.value?.name || '';
});

// Watch for dialog close to reset upload state
watch(isOpen, (open) => {
  if (!open) {
    isUploading.value = false;
    uploadProgress.value = 0;
  }
});

function isValidUrl(str: string): boolean {
  if (!str) return false;
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function handleDrop(event: DragEvent) {
  isDragOver.value = false;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0 && files[0]) {
    fileInput.value = files[0];
  }
}

function handleFileSelect(file: File | null) {
  if (file) {
    fileInput.value = file;
  }
}

function onSubmit() {
  if (tab.value === 'text' && textInput.value.trim()) {
    startUpload(t('knowledge.processingText'));
    emit('add-text', textInput.value.trim());
  } else if (tab.value === 'url' && isValidUrl(urlInput.value)) {
    startUpload(t('knowledge.fetchingUrl'));
    emit('add-url', urlInput.value);
  } else if (tab.value === 'file' && fileInput.value) {
    startUpload(t('knowledge.uploadingFile'));
    emit('add-file', fileInput.value);
  }
}

function startUpload(status: string) {
  isUploading.value = true;
  uploadProgress.value = 0;
  uploadStatusText.value = status;
  
  // Simulate progress (actual progress would come from axios onUploadProgress)
  const interval = setInterval(() => {
    if (uploadProgress.value < 90) {
      uploadProgress.value += Math.random() * 15;
      if (uploadProgress.value > 90) uploadProgress.value = 90;
    }
  }, 200);
  
  // Store interval ID for cleanup
  (window as unknown as Record<string, unknown>).__uploadInterval = interval;
}

function finishUpload() {
  // Clear the progress simulation
  const interval = (window as unknown as Record<string, number>).__uploadInterval;
  if (interval) {
    clearInterval(interval);
  }
  
  uploadProgress.value = 100;
  uploadStatusText.value = t('knowledge.complete');
  
  // Brief delay before closing
  setTimeout(() => {
    resetForm();
    isOpen.value = false;
  }, 500);
}

function onCancel() {
  if (!isUploading.value) {
    resetForm();
    isOpen.value = false;
  }
}

function resetForm() {
  textInput.value = '';
  urlInput.value = '';
  fileInput.value = null;
  isUploading.value = false;
  uploadProgress.value = 0;
  uploadStatusText.value = '';
}

// Called by parent after successful operation
function close() {
  finishUpload();
}

// Helper functions
function getFileIcon(file: File): string {
  const type = file.type;
  if (type.includes('pdf')) return 'picture_as_pdf';
  if (type.includes('image')) return 'image';
  if (type.includes('text') || type.includes('markdown')) return 'description';
  if (type.includes('json')) return 'data_object';
  if (type.includes('spreadsheet') || type.includes('csv') || type.includes('excel')) return 'table_chart';
  if (type.includes('word') || type.includes('document')) return 'article';
  return 'insert_drive_file';
}

function getFileIconColor(file: File): string {
  const type = file.type;
  if (type.includes('pdf')) return 'red';
  if (type.includes('image')) return 'purple';
  if (type.includes('text') || type.includes('markdown')) return 'blue';
  if (type.includes('json')) return 'orange';
  if (type.includes('spreadsheet') || type.includes('csv') || type.includes('excel')) return 'green';
  if (type.includes('word') || type.includes('document')) return 'indigo';
  return 'teal';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

defineExpose({ close });
</script>

<style lang="scss" scoped>
.upload-zone {
  border: 2px dashed $grey-4;
  border-radius: 8px;
  background: $grey-1;
  min-height: 200px;
  transition: all 0.2s ease;
  cursor: pointer;

  &:hover {
    border-color: $primary;
    background: rgba($primary, 0.02);
  }

  &.upload-zone-dragover {
    border-color: $secondary;
    background: rgba($secondary, 0.05);
    transform: scale(1.01);
  }
}

.file-input-btn {
  max-width: 200px;
}

.selected-file {
  border: 1px solid $grey-3;
}

.upload-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.95);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
