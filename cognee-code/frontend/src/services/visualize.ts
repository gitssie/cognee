import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  weight: number;
}

export interface DatasetGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const VisualizeService = {
  async getDatasetGraph(datasetId: string): Promise<DatasetGraphResponse> {
    const response = await axios.get<DatasetGraphResponse>(`${API_BASE}/api/v1/datasets/${datasetId}/graph`);
    return response.data;
  },
};
