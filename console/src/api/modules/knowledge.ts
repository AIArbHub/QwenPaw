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
    return request<{ text: string; filename: string; chars: number }>(
      "/knowledge/parse-file",
      {
        method: "POST",
        body: formData,
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
      local_ocr_enabled: boolean;
      local_ocr_lang: string;
      mineru_configured: boolean;
      paddleocr_installed: { installed: boolean; version: string | null; error?: string };
    }>("/config/documents/parser"),

  getOcrStatus: () =>
    request<{
      paddleocr: { installed: boolean; version: string | null; error?: string };
      mineru_configured: boolean;
      local_ocr_enabled: boolean;
      default_mode: string;
    }>("/config/documents/parser/ocr-status"),

  updateParserConfig: (params: {
    default_mode?: string;
    mineru_api_key?: string;
    mineru_base_url?: string;
    local_ocr_enabled?: boolean;
    local_ocr_lang?: string;
  }) =>
    request<{
      default_mode: string;
      mineru_api_key: string;
      mineru_base_url: string;
      local_ocr_enabled: boolean;
      local_ocr_lang: string;
      mineru_configured: boolean;
      paddleocr_installed: { installed: boolean; version: string | null; error?: string };
    }>("/config/documents/parser", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  installPaddleOCR: (params: { use_mirror?: boolean; mirror_url?: string }) =>
    request<{
      success: boolean;
      output: string;
      paddleocr_installed: { installed: boolean; version: string | null; error?: string };
      message: string;
      platform?: string;
      is_arm_mac?: boolean;
    }>("/config/documents/parser/install-paddleocr", {
      method: "POST",
      body: JSON.stringify(params),
    }),
};