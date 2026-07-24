import { request } from "../request";

// ── Component types ──────────────────────────────────────────────────

export interface DocComponent {
  id: string;
  name: string;
  description: string;
  type: "local" | "cloud";
  version: string;
  installed: boolean;
  configured?: boolean;
  capabilities?: string[];
}

// ── Environment / Config types ───────────────────────────────────────

export interface EnvironmentReport {
  system_status: "ok" | "degraded" | "error";
  python_version?: string;
  installed_packages?: Record<string, string>;
  missing_packages?: string[];
  platform?: string;
}

export interface DocConfig {
  [key: string]: unknown;
}

// ── Redaction types ──────────────────────────────────────────────────

export type RedactionStrategy =
  | "mask"
  | "hash"
  | "replace"
  | "simulate"
  | "delete"
  | "partial_mask";

export interface RedactionRule {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  strategy: RedactionStrategy;
  description?: string;
  tags?: string[];
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateRedactionRuleBody {
  name: string;
  pattern: string;
  replacement: string;
  strategy: RedactionStrategy;
  description?: string;
  tags?: string[];
}

export interface UpdateRedactionRuleBody {
  name?: string;
  pattern?: string;
  replacement?: string;
  strategy?: RedactionStrategy;
  description?: string;
  tags?: string[];
}

export interface RedactionTestRequest {
  pattern: string;
  replacement: string;
  strategy: RedactionStrategy;
  test_text: string;
}

export interface RedactionTestResult {
  original_text: string;
  redacted_text: string;
  matches: number;
  details?: Array<{
    match: string;
    start: number;
    end: number;
    replacement: string;
  }>;
}

// ── History types ───────────────────────────────────────────────────

export interface HistoryItem {
  task_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  status: "completed" | "failed" | "processing" | "cancelled";
  engine: string;
  created_at: string;
  completed_at?: string;
  processing_time?: number;
  result?: { text?: string; markdown?: string; metadata?: Record<string, any> };
  error?: string;
}

export interface HistoryResponse {
  items: HistoryItem[];
  statistics: {
    total: number;
    success: number;
    failed: number;
    today_count: number;
  };
}

// ── Parse / Task types ───────────────────────────────────────────────

export type EngineStrategy = "local_only" | "hybrid" | "cloud_only";

export interface ParseRequest {
  file_path: string;
  auto_ocr?: boolean;
  enable_redaction?: boolean;
  engine_strategy?: EngineStrategy;
}

export interface TaskStatus {
  task_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  message?: string;
}

export interface ParseResult {
  task_id: string;
  text?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

// ── API ──────────────────────────────────────────────────────────────

export const docProcessingApi = {
  // ── Components ──────────────────────────────────────────────────

  listComponents: () =>
    request<DocComponent[]>("/doc/components"),

  installComponent: (componentId: string, tier?: string, apiKey?: string) =>
    request<{ message: string }>("/doc/components/install", {
      method: "POST",
      body: JSON.stringify({
        component_id: componentId,
        ...(tier ? { tier } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      }),
    }),

  uninstallComponent: (componentId: string) =>
    request<{ message: string }>(
      `/doc/components/uninstall/${encodeURIComponent(componentId)}`,
      { method: "DELETE" },
    ),

  configureComponent: (componentId: string, apiKey: string) =>
    request<{ message: string }>("/doc/components/config", {
      method: "POST",
      body: JSON.stringify({
        component_id: componentId,
        api_key: apiKey,
      }),
    }),

  testCloudConnection: (componentId: string, apiKey: string) =>
    request<{ success: boolean; message?: string }>("/doc/components/test", {
      method: "POST",
      body: JSON.stringify({
        component_id: componentId,
        api_key: apiKey,
      }),
    }),

  // ── System / Config ─────────────────────────────────────────────

  getEnvironmentReport: () =>
    request<EnvironmentReport>("/doc/system/env-report"),

  getConfig: () =>
    request<DocConfig>("/doc/config"),

  updateConfig: (config: DocConfig) =>
    request<DocConfig>("/doc/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  // ── Redaction Rules ─────────────────────────────────────────────

  createRedactionRule: (rule: CreateRedactionRuleBody) =>
    request<RedactionRule>("/doc/redaction/rules", {
      method: "POST",
      body: JSON.stringify(rule),
    }),

  listRedactionRules: () =>
    request<RedactionRule[]>("/doc/redaction/rules"),

  updateRedactionRule: (ruleId: string, updates: UpdateRedactionRuleBody) =>
    request<RedactionRule>(
      `/doc/redaction/rules/${encodeURIComponent(ruleId)}`,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      },
    ),

  deleteRedactionRule: (ruleId: string) =>
    request<{ message: string }>(
      `/doc/redaction/rules/${encodeURIComponent(ruleId)}`,
      { method: "DELETE" },
    ),

  toggleRedactionRule: (ruleId: string, enabled: boolean) =>
    request<RedactionRule>(
      `/doc/redaction/rules/${encodeURIComponent(ruleId)}/toggle`,
      {
        method: "POST",
        body: JSON.stringify({ enabled }),
      },
    ),

  testRedactionPattern: (
    pattern: string,
    replacement: string,
    strategy: RedactionStrategy,
    testText: string,
  ) =>
    request<RedactionTestResult>("/doc/redaction/test", {
      method: "POST",
      body: JSON.stringify({
        pattern,
        replacement,
        strategy,
        test_text: testText,
      }),
    }),

  aiDetectMissedRedactions: (text: string, redactedText: string, context?: Record<string, any>) =>
    request<{
      missed_items: Array<{ type: string; text: string; reason: string }>;
      suggestions: Array<{ pattern: string; name: string; strategy: string }>;
      risk_level: "low" | "medium" | "high" | "unknown";
      method?: string;
      error?: string;
    }>("/doc/redaction/ai-detect", {
      method: "POST",
      body: JSON.stringify({ text, redacted_text: redactedText, context }),
    }),

  importRedactionPresets: () =>
    request<{ imported: number }>("/doc/redaction/import-presets", {
      method: "POST",
    }),

  // ── Document Parsing ────────────────────────────────────────────

  parseDocument: (body: ParseRequest) =>
    request<{ task_id: string }>("/doc/parse", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getTaskStatus: (taskId: string) =>
    request<TaskStatus>(`/doc/status/${encodeURIComponent(taskId)}`),

  getParseResult: (taskId: string) =>
    request<ParseResult>(`/doc/result/${encodeURIComponent(taskId)}`),

  // ── Settings (持久化) ──────────────────────────────────────────

  getSettings: () =>
    request<Record<string, any>>("/doc/settings"),

  updateSettings: (settings: Record<string, any>) =>
    request<Record<string, any>>("/doc/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  updateSettingsSection: (section: string, data: Record<string, any>) =>
    request<Record<string, any>>(`/doc/settings/section/${encodeURIComponent(section)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  resetConfig: () =>
    request<{ success: boolean }>("/doc/config/reset", {
      method: "POST",
    }),

  // ── History ─────────────────────────────────────────────────────

  listHistory: () =>
    request<HistoryResponse>("/doc/history"),

  getHistoryDetail: (taskId: string) =>
    request<HistoryItem>(`/doc/history/${encodeURIComponent(taskId)}/detail`),

  deleteHistory: (taskId: string) =>
    request<{ success: boolean }>(`/doc/history/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    }),

  exportHistory: (format: "json" | "csv" = "json") =>
    request<{ data: string; format: string }>("/doc/history/export", {
      method: "POST",
      body: JSON.stringify({ format }),
    }),

  // ── Download ────────────────────────────────────────────────────

  downloadResult: (taskId: string, format: string) =>
    request<Blob>(`/doc/download/${encodeURIComponent(taskId)}/${format}`, {
      method: "GET",
      responseType: "blob",
    }),

  // ── Redaction Templates & Stats ──────────────────────────────────

  getRedactionTemplates: () =>
    request<{ templates: any[] }>("/doc/redaction/templates"),

  getRedactionStatistics: () =>
    request<any>("/doc/redaction/statistics"),

  // ── Batch Processing ─────────────────────────────────────────────

  createBatch: (files: string[], options?: Record<string, any>) =>
    request<{ batch_id: string }>("/doc/batch/create", {
      method: "POST",
      body: JSON.stringify({ files, ...options }),
    }),

  startBatchTask: (batchId: string, taskId: string) =>
    request<{ success: boolean }>(`/doc/batch/${encodeURIComponent(taskId)}/start`, {
      method: "POST",
    }),

  getBatchStatus: (batchId: string) =>
    request<any>(`/doc/batch/${encodeURIComponent(batchId)}/status`),

  getBatchResult: (batchId: string) =>
    request<any>(`/doc/batch/${encodeURIComponent(batchId)}/result`),

  cancelBatch: (batchId: string) =>
    request<{ success: boolean }>(`/doc/batch/${encodeURIComponent(batchId)}/cancel`, {
      method: "POST",
    }),

  listBatches: (limit: number = 20) =>
    request<{ batches: any[] }>(`/doc/batch/list?limit=${limit}`),

  exportBatch: (batchId: string) =>
    request<{ data: string }>(`/doc/batch/${encodeURIComponent(batchId)}/export`, {
      method: "POST",
    }),

  // ── Arbitration Review & Knowledge ──────────────────────────────

  createArbitrationReview: (body: Record<string, any>) =>
    request<{ review_id: string }>("/doc/arbitration/review", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  exportArbitrationReview: (reviewId: string) =>
    request<{ data: string }>(`/doc/arbitration/review/${encodeURIComponent(reviewId)}/export`, {
      method: "POST",
    }),

  searchArbitrationKnowledge: (query: string, limit: number = 10) =>
    request<{ results: any[] }>(`/doc/arbitration/knowledge/search?q=${encodeURIComponent(query)}&limit=${limit}`),

  importArbitrationKnowledge: (body: Record<string, any>) =>
    request<{ imported: number }>("/doc/arbitration/knowledge/import", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getArbitrationKnowledgeStats: () =>
    request<any>("/doc/arbitration/knowledge/stats"),
};