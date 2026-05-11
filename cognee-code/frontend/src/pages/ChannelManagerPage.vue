<template>
  <q-page padding>
    <!-- Page Header -->
    <q-toolbar class="bg-grey-1 q-mb-md rounded-borders">
      <q-toolbar-title>
        <q-icon name="lan" class="q-mr-sm" />
        频道管理
      </q-toolbar-title>
      <q-btn
        flat
        round
        dense
        icon="refresh"
        :loading="loading"
        @click="loadAll"
      />
    </q-toolbar>

    <!-- Loading -->
    <div v-if="loading && !hasData" class="text-center q-py-xl">
      <q-spinner-dots size="48px" />
    </div>

    <!-- Channel Cards -->
    <div v-else class="row q-col-gutter-md">
      <div
        v-for="(ch, name) in channels"
        :key="name"
        class="col-12 col-md-6"
      >
        <q-card flat bordered>
          <q-card-section class="row items-center justify-between">
            <div class="text-subtitle2">
              <q-icon :name="channelIcon(name)" class="q-mr-xs" />
              {{ channelLabel(name) }}
              <q-badge
                v-if="isPluginChannel(name)"
                color="grey-6"
                label="插件"
                class="q-ml-sm"
                outline
              />
            </div>
            <q-btn
              v-if="isManageable(name)"
              flat
              dense
              icon="add"
              label="添加"
              color="primary"
              @click="openDialog(name)"
            />
          </q-card-section>
          <q-separator />
          <q-card-section v-if="ch.items.length === 0" class="text-center q-py-lg text-grey-6">
            暂无 {{ channelLabel(name) }} 频道
          </q-card-section>
          <q-list separator v-else>
            <q-item v-for="item in ch.items" :key="item.id">
              <q-item-section avatar>
                <q-icon
                  :name="item.running ? 'check_circle' : 'cancel'"
                  :color="item.running ? 'positive' : 'grey'"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium">
                  {{ item.id }}
                  <q-badge
                    :color="item.enabled ? 'positive' : 'grey'"
                    :label="item.enabled ? '启用' : '禁用'"
                    class="q-ml-sm"
                    outline
                  />
                  <q-badge
                    v-if="item.meta?.pairingRequired"
                    color="warning"
                    label="需配对"
                    class="q-ml-xs"
                    outline
                  />
                </q-item-label>
                <q-item-label caption>
                  运行状态: {{ item.running ? '运行中' : '已停止' }}
                  <span v-if="item.meta?.access"> · {{ item.meta.access }}</span>
                  <span v-if="item.meta?.fingerprint"> · {{ item.meta.fingerprint }}</span>
                  <span v-if="item.directory"> · {{ item.directory }}</span>
                </q-item-label>
              </q-item-section>
              <q-item-section v-if="isManageable(name)" side>
                <q-btn
                  flat
                  round
                  dense
                  color="negative"
                  icon="delete"
                  size="sm"
                  @click="handleDelete(name, item.id)"
                >
                  <q-tooltip>删除</q-tooltip>
                </q-btn>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>

      <!-- Empty state -->
      <div
        v-if="channelCount === 0"
        class="col-12 text-center q-py-xl text-grey-6"
      >
        暂无频道数据
      </div>
    </div>

    <!-- ── Bindings (User ↔ Channel mappings) ────────────────────── -->
    <q-card flat bordered class="q-mt-md">
      <q-card-section class="row items-center justify-between">
        <div class="text-subtitle2">
          <q-icon name="link" class="q-mr-xs" />
          用户绑定
        </div>
        <q-btn
          flat
          dense
          icon="refresh"
          :loading="bindingsLoading"
          @click="loadBindings"
        />
      </q-card-section>
      <q-separator />
      <q-card-section v-if="bindingsLoading" class="text-center q-py-lg">
        <q-spinner-dots size="40px" />
      </q-card-section>
      <q-card-section v-else-if="bindingList.length === 0" class="text-center q-py-lg text-grey-6">
        暂无用户绑定
      </q-card-section>
      <q-table
        v-else
        :rows="bindingList"
        :columns="bindingColumns"
        row-key="key"
        dense
        flat
        hide-pagination
        class="no-shadow"
      >
        <template #body-cell-channel="props">
          <q-td :props="props">
            <q-badge outline :label="channelLabel(props.value)" />
          </q-td>
        </template>
        <template #body-cell-running="props">
          <q-td :props="props">
            <q-icon
              :name="isIdentityRunning(props.row.channel, props.row.identityId) ? 'check_circle' : 'cancel'"
              :color="isIdentityRunning(props.row.channel, props.row.identityId) ? 'positive' : 'grey'"
            />
          </q-td>
        </template>
      </q-table>
    </q-card>

    <!-- Telegram Dialog -->
    <q-dialog v-model="telegramDialog" persistent>
      <q-card style="width: 420px; max-width: 80vw;">
        <q-toolbar class="bg-grey-1">
          <q-toolbar-title>{{ editingId ? '编辑 Telegram' : '添加 Telegram 机器人' }}</q-toolbar-title>
          <q-btn flat round dense icon="close" v-close-popup />
        </q-toolbar>
        <q-separator />
        <q-card-section class="q-gutter-sm">
          <q-input v-model="telegramForm.token" label="Bot Token" outlined dense :rules="[val => !!val || 'Token 必填']" />
          <q-input v-model="telegramForm.id" label="ID (可选，默认 default)" outlined dense />
          <q-input v-model="telegramForm.directory" label="目录 (可选)" outlined dense />
          <q-toggle v-model="telegramForm.enabled" label="启用" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="primary" label="保存" :loading="telegramSaving" @click="handleSaveTelegram" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Slack Dialog -->
    <q-dialog v-model="slackDialog" persistent>
      <q-card style="width: 420px; max-width: 80vw;">
        <q-toolbar class="bg-grey-1">
          <q-toolbar-title>{{ editingId ? '编辑 Slack' : '添加 Slack 应用' }}</q-toolbar-title>
          <q-btn flat round dense icon="close" v-close-popup />
        </q-toolbar>
        <q-separator />
        <q-card-section class="q-gutter-sm">
          <q-input v-model="slackForm.botToken" label="Bot Token" outlined dense :rules="[val => !!val || 'Bot Token 必填']" />
          <q-input v-model="slackForm.appToken" label="App Token" outlined dense :rules="[val => !!val || 'App Token 必填']" />
          <q-input v-model="slackForm.id" label="ID (可选，默认 default)" outlined dense />
          <q-input v-model="slackForm.directory" label="目录 (可选)" outlined dense />
          <q-toggle v-model="slackForm.enabled" label="启用" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="primary" label="保存" :loading="slackSaving" @click="handleSaveSlack" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import {
  listAllIdentities,
  listBindings,
  upsertTelegramIdentity,
  deleteTelegramIdentity,
  upsertSlackIdentity,
  deleteSlackIdentity,
  type ChannelIdentityItem,
  type BindingItem,
} from 'src/services/agentApi';

const $q = useQuasar();

// ── Channel display helpers ──
const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  wecom: 'WeCom',
  whatsapp: 'WhatsApp',
};

const CHANNEL_ICONS: Record<string, string> = {
  telegram: 'send',
  slack: 'chat',
  wecom: 'chat',
  whatsapp: 'chat',
};

/** Channels that support full CRUD via health API. */
const MANAGEABLE = new Set(['telegram', 'slack']);

function channelLabel(name: string): string {
  return CHANNEL_LABELS[name] || name[0]?.toUpperCase() + name.slice(1);
}

function channelIcon(name: string): string {
  return CHANNEL_ICONS[name] || 'lan';
}

function isManageable(name: string): boolean {
  return MANAGEABLE.has(name);
}

function isPluginChannel(name: string): boolean {
  return !MANAGEABLE.has(name) && name !== 'telegram' && name !== 'slack';
}

// ── Data ──
const loading = ref(false);
const channels = ref<Record<string, { items: ChannelIdentityItem[] }>>({});

const hasData = computed(() => channelCount.value > 0);
const channelCount = computed(() => Object.keys(channels.value).length);

// ── Telegram dialog state ──
const telegramDialog = ref(false);
const telegramSaving = ref(false);
const editingId = ref('');
const telegramForm = ref({ id: '', token: '', directory: '', enabled: true });

// ── Slack dialog state ──
const slackDialog = ref(false);
const slackSaving = ref(false);
const slackForm = ref({ id: '', botToken: '', appToken: '', directory: '', enabled: true });

// ── Bindings ──
const bindingsLoading = ref(false);
const bindingList = ref<(BindingItem & { key: string })[]>([]);

const bindingColumns = [
  { name: 'channel', label: '频道', field: 'channel' as const, align: 'left' as const },
  { name: 'identityId', label: 'Identity ID', field: 'identityId' as const, align: 'left' as const },
  { name: 'peerId', label: '用户 PeerID', field: 'peerId' as const, align: 'left' as const },
  { name: 'directory', label: '工作目录', field: 'directory' as const, align: 'left' as const },
  { name: 'running', label: '运行', field: () => '', align: 'center' as const },
  { name: 'updatedAt', label: '更新时间', field: 'updatedAt' as const, align: 'left' as const, format: (v: number) => v ? new Date(v).toLocaleString() : '-' },
];

function isIdentityRunning(channel: string, identityId: string): boolean {
  const ch = channels.value[channel];
  if (!ch) return false;
  return ch.items.some((i) => i.id === identityId && i.running);
}

async function loadBindings() {
  bindingsLoading.value = true;
  try {
    const result = await listBindings();
    bindingList.value = (result.items || []).map((b, i) => ({
      ...b,
      key: `${b.channel}:${b.identityId}:${b.peerId}:${i}`,
    }));
  } catch {
    console.error('Failed to load bindings');
  } finally {
    bindingsLoading.value = false;
  }
}

// ── Load ──
async function loadAll() {
  loading.value = true;
  try {
    const result = await listAllIdentities();
    channels.value = result.channels || {};
  } catch {
    console.error('Failed to load channel identities');
  } finally {
    loading.value = false;
  }
}

// ── Dialog routing ──
function openDialog(channel: string) {
  editingId.value = '';
  if (channel === 'telegram') {
    telegramForm.value = { id: '', token: '', directory: '', enabled: true };
    telegramDialog.value = true;
  } else if (channel === 'slack') {
    slackForm.value = { id: '', botToken: '', appToken: '', directory: '', enabled: true };
    slackDialog.value = true;
  }
}

// ── Delete ──
function handleDelete(channel: string, id: string) {
  const label = channelLabel(channel);
  $q.dialog({
    title: '确认删除',
    message: `确定要删除 ${label} "${id}" 吗？`,
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void (async () => {
      try {
        if (channel === 'telegram') {
          const result = await deleteTelegramIdentity(id);
          if (result.ok && result.telegram.deleted) {
            $q.notify({ type: 'positive', message: `已删除 ${label}: ${id}` });
          }
        } else if (channel === 'slack') {
          const result = await deleteSlackIdentity(id);
          if (result.ok && result.slack.deleted) {
            $q.notify({ type: 'positive', message: `已删除 ${label}: ${id}` });
          }
        }
        await loadAll();
      } catch {
        $q.notify({ type: 'negative', message: `删除 ${label} 失败` });
      }
    })();
  });
}

// ── Telegram save ──
async function handleSaveTelegram() {
  if (!telegramForm.value.token) return;
  telegramSaving.value = true;
  try {
    const result = await upsertTelegramIdentity({
      ...(telegramForm.value.id ? { id: telegramForm.value.id } : {}),
      token: telegramForm.value.token,
      enabled: telegramForm.value.enabled,
      ...(telegramForm.value.directory ? { directory: telegramForm.value.directory } : {}),
    });
    if (result.ok) {
      $q.notify({ type: 'positive', message: `Telegram ${result.telegram.id} 已保存` });
      telegramDialog.value = false;
      await loadAll();
    } else {
      $q.notify({ type: 'negative', message: '保存失败' });
    }
  } catch {
    $q.notify({ type: 'negative', message: '保存 Telegram 失败' });
  } finally {
    telegramSaving.value = false;
  }
}

// ── Slack save ──
async function handleSaveSlack() {
  if (!slackForm.value.botToken || !slackForm.value.appToken) return;
  slackSaving.value = true;
  try {
    const result = await upsertSlackIdentity({
      ...(slackForm.value.id ? { id: slackForm.value.id } : {}),
      botToken: slackForm.value.botToken,
      appToken: slackForm.value.appToken,
      enabled: slackForm.value.enabled,
      ...(slackForm.value.directory ? { directory: slackForm.value.directory } : {}),
    });
    if (result.ok) {
      $q.notify({ type: 'positive', message: `Slack ${result.slack.id} 已保存` });
      slackDialog.value = false;
      await loadAll();
    } else {
      $q.notify({ type: 'negative', message: '保存失败' });
    }
  } catch {
    $q.notify({ type: 'negative', message: '保存 Slack 失败' });
  } finally {
    slackSaving.value = false;
  }
}

onMounted(() => {
  void loadAll();
  void loadBindings();
});
</script>
