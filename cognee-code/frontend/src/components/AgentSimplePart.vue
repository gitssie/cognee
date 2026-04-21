<template>
  <AgentPartMeta :title="title" :icon="icon">
    <div class="text-caption text-grey-7">{{ description }}</div>
  </AgentPartMeta>
</template>

<script setup lang="ts">
import AgentPartMeta from './AgentPartMeta.vue';

defineProps<{
  title: string;
  icon: string;
  description: string;
}>();
</script>
