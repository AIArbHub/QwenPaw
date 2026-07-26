import { request } from "../request";

// ── Types ────────────────────────────────────────────────────────────────

export type SkillStatus = "draft" | "active" | "archived";

export type SkillNodeType =
  | "start"
  | "action"
  | "decision"
  | "tool_call"
  | "knowledge_query"
  | "reply"
  | "handoff"
  | "terminal";

export interface SkillGraphNode {
  id: string;
  type: SkillNodeType;
  title: string;
  description: string;
  prompt_hint: string;
  tool_name: string;
  knowledge_scope: string;
  metadata: Record<string, unknown>;
  expected_user_info?: string[];
  allowed_actions?: string[];
  retry_policy?: Record<string, unknown>;
}

export interface SkillGraphEdge {
  from_node: string;
  to_node: string;
  condition: string;
  priority: number;
}

export interface SkillCard {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: SkillGraphNode[];
  edges: SkillGraphEdge[];
  start_node_id: string;
  knowledge_scope: string;
  source_doc_ids: string[];
  soul_md_ref: string;
  status: SkillStatus;
  created_at: string;
  updated_at: string;
  tags: string[];
  metadata: Record<string, unknown>;
  // ── 新增字段 ──
  terminal_node_ids?: string[];
  trigger_intents?: string[];
  required_info?: string[];
  interruption_policy?: Record<string, string>;
  response_rules?: string[];
  call_count?: number;
  positive_feedback_count?: number;
  negative_feedback_count?: number;
}

export interface SkillListResponse {
  skills: SkillCard[];
  total: number;
}

export interface SkillValidateResponse {
  valid: boolean;
  issues: string[];
}

export interface DistillRequest {
  doc_content: string;
  skill_id: string;
  skill_name: string;
  persona_content?: string;
  knowledge_scope?: string;
  tags?: string[];
  soul_md_ref?: string;
  agent_id?: string;
}

export interface DistillResponse {
  skill_id: string;
  skill: SkillCard;
}

export interface BuiltinSkillsResponse {
  created: string[];
  updated: string[];
  total: number;
}

// ── Runtime types ────────────────────────────────────────────────────────

export interface RuntimeState {
  skill_id?: string;
  current_node_id?: string;
  context?: Record<string, unknown>;
  history?: unknown[];
  [key: string]: unknown;
}

export interface RuntimeStartRequest {
  session_id: string;
  skill_id: string;
  initial_context?: Record<string, unknown>;
  state?: RuntimeState;
}

export interface RuntimeStartResponse {
  session_id: string;
  state: RuntimeState;
}

export interface RuntimeStepRequest {
  session_id: string;
  user_message: string;
  state: RuntimeState;
  history?: unknown[];
  agent_id?: string;
}

export interface RuntimeStepResponse {
  session_id: string;
  reply: string;
  state: RuntimeState;
  history?: unknown[];
}

export interface RuntimeSuspendRequest {
  state: RuntimeState;
}

export interface RuntimeSuspendResponse {
  state: RuntimeState;
}

export interface RuntimeRestoreRequest {
  state: RuntimeState;
}

export interface RuntimeRestoreResponse {
  state: RuntimeState;
}

export interface RuntimeStateRequest {
  state: RuntimeState;
}

export interface RuntimeStateResponse {
  state: RuntimeState;
}

export interface ReflectionResult {
  agent_id: string;
  skill_id: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  rubric_scores: Record<string, {
    label: string;
    score: number;
    issues: string[];
    suggestion: string;
  }>;
  metrics: Record<string, unknown>;
  rounds: number;
}

export interface ReflectionRequest {
  agent_id?: string;
  skill_id?: string;
}

export interface LeaderboardResponse {
  skills: Array<{
    id: string;
    name: string;
    call_count: number;
    positive_feedback_count: number;
    negative_feedback_count: number;
  }>;
}

// ── API ──────────────────────────────────────────────────────────────────

export const sopApi = {
  // ── SkillCard CRUD ────────────────────────────────────────────────────

  listSkills: () =>
    request<SkillListResponse>("/sop/skills"),

  getSkill: (skillId: string) =>
    request<SkillCard>(`/sop/skills/${encodeURIComponent(skillId)}`),

  saveSkill: (skill: SkillCard) =>
    request<SkillCard>("/sop/skills", {
      method: "POST",
      body: JSON.stringify({ skill }),
    }),

  deleteSkill: (skillId: string) =>
    request<{ deleted: boolean }>(
      `/sop/skills/${encodeURIComponent(skillId)}`,
      { method: "DELETE" },
    ),

  validateSkill: (skillId: string) =>
    request<SkillValidateResponse>(
      `/sop/skills/${encodeURIComponent(skillId)}/validate`,
      { method: "POST" },
    ),

  // ── Distill / Builtin ─────────────────────────────────────────────────

  distill: (payload: DistillRequest) =>
    request<DistillResponse>("/sop/distill", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  ensureBuiltin: () =>
    request<BuiltinSkillsResponse>("/sop/builtin", {
      method: "POST",
    }),

  // ── Runtime ───────────────────────────────────────────────────────────

  startRuntime: (payload: RuntimeStartRequest) =>
    request<RuntimeStartResponse>("/sop/runtime/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  stepRuntime: (payload: RuntimeStepRequest) =>
    request<RuntimeStepResponse>("/sop/runtime/step", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  suspendRuntime: (payload: RuntimeSuspendRequest) =>
    request<RuntimeSuspendResponse>("/sop/runtime/suspend", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  restoreRuntime: (payload: RuntimeRestoreRequest) =>
    request<RuntimeRestoreResponse>("/sop/runtime/restore", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getRuntimeState: (payload: RuntimeStateRequest) =>
    request<RuntimeStateResponse>("/sop/runtime/state", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ── Reflection ───────────────────────────────────────────────────────────

  reflect: (payload: ReflectionRequest) =>
    request<ReflectionResult>("/sop/reflect", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ── Leaderboard ──────────────────────────────────────────────────────────

  getLeaderboard: () =>
    request<LeaderboardResponse>("/sop/leaderboard"),
};

export default sopApi;
