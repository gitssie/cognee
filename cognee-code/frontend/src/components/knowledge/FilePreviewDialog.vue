<template>
  <q-dialog v-model="isOpen">
    <q-card style="width: 800px; max-width: 90vw; height: 70vh; max-height: 80vh;" class="column no-wrap">
      <!-- Header -->
      <q-toolbar class="bg-grey-1">
        <q-icon :name="getIcon(mimeType)" :color="getIconColor(mimeType)" size="sm" class="q-mr-sm" />
        <q-toolbar-title>{{ fileName }}</q-toolbar-title>
        <q-btn flat round dense icon="download" @click="$emit('download')" />
        <q-btn flat round dense icon="close" v-close-popup />
      </q-toolbar>

      <q-separator />

      <!-- Content -->
      <q-card-section class="col q-pa-none" style="overflow: auto;">
        <!-- Loading State -->
        <div v-if="loading" class="full-height row flex-center">
          <q-spinner-dots color="primary" size="40px" />
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="full-height row flex-center column text-negative">
          <q-icon name="error" size="48px" class="q-mb-md" />
          <div>{{ error }}</div>
        </div>

        <!-- Image Preview -->
        <div v-else-if="isImage" class="full-height row flex-center q-pa-md bg-grey-2">
          <img :src="imageUrl" :alt="fileName" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
        </div>

        <!-- Markdown/Text Preview -->
        <div v-else-if="isTextBased" class="q-pa-lg">
          <MarkdownRender :content="textContent" />
        </div>

        <!-- Unsupported Type -->
        <div v-else class="full-height row flex-center column text-grey-6">
          <q-icon name="visibility_off" size="64px" class="q-mb-md" />
          <div class="text-h6">{{ t('filePreview.notAvailable') }}</div>
          <div class="text-caption">{{ mimeType || t('filePreview.unknownFileType') }}</div>
          <q-btn flat color="primary" :label="t('filePreview.downloadToView')" icon="download" class="q-mt-md" @click="$emit('download')" />
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MarkdownRender } from 'markstream-vue';
import 'markstream-vue/index.css';

const props = defineProps<{
  modelValue: boolean;
  fileName: string;
  mimeType?: string;
  content?: Blob | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'download'): void;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const textContent = ref('');
const imageUrl = ref('');
const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const isImage = computed(() => {
  return props.mimeType?.startsWith('image/');
});

const isTextBased = computed(() => {
  if (!props.mimeType) return false;
  return (
    props.mimeType.startsWith('text/') ||
    props.mimeType.includes('markdown') ||
    props.mimeType.includes('json') ||
    props.mimeType.includes('xml') ||
    props.mimeType.includes('javascript') ||
    props.mimeType.includes('typescript') ||
    props.mimeType.includes('yaml') ||
    props.mimeType.includes('csv')
  );
});

// Watch for content changes and process
watch(() => props.content, async (blob) => {
  if (!blob) {
    textContent.value = '';
    imageUrl.value = '';
    return;
  }

  error.value = null;
  loading.value = true;

  try {
    if (isImage.value) {
      // Create object URL for image
      if (imageUrl.value) {
        URL.revokeObjectURL(imageUrl.value);
      }
      imageUrl.value = URL.createObjectURL(blob);
    } else if (isTextBased.value) {
      // Read as text
      textContent.value = await blob.text();
      
      // Wrap code content in code blocks for better rendering
      if (props.mimeType?.includes('json')) {
        try {
          const formatted = JSON.stringify(JSON.parse(textContent.value), null, 2);
          textContent.value = '```json\n' + formatted + '\n```';
        } catch {
          textContent.value = '```json\n' + textContent.value + '\n```';
        }
      } else if (props.mimeType?.includes('javascript') || props.mimeType?.includes('typescript')) {
        const lang = props.mimeType.includes('typescript') ? 'typescript' : 'javascript';
        textContent.value = '```' + lang + '\n' + textContent.value + '\n```';
      } else if (props.mimeType?.includes('xml')) {
        textContent.value = '```xml\n' + textContent.value + '\n```';
      } else if (props.mimeType?.includes('yaml')) {
        textContent.value = '```yaml\n' + textContent.value + '\n```';
      } else if (props.mimeType?.includes('csv')) {
        // Convert CSV to markdown table (simple implementation)
        textContent.value = '```csv\n' + textContent.value + '\n```';
      }
    }
  } catch (e) {
    error.value = t('filePreview.failedLoadContent');
    console.error('Preview error:', e);
  } finally {
    loading.value = false;
  }
}, { immediate: true });

// Helper functions for icons (same as DataList)
function getIcon(mime?: string): string {
  if (!mime) return 'insert_drive_file';
  if (mime.includes('pdf')) return 'picture_as_pdf';
  if (mime.includes('image')) return 'image';
  if (mime.includes('video')) return 'movie';
  if (mime.includes('audio')) return 'audiotrack';
  if (mime.includes('text') || mime.includes('markdown')) return 'description';
  if (mime.includes('json') || mime.includes('xml')) return 'data_object';
  if (mime.includes('spreadsheet') || mime.includes('csv')) return 'table_chart';
  if (mime.includes('presentation')) return 'slideshow';
  if (mime.includes('word') || mime.includes('document')) return 'article';
  return 'insert_drive_file';
}

function getIconColor(mime?: string): string {
  if (!mime) return 'grey';
  if (mime.includes('pdf')) return 'red';
  if (mime.includes('image')) return 'green';
  if (mime.includes('video')) return 'purple';
  if (mime.includes('audio')) return 'orange';
  if (mime.includes('text') || mime.includes('markdown')) return 'blue';
  if (mime.includes('json') || mime.includes('xml')) return 'teal';
  if (mime.includes('spreadsheet') || mime.includes('csv')) return 'green';
  if (mime.includes('presentation')) return 'amber';
  if (mime.includes('word') || mime.includes('document')) return 'indigo';
  return 'grey';
}
</script>
