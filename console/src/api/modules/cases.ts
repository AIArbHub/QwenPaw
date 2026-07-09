import { request } from "../request";

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
}

export interface CaseFile {
  file_name: string;
  file_path: string;
  file_type: string;
  size: number;
  status: string;
  parsed_path: string;
}

export interface CaseListResponse {
  cases: CaseRef[];
  total: number;
}

export interface CaseDetailResponse {
  case: CaseRef;
  files: CaseFile[];
}

export const casesApi = {
  addCase: (
    data: {
      case_name?: string;
      source_path: string;
      scan_mode?: string;
      tags?: string[];
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
};