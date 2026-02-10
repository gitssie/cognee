import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Chat message structure
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  loading?: boolean;
}

// Search types for chat completions
export enum ChatSearchType {
  GRAPH_COMPLETION = 'GRAPH_COMPLETION',
  RAG_COMPLETION = 'RAG_COMPLETION',
  GRAPH_COMPLETION_COT = 'GRAPH_COMPLETION_COT',
}

// Chat request payload
export interface ChatRequest {
  query: string;
  search_type?: ChatSearchType;
  dataset_ids?: string[];
  top_k?: number;
  system_prompt?: string;
}

// Chat response from backend
export interface ChatResponse {
  search_result?: string;
  text_result?: string | string[];
  context_result?: string | string[];
  objects_result?: unknown;
  dataset_name?: string;
}

// History item from backend
export interface ChatHistoryItem {
  id: string;
  text: string;
  user: 'user' | 'system';
  createdAt: string | number;
}

export const ChatService = {
  /**
   * Send a chat message and get AI response
   */
  async sendMessage(request: ChatRequest): Promise<string> {
    const payload = {
      query: request.query,
      search_type: request.search_type || ChatSearchType.GRAPH_COMPLETION,
      dataset_ids: request.dataset_ids,
      top_k: request.top_k || 10,
      system_prompt: request.system_prompt,
    };

    const response = await api.post<ChatResponse[]>('/search', payload);
    
    // Extract the response text
    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      
      if (result) {
        // Priority: search_result > text_result > context_result
        if (result.search_result) {
          return typeof result.search_result === 'string' 
            ? result.search_result 
            : JSON.stringify(result.search_result);
        }
        if (result.text_result) {
          return Array.isArray(result.text_result)
            ? result.text_result.join('\n\n')
            : result.text_result;
        }
        if (result.context_result) {
          return Array.isArray(result.context_result)
            ? result.context_result.join('\n\n')
            : result.context_result;
        }
      }
    }
    
    return 'No response received from the knowledge base.';
  },

  /**
   * Get chat history
   */
  async getHistory(): Promise<ChatHistoryItem[]> {
    try {
      const response = await api.get<ChatHistoryItem[]>('/search');
      return response.data || [];
    } catch {
      return [];
    }
  },

  /**
   * Convert history items to chat messages
   */
  historyToMessages(history: ChatHistoryItem[]): ChatMessage[] {
    return history.map((item, index) => ({
      id: item.id || `msg-${index}`,
      role: item.user === 'user' ? 'user' : 'assistant',
      content: item.text,
      timestamp: new Date(
        typeof item.createdAt === 'number' ? item.createdAt : parseInt(item.createdAt, 10) || Date.now()
      ),
    }));
  },

  /**
   * Generate a unique message ID
   */
  generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },
};
