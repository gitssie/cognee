import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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

// Token storage
const TOKEN_KEY = 'cognee_token';

export const AuthService = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  },

  getAuthHeaders(): Record<string, string> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  async login(credentials: LoginCredentials): Promise<string> {
    // FastAPI Users expects form data for login
    const formData = new URLSearchParams();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);

    const response = await axios.post<{ access_token: string; token_type: string }>(
      `${API_BASE}/api/v1/auth/jwt/login`,
      formData,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const token = response.data.access_token;
    this.setToken(token);
    return token;
  },

  async logout(): Promise<void> {
    try {
      await axios.post(`${API_BASE}/api/v1/auth/logout`, null, {
        headers: this.getAuthHeaders(),
      });
    } finally {
      this.clearToken();
    }
  },

  async register(data: RegisterData): Promise<User> {
    const response = await axios.post<User>(`${API_BASE}/api/v1/auth/register`, data);
    return response.data;
  },

  async getCurrentUser(): Promise<User> {
    const response = await axios.get<User>(`${API_BASE}/api/v1/users/me`, {
      headers: this.getAuthHeaders(),
    });
    return response.data;
  },

  async updateCurrentUser(data: UserUpdate): Promise<User> {
    const response = await axios.patch<User>(`${API_BASE}/api/v1/users/me`, data, {
      headers: this.getAuthHeaders(),
    });
    return response.data;
  },

  async forgotPassword(email: string): Promise<void> {
    await axios.post(`${API_BASE}/api/v1/auth/forgot-password`, { email });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await axios.post(`${API_BASE}/api/v1/auth/reset-password`, { token, password });
  },

  async verifyToken(token: string): Promise<User> {
    const response = await axios.post<User>(`${API_BASE}/api/v1/auth/verify`, { token });
    return response.data;
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },
};

// User management (admin)
export const UserService = {
  async getUser(id: string): Promise<User> {
    const response = await axios.get<User>(`${API_BASE}/api/v1/users/${id}`, {
      headers: AuthService.getAuthHeaders(),
    });
    return response.data;
  },

  async updateUser(id: string, data: UserUpdate): Promise<User> {
    const response = await axios.patch<User>(`${API_BASE}/api/v1/users/${id}`, data, {
      headers: AuthService.getAuthHeaders(),
    });
    return response.data;
  },

  async deleteUser(id: string): Promise<void> {
    await axios.delete(`${API_BASE}/api/v1/users/${id}`, {
      headers: AuthService.getAuthHeaders(),
    });
  },
};
