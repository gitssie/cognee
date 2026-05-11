import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface SearchPayload {
  query: string;
  datasets?: string[];
  dataset_ids?: string[];
  top_k?: number;
  verbose?: boolean;
  recall_mode?: 'balanced' | 'semantic' | 'recent' | 'deep';
  threshold?: number;
}

export interface SearchResult {
  search_result?: string | object | unknown[];
  dataset_id?: string;
  dataset_name?: string;
  dataset_tenant_id?: string;
  text_result?: string | string[];
  context_result?: string | string[];
  objects_result?: unknown;
}

export type SearchApiResponse = SearchResult[] | string | string[] | object;

export interface SearchHistoryItem {
  id: string;
  text: string;
  user: string;
  createdAt: string;
}

export interface ParsedSearchResult {
  resultObject?: unknown[];
  context?: string;
  completion?: unknown[];
  datasetName?: string;
  datasetId?: string;
  datasetTenantId?: string | null;
}

function parseNestedJson(text: string): ParsedSearchResult[] {
  try {
    const parsed = JSON.parse(text) as ParsedSearchResult[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function extractDisplayText(item: ParsedSearchResult): string {
  if (item.context && typeof item.context === 'string') {
    return item.context;
  }

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

function normalizeSearchResponse(data: SearchApiResponse): SearchResult[] {
  if (Array.isArray(data)) {
    if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      const firstItem = data[0] as Record<string, unknown>;
      if ('search_result' in firstItem || 'text_result' in firstItem || 'dataset_id' in firstItem) {
        return data as SearchResult[];
      }
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

    return data.map((item, index) => ({
      search_result: item as string | object,
      dataset_name: `Result ${index + 1}`,
    }));
  }

  if (typeof data === 'string' || (typeof data === 'object' && data !== null)) {
    return [{
      search_result: data,
    }];
  }

  return [];
}

function normalizeHistoryItems(items: SearchHistoryItem[]): SearchHistoryItem[] {
  return items.map((item) => {
    if (item.text.startsWith('[') || item.text.startsWith('{')) {
      const parsed = parseNestedJson(item.text);
      if (parsed.length > 0) {
        const firstResult = parsed[0];
        if (firstResult) {
          const displayText = extractDisplayText(firstResult);
          if (displayText) {
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
  async search(payload: SearchPayload): Promise<SearchResult[]> {
    const response = await api.post<SearchApiResponse>('/search', payload);
    return normalizeSearchResponse(response.data);
  },

  async simpleSearch(query: string): Promise<SearchResult[]> {
    return this.search({ query });
  },

  async getHistory(): Promise<SearchHistoryItem[]> {
    const response = await api.get<SearchHistoryItem[]>('/search');
    return normalizeHistoryItems(response.data);
  },
};
