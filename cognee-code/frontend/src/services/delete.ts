import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export type DeleteMode = 'soft' | 'hard';

export const DeleteService = {
  /**
   * Delete data from a dataset
   * @param dataId - UUID of the data item
   * @param datasetId - UUID of the dataset
   * @param mode - 'soft' (mark as deleted) or 'hard' (permanent delete)
   */
  async deleteData(dataId: string, datasetId: string, mode: DeleteMode = 'soft'): Promise<void> {
    await axios.delete(`${API_BASE}/api/v1/delete`, {
      params: { data_id: dataId, dataset_id: datasetId, mode },
    });
  },
};
