import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface OntologyMetadata {
  ontology_key: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  description?: string;
}

export const OntologyService = {
  async getOntologies(): Promise<Record<string, OntologyMetadata>> {
    const response = await api.get<Record<string, OntologyMetadata>>('/ontologies');
    return response.data;
  },

  async uploadOntology(key: string, file: File, description?: string): Promise<OntologyMetadata> {
    const formData = new FormData();
    formData.append('ontology_key', key);
    formData.append('ontology_file', file);
    if (description) {
      formData.append('description', description);
    }
    const response = await api.post<{ uploaded_ontologies: OntologyMetadata[] }>('/ontologies', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    const result = response.data.uploaded_ontologies[0];
    if (!result) {
        throw new Error("Upload failed: No metadata returned");
    }
    return result;
  },

  async deleteOntology(key: string): Promise<void> {
    await api.delete(`/ontologies/${key}`);
  },

  async getOntologyContent(key: string): Promise<string> {
    const response = await api.get<{ ontology_key: string; content: string }>(`/ontologies/${key}/content`);
    return response.data.content;
  },
};
