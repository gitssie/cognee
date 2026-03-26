import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export type CogneeModel = 'cognee-v1';

export interface ToolFunction {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface FunctionCall {
  name: string;
  arguments: string;
}

export interface ResponseToolCall {
  id: string;
  type: string;
  function: FunctionCall;
  output?: {
    status: string;
    data?: unknown;
  };
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ResponseRequest {
  model: CogneeModel;
  input: string;
  tools?: ToolFunction[];
  tool_choice?: string;
  user?: string;
  temperature?: number;
  max_completion_tokens?: number;
}

export interface ResponseBody {
  id: string;
  created: number;
  model: string;
  object: string;
  status: string;
  tool_calls: ResponseToolCall[];
  usage?: ChatUsage;
  metadata?: Record<string, unknown>;
}

export const ResponsesService = {
  /**
   * OpenAI-compatible responses endpoint with function calling support
   */
  async createResponse(request: ResponseRequest): Promise<ResponseBody> {
    const response = await axios.post<ResponseBody>(`${API_BASE}/api/v1/responses/`, request);
    return response.data;
  },

  /**
   * Simple chat completion without tools
   */
  async chat(input: string, options?: { temperature?: number; maxTokens?: number }): Promise<ResponseBody> {
    const request: ResponseRequest = {
      model: 'cognee-v1',
      input,
    };
    if (options?.temperature !== undefined) {
      request.temperature = options.temperature;
    }
    if (options?.maxTokens !== undefined) {
      request.max_completion_tokens = options.maxTokens;
    }
    return this.createResponse(request);
  },
};
