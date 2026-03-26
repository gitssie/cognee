<template>
  <q-page padding>
    <div class="text-h4 q-mb-md">Administration</div>

    <q-tabs v-model="tab" align="left" class="text-primary">
      <q-tab name="profile" label="My Profile" />
      <q-tab name="tenants" label="Tenants" />
      <q-tab name="roles" label="Roles" />
    </q-tabs>

    <q-separator />

    <q-tab-panels v-model="tab" animated>
      <!-- Profile Tab -->
      <q-tab-panel name="profile">
        <div class="row items-center q-mb-md">
          <div class="text-h6">Current User</div>
          <q-space />
          <q-btn color="negative" label="Logout" icon="logout" @click="handleLogout" />
        </div>

        <q-card v-if="currentUser" flat bordered class="q-mb-md">
          <q-card-section>
            <div class="row q-gutter-md">
              <div class="col-12 col-md-6">
                <q-input v-model="currentUser.email" label="Email" outlined readonly />
              </div>
              <div class="col-12 col-md-6">
                <q-input v-model="currentUser.id" label="User ID" outlined readonly />
              </div>
            </div>
            <div class="row q-gutter-md q-mt-sm">
              <q-chip :color="currentUser.is_active ? 'positive' : 'negative'" text-color="white">
                {{ currentUser.is_active ? 'Active' : 'Inactive' }}
              </q-chip>
              <q-chip v-if="currentUser.is_superuser" color="warning" text-color="dark">
                Superuser
              </q-chip>
              <q-chip v-if="currentUser.is_verified" color="info" text-color="white">
                Verified
              </q-chip>
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">Change Password</div>
            <q-input
              v-model="newPassword"
              label="New Password"
              type="password"
              outlined
              class="q-mb-sm"
            />
            <q-btn color="primary" label="Update Password" @click="updatePassword" :loading="updatingPassword" :disable="!newPassword" />
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <!-- Tenants Tab -->
      <q-tab-panel name="tenants">
        <div class="row items-center q-mb-md">
          <div class="text-h6">My Tenants</div>
          <q-space />
          <q-btn color="primary" label="Create Tenant" @click="showCreateTenant = true" />
        </div>

        <q-list bordered separator>
          <q-item v-for="tenant in tenants" :key="tenant.id">
            <q-item-section>
              <q-item-label>{{ tenant.name }}</q-item-label>
              <q-item-label caption>{{ tenant.id }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat label="Switch To" @click="switchTenant(tenant.id)" />
            </q-item-section>
          </q-item>
          <q-item v-if="tenants.length === 0">
            <q-item-section class="text-grey">No tenants found</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <!-- Roles Tab -->
      <q-tab-panel name="roles">
        <div class="row items-center q-mb-md">
          <div class="text-h6">Roles</div>
          <q-space />
          <q-btn color="primary" label="Create Role" @click="showCreateRole = true" />
        </div>

        <q-list bordered separator>
          <q-item v-for="role in roles" :key="role.id">
            <q-item-section>
              <q-item-label>{{ role.name }}</q-item-label>
              <q-item-label caption>{{ role.id }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="roles.length === 0">
            <q-item-section class="text-grey">No roles found</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>
    </q-tab-panels>

    <!-- Create Tenant Dialog -->
    <q-dialog v-model="showCreateTenant">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">New Tenant</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input dense v-model="newTenantName" autofocus label="Tenant Name" @keyup.enter="createTenant" />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn flat label="Create" @click="createTenant" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Create Role Dialog -->
    <q-dialog v-model="showCreateRole">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">New Role</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input dense v-model="newRoleName" autofocus label="Role Name" @keyup.enter="createRole" />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn flat label="Create" @click="createRole" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { PermissionService } from 'src/services/permission';
import type { Tenant, Role } from 'src/services/permission';
import { AuthService, type User } from 'src/services/auth';

const router = useRouter();
const $q = useQuasar();
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
    $q.notify({ type: 'positive', message: 'Password updated' });
    newPassword.value = '';
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to update password' });
  } finally {
    updatingPassword.value = false;
  }
}

async function handleLogout() {
  try {
    await AuthService.logout();
    $q.notify({ type: 'positive', message: 'Logged out' });
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
    $q.notify({ type: 'negative', message: 'Failed to load tenants' });
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
    $q.notify({ type: 'positive', message: 'Tenant created' });
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to create tenant' });
  }
};

const switchTenant = async (id: string) => {
  try {
    await PermissionService.selectTenant(id);
    $q.notify({ type: 'positive', message: 'Switched tenant' });
    // Reload to refresh context
    window.location.reload();
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to switch tenant' });
  }
};

const createRole = async () => {
  if (!newRoleName.value) return;
  try {
    await PermissionService.createRole(newRoleName.value);
    showCreateRole.value = false;
    newRoleName.value = '';
    await loadRoles();
    $q.notify({ type: 'positive', message: 'Role created' });
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to create role' });
  }
};

onMounted(() => {
  void loadCurrentUser();
  void loadTenants();
  void loadRoles();
});
</script>
