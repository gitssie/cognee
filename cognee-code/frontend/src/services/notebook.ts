import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface NotebookCell {
  id: string;
  type: 'markdown' | 'code';
  name: string;
  content: string;
}

export interface Notebook {
  id: string;
  owner_id: string;
  name: string;
  cells: NotebookCell[];
  created_at: string;
}

export const NotebookService = {
  async getNotebooks(): Promise<Notebook[]> {
    const response = await api.get<Notebook[]>('/notebooks');
    return response.data;
  },

  async createNotebook(name: string): Promise<Notebook> {
    const response = await api.post<Notebook>('/notebooks', { name, cells: [] });
    return response.data;
  },

  async updateNotebook(id: string, name: string, cells: NotebookCell[]): Promise<Notebook> {
    const response = await api.put<Notebook>(`/notebooks/${id}`, { name, cells });
    return response.data;
  },

  async deleteNotebook(id: string): Promise<void> {
    await api.delete(`/notebooks/${id}`);
  },

  async runCell(notebookId: string, cellId: string, content: string): Promise<{ result: unknown; error: unknown }> {
    const response = await api.post<{ result: unknown; error: unknown }>(`/notebooks/${notebookId}/${cellId}/run`, { content });
    return response.data;
  }
};
