import axios from 'axios';
import { AuthService } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface SyncRequest {
  dataset_ids?: string[];
}

export interface SyncResponse {
  run_id: string;
  status: string;
  dataset_ids: string[];
  dataset_names: string[];
  message: string;
  timestamp: string;
  user_id: string;
}

export interface SyncStatus {
  status: string;
  last_sync?: string;
  pending_datasets?: number;
  [key: string]: unknown;
}

export const SyncService = {
  /**
   * Sync local data to cloud
   * @param datasetIds - Optional list of dataset IDs to sync. If empty, syncs all.
   */
  async sync(datasetIds?: string[]): Promise<SyncResponse> {
    const payload: SyncRequest = {};
    if (datasetIds && datasetIds.length > 0) {
      payload.dataset_ids = datasetIds;
    }
    const response = await axios.post<SyncResponse>(`${API_BASE}/api/v1/sync`, payload, {
      headers: AuthService.getAuthHeaders(),
    });
    return response.data;
  },

  /**
   * Get sync status overview
   */
  async getStatus(): Promise<SyncStatus> {
    const response = await axios.get<SyncStatus>(`${API_BASE}/api/v1/sync/status`, {
      headers: AuthService.getAuthHeaders(),
    });
    return response.data;
  },
};
