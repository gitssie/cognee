<template>
  <q-page class="q-pa-md">
    <div class="text-h4 q-mb-md">{{ t('settingsPage.title') }}</div>

    <q-spinner v-if="loading" color="primary" size="3em" class="q-ma-xl" />

    <template v-else>
      <!-- User Profile -->
      <q-card class="q-mb-md">
        <q-card-section>
          <div class="text-h6">{{ t('settingsPage.account') }}</div>
        </q-card-section>
        <q-card-section>
          <q-list separator>
            <q-item>
              <q-item-section avatar><q-icon name="person" /></q-item-section>
              <q-item-section>
                <q-item-label caption>{{ t('settingsPage.email') }}</q-item-label>
                <q-item-label>{{ userEmail }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-item>
              <q-item-section avatar><q-icon name="verified_user" /></q-item-section>
              <q-item-section>
                <q-item-label caption>{{ t('settingsPage.role') }}</q-item-label>
                <q-item-label>{{ userRole }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn color="primary" :label="t('settingsPage.changePassword')" icon="lock" @click="showChangePwd = true" />
        </q-card-actions>
      </q-card>

      <!-- Server Config -->
      <q-card class="q-mb-md">
        <q-card-section>
          <div class="text-h6">{{ t('settingsPage.systemInfo') }}</div>
        </q-card-section>
        <q-card-section>
          <q-list separator>
            <q-item>
              <q-item-section avatar><q-icon name="storage" /></q-item-section>
              <q-item-section>
                <q-item-label caption>{{ t('settingsPage.vectorDb') }}</q-item-label>
                <q-item-label class="text-weight-medium">{{ serverConfig.vectorDbProvider }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>

      <!-- Change Password Dialog -->
      <q-dialog v-model="showChangePwd" persistent>
        <q-card style="width: 380px; max-width: 80vw;">
          <q-toolbar class="bg-grey-1">
            <q-toolbar-title>{{ t('settingsPage.changePassword') }}</q-toolbar-title>
            <q-btn flat round dense icon="close" v-close-popup />
          </q-toolbar>
          <q-separator />
          <q-card-section class="q-gutter-md">
            <q-input
              v-model="oldPassword"
              :label="t('settingsPage.currentPassword')"
              type="password"
              outlined
              dense
              :rules="[val => !!val || t('login.passwordRequired')]"
            />
            <q-input
              v-model="newPassword"
              :label="t('settingsPage.newPassword')"
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
            <q-btn color="primary" :label="t('common.save')" :loading="changingPwd" @click="handleChangePassword" />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { AuthService } from 'src/services/auth';
import { KnowledgeService } from 'src/services/knowledge';

const $q = useQuasar();
const { t } = useI18n();

const loading = ref(true);
const userEmail = ref('');
const userRole = ref('User');
const serverConfig = ref({
  vectorDbProvider: '...',
});

// Change password state
const showChangePwd = ref(false);
const oldPassword = ref('');
const newPassword = ref('');
const confirmNewPwd = ref('');
const changingPwd = ref(false);

async function loadData() {
  try {
    const [user] = await Promise.all([
      AuthService.getCurrentUser().catch(() => null),
      KnowledgeService.getConfig().then(cfg => {
        serverConfig.value.vectorDbProvider = cfg.vector_db_provider;
      }).catch(() => {}),
    ]);
    if (user) {
      userEmail.value = user.email;
      userRole.value = user.is_superuser ? 'Admin' : 'User';
    }
  } finally {
    loading.value = false;
  }
}

async function handleChangePassword() {
  if (!oldPassword.value || !newPassword.value || newPassword.value !== confirmNewPwd.value) return;
  if (newPassword.value.length < 6) {
    $q.notify({ type: 'warning', message: t('login.passwordMin') });
    return;
  }
  changingPwd.value = true;
  try {
    await AuthService.changePassword(oldPassword.value, newPassword.value);
    $q.notify({ type: 'positive', message: t('settingsPage.passwordChanged') });
    showChangePwd.value = false;
    oldPassword.value = '';
    newPassword.value = '';
    confirmNewPwd.value = '';
  } catch {
    $q.notify({ type: 'negative', message: t('settingsPage.passwordChangeFailed') });
  } finally {
    changingPwd.value = false;
  }
}

onMounted(() => void loadData());
</script>
