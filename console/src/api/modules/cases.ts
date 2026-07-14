import { request } from "../request";

// ── Material Access Permission Zones ────────────────────────────────────────

export type MaterialZone =
  | "shared"        // 共有材料
  | "claimant"      // 申请人独享
  | "respondent"    // 被申请人独享
  | "arbitrator"    // 仲裁员独享
  | "secretary";    // 仲裁秘书独享

export const MATERIAL_ZONE_LABELS: Record<MaterialZone, string> = {
  shared: "共有材料",
  claimant: "申请人独享",
  respondent: "被申请人独享",
  arbitrator: "仲裁员独享",
  secretary: "仲裁秘书独享",
};

export const MATERIAL_ZONE_COLORS: Record<MaterialZone, string> = {
  shared: "#1890ff",
  claimant: "#52c41a",
  respondent: "#f5222d",
  arbitrator: "#722ed1",
  secretary: "#fa8c16",
};

// ── Case Structured Info ────────────────────────────────────────────────────

export interface CaseParty {
  party_id: string;
  party_type: "claimant" | "respondent";
  name: string;
  legal_representative?: string;
  contact?: string;
  address?: string;
  counsel?: string;  // 代理人
}

export interface CaseStructuredInfo {
  case_number?: string;           // 案号
  arbitration_institution?: string; // 仲裁机构
  dispute_type?: string;          // 争议类型
  claim_amount?: number;          // 争议金额
  arbitration_procedure?: string; // 仲裁程序（普通/简易/特别）
  arbitration_rules?: string;     // 适用仲裁规则
  filing_date?: string;           // 立案日期
  hearing_date?: string;          // 开庭日期
  parties: CaseParty[];           // 当事人信息
  case_summary?: string;          // 案情摘要
}

// ── File Tag ────────────────────────────────────────────────────────────────

export interface FileTag {
  tag_id: string;
  case_id: string;
  file_path: string;
  zone: MaterialZone;
  category: string;      // 文件分类（如：证据、申请书、答辩状等）
  custom_tags: string[]; // 用户自定义标签
  description?: string;
  created_at: number;
  updated_at: number;
}

export interface UpdateFileTagParams {
  zone?: MaterialZone;
  category?: string;
  custom_tags?: string[];
  description?: string;
}

// ── AI Organize Result ──────────────────────────────────────────────────────

export interface AIOrganizeResult {
  case_id: string;
  backup_path: string;
  organized_files: {
    file_path: string;
    original_path: string;
    new_zone: MaterialZone;
    new_category: string;
    reason: string;
  }[];
  summary: string;
  timestamp: number;
}

// ── Existing types (enhanced) ───────────────────────────────────────────────

export interface CaseRef {
  case_id: string;
  case_name: string;
  source_path: string;
  scan_mode: string;
  tags: string[];
  file_count: number;
  total_size: number;
  index_status: string;
  last_scanned: string;
  enabled: boolean;
  structured_info?: CaseStructuredInfo;
}

export interface CaseFile {
  file_name: string;
  file_path: string;
  file_type: string;
  size: number;
  status: string;
  parsed_path: string;
  zone?: MaterialZone;
  category?: string;
  custom_tags?: string[];
}

export interface CaseListResponse {
  cases: CaseRef[];
  total: number;
}

export interface CaseDetailResponse {
  case: CaseRef;
  files: CaseFile[];
  file_tags?: FileTag[];
}

// ── AI Chat within Case ─────────────────────────────────────────────────────

export interface CaseAIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  documents?: { name: string; content: string; format: string }[];
}

export interface CaseAIChatResponse {
  response: string;
  referenced_files: string[];
  documents_generated?: { name: string; format: string; content: string }[];
}

export const casesApi = {
  addCase: (
    data: {
      case_name?: string;
      source_path: string;
      scan_mode?: string;
      tags?: string[];
      structured_info?: CaseStructuredInfo;
    },
    agentId?: string,
  ) =>
    request<CaseRef>(
      `/cases/add${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  listCases: (agentId?: string) =>
    request<CaseListResponse>(
      `/cases/list${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
    ),

  getCase: (caseId: string, agentId?: string) =>
    request<CaseDetailResponse>(
      `/cases/${caseId}${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
    ),

  deleteCase: (caseId: string, agentId?: string) =>
    request<{ status: string; case_id: string }>(
      `/cases/${caseId}${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
      { method: "DELETE" },
    ),

  rescanCase: (caseId: string, agentId?: string) =>
    request<{ status: string; case: CaseRef }>(
      `/cases/${caseId}/rescan${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
      { method: "POST" },
    ),

  parseCase: (
    caseId: string,
    params?: { scan_mode?: string; force?: boolean },
    agentId?: string,
  ) =>
    request<{ status: string; case_id: string }>(
      `/cases/${caseId}/parse${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(params || {}),
      },
    ),

  getCaseParsedFile: (
    caseId: string,
    fileId: string,
    agentId?: string,
  ) =>
    request<{ file_id: string; content: string }>(
      `/cases/${caseId}/parsed/${encodeURIComponent(fileId)}${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
    ),

  getCaseDesensitizedFile: (
    caseId: string,
    fileId: string,
    agentId?: string,
  ) =>
    request<{ file_id: string; content: string }>(
      `/cases/${caseId}/desensitized/${encodeURIComponent(fileId)}${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
    ),

  restoreCaseFile: (
    caseId: string,
    fileId: string,
    agentId?: string,
  ) =>
    request<{ file_id: string; content: string; restored: boolean }>(
      `/cases/${caseId}/restore/${encodeURIComponent(fileId)}${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({ authorize: true }),
      },
    ),

  exportCaseFiles: (
    caseId: string,
    params: {
      file_ids?: string[];
      restore?: boolean;
      authorize?: boolean;
    },
    agentId?: string,
  ) =>
    request<{
      case_id: string;
      results: { file_id: string; status: string; content?: string; note?: string }[];
      restored: boolean;
    }>(
      `/cases/${caseId}/export${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(params),
      },
    ),

  // ── Structured Info ───────────────────────────────────────────────────────

  updateStructuredInfo: (
    caseId: string,
    info: Partial<CaseStructuredInfo>,
  ) =>
    request<{ case_id: string; structured_info: CaseStructuredInfo }>(
      `/cases/${caseId}/structured-info`,
      { method: "PUT", body: JSON.stringify(info) },
    ),

  // ── File Tagging ──────────────────────────────────────────────────────────

  updateFileTag: (
    caseId: string,
    filePath: string,
    params: UpdateFileTagParams,
  ) =>
    request<FileTag>(
      `/cases/${caseId}/files/tag`,
      {
        method: "PUT",
        body: JSON.stringify({ file_path: filePath, ...params }),
      },
    ),

  batchUpdateFileTags: (
    caseId: string,
    updates: { file_path: string; zone?: MaterialZone; category?: string; custom_tags?: string[] }[],
  ) =>
    request<{ updated: number; tags: FileTag[] }>(
      `/cases/${caseId}/files/batch-tag`,
      {
        method: "POST",
        body: JSON.stringify({ updates }),
      },
    ),

  // ── AI Organize (backup then organize) ────────────────────────────────────

  aiOrganize: (
    caseId: string,
    params?: { dry_run?: boolean; backup_path?: string },
  ) =>
    request<AIOrganizeResult>(
      `/cases/${caseId}/ai-organize`,
      {
        method: "POST",
        body: JSON.stringify(params || {}),
      },
    ),

  // ── Case AI Chat (omniscient perspective) ─────────────────────────────────

  caseAIChat: (
    caseId: string,
    messages: CaseAIChatMessage[],
    params?: { generate_doc?: boolean; doc_format?: string; doc_name?: string },
  ) =>
    request<CaseAIChatResponse>(
      `/cases/${caseId}/ai-chat`,
      {
        method: "POST",
        body: JSON.stringify({ messages, ...params }),
      },
    ),

  // ── Scan local folder to create one or more cases ─────────────────────────

  scanFolder: (
    folderPath: string,
    params?: { auto_create_cases?: boolean; case_name_prefix?: string },
  ) =>
    request<{
      scanned: { path: string; is_case_folder: boolean; suggested_name?: string; file_count: number }[];
      suggested_cases: { folder_path: string; suggested_name: string; file_count: number }[];
    }>(
      `/cases/scan-folder`,
      {
        method: "POST",
        body: JSON.stringify({ folder_path: folderPath, ...params }),
      },
    ),
};
