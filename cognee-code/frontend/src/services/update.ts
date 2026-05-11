import axios from 'axios';


export interface UpdateResponse {
  status?: string;
  pipeline_run_id?: string;
  [key: string]: unknown;
}

export const UpdateService = {
  /**
   * Update data in a dataset
   * @param dataId - UUID of the data item to update
   * @param datasetId - UUID of the dataset
   * @param files - New files to replace the data
   * @param nodeSet - Optional node set labels
   */
  async updateData(
    dataId: string,
    datasetId: string,
    files: File[],
    nodeSet?: string[]
  ): Promise<UpdateResponse> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('data', file);
    });
    if (nodeSet && nodeSet.length > 0) {
      nodeSet.forEach((node) => {
        formData.append('node_set', node);
      });
    }

    const response = await axios.patch<UpdateResponse>(`/api/v1/update`, formData, {
      params: { data_id: dataId, dataset_id: datasetId },
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};
