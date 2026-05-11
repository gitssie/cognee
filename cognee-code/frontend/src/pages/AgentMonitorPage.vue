<template>
  <q-page padding>
    <!-- Page Header -->
    <q-toolbar class="bg-grey-1 q-mb-md rounded-borders">
      <q-toolbar-title>
        <q-icon name="monitor_heart" class="q-mr-sm" />
        Agent 运行监控
      </q-toolbar-title>
      <q-btn
        flat
        round
        dense
        icon="refresh"
        :loading="loading"
        @click="refreshAll"
      />
    </q-toolbar>

    <!-- Health Status Cards -->
    <div class="row q-col-gutter-md q-mb-md">
      <div class="col-12 col-md-3">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-caption text-grey-6">Agent 状态</div>
            <div class="text-h6 q-mt-xs row items-center">
              <q-icon
                :name="health?.opencode?.healthy ? 'check_circle' : 'error'"
                :color="health?.opencode?.healthy ? 'positive' : 'negative'"
                size="sm"
                class="q-mr-sm"
              />
              {{ health?.opencode?.healthy ? '在线' : '离线' }}
            </div>
          </q-card-section>
        </q-card>
      </div>
      <div class="col-12 col-md-3">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-caption text-grey-6">活跃频道</div>
            <div class="text-h6 q-mt-xs">
              {{ activeChannelCount }}
            </div>
          </q-card-section>
        </q-card>
      </div>
      <div class="col-12 col-md-3">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-caption text-grey-6">今日入站</div>
            <div class="text-h6 q-mt-xs">
              {{ health?.activity?.inboundToday ?? 0 }}
            </div>
          </q-card-section>
        </q-card>
      </div>
      <div class="col-12 col-md-3">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-caption text-grey-6">Sandbox 运行中</div>
            <div class="text-h6 q-mt-xs">
              {{ sandboxCount }}
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Agent Info -->
    <q-card flat bordered class="q-mb-md" v-if="health">
      <q-card-section>
        <div class="text-subtitle2">OpenCode 信息</div>
        <div class="row q-col-gutter-md q-mt-sm">
          <div class="col-12 col-md-4">
            <div class="text-caption text-grey-6">URL</div>
            <div class="text-body2">{{ health.opencode.url }}</div>
          </div>
          <div class="col-12 col-md-4">
            <div class="text-caption text-grey-6">版本</div>
            <div class="text-body2">{{ health.opencode.version || '未知' }}</div>
          </div>
          <div class="col-12 col-md-4" v-if="health.config">
            <div class="text-caption text-grey-6">群组模式</div>
            <div class="text-body2">{{ health.config.groupsEnabled ? '已启用' : '已禁用' }}</div>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Sandbox List -->
    <q-card flat bordered>
      <q-card-section>
        <div class="row items-center justify-between">
          <div class="text-subtitle2">Sandbox 运行时</div>
          <q-btn
            flat
            dense
            icon="refresh"
            label="刷新"
            :loading="sandboxLoading"
            @click="loadSandboxes"
          />
        </div>
      </q-card-section>
      <q-separator />
      <q-card-section v-if="sandboxLoading" class="text-center q-py-lg">
        <q-spinner-dots size="40px" />
      </q-card-section>
      <q-card-section v-else-if="sandboxes.length === 0" class="text-center q-py-lg text-grey-6">
        暂无运行中的 sandbox
      </q-card-section>
      <q-list separator v-else>
        <q-item v-for="sb in sandboxes" :key="sb.identity">
          <q-item-section avatar>
            <q-icon
              :name="sb.status === 'running' ? 'play_circle' : 'pause_circle'"
              :color="sb.status === 'running' ? 'positive' : 'warning'"
              size="md"
            />
          </q-item-section>
          <q-item-section>
            <q-item-label class="text-weight-medium">{{ sb.identity }}</q-item-label>
            <q-item-label caption>
              {{ sb.sandboxName }} ·
              镜像: {{ sb.image }} ·
              端口: {{ sb.hostPort }}
            </q-item-label>
            <q-item-label caption>
              状态: {{ sb.status }} ·
              创建: {{ formatTime(sb.createdAt) }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="row q-gutter-xs">
              <q-btn
                flat
                round
                dense
                color="warning"
                icon="stop_circle"
                size="sm"
                @click="handleStop(sb.identity)"
                :disable="sb.status !== 'running'"
              >
                <q-tooltip>停止</q-tooltip>
              </q-btn>
              <q-btn
                flat
                round
                dense
                color="negative"
                icon="delete"
                size="sm"
                @click="handleRemove(sb.identity)"
              >
                <q-tooltip>删除</q-tooltip>
              </q-btn>
            </div>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import {
  getHealth,
  listSandboxes,
  stopSandbox,
  removeSandbox,
  type HealthSnapshot,
  type SandboxRuntimeItem,
} from 'src/services/agentApi';

const $q = useQuasar();

const loading = ref(false);
const health = ref<HealthSnapshot | null>(null);
const sandboxes = ref<SandboxRuntimeItem[]>([]);
const sandboxLoading = ref(false);

const activeChannelCount = computed(() => {
  if (!health.value?.channels) return 0;
  return Object.values(health.value.channels).filter(Boolean).length;
});

const sandboxCount = computed(() => sandboxes.value.length);

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

async function loadHealth() {
  try {
    health.value = await getHealth();
  } catch {
    console.error('Failed to load health');
  }
}

async function loadSandboxes() {
  sandboxLoading.value = true;
  try {
    const result = await listSandboxes();
    sandboxes.value = result.items || [];
  } catch {
    console.error('Failed to load sandboxes');
    $q.notify({ type: 'negative', message: '加载 sandbox 列表失败' });
  } finally {
    sandboxLoading.value = false;
  }
}

async function handleStop(identity: string) {
  try {
    const result = await stopSandbox(identity);
    if (result.ok) {
      $q.notify({ type: 'positive', message: `已停止 sandbox: ${identity}` });
    } else {
      $q.notify({ type: 'negative', message: result.error || '停止失败' });
    }
    await loadSandboxes();
  } catch {
    $q.notify({ type: 'negative', message: '停止 sandbox 失败' });
  }
}

function handleRemove(identity: string) {
  $q.dialog({
    title: '确认删除',
    message: `确定要删除 sandbox "${identity}" 吗？此操作不可撤销。`,
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void (async () => {
      try {
        const result = await removeSandbox(identity);
        if (result.ok) {
          $q.notify({ type: 'positive', message: `已删除 sandbox: ${identity}` });
        } else {
          $q.notify({ type: 'negative', message: result.error || '删除失败' });
        }
        await loadSandboxes();
      } catch {
        $q.notify({ type: 'negative', message: '删除 sandbox 失败' });
      }
    })();
  });
}

async function refreshAll() {
  loading.value = true;
  await Promise.all([loadHealth(), loadSandboxes()]);
  loading.value = false;
}

onMounted(refreshAll);
</script>
