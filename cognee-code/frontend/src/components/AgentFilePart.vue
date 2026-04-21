<template>
  <AgentPartMeta :title="title" icon="description">
    <div class="text-caption text-grey-7">{{ part.url }}</div>
    <div v-if="sourceSummary" class="q-mt-xs text-caption text-grey-6">{{ sourceSummary }}</div>
  </AgentPartMeta>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { FilePart } from '@opencode-ai/sdk/v2';
import AgentPartMeta from './AgentPartMeta.vue';

const props = defineProps<{ part: FilePart }>();

const title = computed(() => props.part.filename || 'File');

const sourceSummary = computed(() => {
  const source = props.part.source;
  if (!source) return '';
  if (source.type === 'file') return source.path;
  if (source.type === 'symbol') return `${source.name} · ${source.path}`;
  if (source.type === 'resource') return `${source.clientName} · ${source.uri}`;
  return '';
});
</script>
