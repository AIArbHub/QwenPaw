import { request } from "../request";

// ── Types ────────────────────────────────────────────────────────────────

export interface FeedbackEntry {
  id: string;
  agent_id: string;
  session_id: string;
  message_id: string;
  rating: number;
  comment: string;
  tags: string[];
  created_at: string;
  // ── 新增归因字段 ──
  analysis_status?: string;
  analysis_bucket?: string;
  analysis_reason?: string;
  analysis_summary?: string;
  analysis_confidence?: number;
  analyzed_at?: string;
  // ── 新增技能级反馈字段 ──
  skill_id?: string;
  skill_version?: string;
  step_id?: string;
}

export interface FeedbackCreate {
  agent_id: string;
  session_id?: string;
  message_id?: string;
  rating: number;
  comment?: string;
  tags?: string[];
  // ── 新增技能级反馈字段 ──
  skill_id?: string;
  skill_version?: string;
  step_id?: string;
}

export interface FeedbackSummary {
  agent_id: string;
  total_feedback: number;
  avg_rating: number;
  rating_distribution: Record<string, number>;
  recent_comments: FeedbackEntry[];
  // ── 新增归因汇总字段 ──
  buckets?: Record<string, number>;
  top_down_summaries?: Array<{
    bucket: string;
    summary: string;
    rating: number;
    created_at: string;
  }>;
  summary_text?: string;
}

// ── API ──────────────────────────────────────────────────────────────────

export const feedbackApi = {
  create: (data: FeedbackCreate) =>
    request<FeedbackEntry>("/feedback/feedback", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  list: (agentId?: string, limit?: number) => {
    const searchParams = new URLSearchParams();
    if (agentId) searchParams.set("agent_id", agentId);
    if (limit !== undefined) searchParams.set("limit", String(limit));
    const qs = searchParams.toString();
    return request<{ feedbacks: FeedbackEntry[] }>(
      `/feedback/feedback${qs ? `?${qs}` : ""}`,
    );
  },

  getSummary: (agentId: string) =>
    request<FeedbackSummary>(
      `/feedback/feedback/summary/${encodeURIComponent(agentId)}`,
    ),

  delete: (feedbackId: string) =>
    request<{ success: boolean }>(
      `/feedback/feedback/${encodeURIComponent(feedbackId)}`,
      { method: "DELETE" },
    ),
};

export default feedbackApi;
