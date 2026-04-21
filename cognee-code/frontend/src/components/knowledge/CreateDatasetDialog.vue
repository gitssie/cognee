<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="width: 400px; max-width: 80vw;">
      <q-card-section>
        <div class="text-h6">{{ t('knowledge.createDataset') }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none q-gutter-sm">
        <q-input
          dense
          v-model="name"
          autofocus
          @keyup.enter="onSubmit"
          :label="t('knowledge.datasetName')"
          :rules="[val => !!val || t('knowledge.fieldRequired')]"
          :disable="loading"
        />
        <q-input
          v-if="showVaultKey"
          dense
          v-model="vaultApiKey"
          :label="t('knowledge.muninnVaultApiKey')"
          placeholder="mk_..."
          type="password"
          :disable="loading"
          :hint="t('knowledge.muninnVaultHint')"
        />
      </q-card-section>

      <q-card-actions align="right" class="text-primary">
        <q-btn flat :label="t('common.cancel')" @click="onCancel" :disable="loading" />
        <q-btn
          flat
          :label="t('common.create')"
          @click="onSubmit"
          :disable="!name || loading"
          :loading="loading"
        >
          <template #loading>
            <q-spinner-dots size="1em" />
            <span class="q-ml-xs">{{ t('common.creating') }}</span>
          </template>
        </q-btn>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
  showVaultKey?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'create', name: string, vaultApiKey: string | null): void;
}>();

const name = ref('');
const vaultApiKey = ref<string | null>(null);
const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

function onSubmit() {
  if (name.value && !props.loading) {
    emit('create', name.value, vaultApiKey.value || null);
    // Note: Parent should call close() after successful API response
  }
}

function onCancel() {
  name.value = '';
  vaultApiKey.value = null;
  isOpen.value = false;
}

// Called by parent after successful creation
function close() {
  name.value = '';
  vaultApiKey.value = null;
  isOpen.value = false;
}

defineExpose({ close });
</script>
