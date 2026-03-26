import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export type LLMProvider = 'openai' | 'ollama' | 'anthropic' | 'gemini' | 'mistral';
export type VectorDBProvider = 'lancedb' | 'chromadb' | 'pgvector';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  api_key?: string;
}

export interface VectorDBConfig {
  provider: VectorDBProvider;
  url?: string;
  api_key?: string;
}

export interface LLMConfigInput {
  provider: LLMProvider;
  model?: string;
  api_key?: string;
}

export interface VectorDBConfigInput {
  provider: VectorDBProvider;
  url?: string;
  api_key?: string;
}

export interface SystemSettings {
  llm: LLMConfig;
  vector_db: VectorDBConfig;
}

export interface SettingsPayload {
  llm?: LLMConfigInput;
  vector_db?: VectorDBConfigInput;
}

export const SettingsService = {
  async getSettings(): Promise<SystemSettings> {
    const response = await axios.get<SystemSettings>(`${API_BASE}/api/v1/settings`);
    return response.data;
  },

  async saveSettings(payload: SettingsPayload): Promise<SystemSettings> {
    const response = await axios.post<SystemSettings>(`${API_BASE}/api/v1/settings`, payload);
    return response.data;
  },
};
