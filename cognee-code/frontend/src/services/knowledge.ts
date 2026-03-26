import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Pipeline processing status from backend
export enum PipelineRunStatus {
  DATASET_PROCESSING_INITIATED = 'DATASET_PROCESSING_INITIATED',
  DATASET_PROCESSING_STARTED = 'DATASET_PROCESSING_STARTED',
  DATASET_PROCESSING_COMPLETED = 'DATASET_PROCESSING_COMPLETED',
  DATASET_PROCESSING_ERRORED = 'DATASET_PROCESSING_ERRORED',
}

// Simplified status for UI display (directly mapped from backend PipelineRunStatus)
export enum DatasetStatus {
  PENDING = 'pending',       // No pipeline run yet, or just initiated (not actively processing)
  PROCESSING = 'processing', // Pipeline actively running
  COMPLETED = 'completed',   // Pipeline completed successfully
  ERROR = 'error',           // Pipeline failed
  EMPTY = 'empty',           // No data in dataset
}

export interface Dataset {
  id: string;
  name: string;
  owner_id: string;
  tenant_id?: string;
  created_at: string;
  updated_at: string;
}

// Extended dataset with status info for UI
export interface DatasetWithStatus extends Dataset {
  status: DatasetStatus;
  pipelineStatus?: PipelineRunStatus;
  statusUpdatedAt?: string;  // ISO timestamp of last status update
  dataCount?: number;
  processedCount?: number;
}

export interface DataItem {
  id: string;
  name: string;
  label?: string | null;
  dataset_id?: string;
  datasetId?: string;
  mime_type?: string;
  mimeType?: string;
  extension?: string;
  raw_data_location?: string;
  rawDataLocation?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  // Pipeline status for this data item: { pipeline_name: { dataset_id: status } }
  pipeline_status?: Record<string, Record<string, string>>;
  pipelineStatus?: Record<string, Record<string, string>>;
}

// Data item processing status
export enum DataItemStatus {
  COMPLETED = 'DATA_ITEM_PROCESSING_COMPLETED',
  PENDING = 'pending',  // Not processed yet
}

// Helper function to check if a data item has been processed for a specific dataset
export function getDataItemStatus(item: DataItem, datasetId?: string): DataItemStatus {
  const pipelineStatus = item.pipeline_status || item.pipelineStatus;
  if (!pipelineStatus || !datasetId) {
    return DataItemStatus.PENDING;
  }
  
  // Check specifically for cognify_pipeline completion (the main processing pipeline)
  // Fall back to checking any pipeline if cognify_pipeline doesn't exist
  const cognifyStatus = pipelineStatus['cognify_pipeline'];
  if (cognifyStatus && cognifyStatus[datasetId] === DataItemStatus.COMPLETED) {
    return DataItemStatus.COMPLETED;
  }
  
  // Also check add_pipeline as a secondary indicator
  const addStatus = pipelineStatus['add_pipeline'];
  if (addStatus && addStatus[datasetId] === DataItemStatus.COMPLETED) {
    // Only add_pipeline completed - file is added but not cognified yet
    // For now, we consider this as PENDING since cognify hasn't run
    // If you want to show "Added" status, you could add a new status here
  }
  
  return DataItemStatus.PENDING;
}

// Status response from /datasets/status endpoint
export interface DatasetStatusResponse {
  [datasetId: string]: PipelineRunStatus;
}

// Detailed status response from /datasets/status/details endpoint
export interface DatasetStatusDetailInfo {
  status: string;
  created_at: string;
  pipeline_run_id: string | null;
}

export interface DatasetStatusDetailsResponse {
  [datasetId: string]: DatasetStatusDetailInfo;
}

export const KnowledgeService = {
  // Datasets
  async getDatasets(): Promise<Dataset[]> {
    const response = await api.get<Dataset[]>('/datasets');
    return response.data;
  },

  async createDataset(name: string): Promise<Dataset> {
    const response = await api.post<Dataset>('/datasets', { name });
    return response.data;
  },

  async deleteDataset(id: string): Promise<void> {
    await api.delete(`/datasets/${id}`);
  },

  // Data
  async getData(datasetId: string): Promise<DataItem[]> {
    const response = await api.get<DataItem[]>(`/datasets/${datasetId}/data`);
    return response.data;
  },

  // Add text data using /add endpoint
  async addTextData(datasetId: string, text: string): Promise<DataItem> {
    // Create a text file from the text content
    const blob = new Blob([text], { type: 'text/plain' });
    const file = new File([blob], 'text-content.txt', { type: 'text/plain' });
    
    const formData = new FormData();
    formData.append('data', file);
    formData.append('datasetId', datasetId);
    
    const response = await api.post<DataItem>('/add', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Add URL data using /add endpoint  
  async addUrlData(datasetId: string, url: string): Promise<DataItem> {
    // Create a text file containing the URL
    const blob = new Blob([url], { type: 'text/plain' });
    const file = new File([blob], 'url.txt', { type: 'text/uri-list' });
    
    const formData = new FormData();
    formData.append('data', file);
    formData.append('datasetId', datasetId);
    
    const response = await api.post<DataItem>('/add', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Upload file using /add endpoint
  async uploadFile(datasetId: string, file: File): Promise<DataItem> {
    const formData = new FormData();
    formData.append('data', file);
    formData.append('datasetId', datasetId);
    
    const response = await api.post<DataItem>('/add', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  async deleteData(datasetId: string, dataId: string): Promise<void> {
    await api.delete(`/datasets/${datasetId}/data/${dataId}`);
  },

  // Download raw data
  async downloadRawData(datasetId: string, dataId: string): Promise<Blob> {
    const response = await api.get(`/datasets/${datasetId}/data/${dataId}/raw`, {
      responseType: 'blob',
    });
    return response.data;
  },

  // Get dataset graph
  async getDatasetGraph(datasetId: string): Promise<{ nodes: unknown[]; edges: unknown[] }> {
    const response = await api.get(`/datasets/${datasetId}/graph`);
    return response.data;
  },

  // Get processing status for datasets
  async getDatasetStatus(datasetIds: string[]): Promise<DatasetStatusResponse> {
    if (datasetIds.length === 0) {
      return {};
    }
    const params = new URLSearchParams();
    datasetIds.forEach(id => params.append('dataset', id));
    const response = await api.get<DatasetStatusResponse>(`/datasets/status?${params.toString()}`);
    return response.data;
  },

  // Get detailed processing status including timestamps for stale detection
  async getDatasetStatusDetails(datasetIds: string[]): Promise<DatasetStatusDetailsResponse> {
    if (datasetIds.length === 0) {
      return {};
    }
    const params = new URLSearchParams();
    datasetIds.forEach(id => params.append('dataset', id));
    const response = await api.get<DatasetStatusDetailsResponse>(`/datasets/status/details?${params.toString()}`);
    return response.data;
  },

  // Open SSE stream for dataset status updates (replaces polling)
  getDatasetStatusStreamUrl(datasetIds: string[]): string {
    const params = new URLSearchParams();
    datasetIds.forEach(id => params.append('dataset', id));
    return `http://localhost:8000/api/v1/datasets/status/stream?${params.toString()}`;
  },

  // Reset stale/stuck pipeline status for datasets
  async resetDatasetStatus(datasetIds: string[]): Promise<{ reset: string[]; message: string }> {
    if (datasetIds.length === 0) {
      return { reset: [], message: 'No datasets to reset' };
    }
    const params = new URLSearchParams();
    datasetIds.forEach(id => params.append('dataset', id));
    const response = await api.post<{ reset: string[]; message: string }>(`/datasets/status/reset?${params.toString()}`);
    return response.data;
  },

  // Convert pipeline status directly to UI status (no time-based guessing)
  // INITIATED is treated as PENDING since user hasn't actively started building yet
  getSimplifiedStatus(pipelineStatus?: PipelineRunStatus): DatasetStatus {
    if (!pipelineStatus) {
      return DatasetStatus.PENDING;
    }
    
    switch (pipelineStatus) {
      case PipelineRunStatus.DATASET_PROCESSING_INITIATED:
        // INITIATED means pipeline record exists but not actively processing
        // From user's perspective, they haven't clicked "Build" yet, so show as Pending
        return DatasetStatus.PENDING;
      case PipelineRunStatus.DATASET_PROCESSING_STARTED:
        return DatasetStatus.PROCESSING;
      case PipelineRunStatus.DATASET_PROCESSING_COMPLETED:
        return DatasetStatus.COMPLETED;
      case PipelineRunStatus.DATASET_PROCESSING_ERRORED:
        return DatasetStatus.ERROR;
      default:
        return DatasetStatus.PENDING;
    }
  },

  // Enrich datasets with status information (using detailed status for stale detection)
  async enrichDatasetsWithStatus(datasets: Dataset[]): Promise<DatasetWithStatus[]> {
    if (datasets.length === 0) {
      return [];
    }
    
    try {
      const statusResponse = await this.getDatasetStatusDetails(datasets.map(d => d.id));
      
      return datasets.map(dataset => {
        const statusInfo = statusResponse[dataset.id];
        const pipelineStatus = statusInfo?.status as PipelineRunStatus | undefined;
        const statusUpdatedAt = statusInfo?.created_at;
        
        const result: DatasetWithStatus = {
          ...dataset,
          status: pipelineStatus ? this.getSimplifiedStatus(pipelineStatus) : DatasetStatus.EMPTY,
        };
        if (statusUpdatedAt !== undefined) {
          result.statusUpdatedAt = statusUpdatedAt;
        }
        if (pipelineStatus !== undefined) {
          result.pipelineStatus = pipelineStatus;
        }
        return result;
      });
    } catch {
      // If status endpoint fails, return datasets with pending status
      return datasets.map(dataset => ({
        ...dataset,
        status: DatasetStatus.PENDING,
      }));
    }
  },
};
