<template>
  <q-page padding>
    <div class="text-h4 q-mb-md">{{ t('admin.title') }}</div>

    <q-tabs v-model="tab" align="left" class="text-primary">
      <q-tab name="profile" :label="t('admin.myProfile')" />
      <q-tab name="tenants" :label="t('admin.tenants')" />
      <q-tab name="roles" :label="t('admin.roles')" />
    </q-tabs>

    <q-separator />

    <q-tab-panels v-model="tab" animated>
      <!-- Profile Tab -->
      <q-tab-panel name="profile">
        <div class="row items-center q-mb-md">
          <div class="text-h6">{{ t('admin.currentUser') }}</div>
          <q-space />
          <q-btn color="negative" :label="t('admin.logout')" icon="logout" @click="handleLogout" />
        </div>

        <q-card v-if="currentUser" flat bordered class="q-mb-md">
          <q-card-section>
            <div class="row q-gutter-md">
              <div class="col-12 col-md-6">
                <q-input v-model="currentUser.email" :label="t('admin.email')" outlined readonly />
              </div>
              <div class="col-12 col-md-6">
                <q-input v-model="currentUser.id" :label="t('admin.userId')" outlined readonly />
              </div>
            </div>
            <div class="row q-gutter-md q-mt-sm">
              <q-chip :color="currentUser.is_active ? 'positive' : 'negative'" text-color="white">
                {{ currentUser.is_active ? t('admin.active') : t('admin.inactive') }}
              </q-chip>
              <q-chip v-if="currentUser.is_superuser" color="warning" text-color="dark">
                {{ t('admin.superuser') }}
              </q-chip>
              <q-chip v-if="currentUser.is_verified" color="info" text-color="white">
                {{ t('admin.verified') }}
              </q-chip>
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">{{ t('admin.changePassword') }}</div>
            <q-input
              v-model="newPassword"
              :label="t('admin.newPassword')"
              type="password"
              outlined
              class="q-mb-sm"
            />
            <q-btn color="primary" :label="t('admin.updatePassword')" @click="updatePassword" :loading="updatingPassword" :disable="!newPassword" />
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <!-- Tenants Tab -->
      <q-tab-panel name="tenants">
        <div class="row items-center q-mb-md">
          <div class="text-h6">{{ t('admin.myTenants') }}</div>
          <q-space />
          <q-btn color="primary" :label="t('admin.createTenant')" @click="showCreateTenant = true" />
        </div>

        <q-list bordered separator>
          <q-item v-for="tenant in tenants" :key="tenant.id">
            <q-item-section>
              <q-item-label>{{ tenant.name }}</q-item-label>
              <q-item-label caption>{{ tenant.id }}</q-item-label>
            </q-item-section>
            <q-item-section side>
               <q-btn flat :label="t('admin.switchTo')" @click="switchTenant(tenant.id)" />
            </q-item-section>
          </q-item>
          <q-item v-if="tenants.length === 0">
             <q-item-section class="text-grey">{{ t('admin.noTenantsFound') }}</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <!-- Roles Tab -->
      <q-tab-panel name="roles">
        <div class="row items-center q-mb-md">
          <div class="text-h6">{{ t('admin.roles') }}</div>
          <q-space />
          <q-btn color="primary" :label="t('admin.createRole')" @click="showCreateRole = true" />
        </div>

        <q-list bordered separator>
          <q-item v-for="role in roles" :key="role.id">
            <q-item-section>
              <q-item-label>{{ role.name }}</q-item-label>
              <q-item-label caption>{{ role.id }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="roles.length === 0">
             <q-item-section class="text-grey">{{ t('admin.noRolesFound') }}</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>
    </q-tab-panels>

    <!-- Create Tenant Dialog -->
    <q-dialog v-model="showCreateTenant">
      <q-card style="min-width: 350px">
        <q-card-section>
           <div class="text-h6">{{ t('admin.newTenant') }}</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
           <q-input dense v-model="newTenantName" autofocus :label="t('admin.tenantName')" @keyup.enter="createTenant" />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
          <q-btn flat :label="t('common.cancel')" v-close-popup />
          <q-btn flat :label="t('common.create')" @click="createTenant" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Create Role Dialog -->
    <q-dialog v-model="showCreateRole">
      <q-card style="min-width: 350px">
        <q-card-section>
           <div class="text-h6">{{ t('admin.newRole') }}</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
           <q-input dense v-model="newRoleName" autofocus :label="t('admin.roleName')" @keyup.enter="createRole" />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
          <q-btn flat :label="t('common.cancel')" v-close-popup />
          <q-btn flat :label="t('common.create')" @click="createRole" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { PermissionService } from 'src/services/permission';
import type { Tenant, Role } from 'src/services/permission';
import { AuthService, type User } from 'src/services/auth';

const router = useRouter();
const $q = useQuasar();
const { t } = useI18n();
const tab = ref('profile');

// User
const currentUser = ref<User | null>(null);
const newPassword = ref('');
const updatingPassword = ref(false);

// Tenants & Roles
const tenants = ref<Tenant[]>([]);
const roles = ref<Role[]>([]);

const showCreateTenant = ref(false);
const newTenantName = ref('');

const showCreateRole = ref(false);
const newRoleName = ref('');

async function loadCurrentUser() {
  try {
    currentUser.value = await AuthService.getCurrentUser();
  } catch {
    // Not logged in
    currentUser.value = null;
  }
}

async function updatePassword() {
  if (!newPassword.value) return;
  updatingPassword.value = true;
  try {
    await AuthService.updateCurrentUser({ password: newPassword.value });
    $q.notify({ type: 'positive', message: t('admin.passwordUpdated') });
    newPassword.value = '';
  } catch {
    $q.notify({ type: 'negative', message: t('admin.failedUpdatePassword') });
  } finally {
    updatingPassword.value = false;
  }
}

async function handleLogout() {
  try {
    await AuthService.logout();
    $q.notify({ type: 'positive', message: t('admin.loggedOut') });
    void router.push('/login');
  } catch {
    // Cookie is cleared by the browser on logout response; just redirect
    void router.push('/login');
  }
}

const loadTenants = async () => {
  try {
    tenants.value = await PermissionService.getMyTenants();
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: t('admin.failedLoadTenants') });
  }
};

const loadRoles = async () => {
  try {
    roles.value = await PermissionService.getRoles();
  } catch (e) {
    console.error(e);
    // Silent fail if no tenant selected or no roles
  }
};

const createTenant = async () => {
  if (!newTenantName.value) return;
  try {
    await PermissionService.createTenant(newTenantName.value);
    showCreateTenant.value = false;
    newTenantName.value = '';
    await loadTenants();
    $q.notify({ type: 'positive', message: t('admin.tenantCreated') });
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: t('admin.failedCreateTenant') });
  }
};

const switchTenant = async (id: string) => {
  try {
    await PermissionService.selectTenant(id);
    $q.notify({ type: 'positive', message: t('admin.switchedTenant') });
    // Reload to refresh context
    window.location.reload();
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: t('admin.failedSwitchTenant') });
  }
};

const createRole = async () => {
  if (!newRoleName.value) return;
  try {
    await PermissionService.createRole(newRoleName.value);
    showCreateRole.value = false;
    newRoleName.value = '';
    await loadRoles();
    $q.notify({ type: 'positive', message: t('admin.roleCreated') });
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: t('admin.failedCreateRole') });
  }
};

onMounted(() => {
  void loadCurrentUser();
  void loadTenants();
  void loadRoles();
});
</script>
