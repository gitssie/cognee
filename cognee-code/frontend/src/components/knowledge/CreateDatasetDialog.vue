<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="width: 400px; max-width: 80vw;">
      <q-card-section>
        <div class="text-h6">Create Dataset</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-input
          dense
          v-model="name"
          autofocus
          @keyup.enter="onSubmit"
          label="Dataset Name"
          :rules="[val => !!val || 'Field is required']"
          :disable="loading"
        />
      </q-card-section>

      <q-card-actions align="right" class="text-primary">
        <q-btn flat label="Cancel" @click="onCancel" :disable="loading" />
        <q-btn
          flat
          label="Create"
          @click="onSubmit"
          :disable="!name || loading"
          :loading="loading"
        >
          <template #loading>
            <q-spinner-dots size="1em" />
            <span class="q-ml-xs">Creating...</span>
          </template>
        </q-btn>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'create', name: string): void;
}>();

const name = ref('');

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

function onSubmit() {
  if (name.value && !props.loading) {
    emit('create', name.value);
    // Note: Parent should call close() after successful API response
  }
}

function onCancel() {
  name.value = '';
  isOpen.value = false;
}

// Called by parent after successful creation
function close() {
  name.value = '';
  isOpen.value = false;
}

defineExpose({ close });
</script>
