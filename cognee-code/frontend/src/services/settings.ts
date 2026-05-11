
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

/**
 * Settings service.
 *
 * Current backend only exposes /api/v1/config (vector_db_provider).
 * LLM and other settings are not configurable via API yet.
 */
export const SettingsService = {
  getSettings(): SystemSettings {
    // Placeholder: backend /api/v1/settings does not exist yet
    return {
      llm: { provider: 'openai', model: 'unknown' },
      vector_db: { provider: 'lancedb' },
    };
  },

  saveSettings(payload: SettingsPayload): never {
    void payload;
    throw new Error('Settings save not yet implemented');
  },
};
