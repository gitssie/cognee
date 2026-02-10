import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const RulesService = {
  async getRules(nodeset: string = 'coding_agent_rules'): Promise<string[]> {
    const response = await api.get<string[]>('/rules', { params: { nodeset } });
    return response.data;
  },

  async addRule(text: string, nodeset: string = 'coding_agent_rules'): Promise<void> {
    await api.post('/rules', { text, nodeset });
  },
};
