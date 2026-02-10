import axios from 'axios';
import { AuthService } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const VisualizeService = {
  /**
   * Get visualization URL for a dataset's knowledge graph
   * Returns an HTML page that can be displayed in an iframe
   */
  getVisualizationUrl(datasetId: string): string {
    const token = AuthService.getToken();
    const params = new URLSearchParams({ dataset_id: datasetId });
    if (token) {
      params.append('token', token);
    }
    return `${API_BASE}/api/v1/visualize?${params.toString()}`;
  },

  /**
   * Fetch visualization HTML content directly
   */
  async getVisualizationHtml(datasetId: string): Promise<string> {
    const response = await axios.get<string>(`${API_BASE}/api/v1/visualize`, {
      params: { dataset_id: datasetId },
      headers: AuthService.getAuthHeaders(),
      responseType: 'text',
    });
    return response.data;
  },
};
