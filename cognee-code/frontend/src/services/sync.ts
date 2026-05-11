import axios from 'axios';


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
    const response = await axios.post<SyncResponse>(`/api/v1/sync`, payload);
    return response.data;
  },

  /**
   * Get sync status overview
   */
  async getStatus(): Promise<SyncStatus> {
    const response = await axios.get<SyncStatus>(`/api/v1/sync/status`);
    return response.data;
  },
};
