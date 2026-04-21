<template>
  <div v-if="segments.length > 0" class="user-message-highlighted">
    <template v-for="(segment, index) in segments" :key="`${index}-${segment.type ?? 'text'}`">
      <span v-if="segment.type" :class="`segment-${segment.type}`">{{ segment.text }}</span>
      <span v-else>{{ segment.text }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AgentPart, FilePart } from '@opencode-ai/sdk/v2';

type Segment = {
  text: string;
  type?: 'file' | 'agent';
};

const props = defineProps<{
  text: string;
  references: FilePart[];
  agents: AgentPart[];
}>();

const segments = computed<Segment[]>(() => {
  const text = props.text;
  if (!text) return [];

  const fileRefs = props.references.flatMap((item) => {
    const source = item.source;
    const textRef = source?.text;
    if (!textRef || textRef.start === undefined || textRef.end === undefined) return [];
    return [{ start: textRef.start, end: textRef.end, type: 'file' as const }];
  });

  const agentRefs = props.agents.flatMap((item) => {
    const source = item.source;
    if (!source || source.start === undefined || source.end === undefined) return [];
    return [{ start: source.start, end: source.end, type: 'agent' as const }];
  });

  const refs = [
    ...fileRefs,
    ...agentRefs,
  ].sort((a, b) => a.start - b.start);

  const result: Segment[] = [];
  let lastIndex = 0;

  for (const ref of refs) {
    if (ref.start < lastIndex || ref.end > text.length || ref.start >= ref.end) continue;
    if (ref.start > lastIndex) {
      result.push({ text: text.slice(lastIndex, ref.start) });
    }
    result.push({ text: text.slice(ref.start, ref.end), type: ref.type });
    lastIndex = ref.end;
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex) });
  }

  return result;
});
</script>

<style lang="scss" scoped>
.user-message-highlighted {
  white-space: pre-wrap;
  word-break: break-word;
}

.segment-file,
.segment-agent {
  border-radius: 6px;
  padding: 1px 4px;
}

.segment-file {
  background: rgba(255, 255, 255, 0.18);
}

.segment-agent {
  background: rgba(255, 255, 255, 0.24);
  font-weight: 600;
}
</style>
