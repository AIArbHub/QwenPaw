export interface MdFileInfo {
  filename: string;
  path: string;
  size: number;
  created_time: string;
  modified_time: string;
}

export interface MdFileContent {
  content: string;
}

export interface MarkdownFile extends MdFileInfo {
  updated_at: number;
  enabled?: boolean;
  memory_path?: string;
  /** When true, this file lives in the work directory and must be
   * read/written via the /work-files API instead of /files. */
  is_work_file?: boolean;
  /** Relative path within the work directory (used for work files). */
  work_file_path?: string;
}

export interface DailyMemoryFile extends MdFileInfo {
  date: string;
  updated_at: number;
}

export interface MemoryStats {
  file_count: number;
  daily_count: number;
  digest_count: number;
  total_size: number;
  latest_modified: string;
}

export interface MemoryStatus {
  initialized: boolean;
  started: boolean;
  backend: string;
  error: string | null;
}

export interface MemorySearchResult {
  success: boolean;
  answer: string;
  query?: string;
  error?: string;
}

export interface TestEmbeddingResult {
  success: boolean;
  latency_ms: number;
  dimensions?: number;
  error: string | null;
}

export interface ReindexResult {
  success: boolean;
  answer?: string;
  error?: string | null;
}

export interface MemoryVersionInfo {
  version_id: string;
  filename: string;
  size: number;
  created_time: string;
  modified_time: string;
}

// ---- Work directory types ----

export interface WorkDirConfig {
  enabled: boolean;
  base_dir: string | null;
  session_isolation: boolean;
  subfolder_pattern: string;
  resolved_preview: string | null;
}

export interface WorkFileInfo {
  filename: string;
  path: string;
  size: number;
  modified_time?: string;
}
