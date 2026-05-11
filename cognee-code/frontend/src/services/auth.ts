import axios from 'axios';


export interface User {
  id: string;
  email: string;
  is_verified: boolean;
  is_active: boolean;
  is_superuser: boolean;
  tenant_id?: string;
}

export interface LoginCredentials {
  username: string; // email
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
}

export interface UserUpdate {
  email?: string;
  password?: string;
  is_active?: boolean;
  is_superuser?: boolean;
  is_verified?: boolean;
}

/**
 * Authentication service.
 *
 * The backend uses FastAPI-Users with CookieTransport: login returns a
 * `Set-Cookie: auth_token=...` header. The browser stores and re-sends
 * the cookie automatically; axios sends it on every request because
 * `axios.defaults.withCredentials = true` is set in boot/axios.ts.
 */
export const AuthService = {
  async login(credentials: LoginCredentials, timeout?: number): Promise<void> {
    const formData = new URLSearchParams();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);

    await axios.post(
      `/api/v1/auth/login`,
      formData,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, ...(timeout !== undefined && { timeout }) },
    );
  },

  async logout(): Promise<void> {
    await axios.post(`/api/v1/auth/logout`);
  },

  async register(data: RegisterData): Promise<User> {
    const response = await axios.post<User>(`/api/v1/auth/register`, data);
    return response.data;
  },

  async getCurrentUser(): Promise<User> {
    const response = await axios.get<User>(`/api/v1/users/me`);
    return response.data;
  },

  async updateCurrentUser(data: UserUpdate): Promise<User> {
    const response = await axios.patch<User>(`/api/v1/users/me`, data);
    return response.data;
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    // FastAPI-Users exposes PATCH /api/v1/users/me with password change
    await axios.patch('/api/v1/users/me', {
      password: newPassword,
      old_password: oldPassword,
    });
  },

  async forgotPassword(email: string): Promise<void> {
    await axios.post(`/api/v1/auth/forgot-password`, { email });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await axios.post(`/api/v1/auth/reset-password`, { token, password });
  },

  async verifyToken(token: string): Promise<User> {
    const response = await axios.post<User>(`/api/v1/auth/verify`, { token });
    return response.data;
  },
};

// User management (admin)
export const UserService = {
  async getUser(id: string): Promise<User> {
    const response = await axios.get<User>(`/api/v1/users/${id}`);
    return response.data;
  },

  async updateUser(id: string, data: UserUpdate): Promise<User> {
    const response = await axios.patch<User>(`/api/v1/users/${id}`, data);
    return response.data;
  },

  async deleteUser(id: string): Promise<void> {
    await axios.delete(`/api/v1/users/${id}`);
  },
};
