import axios from 'axios';
import { AuthService } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface MemifyPayload {
  data?: string;
  dataset_name?: string;
  dataset_id?: string;
  node_name?: string;
  extraction_tasks?: string[];
  enrichment_tasks?: string[];
  run_in_background?: boolean;
}

export interface MemifyResponse {
  pipeline_run_id?: string;
  status?: string;
  [key: string]: unknown;
}

export const MemifyService = {
  /**
   * Run memory enhancement pipeline
   * Memify is similar to Cognify but focuses on memory/extraction tasks
   */
  async memify(payload: MemifyPayload): Promise<MemifyResponse> {
    const response = await axios.post<MemifyResponse>(`${API_BASE}/api/v1/memify`, payload, {
      headers: AuthService.getAuthHeaders(),
    });
    return response.data;
  },
};
