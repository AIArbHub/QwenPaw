import { request } from "../request";

// ── Types ───────────────────────────────────────────────────

export interface IntakeResult {
  success: boolean;
  doc_id: string;
  doc_type: string;
  doc_type_label: string;
  doc_type_confidence: number;
  source_hash: string;
  page_count: number;
  block_count: number;
  char_count: number;
  ocr_engine: string;
  ocr_confidence: number;
  human_review_recommended: boolean;
  warnings: string[];
  recommendations: string[];
  markdown_preview: string;
  semantic_summary: {
    chunk_count: number;
    entity_count: number;
    clause_ref_count: number;
    has_article_structure: boolean;
  };
  outputs: {
    markdown: string;
    ldir_json: string;
    semantic_json: string;
    intake_report: string;
  };
}

export interface IntakeTextResult {
  success: boolean;
  doc_type: string;
  doc_type_label: string;
  confidence: number;
  matched_keywords: { keyword: string; doc_type: string; count: number }[];
  char_count: number;
  entity_preview: {
    type: string;
    text: string;
    normalized: string;
    confidence: number;
  }[];
  entity_type_counts: Record<string, number>;
}

export interface RedactTextResult {
  success: boolean;
  redacted_text: string;
  mappings: RedactionMapping[];
  entity_count: number;
  review_items: RedactionMapping[];
  policy_name: string;
  cluster_table: EntityClusterEntry[];
  output_file?: string;
  mapping_file?: string;
  document_name?: string;
  output_format?: string;
}

export interface RedactionMapping {
  entity_id: string;
  entity_type: string;
  original: string;
  redacted: string;
  mode: string;
  start: number;
  end: number;
  page_number: number | null;
  confidence: number;
  cluster_id: string | null;
  alias_of: string | null;
}

export interface EntityClusterEntry {
  cluster_id: string;
  canonical: string;
  entity_type: string;
  redacted: string;
  mentions: string[];
}

export interface RestoreResult {
  success: boolean;
  restored_text: string;
  replacements: { redacted: string; original: string }[];
  unmatched: string[];
}

export interface EntityTypeEntry {
  id: string;
  name: string;
  description: string;
}

export interface PolicyEntry {
  id: string;
  name: string;
  description: string;
}

export interface ModeEntry {
  id: string;
  example: string;
  description: string;
}

export interface StrengthLevelEntry {
  id: string;
  name: string;
  description: string;
}

export type RedactionMode = "standard" | "agent_enhanced";

export type OutputFormat = "md" | "docx" | "pdf" | "txt";

export interface BatchRedactResult {
  success: boolean;
  total_files: number;
  success_count: number;
  fail_count: number;
  total_entity_count: number;
  results: (RedactTextResult & { file: string; error?: string })[];
}

/** 单个文件批量结果（用于实时进度展示） */
export interface BatchFileResult {
  file: string;
  success?: boolean;
  entity_count?: number;
  output_file?: string;
  mapping_file?: string;
  error?: string;
}

/** SSE 流式事件类型（批量脱敏逐文件推送） */
export interface BatchSSEEvent {
  type: "start" | "progress" | "result" | "done" | "error";
  total_files?: number;
  file?: string;
  index?: number;
  total?: number;
  success?: boolean;
  entity_count?: number;
  output_file?: string;
  mapping_file?: string;
  error?: string;
  success_count?: number;
  fail_count?: number;
  total_entity_count?: number;
}

export interface DocTypeEntry {
  id: string;
  label: string;
}

// ── API ─────────────────────────────────────────────────────

export const documentToolsApi = {
  /** Upload a document and run the full LDIR intake pipeline */
  intakeUpload: (file: File, outputDir?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (outputDir) form.append("output_dir", outputDir);
    return request<IntakeResult>("/document-tools/intake/upload", {
      method: "POST",
      body: form,
    });
  },

  /** Analyze pasted text: infer document type and extract entities */
  intakeText: (text: string, docId?: string) =>
    request<IntakeTextResult>("/document-tools/intake/text", {
      method: "POST",
      body: JSON.stringify({ text, doc_id: docId || "pasted_text" }),
    }),

  /** Read previously generated intake artifacts by doc_id */
  getIntakeResult: (docId: string) =>
    request<Record<string, unknown>>(
      `/document-tools/intake/result/${encodeURIComponent(docId)}`,
    ),

  /** Run redaction on plain text */
  redactText: (payload: {
    text: string;
    policy?: string;
    entity_types?: string[];
    custom_rules?: Record<string, string>;
    strength_level?: string;
  }) =>
    request<RedactTextResult>("/document-tools/redact/text", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Upload a file and run redaction */
  redactUpload: (
    file: File,
    options?: {
      policy?: string;
      entityTypes?: string[];
      strengthLevel?: string;
      outputFormat?: OutputFormat;
      documentName?: string;
    },
  ) => {
    const form = new FormData();
    form.append("file", file);
    const opts = options || {};
    if (opts.policy) form.append("policy", opts.policy);
    if (opts.entityTypes?.length)
      form.append("entity_types", JSON.stringify(opts.entityTypes));
    if (opts.strengthLevel) form.append("strength_level", opts.strengthLevel);
    if (opts.outputFormat) form.append("output_format", opts.outputFormat);
    if (opts.documentName) form.append("document_name", opts.documentName);
    return request<RedactTextResult & { output_file?: string; mapping_file?: string }>(
      "/document-tools/redact/upload",
      { method: "POST", body: form },
    );
  },

  /** Restore redacted text using a mapping file content */
  restoreText: (text: string, mappingJson: string) =>
    request<RestoreResult>("/document-tools/restore", {
      method: "POST",
      body: JSON.stringify({ text, mapping_json: mappingJson }),
    }),

  /** List supported entity types */
  listEntities: () =>
    request<{ success: boolean; entity_types: EntityTypeEntry[] }>(
      "/document-tools/entities",
    ),

  /** List redaction policies */
  listPolicies: () =>
    request<{ success: boolean; policies: PolicyEntry[] }>(
      "/document-tools/policies",
    ),

  /** List redaction modes */
  listModes: () =>
    request<{ success: boolean; modes: ModeEntry[] }>(
      "/document-tools/modes",
    ),

  /** List strength levels */
  listStrengthLevels: () =>
    request<{ success: boolean; strength_levels: StrengthLevelEntry[] }>(
      "/document-tools/strength-levels",
    ),

  /** List supported document types */
  listDocTypes: () =>
    request<{ success: boolean; doc_types: DocTypeEntry[] }>(
      "/document-tools/doc-types",
    ),

  /** Batch redact multiple files (SSE streaming — returns EventSource-compatible response) */
  batchRedact: (
    files: File[],
    options?: {
      policy?: string;
      entityTypes?: string[];
      strengthLevel?: string;
    },
    onProgress?: (event: BatchSSEEvent) => void,
    onDone?: (summary: BatchRedactResult) => void,
    onError?: (error: string) => void,
  ) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    const opts = options || {};
    if (opts.policy) form.append("policy", opts.policy);
    if (opts.entityTypes?.length)
      form.append("entity_types", JSON.stringify(opts.entityTypes));
    if (opts.strengthLevel) form.append("strength_level", opts.strengthLevel);

    // Use fetch directly for SSE streaming support
    const url = "/document-tools/redact/batch";
    return fetch(url, {
      method: "POST",
      body: form,
      headers: { Accept: "text/event-stream" },
    }).then(async (response) => {
      if (!response.ok) {
        const errText = await response.text().catch(() => "Batch redaction failed");
        opts.onError?.(errText);
        throw new Error(errText);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        // Fallback: parse as non-streaming JSON
        const data = await response.json();
        opts.onDone?.(data);
        return data;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as BatchSSEEvent;
              if (event.type === "progress") {
                opts.onProgress?.(event);
              } else if (event.type === "result") {
                opts.onProgress?.(event); // Also treat as progress update
              } else if (event.type === "done") {
                opts.onDone?(event as unknown as BatchRedactResult): void 0;
              } else if (event.type === "error") {
                opts.onError?.(event.error || "Unknown error");
              }
            } catch { /* skip malformed */ }
          }
        }
      }
      return null; // Streaming complete, results delivered via callbacks
    });
  },

  /** Agent-enhanced redaction with LLM deep semantic review */
  agentEnhancedRedact: (options: {
    text: string;
    policy?: string;
    entityTypes?: string[];
    strengthLevel?: string;
    provider_id?: string;  // Optional: override provider for agent model
    model_id?: string;     // Optional: override model ID for agent
  }) =>
    request<RedactTextResult & {
      agent_mode?: string;
      agent_review?: Record<string, any> | null;
      has_agent_suggestions?: boolean;
      agent_suggestions?: Array<{
        original: string;
        entity_type: string;
        suggested_replacement: string;
        reason: string;
      }>;
    }>("/document-tools/redact/agent-enhanced", {
      method: "POST",
      body: options,
      // Agent enhanced mode involves LLM call — use longer timeout (2 min)
      timeout: 120000,
    }),

  // ---- OCR Configuration API ----

  /** Get current OCR configuration and available engines */
  getOCRConfig: () =>
    request<{
      success: boolean;
      config: Record<string, any>;
      available_engines: string[];
      engines: Record<string, {
        name: string;
        description: string;
        installed: boolean;
        install: string;
        hw_req: string;
      }>;
      config_file: string;
      has_any_engine: boolean;
    }>("/document-tools/ocr/config"),

  /** Update OCR configuration */
  updateOCRConfig: (body: {
    // New structure (recommended)
    text_engine?: {
      mode?: string;           // "local" | "cloud_api"
      provider?: string;       // Engine/provider name
      api_key?: string;        // API key for cloud
      endpoint?: string;       // Custom endpoint URL
      use_gpu?: boolean;       // GPU toggle (local mode)
      model_size?: string;    // Model size: small/medium/large/auto
    };
    layout_parser?: {
      mode?: string;           // "local" | "cloud_api"
      provider?: string;       // "mineru-local" | "mineru-cloud" | "custom"
      api_key?: string;
      endpoint?: string;
      use_gpu?: boolean;
      model_size?: string;
    } | null;                  // null = disabled

    // Common settings
    language?: string;
    confidence_threshold?: number;
    dpi?: number;
    enable_ocr?: boolean;
    fallback_to_cloud?: boolean;

    // Legacy fields (still supported for backward compatibility)
    engine_type?: string;
    fallback_engines?: string[];
    mode?: string;
    use_gpu?: boolean;
    cloud_api_key?: string;
    cloud_api_url?: string;
    mineru_enabled?: boolean;
    mineru_mode?: string;
  }) =>
    request<{
      success: boolean;
      message: string;
      config: Record<string, any>;
      available_engines: string[];
      restart_note: string;
    }>("/document-tools/ocr/config", { method: "PUT", body: JSON.stringify(body) }),

  /** Quick check: which OCR engines are installed? */
  listOCREngines: () =>
    request<{
      success: boolean;
      available: string[];
      count: number;
      has_local: boolean;
      has_cloud: boolean;
      recommendation: string;
    }>("/document-tools/ocr/engines"),

  /** Auto-install OCR engine dependencies (detects mirror automatically) */
  installOCREngines: (engine: string = "auto", useMirror?: boolean) =>
    request<{
      success: boolean;
      message: string;
      installed_packages: string[];
      mirror_used: boolean;
      available_engines: string[];
      stderr_tail?: string;
      stdout_tail?: string;
    }>(`/document-tools/ocr/install?engine=${encodeURIComponent(engine)}${useMirror !== undefined ? `&use_mirror=${useMirror}` : ""}`, {
      method: "POST",
      timeout: 300000, // 5 minutes for large packages like paddlepaddle
    }),
};
