<template>
  <div class="agent-permission-dock">
    <!-- Header -->
    <div class="perm-header row items-center no-wrap q-px-sm q-pt-xs q-pb-xs">
      <q-icon name="security" size="16px" color="warning" class="q-mr-xs" />
      <span class="text-caption text-weight-bold text-grey-7">{{ t('agentPermission.required') }}</span>
    </div>

    <q-separator color="grey-3" />

    <!-- Body -->
    <div class="perm-body q-px-sm q-py-xs">
      <div class="text-body2 text-weight-medium q-mb-xs">
        {{ permissionLabel }}
      </div>
      <div v-if="request.patterns && request.patterns.length > 0" class="q-mb-xs">
        <q-chip
          v-for="p in request.patterns"
          :key="p"
          dense outline color="grey-6" size="sm"
          class="q-mr-xs"
        >
          {{ p }}
        </q-chip>
      </div>
      <div v-if="metadataEntries.length > 0" class="text-caption text-grey-6">
        <span v-for="[k, v] in metadataEntries" :key="k" class="q-mr-sm">
          <span class="text-weight-medium">{{ k }}:</span> {{ v }}
        </span>
      </div>
      <div v-if="request.tool" class="text-caption text-grey-6 q-mt-xs">
        <span class="text-weight-medium">Tool:</span> {{ request.tool.callID }}
      </div>
    </div>

    <q-separator color="grey-3" />

    <!-- Footer actions -->
    <div class="perm-footer row items-center justify-between q-px-sm q-py-xs">
      <q-btn
        flat no-caps dense
        color="negative"
        :label="t('agentPermission.deny')"
        :disable="sending"
        @click="respond('reject')"
      />
      <div class="row q-gutter-xs">
        <q-btn
          flat no-caps dense
          color="grey-7"
          :label="t('agentPermission.allowOnce')"
          :loading="sending"
          :disable="sending"
          @click="respond('once')"
        />
        <q-btn
          no-caps unelevated
          color="primary"
          :label="t('agentPermission.alwaysAllow')"
          :loading="sending"
          :disable="sending"
          @click="respond('always')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PermissionRequest } from '@opencode-ai/sdk/v2';

const props = defineProps<{
  request: PermissionRequest;
  onRespond: (requestID: string, response: 'once' | 'always' | 'reject') => Promise<void>;
}>();

const sending = ref(false);
const { t } = useI18n();

const PERMISSION_LABELS: Record<string, string> = {
  read: t('agentPermission.readFile'),
  write: t('agentPermission.writeFile'),
  edit: t('agentPermission.editFile'),
  execute: t('agentPermission.executeCommand'),
  bash: t('agentPermission.runShell'),
  task: t('agentPermission.spawnTask'),
  question: t('agentPermission.askQuestion'),
};

const permissionLabel = computed(() => {
  return PERMISSION_LABELS[props.request.permission] ?? t('agentPermission.useTool', { permission: props.request.permission });
});

const metadataEntries = computed(() => {
  const exclude = new Set(['sessionID', 'messageID', 'callID']);
  return Object.entries(props.request.metadata ?? {})
    .filter(([k]) => !exclude.has(k))
    .slice(0, 4);
});

async function respond(response: 'once' | 'always' | 'reject') {
  sending.value = true;
  try {
    await props.onRespond(props.request.id, response);
  } finally {
    sending.value = false;
  }
}
</script>

<style lang="scss" scoped>
.agent-permission-dock {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 8px;
  background: white;
  border: 1px solid $warning;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.perm-header {
  min-height: 28px;
  background: rgba($warning, 0.06);
}

.perm-body {
  max-height: 150px;
  overflow-y: auto;
}

.perm-footer {
  min-height: 36px;
}
</style>
