<template>
  <AgentPartMeta :title="title" icon="difference">
    <div class="text-caption text-grey-7">Hash: {{ part.hash }}</div>
    <q-list dense class="q-mt-xs">
      <q-item v-for="file in part.files" :key="file" dense>
        <q-item-section avatar>
          <q-icon name="description" size="14px" color="grey-6" />
        </q-item-section>
        <q-item-section class="text-caption">{{ file }}</q-item-section>
      </q-item>
    </q-list>
  </AgentPartMeta>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PatchPart } from '@opencode-ai/sdk/v2';
import AgentPartMeta from './AgentPartMeta.vue';

const props = defineProps<{ part: PatchPart }>();
const title = computed(() => `Patch · ${props.part.files.length} file(s)`);
</script>
