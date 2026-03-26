import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

export interface Rule {
  id: string;
  text: string;
}

export const RulesService = {
  async getRules(projectId?: string): Promise<Rule[]> {
    const params: Record<string, string> = {};
    if (projectId) params['project_id'] = projectId;
    const response = await api.get<Rule[]>('/rules', { params });
    return response.data;
  },

  async addRule(text: string, projectId?: string): Promise<void> {
    const body: Record<string, string> = { text };
    if (projectId) body['project_id'] = projectId;
    await api.post('/rules', body);
  },

  async deleteRule(ruleId: string, projectId?: string): Promise<void> {
    const params: Record<string, string> = {};
    if (projectId) params['project_id'] = projectId;
    await api.delete(`/rules/${ruleId}`, { params });
  },
};
