<template>
  <AgentPartMeta :title="title" icon="stairs">
    <div class="text-caption text-grey-7">{{ description }}</div>
  </AgentPartMeta>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { StepFinishPart, StepStartPart } from '@opencode-ai/sdk/v2';
import AgentPartMeta from './AgentPartMeta.vue';

const props = defineProps<{ part: StepStartPart | StepFinishPart }>();

const title = computed(() => props.part.type === 'step-start' ? 'Step started' : 'Step finished');
const description = computed(() => {
  if (props.part.type === 'step-start') return props.part.snapshot || 'Processing step started';
  return `${props.part.reason} · input ${props.part.tokens.input} · output ${props.part.tokens.output}`;
});
</script>
