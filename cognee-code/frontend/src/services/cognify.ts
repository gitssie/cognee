import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface PipelineRunInfo {
  pipeline_run_id: string;
  status: string;
  [key: string]: unknown;
}

export interface CognifyOptions {
  chunks_per_batch?: number;
  custom_prompt?: string;
  ontology_key?: string;
}

type CognifyResponse = PipelineRunInfo[] | Record<string, PipelineRunInfo>;

function normalizeCognifyResponse(data: CognifyResponse): PipelineRunInfo[] {
  if (Array.isArray(data)) {
    return data;
  }

  return Object.values(data ?? {});
}

export const CognifyService = {
  async cognify(datasetId: string, options?: CognifyOptions): Promise<PipelineRunInfo[]> {
    const response = await api.post<CognifyResponse>('/cognify', {
      dataset_ids: [datasetId],
      run_in_background: true,
      chunks_per_batch: options?.chunks_per_batch,
      custom_prompt: options?.custom_prompt,
      ontology_key: options?.ontology_key,
    });
    return normalizeCognifyResponse(response.data);
  },
};
