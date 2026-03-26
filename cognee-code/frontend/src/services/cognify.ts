import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface PipelineRunInfo {
  pipeline_run_id: string;
  status: string;
  [key: string]: unknown;
}

export const CognifyService = {
  async cognify(datasetId: string): Promise<PipelineRunInfo[]> {
    const response = await api.post<PipelineRunInfo[]>('/cognify', {
      dataset_ids: [datasetId],
      run_in_background: true
    });
    return response.data;
  },

  getSseUrl(pipelineRunId: string): string {
    return `http://localhost:8000/api/v1/cognify/stream/${pipelineRunId}`;
  }
};
