<template>
  <q-dialog v-model="isOpen" @show="onDialogShow">
    <q-card class="share-dialog">
      <!-- Header -->
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">
          <q-icon name="share" class="q-mr-sm" />
          Share Dataset
        </div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-separator class="q-my-md" />

      <q-card-section class="q-pt-none">
        <!-- Grant New Permission Section -->
        <div class="grant-section q-mb-lg">
          <div class="text-subtitle2 text-weight-medium q-mb-md">
            <q-icon name="person_add" class="q-mr-xs" />
            Add People
          </div>
          
          <div class="row q-col-gutter-sm items-end">
            <!-- Principal Type -->
            <div class="col-12 col-sm-3">
              <q-select
                v-model="newPrincipalType"
                :options="principalTypeOptions"
                label="Type"
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
                label="Select User"
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
                      {{ loadingUsers ? 'Loading...' : 'No users found' }}
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
                label="Select Role"
                outlined
                dense
                emit-value
                map-options
                :loading="loadingRoles"
              >
                <template v-slot:no-option>
                  <q-item>
                    <q-item-section class="text-grey">
                      {{ loadingRoles ? 'Loading...' : 'No roles available' }}
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
                label="Enter ID"
                outlined
                dense
                placeholder="UUID or identifier"
              />
            </div>

            <!-- Permission Level -->
            <div class="col-12 col-sm-2">
              <q-select
                v-model="newPermission"
                :options="permissionOptions"
                label="Access"
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
                label="Add"
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
            People with Access
          </div>

          <!-- Loading State -->
          <div v-if="loadingAcls" class="text-center q-pa-md">
            <q-spinner color="primary" size="2em" />
            <div class="text-grey q-mt-sm">Loading permissions...</div>
          </div>

          <!-- Empty State -->
          <div v-else-if="acls.length === 0" class="empty-state q-pa-lg text-center">
            <q-icon name="lock" size="48px" color="grey-4" />
            <div class="text-grey q-mt-sm">Only you have access to this dataset</div>
            <div class="text-caption text-grey-6">Add people above to share</div>
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
                    :label="acl.principal_type" 
                    class="q-mr-xs"
                  />
                </q-item-label>
              </q-item-section>

              <q-item-section side>
                <div class="row items-center q-gutter-sm">
                  <q-badge 
                    :color="getPermissionColor(acl.permission)" 
                    :label="acl.permission"
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
                    <q-tooltip>Remove access</q-tooltip>
                  </q-btn>
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-card-section>

      <!-- Footer -->
      <q-card-actions align="right" class="q-pa-md bg-grey-1">
        <q-btn flat label="Done" color="primary" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
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
  { value: 'user', label: 'User' },
  { value: 'role', label: 'Role' },
  { value: 'custom', label: 'Custom ID' },
];

const permissionOptions = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'delete', label: 'Delete' },
  { value: 'share', label: 'Share' },
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
    acls.value = await PermissionService.getDatasetPermissions(props.datasetId);
  } catch {
    $q.notify({ type: 'negative', message: 'Failed to load permissions' });
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
      message: 'Access granted successfully',
      icon: 'check_circle'
    });
    newPrincipalId.value = '';
    await loadPermissions();
  } catch {
    $q.notify({ 
      type: 'negative', 
      message: 'Failed to grant access. Please check the ID.',
      icon: 'error'
    });
  } finally {
    granting.value = false;
  }
}

function confirmRevoke(acl: ACL) {
  $q.dialog({
    title: 'Remove Access',
    message: `Remove ${acl.permission} access for this ${acl.principal_type}?`,
    persistent: true,
    ok: {
      label: 'Remove',
      color: 'negative',
      flat: true,
    },
    cancel: {
      label: 'Cancel',
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
      message: 'Access removed',
      icon: 'check_circle'
    });
    await loadPermissions();
  } catch {
    $q.notify({ 
      type: 'negative', 
      message: 'Failed to remove access',
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

function getPrincipalDisplayName(acl: ACL): string {
  // Try to find user/role by ID
  if (acl.principal_type === 'user') {
    const user = users.value.find(u => u.id === acl.principal_id);
    if (user?.email) return user.email;
  }
  if (acl.principal_type === 'role') {
    const role = roles.value.find(r => r.id === acl.principal_id);
    if (role?.name) return role.name;
  }
  // Fallback to ID (truncated)
  const id = acl.principal_id;
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

function getPermissionColor(permission: string): string {
  switch (permission) {
    case 'read': return 'green';
    case 'write': return 'orange';
    case 'delete': return 'red';
    case 'share': return 'purple';
    default: return 'grey';
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
