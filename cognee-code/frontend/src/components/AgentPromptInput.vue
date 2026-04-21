<template>
  <div class="agent-prompt-input">
    <input
      ref="fileInputRef"
      type="file"
      class="hidden-file-input"
      multiple
      @change="onFileSelected"
    >

    <div class="input-card">
      <div v-if="attachments.length > 0" class="attachment-chip-row row q-col-gutter-xs q-px-xs q-pt-xs">
        <div v-for="attachment in attachments" :key="attachment.id" class="col-auto">
          <q-chip
            dense
            removable
            color="blue-1"
            text-color="primary"
            icon="attach_file"
            class="attachment-chip"
            @remove="emit('remove-attachment', attachment.id)"
          >
            {{ attachment.name }}
          </q-chip>
        </div>
      </div>

      <q-input
        ref="inputRef"
        :model-value="localDraft"
        :placeholder="t('agent.askAnythingPlaceholder')"
        borderless
        autogrow
        :maxlength="4000"
        :disable="disabled"
        class="chat-input"
        @update:model-value="onInputUpdate"
        @keydown="handleKeydown"
      />

      <div class="input-actions row items-center no-wrap q-gutter-xs">
        <template v-if="selectedDatasets.length > 0">
          <q-chip
            v-for="id in selectedDatasets"
            :key="id"
            dense
            removable
            color="primary"
            text-color="white"
            icon="folder_open"
            size="sm"
            class="dataset-chip"
            @remove="emit('toggle-dataset', id)"
          >
            {{ datasetLabelMap.get(id) ?? id }}
          </q-chip>
          <q-btn round flat dense icon="add" size="xs" color="grey-5" class="dataset-add-btn">
            <q-menu anchor="top left" self="bottom left" :offset="[0, 4]">
              <q-list style="min-width: 200px">
                <q-item-label header class="text-caption text-grey-6 q-pt-sm q-pb-xs">{{ t('agent.addDataset') }}</q-item-label>
                <q-item
                  v-for="opt in unselectedDatasetOptions"
                  :key="opt.value"
                  clickable
                  v-close-popup
                  @click="emit('toggle-dataset', opt.value)"
                >
                  <q-item-section avatar>
                    <q-icon name="folder_open" size="14px" color="grey-6" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-caption">{{ opt.label }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item v-if="unselectedDatasetOptions.length === 0">
                  <q-item-section class="text-grey text-caption">{{ t('agent.allAdded') }}</q-item-section>
                </q-item>
                <q-separator />
                <q-item clickable v-close-popup @click="emit('clear-datasets')">
                  <q-item-section class="text-caption text-negative">{{ t('agent.clearAll') }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </template>

        <template v-else>
          <q-btn flat dense no-caps size="sm" class="dataset-empty-btn q-px-xs">
            <q-icon name="folder_open" size="14px" color="grey-6" class="q-mr-xs" />
            <span class="text-grey-6 dataset-empty-label">{{ t('common.allDatasets') }}</span>
            <q-menu anchor="top left" self="bottom left" :offset="[0, 4]">
              <q-list style="min-width: 200px">
                <q-item-label header class="text-caption text-grey-6 q-pt-sm q-pb-xs">{{ t('agent.filterByDataset') }}</q-item-label>
                <q-item
                  v-for="opt in datasetOptions"
                  :key="opt.value"
                  clickable
                  v-close-popup
                  @click="emit('toggle-dataset', opt.value)"
                >
                  <q-item-section avatar>
                    <q-icon name="folder_open" size="14px" color="grey-6" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-caption">{{ opt.label }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item v-if="datasetOptions.length === 0">
                  <q-item-section class="text-grey text-caption">{{ t('common.noDatasets') }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </template>

        <q-btn
          flat
          dense
          round
          icon="attach_file"
          size="sm"
          color="grey-6"
          :disable="disabled"
          @click="fileInputRef?.click()"
        >
          <q-tooltip>{{ t('agent.attachFile') }}</q-tooltip>
        </q-btn>

        <q-space />

        <q-icon
          name="circle"
          :color="connected ? 'positive' : 'grey-4'"
          size="8px"
          class="q-mr-xs"
        >
          <q-tooltip>{{ connected ? t('agent.connected') : t('agent.connecting') }}</q-tooltip>
        </q-icon>

        <q-btn
          round
          unelevated
          :icon="loading ? 'stop' : 'arrow_upward'"
          :color="(localDraft.trim() || attachments.length > 0 || loading) ? 'primary' : 'grey-3'"
          :text-color="(localDraft.trim() || attachments.length > 0 || loading) ? 'white' : 'grey-5'"
          :disable="disabled ? true : (!localDraft.trim() && attachments.length === 0 && !loading)"
          size="sm"
          class="send-btn"
          @click="loading ? emit('abort') : emit('submit', localDraft)"
        >
          <q-tooltip>{{ loading ? t('agent.stop') : t('agent.send') }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <div class="text-caption text-grey-5 text-center q-mt-xs">
      {{ t('agent.inputHint') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { QInput } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { PendingAttachment } from 'src/composables/useAgentSession';

type DatasetOption = {
  value: string;
  label: string;
};

const props = defineProps<{
  draft: string;
  loading: boolean;
  connected: boolean;
  disabled: boolean;
  attachments: PendingAttachment[];
  selectedDatasets: string[];
  datasetOptions: DatasetOption[];
}>();

const emit = defineEmits<{
  (e: 'update:draft', value: string): void;
  (e: 'submit', value: string): void;
  (e: 'abort'): void;
  (e: 'toggle-dataset', value: string): void;
  (e: 'clear-datasets'): void;
  (e: 'remove-attachment', value: string): void;
  (e: 'attach-files', files: File[]): void;
}>();

const { t } = useI18n();
const inputRef = ref<QInput | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const localDraft = ref(props.draft);

const datasetLabelMap = computed(() => new Map(props.datasetOptions.map((option) => [option.value, option.label])));
const unselectedDatasetOptions = computed(() => props.datasetOptions.filter((option) => !props.selectedDatasets.includes(option.value)));

watch(() => props.draft, (value) => {
  if (value !== localDraft.value) {
    localDraft.value = value;
  }
});

function onInputUpdate(value: string | number | null) {
  localDraft.value = typeof value === 'string' ? value : String(value ?? '');
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (localDraft.value.trim() && !props.loading) {
      emit('submit', localDraft.value);
    }
  }
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const files = Array.from(target?.files ?? []);
  if (files.length > 0) {
    emit('attach-files', files);
  }
  if (target) target.value = '';
}

defineExpose({
  focus: () => inputRef.value?.focus(),
  setDraft: (value: string) => {
    localDraft.value = value;
  },
});
</script>

<style lang="scss" scoped>
.hidden-file-input {
  display: none;
}

.input-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 4px 12px 8px;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus-within {
    border-color: $primary;
    box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.1);
  }
}

.attachment-chip-row {
  max-width: 100%;
}

.attachment-chip {
  max-width: 240px;

  :deep(.q-chip__content) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }
}

.chat-input {
  :deep(.q-field__control) {
    padding: 0;
    min-height: unset;
  }

  :deep(textarea) {
    font-size: 14px;
    min-height: 40px;
    max-height: 180px;
    padding-top: 10px;
    padding-bottom: 4px;
    line-height: 1.5;
    resize: none;
  }
}

.input-actions {
  min-height: 36px;
}

.dataset-chip {
  max-width: 160px;

  :deep(.q-chip__content) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }
}

.dataset-add-btn {
  width: 20px;
  height: 20px;
  min-width: unset;
}

.dataset-empty-btn {
  border-radius: 8px;
  padding: 2px 6px;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}

.dataset-empty-label {
  font-size: 12px;
}
</style>
