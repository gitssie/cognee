import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const VisualizeService = {
  /**
   * Get visualization URL for a dataset's knowledge graph
   * Returns an HTML page that can be displayed in an iframe
   */
  getVisualizationUrl(datasetId: string): string {
    const params = new URLSearchParams({ dataset_id: datasetId });
    return `${API_BASE}/api/v1/visualize?${params.toString()}`;
  },

  /**
   * Fetch visualization HTML content directly
   */
  async getVisualizationHtml(datasetId: string): Promise<string> {
    const response = await axios.get<string>(`${API_BASE}/api/v1/visualize`, {
      params: { dataset_id: datasetId },
      responseType: 'text',
    });
    return response.data;
  },
};
