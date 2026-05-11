import axios from 'axios';

export type ProjectType = 'git' | 'file' | 'general';

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  opencode_project_id?: string | null;
  remote_url?: string | null;
  local_path?: string | null;
  dataset_id: string;
  owner_id: string;
  created_at: string;
}

export interface CreateProjectInput {
  name: string;
  type: ProjectType;
  opencode_project_id?: string | null;
  remote_url?: string | null;
  local_path?: string | null;
  vault_api_key?: string | null;
}

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

export const ProjectsService = {
  async getProjects(): Promise<Project[]> {
    const response = await api.get<Project[]>('/projects');
    return response.data;
  },

  async createProject(input: CreateProjectInput): Promise<Project> {
    const response = await api.post<Project>('/projects', input);
    return response.data;
  },

  async updateProject(id: string, input: Partial<CreateProjectInput>): Promise<Project> {
    const response = await api.patch<Project>(`/projects/${id}`, input);
    return response.data;
  },

  async deleteProject(id: string): Promise<void> {
    await api.delete(`/projects/${id}`);
  },
};
