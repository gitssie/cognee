<template>
  <q-dialog v-model="isOpen" @show="onDialogShow">
    <q-card class="share-dialog">
      <!-- Header -->
      <q-toolbar>
        <q-icon name="share" class="q-mr-sm" />
        <q-toolbar-title>{{ t('shareDialog.title') }}</q-toolbar-title>
        <q-btn icon="close" flat round dense v-close-popup />
      </q-toolbar>

      <q-separator class="q-my-md" />

      <q-card-section class="q-pt-none">
        <!-- Grant New Permission Section -->
        <div class="grant-section q-mb-lg">
          <div class="text-subtitle2 text-weight-medium q-mb-md">
            <q-icon name="person_add" class="q-mr-xs" />
            {{ t('shareDialog.addPeople') }}
          </div>
          
          <div class="row q-col-gutter-sm items-end">
            <!-- Principal Type -->
            <div class="col-12 col-sm-3">
              <q-select
                v-model="newPrincipalType"
                :options="principalTypeOptions"
                :label="t('shareDialog.type')"
                outlined
                dense
                emit-value
                map-options
              />
            </div>

            <!-- Principal Selection -->
            <div class="col-12 col-sm-5">
              <q-select
                v-if="newPrincipalType === 'user'"
                v-model="newPrincipalId"
                :options="userOptions"
                :label="t('shareDialog.selectUser')"
                outlined
                dense
                emit-value
                map-options
                use-input
                input-debounce="300"
                :loading="loadingUsers"
                @filter="filterUsers"
              >
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="text-grey">
                      {{ loadingUsers ? t('shared.loading') : t('shareDialog.noUsersFound') }}
                    </q-item-section>
                  </q-item>
                </template>
                <template v-slot:option="scope">
                  <q-item v-bind="scope.itemProps">
                    <q-item-section avatar>
                      <q-avatar color="primary" text-color="white" size="sm">
                        {{ getInitials(scope.opt.label) }}
                      </q-avatar>
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ scope.opt.label }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>

              <q-select
                v-else-if="newPrincipalType === 'role'"
                v-model="newPrincipalId"
                :options="roleOptions"
                :label="t('shareDialog.selectRole')"
                outlined
                dense
                emit-value
                map-options
                :loading="loadingRoles"
              >
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="text-grey">
                      {{ loadingRoles ? t('shared.loading') : t('shareDialog.noRolesAvailable') }}
                    </q-item-section>
                  </q-item>
                </template>
                <template v-slot:option="scope">
                  <q-item v-bind="scope.itemProps">
                    <q-item-section avatar>
                      <q-icon name="group" color="accent" />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ scope.opt.label }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>

              <q-input
                v-else
                v-model="newPrincipalId"
                :label="t('shareDialog.enterId')"
                outlined
                dense
                :placeholder="t('shareDialog.idPlaceholder')"
              />
            </div>

            <!-- Permission Level -->
            <div class="col-12 col-sm-2">
              <q-select
                v-model="newPermission"
                :options="permissionOptions"
                :label="t('shareDialog.access')"
                outlined
                dense
                emit-value
                map-options
              />
            </div>

            <!-- Add Button -->
            <div class="col-12 col-sm-2">
              <q-btn
                color="primary"
                icon="add"
                :label="t('shareDialog.add')"
                unelevated
                class="full-width"
                :disable="!canGrant"
                :loading="granting"
                @click="grant"
              />
            </div>
          </div>
        </div>

        <!-- Current Permissions Section -->
        <div class="permissions-section">
          <div class="text-subtitle2 text-weight-medium q-mb-md">
            <q-icon name="people" class="q-mr-xs" />
            {{ t('shareDialog.peopleWithAccess') }}
          </div>

          <!-- Loading State -->
          <div v-if="loadingAcls" class="text-center q-pa-md">
            <q-spinner color="primary" size="2em" />
            <div class="text-grey q-mt-sm">{{ t('shareDialog.loadingPermissions') }}</div>
          </div>

          <!-- Empty State -->
          <div v-else-if="acls.length === 0" class="empty-state q-pa-lg text-center">
            <q-icon name="lock" size="48px" color="grey-4" />
            <div class="text-grey q-mt-sm">{{ t('shareDialog.onlyYou') }}</div>
            <div class="text-caption text-grey-6">{{ t('shareDialog.addPeopleAbove') }}</div>
          </div>

          <!-- Permissions List -->
          <q-list v-else separator class="permissions-list">
            <q-item v-for="acl in acls" :key="acl.id" class="permission-item">
              <q-item-section avatar>
                <q-avatar 
                  :color="getPrincipalColor(acl.principal_type)" 
                  text-color="white" 
                  size="40px"
                >
                  <q-icon v-if="acl.principal_type === 'role'" name="group" />
                  <q-icon v-else-if="acl.principal_type === 'tenant'" name="business" />
                  <span v-else>{{ getInitials(acl.principal_id) }}</span>
                </q-avatar>
              </q-item-section>

              <q-item-section>
                <q-item-label class="text-weight-medium">
                  {{ getPrincipalDisplayName(acl) }}
                </q-item-label>
                <q-item-label caption>
                    <q-badge 
                      :color="getPrincipalTypeColor(acl.principal_type)" 
                      :label="getPrincipalTypeLabel(acl.principal_type)" 
                      class="q-mr-xs"
                    />
                </q-item-label>
              </q-item-section>

              <q-item-section side>
                <div class="row items-center q-gutter-sm">
                    <q-badge 
                      :color="getPermissionColor(acl.permission)" 
                      :label="getPermissionLabel(acl.permission)"
                      class="permission-badge"
                    />
                  <q-btn
                    flat
                    round
                    dense
                    icon="delete"
                    color="negative"
                    size="sm"
                    @click="confirmRevoke(acl)"
                  >
                    <q-tooltip>{{ t('shareDialog.removeAccess') }}</q-tooltip>
                  </q-btn>
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-card-section>

      <!-- Footer -->
      <q-card-actions align="right" class="q-pa-md bg-grey-1">
        <q-btn flat :label="t('shared.done')" color="primary" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { PermissionService } from 'src/services/permission';
import type { ACL, User, Role } from 'src/services/permission';

interface Props {
  modelValue: boolean;
  datasetId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const $q = useQuasar();
const { t } = useI18n();

// State
const acls = ref<ACL[]>([]);
const users = ref<User[]>([]);
const roles = ref<Role[]>([]);
const filteredUsers = ref<User[]>([]);

const newPrincipalType = ref<'user' | 'role' | 'custom'>('user');
const newPrincipalId = ref('');
const newPermission = ref('read');

const loadingAcls = ref(false);
const loadingUsers = ref(false);
const loadingRoles = ref(false);
const granting = ref(false);

// Computed
const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const canGrant = computed(() => {
  return newPrincipalId.value && newPermission.value;
});

const principalTypeOptions = [
  { value: 'user', label: t('shareDialog.user') },
  { value: 'role', label: t('shareDialog.role') },
  { value: 'custom', label: t('shareDialog.customId') },
];

const permissionOptions = [
  { value: 'read', label: t('shareDialog.read') },
  { value: 'write', label: t('shareDialog.write') },
  { value: 'delete', label: t('shareDialog.delete') },
  { value: 'share', label: t('shareDialog.share') },
];

const userOptions = computed(() => {
  return filteredUsers.value.map(u => ({
    value: u.id,
    label: u.email || u.id,
  }));
});

const roleOptions = computed(() => {
  return roles.value.map(r => ({
    value: r.id,
    label: r.name,
  }));
});

// Watch principal type change
watch(newPrincipalType, () => {
  newPrincipalId.value = '';
});

// Methods
function onDialogShow() {
  void loadPermissions();
  void loadRoles();
}

async function loadPermissions() {
  if (!props.datasetId) return;
  loadingAcls.value = true;
  try {
    acls.value = (await PermissionService.getDatasetPermissions(props.datasetId)).map(normalizeAcl);
  } catch {
    $q.notify({ type: 'negative', message: t('shareDialog.failedLoadPermissions') });
  } finally {
    loadingAcls.value = false;
  }
}

async function loadRoles() {
  loadingRoles.value = true;
  try {
    roles.value = await PermissionService.getRoles();
  } catch {
    // Roles may not be available
  } finally {
    loadingRoles.value = false;
  }
}

function filterUsers(
  val: string, 
  update: (fn: () => void) => void,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _abort: () => void
) {
  if (val.length < 2) {
    update(() => {
      filteredUsers.value = users.value;
    });
    return;
  }

  update(() => {
    const needle = val.toLowerCase();
    filteredUsers.value = users.value.filter(
      u => u.email?.toLowerCase().includes(needle) || u.id.toLowerCase().includes(needle)
    );
  });
}

async function grant() {
  if (!canGrant.value) return;
  
  granting.value = true;
  try {
    await PermissionService.grantPermission(
      props.datasetId, 
      newPrincipalId.value, 
      newPermission.value
    );
    $q.notify({ 
      type: 'positive', 
      message: t('shareDialog.accessGranted'),
      icon: 'check_circle'
    });
    newPrincipalId.value = '';
    await loadPermissions();
  } catch {
    $q.notify({ 
      type: 'negative', 
      message: t('shareDialog.failedGrant'),
      icon: 'error'
    });
  } finally {
    granting.value = false;
  }
}

function confirmRevoke(acl: ACL) {
  $q.dialog({
    title: t('shareDialog.removeAccessTitle'),
    message: t('shareDialog.removeAccessConfirm', { permission: acl.permission, type: acl.principal_type }),
    persistent: true,
    ok: {
      label: t('shared.remove'),
      color: 'negative',
      flat: true,
    },
    cancel: {
      label: t('common.cancel'),
      flat: true,
    },
  }).onOk(() => {
    void revoke(acl.id);
  });
}

async function revoke(aclId: string) {
  try {
    await PermissionService.revokePermission(aclId);
    $q.notify({ 
      type: 'positive', 
      message: t('shareDialog.accessRemoved'),
      icon: 'check_circle'
    });
    await loadPermissions();
  } catch {
    $q.notify({ 
      type: 'negative', 
      message: t('shareDialog.failedRemoveAccess'),
      icon: 'error'
    });
  }
}

function getInitials(str: string): string {
  if (!str) return '?';
  const parts = str.split(/[@.\s]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    const first = parts[0][0] ?? '';
    const second = parts[1][0] ?? '';
    return (first + second).toUpperCase();
  }
  return str.substring(0, 2).toUpperCase();
}

function normalizeAcl(acl: ACL): ACL {
  return {
    ...acl,
    principal_id: typeof acl.principal_id === 'string' ? acl.principal_id : '',
    principal_type: typeof acl.principal_type === 'string' ? acl.principal_type : 'custom',
    permission: typeof acl.permission === 'string' ? acl.permission : '',
  };
}

function getPrincipalDisplayName(acl: ACL): string {
  const id = typeof acl.principal_id === 'string' ? acl.principal_id : '';

  // Try to find user/role by ID
  if (acl.principal_type === 'user') {
    const user = users.value.find(u => u.id === id);
    if (user?.email) return user.email;
  }
  if (acl.principal_type === 'role') {
    const role = roles.value.find(r => r.id === id);
    if (role?.name) return role.name;
  }
  // Fallback to ID (truncated)
  if (!id) return t('shareDialog.customId');
  if (id.length > 20) {
    return id.substring(0, 8) + '...' + id.substring(id.length - 4);
  }
  return id;
}

function getPrincipalColor(type: string): string {
  switch (type) {
    case 'user': return 'primary';
    case 'role': return 'accent';
    case 'tenant': return 'secondary';
    default: return 'grey';
  }
}

function getPrincipalTypeColor(type: string): string {
  switch (type) {
    case 'user': return 'blue-2';
    case 'role': return 'purple-2';
    case 'tenant': return 'teal-2';
    default: return 'grey-4';
  }
}

function getPrincipalTypeLabel(type: string): string {
  switch (type) {
    case 'user': return t('shareDialog.user');
    case 'role': return t('shareDialog.role');
    case 'custom': return t('shareDialog.customId');
    default: return type;
  }
}

function getPermissionColor(permission: string): string {
  switch (permission) {
    case 'read': return 'green';
    case 'write': return 'orange';
    case 'delete': return 'red';
    case 'share': return 'purple';
    default: return 'grey';
  }
}

function getPermissionLabel(permission: string): string {
  switch (permission) {
    case 'read': return t('shareDialog.read');
    case 'write': return t('shareDialog.write');
    case 'delete': return t('shareDialog.delete');
    case 'share': return t('shareDialog.share');
    default: return permission;
  }
}
</script>

<style lang="scss" scoped>
.share-dialog {
  min-width: 550px;
  max-width: 650px;
  width: 100%;
}

.grant-section {
  background: $grey-1;
  border-radius: 8px;
  padding: 16px;
}

.permissions-list {
  border: 1px solid $grey-3;
  border-radius: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.permission-item {
  transition: background-color 0.2s;
  
  &:hover {
    background-color: $grey-1;
  }
}

.permission-badge {
  min-width: 50px;
  text-transform: capitalize;
}

.empty-state {
  background: $grey-1;
  border-radius: 8px;
  border: 1px dashed $grey-4;
}

@media (max-width: 600px) {
  .share-dialog {
    min-width: 100%;
  }
}
</style>
