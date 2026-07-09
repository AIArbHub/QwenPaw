import { request } from "../request";
import { getApiUrl, getApiToken } from "../config";

export type RoleCategory = "arbitrator" | "party" | "secretary" | "controller";
export type CollaborationMode = "human_lead" | "ai_lead" | "full_ai" | "full_human";
export type CaseStage =
  | "draft"
  | "filing"
  | "service"
  | "defense"
  | "arbitrator_selection"
  | "tribunal_formation"
  | "jurisdiction_objection"
  | "challenge"
  | "appraisal"
  | "merger"
  | "pre_hearing"
  | "hearing"
  | "deliberation"
  | "award"
  | "enforcement"
  | "closed";

export type EventType =
  | "stage_change"
  | "party_change"
  | "procedure_change"
  | "tribunal_change"
  | "claim_change"
  | "rule_change"
  | "collaboration_mode_change"
  | "procedural_application"
  | "procedural_decision"
  | "file_uploaded"
  | "file_shared"
  | "file_versioned"
  | "file_deleted";

export type FileVisibility = "private" | "shared" | "directed";

export interface MootParticipant {
  participant_id: string;
  agent_id: string;
  display_name: string;
  role: RoleCategory;
  role_detail: string;
  collaboration_mode: CollaborationMode;
  joined_at: number;
  active: boolean;
}

export interface MootMessage {
  id: string;
  participant_id: string;
  agent_id: string;
  display_name: string;
  role: RoleCategory;
  content: string;
  stage: CaseStage;
  timestamp: number;
  is_system: boolean;
}

export interface MootCaseEvent {
  event_id: string;
  event_type: EventType;
  description: string;
  data: Record<string, unknown>;
  timestamp: number;
  actor_participant_id: string | null;
}

export interface MootCaseFile {
  file_id: string;
  case_id: string;
  blob_id: string;
  filename: string;
  original_filename: string;
  description: string;
  owner_participant_id: string;
  visibility: FileVisibility;
  allowed_participant_ids: string[];
  category: string;
  tags: string[];
  version: number;
  parent_file_id: string | null;
  uploaded_at: number;
  updated_at: number;
}

export interface MootCaseData {
  case_id: string;
  case_name: string;
  case_description: string;
  status: string;
  current_stage: CaseStage;
  current_stage_label: string;
  rules: string[];
  controller_participant_id: string | null;
  participants: MootParticipant[];
  events: MootCaseEvent[];
  messages: MootMessage[];
  created_at: number;
  updated_at: number;
  current_speaker: string | null;
}

export interface MootCaseListItem {
  case_id: string;
  case_name: string;
  status: string;
  current_stage: CaseStage;
  current_stage_label: string;
  rules: string[];
  participants: MootParticipant[];
  message_count: number;
  event_count: number;
  created_at: number;
  current_speaker: string | null;
}

export interface CreateCaseParams {
  case_name?: string;
  case_description?: string;
  rules?: string[];
  template_id?: string;
}

export interface CaseTemplate {
  template_id: string;
  name: string;
  description: string;
  case_name: string;
  case_description: string;
  rules: string[];
  default_participants: { role: string; role_detail: string; display_name: string }[];
}

export interface ArbitrationRule {
  rule_id: string;
  name: string;
  name_en: string;
  edition: string;
  description: string;
}

export interface DocumentTemplate {
  doc_type: string;
  name: string;
  name_en: string;
  description: string;
}

export interface ScoringDimension {
  dimension_id: string;
  name: string;
  name_en: string;
  description: string;
}

export interface ScoreResult {
  dimension_id: string;
  dimension_name: string;
  score: number;
  reason: string;
}

export interface GenerateDocumentResult {
  case_id: string;
  doc_type: string;
  doc_name: string;
  content: string;
}

export interface ScoreParticipantResult {
  case_id: string;
  participant_id: string;
  participant_name: string;
  scores: ScoreResult[];
}

export interface AddParticipantParams {
  agent_id?: string;
  new_agent_name?: string;
  new_agent_description?: string;
  display_name: string;
  role: RoleCategory;
  role_detail?: string;
  collaboration_mode?: CollaborationMode;
}

export interface UpdateParticipantParams {
  collaboration_mode?: CollaborationMode;
  role_detail?: string;
  active?: boolean;
}

export interface SpeakParams {
  participant_id: string;
  content: string;
}

export interface AutoSpeakParams {
  participant_id: string;
  prompt?: string;
}

export interface StageTransitionParams {
  stage: CaseStage;
  description?: string;
}

export interface CaseEventParams {
  event_type: EventType;
  description: string;
  data?: Record<string, unknown>;
}

export const ROLE_CATEGORY_LABELS: Record<RoleCategory, string> = {
  arbitrator: "仲裁员",
  party: "当事人",
  secretary: "仲裁秘书",
  controller: "主控",
};

export const COLLABORATION_MODE_LABELS: Record<CollaborationMode, string> = {
  human_lead: "人主AI辅",
  ai_lead: "人辅AI主",
  full_ai: "全AI",
  full_human: "全人",
};

export const CASE_STAGE_LABELS: Record<CaseStage, string> = {
  draft: "草稿",
  filing: "立案",
  service: "送达",
  defense: "答辩",
  arbitrator_selection: "选定仲裁员",
  tribunal_formation: "组庭",
  jurisdiction_objection: "管辖权异议",
  challenge: "回避申请",
  appraisal: "鉴定",
  merger: "合并审理",
  pre_hearing: "庭前准备",
  hearing: "开庭审理",
  deliberation: "合议",
  award: "裁决",
  enforcement: "执行",
  closed: "结案",
};

export const ROLE_COLORS: Record<RoleCategory, string> = {
  arbitrator: "#722ed1",
  party: "#1890ff",
  secretary: "#fa8c16",
  controller: "#52c41a",
};

export const mootApi = {
  listTemplates: () => request<CaseTemplate[]>("/moot/templates"),

  listRules: () => request<ArbitrationRule[]>("/moot/rules"),

  listDocumentTemplates: () => request<DocumentTemplate[]>("/moot/document-templates"),

  listScoringDimensions: () => request<ScoringDimension[]>("/moot/scoring-dimensions"),

  generateDocument: (caseId: string, docType: string, participantId?: string) =>
    request<GenerateDocumentResult>(`/moot/${caseId}/generate-document`, {
      method: "POST",
      body: JSON.stringify({ doc_type: docType, participant_id: participantId }),
    }),

  scoreParticipant: (caseId: string, participantId: string, dimensionId?: string) =>
    request<ScoreParticipantResult>(`/moot/${caseId}/score`, {
      method: "POST",
      body: JSON.stringify({ participant_id: participantId, dimension_id: dimensionId }),
    }),

  create: (params: CreateCaseParams) =>
    request<{
      case_id: string;
      case_name: string;
      status: string;
      current_stage: string;
      rules: string[];
    }>("/moot/create", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  listCases: () => request<MootCaseListItem[]>("/moot/cases"),

  getCase: (caseId: string) =>
    request<MootCaseData>(`/moot/${encodeURIComponent(caseId)}`),

  addParticipant: (caseId: string, params: AddParticipantParams) =>
    request<{
      participant_id: string;
      agent_id: string;
      display_name: string;
      role: string;
      role_detail: string;
      collaboration_mode: string;
    }>(`/moot/${encodeURIComponent(caseId)}/participants`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  updateParticipant: (
    caseId: string,
    participantId: string,
    params: UpdateParticipantParams,
  ) =>
    request<{
      participant_id: string;
      collaboration_mode: string;
      role_detail: string;
      active: boolean;
    }>(
      `/moot/${encodeURIComponent(caseId)}/participants/${encodeURIComponent(participantId)}`,
      { method: "PATCH", body: JSON.stringify(params) },
    ),

  removeParticipant: (caseId: string, participantId: string) =>
    request<{ success: boolean }>(
      `/moot/${encodeURIComponent(caseId)}/participants/${encodeURIComponent(participantId)}`,
      { method: "DELETE" },
    ),

  advanceStage: (caseId: string, params: StageTransitionParams) =>
    request<{
      case_id: string;
      status: string;
      current_stage: string;
      current_stage_label: string;
    }>(`/moot/${encodeURIComponent(caseId)}/stage`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  addCaseEvent: (caseId: string, params: CaseEventParams) =>
    request<{
      event_id: string;
      event_type: string;
      description: string;
      timestamp: number;
    }>(`/moot/${encodeURIComponent(caseId)}/events`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  speak: (caseId: string, params: SpeakParams) =>
    request<{
      id: string;
      participant_id: string;
      agent_id: string;
      display_name: string;
      role: string;
      content: string;
      stage: string;
      timestamp: number;
      is_system: boolean;
    }>(`/moot/${encodeURIComponent(caseId)}/speak`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  autoSpeak: (caseId: string, params: AutoSpeakParams) =>
    request<{
      id: string;
      participant_id: string;
      agent_id: string;
      display_name: string;
      role: string;
      content: string;
      stage: string;
      timestamp: number;
      is_system: boolean;
    }>(`/moot/${encodeURIComponent(caseId)}/auto-speak`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  deleteCase: (caseId: string) =>
    request<{ success: boolean }>(`/moot/${encodeURIComponent(caseId)}`, {
      method: "DELETE",
    }),

  streamUrl: (caseId: string) => {
    const base = getApiUrl(`/moot/${encodeURIComponent(caseId)}/stream`);
    const token = getApiToken();
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },

  // ── Dynamic case modification ──────────────────────────────────────────────

  addParty: (caseId: string, params: AddParticipantParams) =>
    request<{
      participant_id: string;
      agent_id: string;
      display_name: string;
      role: string;
      role_detail: string;
      collaboration_mode: string;
    }>(`/moot/${encodeURIComponent(caseId)}/add-party`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  changeProcedure: (
    caseId: string,
    rules?: string[],
    description?: string,
  ) =>
    request<{
      case_id: string;
      rules: string[];
      case_description: string;
    }>(`/moot/${encodeURIComponent(caseId)}/procedure-change`, {
      method: "POST",
      body: JSON.stringify({ rules, description }),
    }),

  changeTribunal: (caseId: string, description: string, data?: Record<string, unknown>) =>
    request<{ case_id: string; updated_at: number }>(
      `/moot/${encodeURIComponent(caseId)}/tribunal-change`,
      {
        method: "POST",
        body: JSON.stringify({ description, data: data || {} }),
      },
    ),

  changeClaims: (
    caseId: string,
    description: string,
    actorParticipantId?: string,
  ) =>
    request<{
      case_id: string;
      case_description: string;
      updated_at: number;
    }>(`/moot/${encodeURIComponent(caseId)}/claim-change`, {
      method: "POST",
      body: JSON.stringify({ description, actor_participant_id: actorParticipantId }),
    }),

  submitProceduralApplication: (
    caseId: string,
    eventType: EventType,
    description: string,
    actorParticipantId?: string,
  ) =>
    request<{ case_id: string; description: string }>(
      `/moot/${encodeURIComponent(caseId)}/procedural-application`,
      {
        method: "POST",
        body: JSON.stringify({
          event_type: eventType,
          description,
          actor_participant_id: actorParticipantId,
        }),
      },
    ),

  // ── File management ──────────────────────────────────────────────────────

  uploadFile: (
    caseId: string,
    file: File,
    ownerParticipantId: string,
    visibility: FileVisibility = "private",
    allowedParticipants: string[] = [],
    category: string = "",
    tags: string[] = [],
    description: string = "",
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("owner_participant_id", ownerParticipantId);
    formData.append("visibility", visibility);
    formData.append("allowed_participants", JSON.stringify(allowedParticipants));
    formData.append("category", category);
    formData.append("tags", JSON.stringify(tags));
    formData.append("description", description);
    return request<MootCaseFile>(`/moot/${encodeURIComponent(caseId)}/files`, {
      method: "POST",
      body: formData,
      headers: {},
    });
  },

  listFiles: (caseId: string, participantId?: string) => {
    const params = participantId ? `?participant_id=${encodeURIComponent(participantId)}` : "";
    return request<MootCaseFile[]>(`/moot/${encodeURIComponent(caseId)}/files${params}`);
  },

  downloadFile: (caseId: string, fileId: string) => {
    const base = getApiUrl(`/moot/${encodeURIComponent(caseId)}/files/${encodeURIComponent(fileId)}/content`);
    const token = getApiToken();
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },

  updateFileVisibility: (
    caseId: string,
    fileId: string,
    visibility: FileVisibility,
    allowedParticipants?: string[],
  ) =>
    request<MootCaseFile>(
      `/moot/${encodeURIComponent(caseId)}/files/${encodeURIComponent(fileId)}/visibility`,
      {
        method: "PUT",
        body: JSON.stringify({ visibility, allowed_participant_ids: allowedParticipants }),
      },
    ),

  deleteFile: (caseId: string, fileId: string) =>
    request<{ success: boolean }>(
      `/moot/${encodeURIComponent(caseId)}/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
    ),

  getFileVersions: (caseId: string, fileId: string) =>
    request<MootCaseFile[]>(
      `/moot/${encodeURIComponent(caseId)}/files/${encodeURIComponent(fileId)}/versions`,
    ),
};