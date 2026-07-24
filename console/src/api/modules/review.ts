import { request } from "../request";

// ── Types ────────────────────────────────────────────────────────────────

export interface ReviewTemplateItem {
  id: string;
  title: string;
  desc: string;
}

export interface ReviewTemplateCategory {
  id: string;
  name: string;
  items: ReviewTemplateItem[];
}

export interface ReviewTemplate {
  id: string;
  name: string;
  categories: ReviewTemplateCategory[];
}

export type ReviewItemStatus = "pending" | "pass" | "need_fix" | "fail";

export interface ReviewItem {
  id: string;
  category_id: string;
  category_name: string;
  title: string;
  desc: string;
  status: ReviewItemStatus;
  annotation: string;
  updated_at: string;
}

export interface ReviewDocument {
  name: string;
  path: string;
  type: string;
}

export interface ReviewSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

export interface ReviewSession {
  id: string;
  case_name: string;
  case_id: string | null;
  template_id: string;
  documents: ReviewDocument[];
  items: ReviewItem[];
  status: "in_progress" | "completed" | "archived";
  created_at: string;
  updated_at: string;
  summary: ReviewSummary;
}

export interface ReviewListItem {
  id: string;
  case_name: string;
  case_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  summary: ReviewSummary;
}

export interface ReviewKnowledge {
  ok: boolean;
  query: string;
  results: {
    path: string;
    title: string;
    snippet: string;
    tags: string[];
    status: string;
  }[];
  related: {
    path: string;
    title: string;
    snippet: string;
    tags: string[];
    status: string;
  }[];
  tags: { tag: string; count: number }[];
}

export interface ReviewExport {
  ok: boolean;
  markdown: string;
  filename: string;
}

// ── API ──────────────────────────────────────────────────────────────────

export const reviewApi = {
  listTemplates: () =>
    request<{ ok: boolean; templates: ReviewTemplate[] }>("/review/templates"),

  getTemplate: (id: string) =>
    request<{ ok: boolean; template: ReviewTemplate }>(
      `/review/templates/${encodeURIComponent(id)}`,
    ),

  create: (payload: {
    case_name: string;
    case_id?: string;
    template_id?: string;
    documents?: ReviewDocument[];
  }) =>
    request<{ ok: boolean; review: ReviewSession }>("/review/create", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  list: () => request<{ ok: boolean; reviews: ReviewListItem[] }>("/review/list"),

  get: (id: string) =>
    request<{ ok: boolean; review: ReviewSession }>(
      `/review/${encodeURIComponent(id)}`,
    ),

  delete: (id: string) =>
    request<{ ok: boolean }>(`/review/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  updateItem: (
    id: string,
    payload: {
      item_id: string;
      status: ReviewItemStatus;
      annotation?: string;
    },
  ) =>
    request<{ ok: boolean; review: ReviewSession }>(
      `/review/${encodeURIComponent(id)}/item`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    ),

  addAnnotation: (
    id: string,
    payload: { item_id: string; annotation: string },
  ) =>
    request<{ ok: boolean; item: ReviewItem }>(
      `/review/${encodeURIComponent(id)}/annotation`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  getKnowledge: (id: string, q = "") =>
    request<ReviewKnowledge>(
      `/review/${encodeURIComponent(id)}/knowledge?q=${encodeURIComponent(q)}`,
    ),

  export: (id: string) =>
    request<ReviewExport>(`/review/${encodeURIComponent(id)}/export`),
};
