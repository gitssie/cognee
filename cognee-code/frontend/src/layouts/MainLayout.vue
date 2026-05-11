<template>
  <q-layout view="lHh Lpr lFf">
    <!-- Header: Clean White -->
    <q-header class="bg-white text-dark bordered-bottom" height-hint="64">
      <q-toolbar class="h-16">
        <q-btn
          flat
          dense
          round
          icon="menu"
          :aria-label="t('layout.dashboard')"
          @click="toggleLeftDrawer"
          class="text-grey-7"
        />

        <q-toolbar-title class="text-weight-bold flex items-center text-slate-900">
          <q-icon name="memory" class="q-mr-sm text-primary" size="28px" />
          <span>Cognee</span> <span class="text-weight-light">Code</span>
        </q-toolbar-title>

        <div class="row items-center q-gutter-sm">
          <q-select
            v-model="locale"
            :options="languageOptions"
            dense
            borderless
            emit-value
            map-options
            options-dense
            style="min-width: 110px"
            class="text-grey-7"
          />
          <div class="text-caption text-grey-6">v0.0.1</div>
          <q-btn round flat icon="notifications" color="grey-6" size="sm" />
          <q-btn-dropdown flat round no-icon-animation>
            <template #label>
              <q-avatar size="32px" color="primary" text-color="white">
                <span class="text-weight-bold">{{ userInitial }}</span>
              </q-avatar>
            </template>
            <q-list dense>
              <q-item>
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{ userEmail }}</q-item-label>
                  <q-item-label caption>{{ t('layout.loggedIn') }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-separator />
              <q-item clickable v-close-popup @click="showChangePwd = true">
                <q-item-section avatar>
                  <q-icon name="lock" />
                </q-item-section>
                <q-item-section>{{ t('layout.changePassword') }}</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="handleLogout">
                <q-item-section avatar>
                  <q-icon name="logout" />
                </q-item-section>
                <q-item-section>{{ t('layout.logout') }}</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>

        <!-- Change Password Dialog -->
        <q-dialog v-model="showChangePwd" persistent>
          <q-card style="width: 380px; max-width: 80vw;">
            <q-toolbar class="bg-grey-1">
              <q-toolbar-title>{{ t('layout.changePassword') }}</q-toolbar-title>
              <q-btn flat round dense icon="close" v-close-popup />
            </q-toolbar>
            <q-separator />
            <q-card-section class="q-gutter-md">
              <q-input
                v-model="oldPassword"
                :label="t('layout.currentPassword')"
                type="password"
                outlined
                dense
                :rules="[val => !!val || t('login.passwordRequired')]"
              />
              <q-input
                v-model="newPassword"
                :label="t('layout.newPassword')"
                type="password"
                outlined
                dense
                :rules="[val => !!val && val.length >= 6 || t('login.passwordMin')]"
              />
              <q-input
                v-model="confirmNewPwd"
                :label="t('login.confirmPassword')"
                type="password"
                outlined
                dense
                :rules="[val => val === newPassword || t('login.passwordMismatch')]"
              />
            </q-card-section>
            <q-card-actions align="right">
              <q-btn flat :label="t('common.cancel')" v-close-popup />
              <q-btn
                color="primary"
                :label="t('common.save')"
                :loading="changingPwd"
                @click="handleChangePassword"
              />
            </q-card-actions>
          </q-card>
        </q-dialog>
      </q-toolbar>
    </q-header>

    <!-- Sidebar: Deep Slate -->
    <q-drawer v-model="leftDrawerOpen" show-if-above class="bg-secondary text-grey-4" :width="260">
      <q-list padding class="q-pt-lg">
        <q-item-label
          header
          class="text-grey-6 text-uppercase text-weight-bold q-pl-md font-xs q-mb-sm"
        >
          {{ t('layout.platform') }}
        </q-item-label>

        <q-item
          to="/"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          exact
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="dashboard" />
          </q-item-section>
          <q-item-section>{{ t('layout.dashboard') }}</q-item-section>
        </q-item>

        <q-item
          to="/search"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="search" />
          </q-item-section>
          <q-item-section>{{ t('layout.search') }}</q-item-section>
        </q-item>

        <q-item
          to="/knowledge"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="library_books" />
          </q-item-section>
          <q-item-section>{{ t('layout.knowledgeBase') }}</q-item-section>
        </q-item>

        <q-item
          to="/graph"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="hub" />
          </q-item-section>
          <q-item-section>{{ t('layout.graphKnowledge') }}</q-item-section>
          <q-item-section side>
            <q-badge color="grey-8" label="M2" outline />
          </q-item-section>
        </q-item>

        <q-item
          to="/agents"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="smart_toy" />
          </q-item-section>
          <q-item-section>{{ t('layout.agents') }}</q-item-section>
          <q-item-section side>
            <q-badge color="grey-8" label="M4" outline />
          </q-item-section>
        </q-item>

        <q-item
          to="/monitor"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="monitor_heart" />
          </q-item-section>
          <q-item-section>Agent 监控</q-item-section>
        </q-item>

        <q-separator class="q-my-md bg-grey-8" />

        <q-item
          to="/channels"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="lan" />
          </q-item-section>
          <q-item-section>频道管理</q-item-section>
        </q-item>

        <q-item-label
          header
          class="text-grey-6 text-uppercase text-weight-bold q-pl-md font-xs q-mb-sm"
        >
          {{ t('layout.system') }}
        </q-item-label>

        <q-item
          to="/settings"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="settings" />
          </q-item-section>
          <q-item-section>{{ t('layout.settings') }}</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container class="bg-app">
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { localeOptions } from 'src/i18n';
import { AuthService } from 'src/services/auth';

const router = useRouter();
const $q = useQuasar();
const leftDrawerOpen = ref(false);
const { t, locale } = useI18n({ useScope: 'global' });
const languageOptions = localeOptions;

// ── User state ──
const userEmail = ref('...');
const userInitial = computed(() => (userEmail.value[0] || 'A').toUpperCase());

onMounted(async () => {
  try {
    const user = await AuthService.getCurrentUser();
    userEmail.value = user.email;
  } catch { /* not logged in */ }
});

// ── Logout ──
async function handleLogout() {
  try {
    await AuthService.logout();
  } catch { /* ignore */ }
  void router.push('/login');
}

// ── Change password ──
const showChangePwd = ref(false);
const oldPassword = ref('');
const newPassword = ref('');
const confirmNewPwd = ref('');
const changingPwd = ref(false);

async function handleChangePassword() {
  if (!oldPassword.value || !newPassword.value || newPassword.value !== confirmNewPwd.value) return;
  if (newPassword.value.length < 6) {
    $q.notify({ type: 'warning', message: t('login.passwordMin') });
    return;
  }
  changingPwd.value = true;
  try {
    await AuthService.changePassword(oldPassword.value, newPassword.value);
    $q.notify({ type: 'positive', message: t('layout.passwordChanged') });
    showChangePwd.value = false;
    oldPassword.value = '';
    newPassword.value = '';
    confirmNewPwd.value = '';
  } catch {
    $q.notify({ type: 'negative', message: t('layout.passwordChangeFailed') });
  } finally {
    changingPwd.value = false;
  }
}

function toggleLeftDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value;
}
</script>

<style lang="scss" scoped>
.bordered-bottom {
  border-bottom: 1px solid #e2e8f0;
}
.rounded-borders {
  border-radius: 8px;
}
.opacity-50 {
  opacity: 0.5;
}
.font-xs {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
}
.text-slate-900 {
  color: #0f172a;
}
.bg-app {
  background-color: #f8fafc;
}
.shadow-md {
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06);
}
</style>
