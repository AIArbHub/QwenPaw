import { request } from "../request";
import { getApiUrl } from "../config";
import { buildAuthHeaders } from "../authHeaders";
import { useCodeFileCacheStore } from "../../stores/codeFileCacheStore";
import { downloadFileFromUrl } from "../../utils/downloadFileFromUrl";
import type {
  MdFileInfo,
  MdFileContent,
  DailyMemoryFile,
  MemoryStats,
  MemoryStatus,
  MemorySearchResult,
  TestEmbeddingResult,
  ReindexResult,
  MemoryVersionInfo,
} from "../types";

function getSelectedAgentId(): string {
  try {
    // Read from sessionStorage first (per-tab agent), fall back to localStorage
    const agentStorage =
      sessionStorage.getItem("qwenpaw-agent-storage") ||
      localStorage.getItem("qwenpaw-agent-storage");
    if (agentStorage) {
      const parsed = JSON.parse(agentStorage);
      const selectedAgent = parsed?.state?.selectedAgent;
      if (selectedAgent) {
        return selectedAgent;
      }
    }
  } catch (error) {
    console.warn("Failed to get selected agent from storage:", error);
  }
  return "default";
}

function generateFallbackFilename(): string {
  const agentId = getSelectedAgentId();
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_")
    .slice(0, 15); // YYYYMMDD_HHMMSS
  return `qwenpaw_workspace_${agentId}_${timestamp}.zip`;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export const workspaceApi = {
  listFiles: (agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<MdFileInfo[]>(`/workspace/files${query}`).then((files) =>
      files.map((file) => ({
        ...file,
        updated_at: new Date(file.modified_time).getTime(),
      })),
    );
  },

  loadFile: (fileName: string, agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<MdFileContent>(
      `/workspace/files/${encodeURIComponent(fileName)}${query}`,
    );
  },

  saveFile: (fileName: string, content: string, agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<Record<string, unknown>>(
      `/workspace/files/${encodeURIComponent(fileName)}${query}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    );
  },

  // Workspace package download
  downloadWorkspace: () =>
    downloadFileFromUrl(
      getApiUrl("/workspace/download"),
      generateFallbackFilename(),
      {
        headers: buildAuthHeaders(),
        errorMessage: "Workspace download failed",
        preferResponseFilename: true,
      },
    ),

  // File upload functionality
  uploadFile: async (
    file: File,
  ): Promise<{ success: boolean; message: string }> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(getApiUrl("/workspace/upload"), {
      method: "POST",
      headers: buildAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Upload failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return await response.json();
  },

  listDailyMemory: (agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<MdFileInfo[]>(`/workspace/memory${query}`).then((files) =>
      files.map((file) => {
        const basename = file.filename.split("/").pop() || file.filename;
        const date = basename.replace(".md", "");
        return {
          ...file,
          date,
          updated_at: new Date(file.modified_time).getTime(),
        } as DailyMemoryFile;
      }),
    );
  },

  loadDailyMemory: (memoryPath: string, agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<MdFileContent>(`/workspace/memory/${encodePath(memoryPath)}${query}`);
  },

  saveDailyMemory: (memoryPath: string, content: string, agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<Record<string, unknown>>(
      `/workspace/memory/${encodePath(memoryPath)}${query}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    );
  },

  deleteDailyMemory: (memoryPath: string, agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<Record<string, unknown>>(
      `/workspace/memory/${encodePath(memoryPath)}${query}`,
      {
        method: "DELETE",
      },
    );
  },

  searchMemory: (query: string, limit = 5, minScore = 0, agentId?: string) => {
    const q = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<MemorySearchResult>(`/workspace/memory/search${q}`, {
      method: "POST",
      body: JSON.stringify({ query, limit, min_score: minScore }),
    });
  },

  getMemoryStats: (agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<MemoryStats>(`/workspace/memory/stats${query}`);
  },

  getMemoryStatus: (agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<MemoryStatus>(`/workspace/memory/status${query}`);
  },

  testEmbedding: (config: {
    backend: string;
    api_key: string;
    base_url: string;
    model_name: string;
    dimensions: number;
  }) =>
    request<TestEmbeddingResult>("/workspace/memory/test-embedding", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  reindexMemory: (agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return request<ReindexResult>(`/workspace/memory/reindex${query}`, {
      method: "POST",
    });
  },

  // System prompt files management
  getSystemPromptFiles: () =>
    request<string[]>("/workspace/system-prompt-files"),

  setSystemPromptFiles: (files: string[]) =>
    request<string[]>("/workspace/system-prompt-files", {
      method: "PUT",
      body: JSON.stringify(files),
    }),

  // Coding Mode – full file tree (all file types)
  listCodeFiles: () =>
    request<MdFileInfo[]>("/workspace/code-files").then((files) =>
      files.map((file) => ({
        ...file,
        updated_at: new Date(file.modified_time).getTime(),
      })),
    ),

  /**
   * Load a workspace file's text content.
   *
   * Cache strategy: returns the in-memory cached content immediately when
   * present (no network). Otherwise issues a GET with `If-None-Match` from
   * the cached ETag (if any) so a hard-refresh can short-circuit to 304.
   * Cache invalidation lives in `FileTree`'s SSE handler.
   */
  loadCodeFile: async (
    filePath: string,
  ): Promise<{ path: string; content: string }> => {
    const cache = useCodeFileCacheStore.getState();
    const cached = cache.get(filePath);
    if (cached) {
      return { path: filePath, content: cached.content };
    }

    const url = getApiUrl(
      `/workspace/code-files/${filePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    );
    const headers = new Headers();
    for (const [k, v] of Object.entries(buildAuthHeaders())) {
      headers.set(k, v);
    }
    // The browser handles `If-None-Match` automatically from its HTTP cache;
    // we only need to populate the in-memory cache from the response.
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const err = new Error(text || `Request failed: ${response.status}`);
      (err as Error & { status?: number }).status = response.status;
      throw err;
    }

    const data = (await response.json()) as { path: string; content: string };
    const etag = response.headers.get("ETag");
    cache.set(filePath, data.content, etag);
    return data;
  },

  saveCodeFile: (filePath: string, content: string) =>
    request<{ path: string; size: number }>(
      `/workspace/code-files/${filePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    ).then((result) => {
      // Local edit: drop the cached entry — next read will refetch with the
      // server's new ETag. Cheaper than threading content through here.
      useCodeFileCacheStore.getState().invalidate(filePath);
      return result;
    }),

  /** Returns the URL for the SSE file-watch stream (Coding Mode). */
  getWatchUrl: () => getApiUrl("/workspace/watch"),

  /**
   * Returns the URL for a binary file (image, PDF, CSV) preview.
   * The browser can use this URL directly in <img>, <embed>, or fetch().
   */
  getBinaryFileUrl: (filePath: string) =>
    getApiUrl(
      `/workspace/binary-files/${filePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    ),

  // ---- Memory version control ----

  listMemoryVersions: (memoryPath: string, agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    const encoded = encodePath(memoryPath);
    return request<MemoryVersionInfo[]>(
      `/workspace/memory/${encoded}/versions${query}`,
    );
  },

  readMemoryVersion: (memoryPath: string, versionId: string, agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    const encoded = encodePath(memoryPath);
    return request<MdFileContent>(
      `/workspace/memory/${encoded}/versions/${encodeURIComponent(versionId)}${query}`,
    );
  },

  restoreMemoryVersion: (memoryPath: string, versionId: string, agentId?: string) => {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    const encoded = encodePath(memoryPath);
    return request<MdFileContent>(
      `/workspace/memory/${encoded}/versions/${encodeURIComponent(versionId)}/restore${query}`,
      { method: "POST" },
    );
  },
};
