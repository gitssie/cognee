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

export interface CognifyOptions {
  chunkSize?: number;
  chunkOverlapRatio?: number;
  maxTextLength?: number;
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
      chunk_size: options?.chunkSize,
      chunk_overlap_ratio: options?.chunkOverlapRatio,
      max_text_length: options?.maxTextLength,
    });
    return normalizeCognifyResponse(response.data);
  },

  getSseUrl(pipelineRunId: string): string {
    return `http://localhost:8000/api/v1/cognify/stream/${pipelineRunId}`;
  }
};
