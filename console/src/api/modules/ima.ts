import { request } from "../request";

export interface IMAAuthStatus {
  authenticated: boolean;
  has_token: boolean;
}

export interface IMAQRCodeResponse {
  qrcode_url: string;
  session_id: string;
}

export interface IMALoginStatusResponse {
  status: "pending" | "scanned" | "confirmed" | "expired";
  access_token: string;
  message: string;
}

export interface IMAKnowledgeBase {
  id: string;
  name: string;
  description: string;
  doc_count: number;
}

export interface IMAResearchRequest {
  query: string;
  top_k?: number;
}

export interface IMAResearchResponse {
  source: "ima" | "local_kb" | "external_mcp" | "none" | string;
  answer: string;
  sources: Record<string, unknown>[];
  selected_bases: string[];
  error: string | null;
  message: string | null;
}

export const imaApi = {
  /** Check IMA login status */
  getAuthStatus: () => request<IMAAuthStatus>("/ima/auth/status"),

  /** Start QR code login flow */
  startQRLogin: () =>
    request<IMAQRCodeResponse>("/ima/auth/qrcode", { method: "POST" }),

  /** Poll login status by session_id */
  pollLoginStatus: (sessionId: string) =>
    request<IMALoginStatusResponse>(`/ima/auth/poll/${encodeURIComponent(sessionId)}`),

  /** Clear IMA auth state */
  clearAuth: () =>
    request<{ message: string }>("/ima/auth", { method: "DELETE" }),

  /** List IMA knowledge bases */
  listKnowledgeBases: () =>
    request<IMAKnowledgeBase[]>("/ima/knowledge-bases"),

  /** Execute IMA two-level RAG research */
  research: (body: IMAResearchRequest) =>
    request<IMAResearchResponse>("/ima/research", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
