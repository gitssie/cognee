<template>
  <div class="part-meta-item">
    <div class="part-meta-header row items-center no-wrap" @click="open = !open">
      <q-icon :name="icon" size="14px" color="grey-6" class="q-mr-xs" />
      <span class="part-meta-title col">{{ title }}</span>
      <q-icon :name="open ? 'expand_less' : 'expand_more'" size="14px" color="grey-5" />
    </div>

    <div v-if="open" class="part-meta-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{
  title: string;
  icon: string;
  defaultOpen?: boolean;
}>(), {
  defaultOpen: false,
});

const open = ref(props.defaultOpen);
</script>

<style lang="scss" scoped>
.part-meta-item {
  margin: 4px 0;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.65);
  overflow: hidden;
}

.part-meta-header {
  min-height: 30px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(0, 0, 0, 0.03);
  }
}

.part-meta-title {
  font-size: 12px;
  font-weight: 600;
  color: $grey-8;
}

.part-meta-body {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding: 8px 10px;
}
</style>
