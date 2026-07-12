import { request } from "../request";

export interface WikiPage {
  path: string;
  name: string;
  page_type: string;
  source_doc_ids: string[];
  source_case_ids: string[];
  updated_at: string;
}

export interface WikiPageListResponse {
  pages: WikiPage[];
  total: number;
}

export interface WikiPageContentResponse {
  path: string;
  content: string;
}

export interface IngestResult {
  ingested: string[];
  skipped: string[];
  errors: string[];
  total_pages: number;
}

export interface LintResult {
  issues: { path: string; issue: string }[];
  fixed: string[];
  total_pages: number;
}

export interface FutureResult {
  results: {
    page_path: string;
    qa_count: number;
    qa: { question: string; answer: string; tags: string[] }[];
  }[];
  errors: string[];
  total_qa: number;
}

export const wikiApi = {
  ingest: (params?: {
    doc_ids?: string[];
    case_ids?: string[];
    page_type?: string;
    force?: boolean;
  }) =>
    request<IngestResult>("/wiki/ingest", {
      method: "POST",
      body: JSON.stringify(params || {}),
    }),

  listPages: (params?: {
    keyword?: string;
    page_type?: string;
    source_doc_id?: string;
    source_case_id?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.keyword) qs.set("keyword", params.keyword);
    if (params?.page_type) qs.set("page_type", params.page_type);
    if (params?.source_doc_id) qs.set("source_doc_id", params.source_doc_id);
    if (params?.source_case_id) qs.set("source_case_id", params.source_case_id);
    const query = qs.toString();
    return request<WikiPageListResponse>(`/wiki/pages${query ? `?${query}` : ""}`);
  },

  readPage: (pagePath: string) =>
    request<WikiPageContentResponse>(`/wiki/pages/${encodeURIComponent(pagePath)}`),

  writePage: (pagePath: string, content: string) =>
    request<WikiPageContentResponse>(`/wiki/pages/${encodeURIComponent(pagePath)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  lint: (fix: boolean = false) =>
    request<LintResult>("/wiki/lint", {
      method: "POST",
      body: JSON.stringify({ fix }),
    }),

  future: (params?: { doc_ids?: string[]; page_paths?: string[] }) =>
    request<FutureResult>("/wiki/future", {
      method: "POST",
      body: JSON.stringify(params || {}),
    }),
};