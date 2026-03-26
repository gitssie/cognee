<template>
  <div class="tool-call-item" :class="`status-${part.state.status}`">
    <!-- Header row -->
    <div class="tool-call-header row items-center no-wrap" @click="open = !open">

      <!-- Status indicator -->
      <div class="status-dot-wrap q-mr-sm flex-shrink-0">
        <q-spinner-dots v-if="part.state.status === 'running'" size="14px" color="primary" />
        <q-icon v-else-if="part.state.status === 'completed'" name="check_circle" size="14px" color="positive" />
        <q-icon v-else-if="part.state.status === 'error'" name="cancel" size="14px" color="negative" />
        <q-icon v-else :name="toolIcon" size="14px" color="grey-5" />
      </div>

      <!-- Tool name badge -->
      <span class="tool-badge q-mr-sm flex-shrink-0">{{ part.tool }}</span>

      <!-- Title text (truncated, takes remaining space) -->
      <span v-if="titleText" class="tool-title col">{{ titleText }}</span>
      <div v-else class="col" />

      <!-- Duration badge when completed -->
      <span v-if="part.state.status === 'completed' && durationText" class="duration-badge q-mr-sm flex-shrink-0">
        {{ durationText }}
      </span>

      <!-- Expand/collapse chevron -->
      <q-icon
        :name="open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'"
        size="16px"
        color="grey-5"
        class="flex-shrink-0 chevron"
        :class="{ 'chevron--open': open }"
      />
    </div>

    <!-- Expanded detail -->
    <transition name="slide-down">
      <div v-if="open" class="tool-call-detail">
        <!-- Input -->
        <div class="detail-block">
          <div class="detail-label">
            <q-icon name="input" size="11px" class="q-mr-xs" />Input
          </div>
          <pre class="tool-json">{{ formatJson(part.state.input) }}</pre>
        </div>

        <!-- Output -->
        <div v-if="part.state.status === 'completed'" class="detail-block">
          <div class="detail-label text-positive">
            <q-icon name="output" size="11px" class="q-mr-xs" />Output
          </div>
          <pre class="tool-json tool-json--output">{{ part.state.output }}</pre>
        </div>

        <!-- Error -->
        <div v-if="part.state.status === 'error'" class="detail-block">
          <div class="detail-label text-negative">
            <q-icon name="error_outline" size="11px" class="q-mr-xs" />Error
          </div>
          <pre class="tool-json tool-json--error">{{ part.state.error }}</pre>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ToolPart } from '@opencode-ai/sdk/v2';

interface Props {
  part: ToolPart;
}

const props = defineProps<Props>();
const open = ref(false);

const toolIcon = computed(() => {
  const tool = props.part.tool.toLowerCase();
  if (tool.includes('read') || tool.includes('file')) return 'description';
  if (tool.includes('write') || tool.includes('edit')) return 'edit';
  if (tool.includes('bash') || tool.includes('shell') || tool.includes('exec')) return 'terminal';
  if (tool.includes('search') || tool.includes('grep') || tool.includes('glob')) return 'search';
  if (tool.includes('memory') || tool.includes('cognee') || tool.includes('cognify')) return 'psychology';
  if (tool.includes('web') || tool.includes('fetch') || tool.includes('http')) return 'language';
  if (tool.includes('list') || tool.includes('dir')) return 'folder_open';
  return 'build';
});

const titleText = computed(() => {
  const state = props.part.state;
  if ((state.status === 'running' || state.status === 'completed') && state.title) return state.title;
  return '';
});

const durationText = computed(() => {
  const state = props.part.state;
  if (state.status !== 'completed') return '';
  const start = (state as { time?: { start?: number } }).time?.start;
  const end = (state as { time?: { end?: number } }).time?.end;
  if (!start || !end) return '';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
});

function formatJson(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return '[unserializable]';
  }
}
</script>

<style lang="scss" scoped>
// ── Container ─────────────────────────────────────────────────────────────────
.tool-call-item {
  margin: 4px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid transparent;
  background: rgba(0, 0, 0, 0.025);
  transition: border-color 0.15s, background 0.15s;

  &.status-running {
    border-color: rgba(25, 118, 210, 0.25);
    background: rgba(25, 118, 210, 0.04);
  }
  &.status-completed {
    border-color: rgba(33, 186, 69, 0.2);
    background: rgba(33, 186, 69, 0.03);
  }
  &.status-error {
    border-color: rgba(193, 0, 21, 0.25);
    background: rgba(193, 0, 21, 0.04);
  }
}

// ── Header ────────────────────────────────────────────────────────────────────
.tool-call-header {
  padding: 6px 10px;
  cursor: pointer;
  min-height: 32px;
  user-select: none;
  border-radius: 8px;
  transition: background 0.1s;

  &:hover {
    background: rgba(0, 0, 0, 0.035);
  }
}

.status-dot-wrap {
  width: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

// Tool name — monospace pill
.tool-badge {
  font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', monospace;
  font-size: 11px;
  font-weight: 600;
  color: #1e293b;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 1px 6px;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.status-running .tool-badge  { background: rgba(25, 118, 210, 0.12); color: #1565c0; }
.status-completed .tool-badge { background: rgba(33, 186, 69, 0.12); color: #1b7232; }
.status-error .tool-badge    { background: rgba(193, 0, 21, 0.1);   color: #b71c1c; }

// Title — secondary description
.tool-title {
  font-size: 11.5px;
  color: $grey-7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

// Duration badge
.duration-badge {
  font-size: 10px;
  color: $grey-6;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
  padding: 1px 7px;
  white-space: nowrap;
}

// Chevron with smooth rotation
.chevron {
  transition: transform 0.18s ease;
  &--open { transform: rotate(180deg); }
}

// ── Expanded detail ───────────────────────────────────────────────────────────
.tool-call-detail {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.015);
}

.detail-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  display: flex;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: $grey-6;
}

.tool-json {
  font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.06);
  padding: 7px 10px;
  border-radius: 6px;
  color: #334155;

  &--output { border-color: rgba(33, 186, 69, 0.18); background: rgba(33, 186, 69, 0.03); }
  &--error  { border-color: rgba(193, 0, 21, 0.18);  background: rgba(193, 0, 21, 0.03); }
}

// ── Slide transition ──────────────────────────────────────────────────────────
.slide-down-enter-active,
.slide-down-leave-active {
  transition: max-height 0.2s ease, opacity 0.18s ease;
  overflow: hidden;
  max-height: 600px;
}
.slide-down-enter-from,
.slide-down-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
