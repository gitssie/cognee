import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// All available search types from backend
export enum SearchType {
  // Document-based search
  SUMMARIES = 'SUMMARIES',
  CHUNKS = 'CHUNKS',
  CHUNKS_LEXICAL = 'CHUNKS_LEXICAL',
  
  // Completion-based search (with LLM)
  RAG_COMPLETION = 'RAG_COMPLETION',
  GRAPH_COMPLETION = 'GRAPH_COMPLETION',
  GRAPH_SUMMARY_COMPLETION = 'GRAPH_SUMMARY_COMPLETION',
  TRIPLET_COMPLETION = 'TRIPLET_COMPLETION',
  GRAPH_COMPLETION_COT = 'GRAPH_COMPLETION_COT',
  GRAPH_COMPLETION_CONTEXT_EXTENSION = 'GRAPH_COMPLETION_CONTEXT_EXTENSION',
  
  // Graph and database search
  CYPHER = 'CYPHER',
  NATURAL_LANGUAGE = 'NATURAL_LANGUAGE',
  
  // Specialized search
  TEMPORAL = 'TEMPORAL',
  CODING_RULES = 'CODING_RULES',
  
  // Auto-selection
  FEELING_LUCKY = 'FEELING_LUCKY',
}

// Search type metadata for UI display
export const SearchTypeInfo: Record<SearchType, { label: string; description: string; category: string }> = {
  [SearchType.GRAPH_COMPLETION]: {
    label: 'Graph Completion',
    description: 'Natural language Q&A using full graph context and LLM reasoning',
    category: 'AI Completion',
  },
  [SearchType.RAG_COMPLETION]: {
    label: 'RAG Completion',
    description: 'Traditional RAG using document chunks without graph structure',
    category: 'AI Completion',
  },
  [SearchType.GRAPH_SUMMARY_COMPLETION]: {
    label: 'Graph Summary Completion',
    description: 'Graph completion with summary context',
    category: 'AI Completion',
  },
  [SearchType.TRIPLET_COMPLETION]: {
    label: 'Triplet Completion',
    description: 'Completion based on knowledge graph triplets (edges)',
    category: 'AI Completion',
  },
  [SearchType.GRAPH_COMPLETION_COT]: {
    label: 'Graph Completion (CoT)',
    description: 'Graph completion with chain-of-thought reasoning',
    category: 'AI Completion',
  },
  [SearchType.GRAPH_COMPLETION_CONTEXT_EXTENSION]: {
    label: 'Graph Completion (Extended)',
    description: 'Graph completion with extended context',
    category: 'AI Completion',
  },
  [SearchType.CHUNKS]: {
    label: 'Chunks',
    description: 'Raw text segments that match the query semantically',
    category: 'Document Search',
  },
  [SearchType.CHUNKS_LEXICAL]: {
    label: 'Chunks (Lexical)',
    description: 'Token-based lexical chunk search',
    category: 'Document Search',
  },
  [SearchType.SUMMARIES]: {
    label: 'Summaries',
    description: 'Pre-generated hierarchical summaries of content',
    category: 'Document Search',
  },
  [SearchType.CYPHER]: {
    label: 'Cypher Query',
    description: 'Direct graph database queries using Cypher syntax',
    category: 'Advanced',
  },
  [SearchType.NATURAL_LANGUAGE]: {
    label: 'Natural Language',
    description: 'Natural language query processing',
    category: 'Advanced',
  },
  [SearchType.TEMPORAL]: {
    label: 'Temporal',
    description: 'Temporal-aware search for time-based queries',
    category: 'Specialized',
  },
  [SearchType.CODING_RULES]: {
    label: 'Coding Rules',
    description: 'Code rule extraction and search',
    category: 'Specialized',
  },
  [SearchType.FEELING_LUCKY]: {
    label: 'Feeling Lucky',
    description: 'Auto-select the most appropriate search type',
    category: 'Auto',
  },
};

// Search request payload
export interface SearchPayload {
  query: string;
  search_type?: SearchType;
  datasets?: string[];        // Dataset names
  dataset_ids?: string[];     // Dataset UUIDs
  top_k?: number;
  system_prompt?: string;
  node_name?: string[];
  only_context?: boolean;
  verbose?: boolean;
}

// Search result from API - supports both wrapped and unwrapped formats
export interface SearchResult {
  // Non-verbose mode (access control enabled)
  search_result?: string | object | unknown[];
  dataset_id?: string;
  dataset_name?: string;
  dataset_tenant_id?: string;
  
  // Verbose mode fields (snake_case from backend)
  text_result?: string | string[];
  context_result?: string | string[];
  objects_result?: unknown;
}

// Raw API response can be array of results OR unwrapped value
export type SearchApiResponse = SearchResult[] | string | string[] | object;

// Search history item (API returns camelCase)
export interface SearchHistoryItem {
  id: string;
  text: string;
  user: string;
  createdAt: string;
}

// Parsed result from nested JSON
export interface ParsedSearchResult {
  resultObject?: unknown[];
  context?: string;
  completion?: unknown[];
  searchType?: string;
  datasetName?: string;
  datasetId?: string;
  datasetTenantId?: string | null;
  onlyContext?: boolean;
}

/**
 * Parse nested JSON string from search history text field
 */
function parseNestedJson(text: string): ParsedSearchResult[] {
  try {
    // The text field contains a JSON array string
    const parsed = JSON.parse(text) as ParsedSearchResult[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // If not valid JSON, return as-is wrapped in result
    return [];
  }
}

/**
 * Extract display text from completion or context
 */
function extractDisplayText(item: ParsedSearchResult): string {
  // Prefer context (clean text)
  if (item.context && typeof item.context === 'string') {
    return item.context;
  }
  
  // Try completion array
  if (item.completion && Array.isArray(item.completion)) {
    const texts = item.completion
      .map((c) => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c !== null && 'text' in c) {
          return (c as { text: string }).text;
        }
        return null;
      })
      .filter((t): t is string => t !== null);
    if (texts.length > 0) {
      return texts.join('\n\n');
    }
  }
  
  return '';
}

/**
 * Normalize API response to consistent SearchResult[] format
 */
function normalizeSearchResponse(data: SearchApiResponse): SearchResult[] {
  // If it's already an array of objects with search_result or text_result, return as-is
  if (Array.isArray(data)) {
    // Check if it's array of SearchResult objects
    if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      const firstItem = data[0] as Record<string, unknown>;
      if ('search_result' in firstItem || 'text_result' in firstItem || 'dataset_id' in firstItem) {
        return data as SearchResult[];
      }
      // Check for nested format (resultObject, context, completion)
      if ('resultObject' in firstItem || 'context' in firstItem || 'completion' in firstItem) {
        return (data as ParsedSearchResult[]).map((item): SearchResult => {
          const result: SearchResult = {
            search_result: extractDisplayText(item) || JSON.stringify(item),
          };
          if (item.datasetId) result.dataset_id = item.datasetId;
          if (item.datasetName) result.dataset_name = item.datasetName;
          if (item.context) result.context_result = item.context;
          if (item.resultObject) result.objects_result = item.resultObject;
          return result;
        });
      }
    }
    // It's an array of raw values (e.g., chunks strings) - wrap each
    return data.map((item, index) => ({
      search_result: item as string | object,
      dataset_name: `Result ${index + 1}`,
    }));
  }
  
  // Single unwrapped value (string or object)
  if (typeof data === 'string' || (typeof data === 'object' && data !== null)) {
    return [{
      search_result: data,
    }];
  }
  
  return [];
}

/**
 * Normalize search history items - parse nested JSON in text field
 */
function normalizeHistoryItems(items: SearchHistoryItem[]): SearchHistoryItem[] {
  return items.map((item) => {
    // Try to parse the text field if it looks like JSON
    if (item.text.startsWith('[') || item.text.startsWith('{')) {
      const parsed = parseNestedJson(item.text);
      if (parsed.length > 0) {
        // Extract a summary for display
        const firstResult = parsed[0];
        if (firstResult) {
          const displayText = extractDisplayText(firstResult);
          if (displayText) {
            // Truncate for display in history
            const truncated = displayText.length > 100 
              ? displayText.substring(0, 100) + '...' 
              : displayText;
            return { ...item, text: truncated };
          }
        }
      }
    }
    return item;
  });
}

export const SearchService = {
  /**
   * Perform a search with full options
   */
  async search(payload: SearchPayload): Promise<SearchResult[]> {
    const response = await api.post<SearchApiResponse>('/search', payload);
    return normalizeSearchResponse(response.data);
  },

  /**
   * Simple search with just query (backwards compatible)
   */
  async simpleSearch(query: string): Promise<SearchResult[]> {
    return this.search({ query });
  },

  /**
   * Get search history
   */
  async getHistory(): Promise<SearchHistoryItem[]> {
    const response = await api.get<SearchHistoryItem[]>('/search');
    return normalizeHistoryItems(response.data);
  },

  /**
   * Get grouped search types for UI display
   */
  getSearchTypesByCategory(): Record<string, { type: SearchType; info: typeof SearchTypeInfo[SearchType] }[]> {
    const categories: Record<string, { type: SearchType; info: typeof SearchTypeInfo[SearchType] }[]> = {};
    
    for (const [type, info] of Object.entries(SearchTypeInfo)) {
      const category = info.category;
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push({ type: type as SearchType, info });
    }
    
    return categories;
  },
};
