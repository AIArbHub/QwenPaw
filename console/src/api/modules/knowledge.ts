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