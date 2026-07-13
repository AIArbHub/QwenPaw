import { request } from "../request";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CaseLink {
  link_id: string;
  case_id: string;
  doc_id: string;
  wiki_page_path: string;
  link_type: "evidence" | "reference" | "context";
  side: string;
  ai_analysis: string;
  created_at: number;
}

export interface AddCaseLinkParams {
  doc_id?: string;
  wiki_page_path?: string;
  link_type?: string;
  side?: string;
  ai_analysis?: string;
}

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface CopilotChatParams {
  case_id: string;
  message: string;
  context_tab?: string;
  selected_doc_id?: string;
}

export interface DocAnalysisResult {
  doc_type: string;
  key_points: string[];
  dispute_points: string[];
  evidence_chain: string[];
  legal_basis: string[];
  summary: string;
}

export interface WikiLink {
  source_path: string;
  target_path: string;
  link_text: string;
  link_type: string;
}

export interface LinkGraph {
  links: WikiLink[];
  forward: Record<string, string[]>;
  backward: Record<string, string[]>;
  total_links: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  page_path: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SearchResult {
  type: "wiki_page" | "document" | "memory";
  path?: string;
  name?: string;
  doc_id?: string;
  content?: string;
  score: number;
  source: string;
}

// ── API functions ───────────────────────────────────────────────────────────

export const deskApi = {
  // Case Links
  getCaseLinks: (caseId: string) =>
    request<CaseLink[]>(`/moot/${caseId}/links`),

  addCaseLink: (caseId: string, params: AddCaseLinkParams) =>
    request<CaseLink>(`/moot/${caseId}/links`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  removeCaseLink: (caseId: string, linkId: string) =>
    request<{ success: boolean }>(`/moot/${caseId}/links/${linkId}`, {
      method: "DELETE",
    }),

  // Copilot
  copilotChat: (params: CopilotChatParams) =>
    request<{ response: string }>(`/moot/${params.case_id}/copilot`, {
      method: "POST",
      body: JSON.stringify({
        case_id: params.case_id,
        message: params.message,
        context_tab: params.context_tab || "overview",
        selected_doc_id: params.selected_doc_id,
      }),
    }),

  getCopilotHistory: (caseId: string) =>
    request<CopilotMessage[]>(`/moot/${caseId}/copilot/history`),

  // Document Analysis
  analyzeDocument: (docId: string, caseId?: string) =>
    request<DocAnalysisResult>(`/moot/analyze-doc?doc_id=${docId}&case_id=${caseId || ""}`, {
      method: "POST",
    }),

  // Wiki enhanced
  getWikiLinks: () =>
    request<LinkGraph>(`/wiki/links`),

  getKnowledgeGraph: () =>
    request<KnowledgeGraph>(`/wiki/graph`),

  semanticSearch: (query: string, caseId?: string) =>
    request<{ results: SearchResult[]; total: number }>(
      `/wiki/search?q=${encodeURIComponent(query)}&case_id=${caseId || ""}`
    ),

  autoCompile: (docIds?: string[]) =>
    request(`/wiki/auto-compile`, {
      method: "POST",
      body: JSON.stringify({ doc_ids: docIds || [] }),
    }),
};
