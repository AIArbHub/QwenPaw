import { request } from "../request";

// ── Types ──────────────────────────────────────────────

export interface KnowledgeRoot {
  path: string;
  writable: boolean;
}

export interface KnowledgeCategory {
  name: string;
  path: string;
}

export interface KnowledgeOverview {
  editable_root: string;
  roots: KnowledgeRoot[];
  categories: KnowledgeCategory[];
}

export interface KnowledgeFile {
  name: string;
  path: string;
  size: number;
}

export interface KnowledgeFileContent {
  path: string;
  content: string;
  truncated: boolean;
}

export interface KnowledgeSearchHit {
  path: string;
  root: string;
  line: number;
  snippet: string;
}

export interface KnowledgeSearchResult {
  results: KnowledgeSearchHit[];
  total: number;
}

// ── API ────────────────────────────────────────────────

export const knowledgeApi = {
  /** 知识库总览：可写根 + 所有根 + 分类列表 */
  overview: () => request<KnowledgeOverview>("/knowledge/overview"),

  /** 分类下的文件列表 */
  tree: (rel?: string) =>
    request<{ files: KnowledgeFile[] }>(
      `/knowledge/tree${rel ? `?rel=${encodeURIComponent(rel)}` : ""}`,
    ),

  /** 全文检索（全部根） */
  search: (q: string, scope?: string, limit = 50) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (scope) params.set("scope", scope);
    return request<KnowledgeSearchResult>(`/knowledge/search?${params}`);
  },

  /** 读取文本文件内容 */
  readFile: (rel: string) =>
    request<KnowledgeFileContent>(
      `/knowledge/file?rel=${encodeURIComponent(rel)}`,
    ),

  /** 保存文本文件内容 */
  saveFile: (rel: string, content: string) =>
    request<{ path: string; saved: boolean }>(
      `/knowledge/file?rel=${encodeURIComponent(rel)}`,
      { method: "PUT", body: JSON.stringify({ rel, content }) },
    ),

  /** 上传文件到指定分类 */
  upload: (file: File, category?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (category) form.append("category", category);
    return request<{ path: string; name: string; size: number }>(
      "/knowledge/upload",
      { method: "POST", body: form },
    );
  },

  /** 重命名/移动文件或分类 */
  rename: (rel: string, newName: string) =>
    request<{ path: string; name: string }>("/knowledge/rename", {
      method: "POST",
      body: JSON.stringify({ rel, new_name: newName }),
    }),

  /** 删除文件（或空分类） */
  deleteFile: (rel: string) =>
    request<{ deleted: string }>(
      `/knowledge/file?rel=${encodeURIComponent(rel)}`,
      { method: "DELETE" },
    ),

  /** 新建分类 */
  createCategory: (name: string) =>
    request<{ name: string; path: string }>("/knowledge/category", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
};

// ── KB Curator (AI 知识整理) ──────────────────────────

export interface CuratorSettings {
  enabled: boolean;
  publish_enabled: boolean;
  default_category: string;
  timeout_seconds: number;
  language: string;
  settings_file?: string;
}

export interface CurateTaskItem {
  id: string;
  status: "pending" | "running" | "done" | "error";
  title: string;
  category: string;
  file_names: string[];
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  published: { path: string; category: string; name: string; published: boolean }[];
  error: string | null;
}

export const kbCuratorApi = {
  /** 读取整理设置 */
  getSettings: () => request<CuratorSettings>("/kb-curator/settings"),

  /** 更新整理设置（局部字段） */
  updateSettings: (patch: Partial<CuratorSettings>) =>
    request<CuratorSettings>("/kb-curator/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  /** 提交文本素材进行 AI 整理 */
  curateText: (payload: { text: string; title?: string; category?: string }) =>
    request<{ task_id: string; status: string }>("/kb-curator/curate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** 上传文件素材进行 AI 整理 */
  curateUpload: (files: File[], title?: string, category?: string) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const params = new URLSearchParams();
    if (title) params.set("title", title);
    if (category) params.set("category", category);
    const qs = params.toString();
    return request<{ task_id: string; status: string; files: string[] }>(
      `/kb-curator/curate/upload${qs ? `?${qs}` : ""}`,
      { method: "POST", body: form },
    );
  },

  /** 整理任务列表 */
  listTasks: (limit = 50) =>
    request<{ tasks: CurateTaskItem[] }>(
      `/kb-curator/tasks?limit=${limit}`,
    ),

  /** 单个整理任务状态 */
  getTask: (taskId: string) =>
    request<CurateTaskItem>(`/kb-curator/tasks/${taskId}`),
};