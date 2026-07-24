import { request } from "../request";
import { getApiUrl } from "../config";
import { buildAuthHeaders } from "../authHeaders";

// ── Types ────────────────────────────────────────────────────────────────

export interface KBFileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: KBFileNode[];
}

export interface KBStats {
  total_files: number;
  total_tags: number;
  total_links: number;
  by_status: Record<string, number>;
}

export interface KBTagCount {
  tag: string;
  count: number;
}

export interface KBFileContent {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
  tags: string[];
  status: string;
  links: string[];
}

export interface KBSearchResult {
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  status: string;
  score?: number;
}

export interface KBLinkResult {
  path: string;
  title: string;
  link_text: string;
  tags: string[];
}

export interface KBGraph {
  nodes: { id: string; title: string; path: string; tags: string[] }[];
  edges: { source: string; target: string }[];
}

export interface KBImportResult {
  ok: boolean;
  file: string;
  title: string;
  tags: string[];
  summary: string;
  suggestions: {
    linked: string[];
    pending_links: string[];
  };
}

export interface KBAIAskEvent {
  type: "start" | "token" | "tool" | "done" | "error";
  text?: string;
  name?: string;
  message?: string;
}

// ── API ──────────────────────────────────────────────────────────────────

export const kbApi = {
  list: () =>
    request<{ ok: boolean; tree: KBFileNode[]; stats: KBStats }>("/kb/list"),

  stats: () => request<{ ok: boolean; stats: KBStats }>("/kb/stats"),

  tags: () => request<{ ok: boolean; tags: KBTagCount[] }>("/kb/tags"),

  getFile: (path: string) =>
    request<{ ok: boolean; file: KBFileContent }>(
      `/kb/file?path=${encodeURIComponent(path)}`,
    ),

  getFileRaw: (path: string) =>
    request<{ ok: boolean; content: string }>(
      `/kb/file/raw?path=${encodeURIComponent(path)}`,
    ),

  search: (q: string) =>
    request<{ ok: boolean; results: KBSearchResult[] }>(
      `/kb/search?q=${encodeURIComponent(q)}`,
    ),

  byTag: (tag: string) =>
    request<{ ok: boolean; results: KBSearchResult[] }>(
      `/kb/by-tag?tag=${encodeURIComponent(tag)}`,
    ),

  byStatus: (status: string) =>
    request<{ ok: boolean; results: KBSearchResult[] }>(
      `/kb/by-status?status=${encodeURIComponent(status)}`,
    ),

  backlinks: (title: string) =>
    request<{ ok: boolean; results: KBLinkResult[] }>(
      `/kb/backlinks?title=${encodeURIComponent(title)}`,
    ),

  forwardLinks: (path: string) =>
    request<{ ok: boolean; links: string[] }>(
      `/kb/forward-links?path=${encodeURIComponent(path)}`,
    ),

  dsl: (dsl: string) =>
    request<{ ok: boolean; results: KBSearchResult[] }>("/kb/dsl", {
      method: "POST",
      body: JSON.stringify({ dsl }),
    }),

  graph: () => request<{ ok: boolean; graph: KBGraph }>("/kb/graph"),

  importFile: (file: File, autoOcr = true) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<KBImportResult>(
      `/kb/import?auto_ocr=${autoOcr}`,
      {
        method: "POST",
        body: formData,
      },
    );
  },

  importRaw: (payload: {
    title: string;
    content: string;
    tags?: string[];
    status?: string;
  }) =>
    request<{ ok: boolean; file: string; title: string }>("/kb/import-raw", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Stream an AI ask response via SSE. */
  aiAskStream: async (
    payload: {
      question: string;
      agent_id?: string;
      context_files?: string[];
    },
    onEvent: (event: KBAIAskEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const url = getApiUrl("/kb/ai-ask");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...buildAuthHeaders(),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Request failed: ${res.status}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.trim();
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;
        try {
          const event = JSON.parse(jsonStr) as KBAIAskEvent;
          onEvent(event);
          if (event.type === "error") {
            throw new Error(event.message || "AI ask failed");
          }
        } catch (e) {
          if (e instanceof Error && e.message) throw e;
          // Ignore JSON parse errors for partial chunks
        }
      }
    }
  },
};
