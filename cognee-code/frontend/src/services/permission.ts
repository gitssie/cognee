import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true
});

export interface Tenant {
  id: string;
  name: string;
}

export interface Role {
  id: string;
  name: string;
  tenant_id: string;
}

export interface User {
  id: string;
  email: string;
}

export interface ACL {
  id: string;
  permission: string; // 'read', 'write', etc.
  dataset_id: string;
  principal_id: string;
  principal_type: string; // 'user', 'role', 'tenant'
}

export interface CreateTenantResponse {
    message: string;
    tenant_id: string;
}

export const PermissionService = {
  // Tenant Management
  async getMyTenants(): Promise<Tenant[]> {
    const response = await api.get<Tenant[]>('/tenants');
    return response.data;
  },

  async createTenant(name: string): Promise<CreateTenantResponse> {
    const response = await api.post<CreateTenantResponse>('/permissions/tenants', null, {
        params: { tenant_name: name }
    });
    return response.data;
  },
  
  async selectTenant(tenantId: string | null): Promise<void> {
      await api.post('/permissions/tenants/select', { tenant_id: tenantId });
  },

  async getTenantUsers(tenantId: string): Promise<User[]> {
      const response = await api.get<User[]>(`/tenants/${tenantId}/users`);
      return response.data;
  },

  async addUserToTenant(userId: string, tenantId: string): Promise<void> {
       await api.post(`/permissions/users/${userId}/tenants`, null, {
           params: { tenant_id: tenantId }
       });
  },

  // Role Management
  async getRoles(): Promise<Role[]> {
    const response = await api.get<Role[]>('/roles');
    return response.data;
  },

  async createRole(name: string): Promise<void> {
    await api.post('/permissions/roles', null, {
        params: { role_name: name }
    });
  },

  async addUserToRole(userId: string, roleId: string): Promise<void> {
      await api.post(`/permissions/users/${userId}/roles`, null, {
           params: { role_id: roleId }
       });
  },

  // Dataset Permissions
  async getDatasetPermissions(datasetId: string): Promise<ACL[]> {
    const response = await api.get<ACL[]>(`/datasets/${datasetId}/permissions`);
    return response.data;
  },

  async grantPermission(datasetId: string, principalId: string, permissionName: string): Promise<void> {
      const params = new URLSearchParams();
      params.append('permission_name', permissionName);
      params.append('dataset_ids', datasetId); 
      
      await api.post(`/permissions/datasets/${principalId}?${params.toString()}`);
  },

  async revokePermission(aclId: string): Promise<void> {
      await api.delete(`/permissions/${aclId}`);
  }
};
