import { request } from "../request";

// ── Types ────────────────────────────────────────────────────────────────

export interface OkfSection {
  id: string;
  title: string;
  content: string;
  order: number;
  metadata?: Record<string, unknown>;
}

export interface OkfBucket {
  id: string;
  doc_id: string;
  title: string;
  summary: string;
  keywords: string[];
  chunk_count: number;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface OkfDocument {
  id: string;
  title: string;
  source: string;
  file_type: string;
  page_count: number;
  section_count: number;
  bucket_count: number;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface OkfDocumentDetail extends OkfDocument {
  sections: OkfSection[];
  buckets: OkfBucket[];
}

export interface OkfDocumentListResponse {
  documents: OkfDocument[];
  total: number;
}

export interface OkfIngestRequest {
  content: string;
  title: string;
  source?: string;
  file_type?: string;
  page_count?: number;
  metadata?: Record<string, unknown>;
  generate_buckets_flag?: boolean;
  agent_id?: string;
}

export interface OkfIngestResponse {
  doc_id: string;
  document: OkfDocument;
}

export interface OkfSearchRequest {
  query: string;
  doc_id?: string;
  top_k?: number;
  route?: string;
}

export interface OkfSearchHit {
  doc_id: string;
  bucket_id: string;
  title: string;
  snippet: string;
  score: number;
  keywords?: string[];
}

export interface OkfSearchResponse {
  query: string;
  hits: OkfSearchHit[];
  total: number;
}

export interface OkfGenerateBucketsRequest {
  doc_id: string;
  agent_id?: string;
}

export interface OkfGenerateBucketsResponse {
  doc_id: string;
  buckets: OkfBucket[];
  total: number;
}

// ── API ──────────────────────────────────────────────────────────────────

export const okfApi = {
  // ── Documents ──────────────────────────────────────────────────────────

  listDocuments: () =>
    request<OkfDocumentListResponse>("/okf/documents"),

  getDocument: (docId: string) =>
    request<OkfDocumentDetail>(`/okf/documents/${encodeURIComponent(docId)}`),

  ingestDocument: (payload: OkfIngestRequest) =>
    request<OkfIngestResponse>("/okf/documents", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteDocument: (docId: string) =>
    request<{ deleted: boolean }>(
      `/okf/documents/${encodeURIComponent(docId)}`,
      { method: "DELETE" },
    ),

  // ── Search ─────────────────────────────────────────────────────────────

  search: (payload: OkfSearchRequest) =>
    request<OkfSearchResponse>("/okf/search", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ── Buckets ────────────────────────────────────────────────────────────

  generateBuckets: (payload: OkfGenerateBucketsRequest) =>
    request<OkfGenerateBucketsResponse>("/okf/buckets/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export default okfApi;
