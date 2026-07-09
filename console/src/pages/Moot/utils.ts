import type { MootCaseData, MootCaseListItem, MootParticipant, CollaborationMode } from "../../api/modules/moot";

export interface CollaborationPreset {
  id: string;
  name: string;
  description: string;
  collaboration_mode: CollaborationMode;
}

export interface DemoCaseDraft {
  case_name: string;
  case_description: string;
  rules: string[];
  participants: Array<{
    display_name: string;
    role: "arbitrator" | "party" | "secretary" | "controller";
    role_detail: string;
    collaboration_mode: CollaborationMode;
  }>;
}

export interface CaseGuidanceStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
}

export function createDefaultCollaborationPresets(): CollaborationPreset[] {
  return [
    {
      id: "human_lead_default",
      name: "人主 AI辅",
      description: "用户主导，AI辅助议事与整理材料",
      collaboration_mode: "human_lead",
    },
    {
      id: "ai_lead_default",
      name: "人辅 AI主",
      description: "AI主导推进，用户在关键节点确认",
      collaboration_mode: "ai_lead",
    },
    {
      id: "full_ai_default",
      name: "全 AI",
      description: "AI自动推进与发言，适合演示与压测",
      collaboration_mode: "full_ai",
    },
    {
      id: "full_human_default",
      name: "全人",
      description: "人工主导，AI只提供辅助信息",
      collaboration_mode: "full_human",
    },
  ];
}

export function buildCaseSearchText(caseLike: {
  case_name?: string;
  case_description?: string;
  rules?: string[];
  participants?: Array<Partial<MootParticipant> | { display_name?: string }>;
}) {
  const parts = [
    caseLike.case_name || "",
    caseLike.case_description || "",
    (caseLike.rules || []).join(" "),
    (caseLike.participants || [])
      .map((participant) => participant.display_name || "")
      .join(" "),
  ];
  return parts.join(" ").toLowerCase();
}

export function buildAutoCaseSummary(files: Array<{ filename?: string; description?: string; category?: string }>, description: string) {
  const fileSummary = files
    .map((file) => `${file.filename || "文件"} · ${file.description || file.category || "无说明"}`)
    .join("；");
  return [description, fileSummary].filter(Boolean).join("\n");
}

export function toCaseListSearchIndex(caseItem: MootCaseListItem) {
  return {
    id: caseItem.case_id,
    text: buildCaseSearchText({
      case_name: caseItem.case_name,
      case_description: "",
      rules: caseItem.rules,
      participants: caseItem.participants,
    }),
  };
}

export function getDemoCaseDraft(): DemoCaseDraft {
  return {
    case_name: "示范合同争议仲裁模拟案",
    case_description: "围绕跨境货物运输合同履行与损害赔偿展开的模拟仲裁。材料包括仲裁申请书、答辩书和证据清单。",
    rules: ["UNCITRAL 2010", "《仲裁规则》"],
    participants: [
      {
        display_name: "首席仲裁员",
        role: "arbitrator",
        role_detail: "首席仲裁员",
        collaboration_mode: "human_lead",
      },
      {
        display_name: "申请人代表",
        role: "party",
        role_detail: "申请人",
        collaboration_mode: "ai_lead",
      },
      {
        display_name: "被申请人代表",
        role: "party",
        role_detail: "被申请人",
        collaboration_mode: "ai_lead",
      },
      {
        display_name: "仲裁秘书",
        role: "secretary",
        role_detail: "仲裁秘书",
        collaboration_mode: "ai_lead",
      },
    ],
  };
}

export function getDefaultCollaborationMode(): CollaborationMode {
  return "ai_lead";
}

export function getCaseGuidanceSteps(caseLike: {
  case_description?: string;
  participants?: Array<{ display_name?: string }>;
  rules?: string[];
  messages?: Array<{ content?: string }>;
  current_stage?: string;
  files?: Array<{ filename?: string }>;
}): CaseGuidanceStep[] {
  const hasDescription = Boolean((caseLike.case_description || "").trim());
  const hasParticipants = (caseLike.participants || []).filter((participant) => (participant.display_name || "").trim()).length > 0;
  const hasRules = (caseLike.rules || []).filter(Boolean).length > 0;
  const hasMessages = (caseLike.messages || []).filter((message) => (message.content || "").trim()).length > 0;
  const hasFiles = (caseLike.files || []).filter((file) => (file.filename || "").trim()).length > 0;
  const hasAdvancedStage = (caseLike.current_stage || "") !== "draft";

  return [
    {
      key: "background",
      title: "补充案件背景",
      description: "为模拟案填入案件事实、争议焦点和主要请求。",
      done: hasDescription,
    },
    {
      key: "participants",
      title: "添加参与者",
      description: "补齐仲裁员、当事人和秘书，建立完整的模拟角色表。",
      done: hasParticipants,
    },
    {
      key: "rules",
      title: "确认仲裁规则",
      description: "指定适用的规则，避免后续程序推进混乱。",
      done: hasRules,
    },
    {
      key: "materials",
      title: "上传材料与证据",
      description: "上传申请书、答辩书、证据清单等材料。",
      done: hasFiles,
    },
    {
      key: "dialogue",
      title: "开始实训对话",
      description: "从一轮发言或一次程序动作开始推进案件。",
      done: hasMessages || hasAdvancedStage,
    },
  ];
}

export function getSearchFilterValue(value: string | undefined) {
  return (value || "").trim().toLowerCase();
}

export function filterCasesByText(cases: MootCaseListItem[], keyword: string) {
  const normalized = getSearchFilterValue(keyword);
  if (!normalized) return cases;
  return cases.filter((caseItem) => toCaseListSearchIndex(caseItem).text.includes(normalized));
}

export function getCaseSummary(caseItem: Partial<MootCaseData> | Partial<MootCaseListItem>) {
  const name = caseItem.case_name || "未命名模拟案";
  const stage = caseItem.current_stage_label || "未开始";
  return `${name} · ${stage}`;
}

export function getCaseProgressSummary(steps: CaseGuidanceStep[]) {
  const completed = steps.filter((step) => step.done).length;
  const total = steps.length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  let label = "刚开始";
  if (percent >= 80) label = "基本就绪";
  else if (percent >= 50) label = "已进入实训";
  else if (percent >= 20) label = "正在搭建";
  return { completed, total, percent, label };
}
