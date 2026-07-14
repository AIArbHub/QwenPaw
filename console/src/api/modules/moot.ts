import { request } from "../request";
import { getApiUrl, getApiToken } from "../config";

export type RoleCategory = "arbitrator" | "party" | "counsel" | "secretary" | "controller";
export type CollaborationMode = "human_lead" | "ai_lead" | "full_ai" | "full_human";
export type TrialStyle = "civil_style" | "common_style";
export type Side = "claimant" | "respondent" | "neutral";
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
  | "award"
  | "enforcement"
  | "opening"
  | "pleading"
  | "evidence"
  | "debate"
  | "closing"
  | "deliberation"
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
  side: Side;
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
  trial_style: TrialStyle;
  global_collaboration_mode: CollaborationMode;
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
  trial_style: TrialStyle;
  global_collaboration_mode: CollaborationMode;
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
  trial_style?: TrialStyle;
  global_collaboration_mode?: CollaborationMode;
  template_id?: string;
}

export interface CaseTemplate {
  template_id: string;
  name: string;
  description: string;
  case_name: string;
  case_description: string;
  rules: string[];
  default_participants: { role: string; role_detail: string; display_name: string; side?: string }[];
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
  side?: Side;
  collaboration_mode?: CollaborationMode;
}

export interface UpdateParticipantParams {
  collaboration_mode?: CollaborationMode;
  role_detail?: string;
  side?: Side;
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
  counsel: "代理人",
  secretary: "仲裁秘书",
  controller: "主控",
};

export const COLLABORATION_MODE_LABELS: Record<CollaborationMode, string> = {
  human_lead: "人主导",
  ai_lead: "AI主导",
  full_ai: "AI全自动",
  full_human: "纯人工",
};

export const TRIAL_STYLE_LABELS: Record<TrialStyle, string> = {
  civil_style: "大陆法系风格",
  common_style: "普通法系风格",
};

export const SIDE_LABELS: Record<Side, string> = {
  claimant: "申请人方",
  respondent: "被申请人方",
  neutral: "中立",
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
  award: "裁决",
  enforcement: "执行",
  opening: "开庭准备",
  pleading: "陈述与答辩",
  evidence: "举证质证",
  debate: "辩论",
  closing: "最后陈述",
  deliberation: "合议与裁决",
  closed: "结案",
};

export const ROLE_COLORS: Record<RoleCategory, string> = {
  arbitrator: "#722ed1",
  party: "#1890ff",
  counsel: "#52c41a",
  secretary: "#fa8c16",
  controller: "#52c41a",
};

export const SIDE_COLORS: Record<Side, string> = {
  claimant: "#1890ff",
  respondent: "#f5222d",
  neutral: "#8c8c8c",
};

// Trial stages used by the new trial flow (in order)
export const TRIAL_STAGE_FLOW: CaseStage[] = [
  "opening",
  "pleading",
  "evidence",
  "debate",
  "closing",
  "deliberation",
  "closed",
];

export interface TrialStageDef {
  id: string;
  name: string;
  name_en: string;
  description: string;
  speaker_order: string[];
}

export interface TrialStyleTemplate {
  style_id: string;
  name: string;
  name_en: string;
  description: string;
  stages: TrialStageDef[];
  default_participants: {
    display_name: string;
    role: string;
    side: string;
    role_detail: string;
  }[];
  ai_prompt_guidance: string;
}

export interface AdvanceTrialResult {
  case_id: string;
  current_stage: string;
  current_stage_label: string;
  messages_sent: number;
  advanced_to_next: boolean;
  message?: string;
}

export const mootApi = {
  listTrialStyles: () => request<TrialStyleTemplate[]>("/moot/trial-styles"),

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
      trial_style: string;
      global_collaboration_mode: string;
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

  advanceTrial: (caseId: string) =>
    request<AdvanceTrialResult>(`/moot/${encodeURIComponent(caseId)}/advance-trial`, {
      method: "POST",
    }),

  advanceToNextStage: (caseId: string) =>
    request<{
      case_id: string;
      current_stage: string;
      current_stage_label: string;
    }>(`/moot/${encodeURIComponent(caseId)}/advance-to-next-stage`, {
      method: "POST",
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

  // ── Award generation & review ─────────────────────────────────────────────

  generateAward: (
    caseId: string,
    params: {
      template_type?: "domestic" | "international";
      institution_name?: string;
      custom_instructions?: string;
    },
  ) =>
    request<AwardDraft>(`/moot/${encodeURIComponent(caseId)}/award/generate`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  getAward: (caseId: string) =>
    request<AwardDraft | null>(`/moot/${encodeURIComponent(caseId)}/award`),

  updateAward: (caseId: string, content: string) =>
    request<AwardDraft>(`/moot/${encodeURIComponent(caseId)}/award`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  reviewAward: (
    caseId: string,
    params: {
      rule_ids?: string[];
      custom_instructions?: string;
    },
  ) =>
    request<ReviewReport>(`/moot/${encodeURIComponent(caseId)}/award/review`, {
      method: "POST",
      body: JSON.stringify(params),
    }),

  getReviewReport: (caseId: string) =>
    request<ReviewReport | null>(`/moot/${encodeURIComponent(caseId)}/award/review-report`),

  exportAward: (caseId: string, format: "markdown" | "docx") =>
    request<{ url: string; filename: string }>(
      `/moot/${encodeURIComponent(caseId)}/award/export`,
      {
        method: "POST",
        body: JSON.stringify({ format }),
      },
    ),

  // ── Review rules ──────────────────────────────────────────────────────────

  listReviewRules: () => request<ReviewRule[]>("/moot/review-rules"),

  createReviewRule: (params: CreateReviewRuleParams) =>
    request<ReviewRule>("/moot/review-rules", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  updateReviewRule: (ruleId: string, params: Partial<CreateReviewRuleParams>) =>
    request<ReviewRule>(`/moot/review-rules/${encodeURIComponent(ruleId)}`, {
      method: "PATCH",
      body: JSON.stringify(params),
    }),

  deleteReviewRule: (ruleId: string) =>
    request<{ success: boolean }>(`/moot/review-rules/${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
    }),

  listReviewRuleCategories: () =>
    request<ReviewRuleCategory[]>("/moot/review-rules/categories"),
};

// ── Award & Review types ───────────────────────────────────────────────────

export type AwardTemplateType = "domestic" | "international";

export type ReviewIssueCategory = "format" | "text" | "law" | "content" | "expression";
export type ReviewIssueSeverity = "must_fix" | "suggest_fix";

export interface AwardSection {
  section_id: string;
  title: string;
  content: string;
  order: number;
}

export interface AwardDraft {
  award_id: string;
  case_id: string;
  template_type: AwardTemplateType;
  institution_name: string;
  content: string;
  sections: AwardSection[];
  generated_at: number;
  updated_at: number;
  version: number;
}

export interface ReviewIssue {
  issue_id: string;
  rule_id: string;
  rule_name: string;
  category: ReviewIssueCategory;
  severity: ReviewIssueSeverity;
  section_title: string;
  position_description: string;
  problem_description: string;
  suggestion: string;
  original_text?: string;
  corrected_text?: string;
}

export interface ReviewReport {
  report_id: string;
  award_id: string;
  case_id: string;
  case_name: string;
  template_type: AwardTemplateType;
  institution_name: string;
  total_issues: number;
  must_fix_count: number;
  suggest_fix_count: number;
  issues_by_category: Record<ReviewIssueCategory, number>;
  issues: ReviewIssue[];
  reviewed_at: number;
  rule_version: string;
}

export interface ReviewRule {
  rule_id: string;
  name: string;
  category: ReviewIssueCategory;
  sub_category: string;
  description: string;
  severity: ReviewIssueSeverity;
  detection_logic: string;
  suggestion_template: string;
  is_builtin: boolean;
  is_active: boolean;
  applicable_template_types: AwardTemplateType[];
  created_at: number;
  updated_at: number;
}

export interface CreateReviewRuleParams {
  name: string;
  category: ReviewIssueCategory;
  sub_category: string;
  description: string;
  severity: ReviewIssueSeverity;
  detection_logic: string;
  suggestion_template: string;
  is_active?: boolean;
  applicable_template_types?: AwardTemplateType[];
}

export interface ReviewRuleCategory {
  category: ReviewIssueCategory;
  label: string;
  sub_categories: string[];
  builtin_count: number;
  custom_count: number;
}

export const REVIEW_ISSUE_CATEGORY_LABELS: Record<ReviewIssueCategory, string> = {
  format: "格式",
  text: "文字",
  law: "法律",
  content: "内容",
  expression: "表述",
};

export const REVIEW_ISSUE_SEVERITY_LABELS: Record<ReviewIssueSeverity, string> = {
  must_fix: "必须修改",
  suggest_fix: "建议修改",
};

export const REVIEW_ISSUE_CATEGORY_COLORS: Record<ReviewIssueCategory, string> = {
  format: "#fa8c16",
  text: "#1890ff",
  law: "#f5222d",
  content: "#722ed1",
  expression: "#13c2c2",
};

export const REVIEW_ISSUE_SEVERITY_COLORS: Record<ReviewIssueSeverity, string> = {
  must_fix: "#f5222d",
  suggest_fix: "#faad14",
};

// ── Default review rules (built-in) ────────────────────────────────────────

export const DEFAULT_REVIEW_RULES: Omit<ReviewRule, "rule_id" | "created_at" | "updated_at">[] = [
  {
    name: "标题格式规范",
    category: "format",
    sub_category: "标题格式",
    description: "裁决书标题需包含仲裁机构名称，居中排列",
    severity: "must_fix",
    detection_logic: "提取标题文本，校验是否包含仲裁机构名称及居中对齐",
    suggestion_template: "调整标题为「{institution_name}裁决书」，居中对齐",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "正文字体规范",
    category: "format",
    sub_category: "字体字号",
    description: "正文一般使用宋体小四号，标题使用黑体",
    severity: "must_fix",
    detection_logic: "提取文本格式，校验字体和字号",
    suggestion_template: "将{position}字体改为{correct_font}，字号改为{correct_size}",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "错别字检测",
    category: "text",
    sub_category: "错别字",
    description: "裁决书不得有错别字",
    severity: "must_fix",
    detection_logic: "文本比对，匹配错别字库",
    suggestion_template: "将「{wrong_text}」改为「{correct_text}」",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "法律条款引用完整性",
    category: "law",
    sub_category: "条款引用",
    description: "引用法律条款需含完整名称+条款号（如《仲裁法》第51条）",
    severity: "must_fix",
    detection_logic: "提取法律依据模块文本，匹配条款库，校验完整性",
    suggestion_template: "补充条款完整名称/条款号：{correct_citation}",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "漏裁检测",
    category: "law",
    sub_category: "漏裁",
    description: "裁决主文需覆盖仲裁申请书全部请求项",
    severity: "must_fix",
    detection_logic: "比对仲裁申请书请求项与裁决主文，检查是否全覆盖",
    suggestion_template: "补充裁决主文中缺失的请求项：{missing_claim}",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "超裁检测",
    category: "law",
    sub_category: "超裁",
    description: "裁决主文不得包含仲裁申请书未提及的请求项",
    severity: "must_fix",
    detection_logic: "比对仲裁申请书请求项与裁决主文，检查是否有新增项",
    suggestion_template: "删除裁决主文中超出仲裁请求的内容：{excess_content}",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "仲裁请求一致性",
    category: "content",
    sub_category: "仲裁请求",
    description: "裁决书「仲裁请求」需与申请书/庭审笔录一致",
    severity: "must_fix",
    detection_logic: "比对裁决书与案件材料中仲裁请求文本相似度",
    suggestion_template: "修正为申请书/庭审笔录中的内容",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "证据材料列举完整",
    category: "content",
    sub_category: "证据材料",
    description: "证据编号/名称需与证据清单/庭审笔录完全匹配",
    severity: "must_fix",
    detection_logic: "比对裁决书与案件材料中证据清单，检查是否一致",
    suggestion_template: "修正证据列举为证据清单中的内容",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "事实认定有证据支持",
    category: "content",
    sub_category: "事实认定",
    description: "基本事实认定需有证据支持",
    severity: "must_fix",
    detection_logic: "检查事实认定部分是否引用证据，证据是否在证据清单中",
    suggestion_template: "补充事实认定的证据支持",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "仲裁庭意见回应争议点",
    category: "content",
    sub_category: "仲裁庭意见",
    description: "仲裁庭意见需充分回应当事人的主要争议点",
    severity: "suggest_fix",
    detection_logic: "分析仲裁庭意见是否覆盖当事人主要争议点",
    suggestion_template: "补充对争议点{missing_point}的回应",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "费用计算准确",
    category: "law",
    sub_category: "费用计算",
    description: "仲裁费、鉴定费等费用金额需准确",
    severity: "must_fix",
    detection_logic: "提取费用金额，与案件数据比对",
    suggestion_template: "修正费用金额为{correct_amount}",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "表述风格正式",
    category: "expression",
    sub_category: "表述风格",
    description: "表述风格需正式、客观、中立",
    severity: "suggest_fix",
    detection_logic: "分析文本表述风格是否符合要求",
    suggestion_template: "调整表述风格，使其更加正式、客观、中立",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "术语统一",
    category: "text",
    sub_category: "术语统一",
    description: "法律术语需统一使用",
    severity: "must_fix",
    detection_logic: "术语检测，匹配术语库",
    suggestion_template: "将「{inconsistent_term}」统一为「{standard_term}」",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
  {
    name: "裁决主文可执行性",
    category: "law",
    sub_category: "可执行性",
    description: "裁决主文内容需满足确定、可执行的要求",
    severity: "must_fix",
    detection_logic: "分析裁决主文是否明确、具体、可执行",
    suggestion_template: "优化裁决主文表述，使其更加明确、可执行",
    is_builtin: true,
    is_active: true,
    applicable_template_types: ["domestic", "international"],
  },
];

// ── Strategy Analysis Types ────────────────────────────────────────────────

export type ViewPerspective = "god" | "claimant" | "respondent" | "arbitrator" | "secretary";

export const VIEW_PERSPECTIVE_LABELS: Record<ViewPerspective, string> = {
  god: "上帝视角（全局观察）",
  claimant: "申请人视角",
  respondent: "被申请人视角",
  arbitrator: "仲裁员视角",
  secretary: "仲裁秘书视角",
};

export interface StrategyAnalysis {
  perspective: ViewPerspective;
  own_strategies: { name: string; description: string; risk_level: "low" | "medium" | "high"; expected_outcome: string }[];
  opponent_predictions: { participant_id: string; display_name: string; predicted_strategy: string; confidence: number }[];
  win_rate: { score: number; analysis: string; key_factors: string[] };
  recommendations: string[];
  risk_assessment: string;
}

export interface CaseImportParams {
  source_case_id: string;
  case_name?: string;
  trial_style?: TrialStyle;
  global_collaboration_mode?: CollaborationMode;
}

// ── Strategy & Import API extensions ───────────────────────────────────────

export const strategyApi = {
  analyzeStrategy: (caseId: string, perspective: ViewPerspective) =>
    request<StrategyAnalysis>(`/moot/${encodeURIComponent(caseId)}/analyze-strategy`, {
      method: "POST",
      body: JSON.stringify({ perspective }),
    }),

  importFromCase: (caseId: string, params: CaseImportParams) =>
    request<{ case_id: string; case_name: string; imported: boolean }>(
      `/moot/${encodeURIComponent(caseId)}/import-from-case`,
      { method: "POST", body: JSON.stringify(params) },
    ),

  listCasesForImport: () =>
    request<{ cases: { case_id: string; case_name: string; source_path: string; file_count: number }[] }>(
      "/moot/cases-for-import",
    ),
};