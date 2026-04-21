<template>
  <div class="reasoning-item" :class="streaming ? 'status-streaming' : 'status-done'">
    <!-- Header (always visible) -->
    <div class="reasoning-header row items-center no-wrap" @click="open = !open">
      <q-icon name="psychology_alt" size="13px" color="amber-7" class="q-mr-xs flex-shrink-0" />
      <span class="reasoning-title col">{{ streaming ? t('agentReasoning.thinking') : t('agentReasoning.thoughts') }}</span>
      <q-spinner-dots v-if="streaming" size="12px" color="amber-6" class="q-mx-xs flex-shrink-0" />
      <q-icon :name="open ? 'expand_less' : 'expand_more'" size="13px" color="grey-5" class="flex-shrink-0" />
    </div>

    <!-- Expanded content -->
    <div v-if="open && displayText" class="reasoning-detail">
      <pre class="reasoning-text">{{ displayText }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ReasoningPart } from '@opencode-ai/sdk/v2';

interface Props {
  part: ReasoningPart;
  text?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const displayText = computed(() => (props.text ?? props.part.text ?? '').trim());
// streaming = reasoning still in progress (time.end not yet set)
const streaming = computed(() => !props.part.time?.end);
// auto-expand while streaming, collapse once done
const open = ref(streaming.value && !!displayText.value);
watch(streaming, (isStreaming) => {
  if (!isStreaming) open.value = false;
});
watch(displayText, (value) => {
  if (streaming.value && value) {
    open.value = true;
  }
});
</script>

<style lang="scss" scoped>
.reasoning-item {
  margin: 3px 0;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(245, 158, 11, 0.04);
  border: 1px solid rgba(245, 158, 11, 0.2);

  &.status-streaming { border-color: rgba(25, 118, 210, 0.2); background: rgba(25, 118, 210, 0.03); }
  &.status-done      { border-color: rgba(245, 158, 11, 0.2); background: rgba(245, 158, 11, 0.04); }
}

.reasoning-header {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  min-height: 28px;
  user-select: none;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}

.reasoning-title {
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 11.5px;
  font-weight: 600;
  color: #92400e;
}

.reasoning-detail {
  border-top: 1px solid rgba(245, 158, 11, 0.15);
  padding: 6px 8px;
}

.reasoning-text {
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  max-height: 280px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.04);
  padding: 6px 8px;
  border-radius: 4px;
  color: #78350f;
  font-family: inherit;
}
</style>
