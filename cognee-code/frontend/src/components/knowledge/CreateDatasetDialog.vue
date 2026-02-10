<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="min-width: 350px">
      <q-card-section>
        <div class="text-h6">Create Dataset</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-input dense v-model="name" autofocus @keyup.enter="onSubmit" label="Dataset Name" :rules="[val => !!val || 'Field is required']" />
      </q-card-section>

      <q-card-actions align="right" class="text-primary">
        <q-btn flat label="Cancel" @click="onCancel" />
        <q-btn flat label="Create" @click="onSubmit" :disable="!name" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  modelValue: boolean;
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
  if (name.value) {
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
