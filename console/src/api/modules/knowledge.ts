import { request } from "../request";
import { getApiUrl } from "../config";
import { buildAuthHeaders } from "../authHeaders";

export interface KnowledgeDoc {
  id: string;
  name: string;
  file_path: string;
  tags: string[];
  category: string;
  owner: string;
  file_type: string;
  source: string;
  size: number;
  status: string;
  summary: string;
  created_at: string;
  updated_at: string;
  parse_mode: string;
  desensitized: boolean;
  checksum: string;
}

export interface KnowledgeEnums {
  categories: string[];
  owners: string[];
  tags: string[];
}

export interface FilterRule {
  field: string;
  op: string;
  value: string | string[];
}

export interface KnowledgeView {
  id: string;
  name: string;
  rules: FilterRule[];
  order: number;
}

export interface KnowledgeScopeConfig {
  include_rules: FilterRule[];
  exclude_rules: FilterRule[];
  external_paths: { path: string; label: string }[];
}

export interface DocListResponse {
  docs: KnowledgeDoc[];
  total: number;
}

export interface ScanFolderResponse {
  path: string;
  file_count: number;
  files: { name: string; path: string; size: number; type: string }[];
}

function buildQueryString(
  params?: Record<string, string | undefined>,
): string {
  if (!params) return "";
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export const knowledgeApi = {
  listDocs: (params?: {
    category?: string;
    owner?: string;
    tags?: string;
    q?: string;
    status?: string;
    file_type?: string;
  }) =>
    request<DocListResponse>(
      `/knowledge/docs${buildQueryString(params as Record<string, string | undefined>)}`,
    ),

  uploadDoc: async (formData: FormData) => {
    const url = getApiUrl("/knowledge/upload");
    const headers = buildAuthHeaders();
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    return response.json() as Promise<{
      id: string;
      status: string;
      doc: KnowledgeDoc;
    }>;
  },

  deleteDoc: (docId: string) =>
    request<{ status: string; id: string }>(`/knowledge/docs/${docId}`, {
      method: "DELETE",
    }),

  updateDoc: (docId: string, body: Partial<KnowledgeDoc>) =>
    request<{ status: string; doc: KnowledgeDoc }>(
      `/knowledge/docs/${docId}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  getEnums: () => request<KnowledgeEnums>("/knowledge/enums"),

  createEnum: (field: string, value: string) =>
    request<{ status: string; enums: KnowledgeEnums }>("/knowledge/enums", {
      method: "POST",
      body: JSON.stringify({ field, value }),
    }),

  deleteEnum: (field: string, value: string) =>
    request<{ status: string; enums: KnowledgeEnums }>(
      `/knowledge/enums/${field}/${encodeURIComponent(value)}`,
      { method: "DELETE" },
    ),

  listViews: () =>
    request<{ views: KnowledgeView[] }>("/knowledge/views"),

  createView: (name: string, rules: FilterRule[] = []) =>
    request<{ id: string; view: KnowledgeView }>("/knowledge/views", {
      method: "POST",
      body: JSON.stringify({ name, rules }),
    }),

  updateView: (
    viewId: string,
    data: { name?: string; rules?: FilterRule[] },
  ) =>
    request<{ status: string; view: KnowledgeView }>(
      `/knowledge/views/${viewId}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),

  deleteView: (viewId: string) =>
    request<{ status: string }>(`/knowledge/views/${viewId}`, {
      method: "DELETE",
    }),

  getScope: (agentId?: string) =>
    request<KnowledgeScopeConfig>(
      `/knowledge/scope${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
    ),

  updateScope: (data: KnowledgeScopeConfig, agentId?: string) =>
    request<{ status: string; scope: KnowledgeScopeConfig }>(
      `/knowledge/scope${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),

  scanFolder: (path: string) =>
    request<ScanFolderResponse>("/knowledge/scan-folder", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  getParsedContent: (docId: string) =>
    request<{ doc_id: string; content: string }>(
      `/knowledge/docs/${docId}/parsed`,
    ),

  getDesensitizedContent: (docId: string) =>
    request<{ doc_id: string; content: string }>(
      `/knowledge/docs/${docId}/desensitized`,
    ),

  restoreContent: (docId: string) =>
    request<{ doc_id: string; content: string }>(
      `/knowledge/docs/${docId}/restore`,
      { method: "POST" },
    ),

  batchParse: (params?: {
    doc_ids?: string[];
    parse_mode?: string;
    force?: boolean;
  }) =>
    request<{ results: { doc_id: string; status: string }[] }>(
      "/knowledge/parse",
      {
        method: "POST",
        body: JSON.stringify(params || {}),
      },
    ),

  batchDesensitize: (params?: {
    doc_ids?: string[];
    rules?: { name: string; pattern: string; placeholder: string; group: number }[];
    force?: boolean;
  }) =>
    request<{
      results: { doc_id: string; status: string; replacements?: number }[];
    }>("/knowledge/desensitize", {
      method: "POST",
      body: JSON.stringify(params || {}),
    }),

  batchLlmDesensitize: (params?: { doc_ids?: string[] }) =>
    request<{
      results: { doc_id: string; status: string; new_replacements?: number }[];
    }>("/knowledge/desensitize-llm", {
      method: "POST",
      body: JSON.stringify(params || {}),
    }),

  parseFile: (file: File, parseMode?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (parseMode) {
      formData.append("parse_mode", parseMode);
    }
    // Large files may need extended timeout for upload + OCR processing
    const fileSizeMB = file.size / (1024 * 1024);
    const timeoutMs = Math.max(30000, 120000 + Math.floor(fileSizeMB) * 5000);
    return request<{ text: string; filename: string; chars: number }>(
      "/knowledge/parse-file",
      {
        method: "POST",
        body: formData,
        timeout: timeoutMs,
      },
    );
  },

  desensitizeText: (params: {
    text: string;
    name?: string;
    mode?: "local" | "local_ai" | "ai";
    rules?: { name: string; pattern: string; placeholder: string; group: number }[];
  }) =>
    request<{
      original_text: string;
      desensitized_text: string;
      backfill_map: Record<string, string>;
      replacements: number;
      mode: string;
    }>("/knowledge/desensitize-text", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  getDesensitizeRules: () =>
    request<{
      rules: { name: string; pattern: string; placeholder: string; group: number }[];
      source: string;
    }>("/knowledge/desensitize-rules"),

  updateDesensitizeRules: (
    rules: { name: string; pattern: string; placeholder: string; group: number }[],
  ) =>
    request<{ status: string; rules: typeof rules }>(
      "/knowledge/desensitize-rules",
      {
        method: "PUT",
        body: JSON.stringify({ rules }),
      },
    ),

  resetDesensitizeRules: () =>
    request<{
      status: string;
      rules: { name: string; pattern: string; placeholder: string; group: number }[];
    }>("/knowledge/desensitize-rules/reset", {
      method: "POST",
    }),

  exportDocs: (
    params: {
      doc_ids?: string[];
      restore?: boolean;
      authorize?: boolean;
    },
  ) =>
    request<{
      results: {
        doc_id: string;
        name?: string;
        status: string;
        content?: string;
        note?: string;
        restored?: boolean;
      }[];
      total: number;
      restored: boolean;
    }>("/knowledge/export", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  getParserConfig: () =>
    request<{
      default_mode: string;
      mineru_api_key: string;
      mineru_base_url: string;
      mineru_mode: string;
      mineru_backend: string;
      mineru_effort: string;
      mineru_configured: boolean;
      tesseract_langs: string;
      tesseract_available: boolean;
      tesseract_version: string;
    }>("/config/documents/parser"),

  getOcrStatus: () =>
    request<{
      mineru_configured: boolean;
      mineru_mode: string;
      mineru_base_url: string;
      local_mineru: { reachable: boolean; error?: string; status_code?: number };
      tesseract: {
        available: boolean;
        version?: string;
        tesseract_cmd?: string;
        poppler_path?: string;
        langs?: string;
        error?: string;
      };
      default_mode: string;
      cloud_token_valid?: boolean | null;
      cloud_token_error?: string;
    }>("/config/documents/parser/ocr-status"),

  updateParserConfig: (params: {
    default_mode?: string;
    mineru_api_key?: string;
    mineru_base_url?: string;
    mineru_mode?: string;
    mineru_backend?: string;
    mineru_effort?: string;
    tesseract_langs?: string;
  }) =>
    request<{
      default_mode: string;
      mineru_api_key: string;
      mineru_base_url: string;
      mineru_mode: string;
      mineru_backend: string;
      mineru_effort: string;
      mineru_configured: boolean;
      tesseract_langs: string;
      tesseract_available: boolean;
      tesseract_version: string;
    }>("/config/documents/parser", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  deployLocalMineru: (params?: {
    port?: number;
    use_mirror?: boolean;
    mirror_url?: string;
  }) =>
    request<{
      task_id: string;
      status: string;
      message: string;
    }>("/config/documents/parser/deploy-local-mineru", {
      method: "POST",
      body: JSON.stringify(params || { use_mirror: true }),
    }),

  precheckLocalMineru: (params?: {
    port?: number;
  }) =>
    request<{
      can_deploy: boolean;
      checks: {
        python: { version: string; path: string; ok: boolean };
        disk: { free_gb: number; ok: boolean; error?: string };
        network: { pypi: boolean; mirror?: boolean; ok: boolean; note?: string };
        port: { port: number; available: boolean; ok: boolean };
        venv: { exists: boolean; path: string; ok: boolean };
        installed: { installed: boolean; version?: string; ok: boolean };
        gpu: {
          available: boolean;
          count?: number;
          gpus?: { name: string; vram_mb: number; vram_gb: number }[];
          best_name?: string;
          best_vram_gb?: number;
          ok: boolean;
          note?: string;
          error?: string;
        };
        memory: { total_gb?: number; ok: boolean; note?: string; error?: string };
      };
      warnings: string[];
      blockers: string[];
    }>("/config/documents/parser/deploy-local-mineru/precheck", {
      method: "POST",
      body: JSON.stringify(params || {}),
    }),

  getDeployTaskStatus: (taskId: string) =>
    request<{
      task_id: string;
      status: string;
      stage: string;
      progress: number;
      message: string;
      error: string;
      result: Record<string, unknown> | null;
      updated_at: string;
    }>(`/config/documents/parser/deploy-local-mineru/status/${taskId}`),

  getDeployProgressSSEUrl: (taskId: string) =>
    `/config/documents/parser/deploy-local-mineru/progress/${taskId}`,

  getLocalMineruStatus: () =>
    request<{
      installed: boolean;
      version?: string;
      python_path?: string;
      running: boolean;
      venv_dir: string;
    }>("/config/documents/parser/local-mineru-status"),

  stopLocalMineru: () =>
    request<{
      success: boolean;
      details: string[];
    }>("/config/documents/parser/stop-local-mineru", {
      method: "POST",
    }),
};