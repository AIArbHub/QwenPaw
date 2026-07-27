import { request } from "../request";

// ── Types ────────────────────────────────────────────────────────────────

export interface KnowledgeDocumentSummary {
  id: string;
  title: string;
  tags: string[];
  source_path: string;
  chunk_count: number;
  status: string;
}

export interface KnowledgeChunk {
  id: string;
  document_id: string;
  content: string;
  index: number;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentSummary {
  content_hash: string;
  chunks: KnowledgeChunk[];
  okf_concepts?: OKFConcept[];
}

export interface OKFConcept {
  concept_id: string;
  concept_type: string;
  title: string;
  description: string;
  content_md: string;
  frontmatter: Record<string, unknown>;
  links: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  source_refs: Array<Record<string, unknown>>;
  document_id: string;
}

export interface IngestRequest {
  file_path: string;
  title?: string;
  tags?: string[];
  chunk_size?: number;
  chunk_overlap?: number;
}

export interface IngestTextRequest {
  text: string;
  title?: string;
  tags?: string[];
  chunk_size?: number;
  chunk_overlap?: number;
  agent_id?: string;
}

export interface IngestResponse {
  success: boolean;
  document_id: string;
  chunk_count: number;
  title: string;
  format?: string;
  okf_concept_count?: number;
}

export interface SearchResultItem {
  document_id: string;
  document_title: string;
  chunk_content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SearchConceptResult {
  concept: OKFConcept;
  score: number;
}

export interface Citation {
  label: string;
  kind: string;
  title: string;
  excerpt: string;
  summary?: string;
  source: {
    doc_id: string;
    section_id: string;
    concept_id?: string;
  };
}

export interface TraceStep {
  phase: string;
  hit_count?: number;
  candidate_count?: number;
  result_count?: number;
  selected?: string[];
  message?: string;
}

export interface SearchResponse {
  chunks: SearchResultItem[];
  concepts: SearchConceptResult[];
  citations: Citation[];
  trace?: TraceStep[];
}

export interface DiscoverySuggestion {
  suggestion_id: string;
  suggestion_type: string; // sop / tool / knowledge_gap
  title: string;
  description: string;
  content: string;
  confidence: number;
  status: string; // pending / accepted / rejected
  document_id: string;
  created_at: string;
}

export interface SearchRequest {
  query: string;
  top_k?: number;
  knowledge_scope?: string;
  filter_tags?: string[];
  agent_id?: string;
}

// ── API ──────────────────────────────────────────────────────────────────

export const kbApi = {
  ingest: (data: IngestRequest) =>
    request<IngestResponse>("/kb/ingest", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  ingestText: (data: IngestTextRequest) =>
    request<IngestResponse>("/kb/ingest-text", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  search: (data: SearchRequest) =>
    request<SearchResponse>("/kb/search", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listDocuments: () =>
    request<{ documents: KnowledgeDocumentSummary[] }>("/kb/documents"),

  getDocument: (docId: string) =>
    request<KnowledgeDocumentDetail>(
      `/kb/documents/${encodeURIComponent(docId)}`,
    ),

  deleteDocument: (docId: string) =>
    request<{ success: boolean }>(
      `/kb/documents/${encodeURIComponent(docId)}`,
      { method: "DELETE" },
    ),

  listOkfConcepts: (docId?: string) => {
    const qs = docId ? `?doc_id=${encodeURIComponent(docId)}` : "";
    return request<{ concepts: OKFConcept[] }>(`/kb/okf/concepts${qs}`);
  },

  lintOkf: (docId?: string) => {
    const qs = docId ? `?doc_id=${encodeURIComponent(docId)}` : "";
    return request<{ issues: Array<Record<string, string>> }>(
      `/kb/okf/lint${qs}`,
    );
  },

  // ── 知识自发现 ──

  listDiscoverySuggestions: (status?: string, docId?: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (docId) params.set("doc_id", docId);
    const qs = params.toString();
    return request<{ suggestions: DiscoverySuggestion[] }>(
      `/kb/discovery/suggestions${qs ? `?${qs}` : ""}`,
    );
  },

  acceptSuggestion: (suggestionId: string) =>
    request<{ success: boolean; status: string }>(
      `/kb/discovery/suggestions/${encodeURIComponent(suggestionId)}/accept`,
      { method: "POST" },
    ),

  rejectSuggestion: (suggestionId: string) =>
    request<{ success: boolean; status: string }>(
      `/kb/discovery/suggestions/${encodeURIComponent(suggestionId)}/reject`,
      { method: "POST" },
    ),

  // ── v5.0: 文件上传 ──

  uploadDocument: (file: File, opts?: { title?: string; tags?: string; agent_id?: string }) => {
    const formData = new FormData();
    formData.append("file", file);
    if (opts?.title) formData.append("title", opts.title);
    if (opts?.tags) formData.append("tags", opts.tags);
    if (opts?.agent_id) formData.append("agent_id", opts.agent_id);
    return request<IngestResponse>("/kb/upload", {
      method: "POST",
      body: formData,
    });
  },
};

export default kbApi;
