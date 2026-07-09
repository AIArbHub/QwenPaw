import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  Select,
  Tag,
  Modal,
  Form,
  Empty,
  Progress,
  Popconfirm,
  Dropdown,
  message as antMessage,
  Timeline,
  Segmented,
  Upload,
  Checkbox,
  Tooltip,
  Collapse,
  Row,
  Col,
  Table,
} from "antd";
import {
  PlusOutlined,
  SendOutlined,
  RobotOutlined,
  DeleteOutlined,
  UserAddOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  ExperimentOutlined,
  TeamOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  SwapOutlined,
  UsergroupAddOutlined,
  StarOutlined,
  UploadOutlined,
  CheckOutlined,
  CloseOutlined,
  ShareAltOutlined,
  ExpandAltOutlined,
  CompressOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import type { MenuProps } from "antd";
import {
  mootApi,
  CASE_STAGE_LABELS,
  ROLE_CATEGORY_LABELS,
  COLLABORATION_MODE_LABELS,
  ROLE_COLORS,
  type MootCaseData,
  type MootCaseListItem,
  type MootParticipant,
  type MootMessage,
  type MootCaseEvent,
  type RoleCategory,
  type CollaborationMode,
  type CaseStage,
  type EventType,
  type CaseTemplate,
  type ArbitrationRule,
  type DocumentTemplate,
  type ScoringDimension,
  type ScoreResult,
} from "../../api/modules/moot";
import { agentsApi } from "../../api/modules/agents";
import type { AgentSummary } from "../../api/types/agents";
import type { MootCaseFile, FileVisibility } from "../../api/modules/moot";
import {
  buildAutoCaseSummary,
  createDefaultCollaborationPresets,
  filterCasesByText,
  getCaseGuidanceSteps,
  getCaseProgressSummary,
  getDemoCaseDraft,
  getDefaultCollaborationMode,
} from "./utils";
import styles from "./index.module.less";

const ALL_STAGES: CaseStage[] = [
  "draft",
  "filing",
  "service",
  "defense",
  "arbitrator_selection",
  "tribunal_formation",
  "jurisdiction_objection",
  "challenge",
  "appraisal",
  "merger",
  "pre_hearing",
  "hearing",
  "deliberation",
  "award",
  "enforcement",
  "closed",
];

// 已开放阶段白名单：仅放开"开庭审理"阶段，其余阶段标记为开发中
const ENABLED_STAGES: CaseStage[] = ["hearing"];

function isStageEnabled(stage: CaseStage): boolean {
  return ENABLED_STAGES.includes(stage);
}

const ROLE_DETAIL_OPTIONS: Record<RoleCategory, string[]> = {
  arbitrator: ["首席仲裁员", "仲裁员", "边裁"],
  party: ["申请人", "被申请人", "第三人"],
  secretary: ["仲裁秘书"],
  controller: ["导演/上帝视角", "仲裁秘书兼任", "当事人兼任"],
};

const COLLAB_MODE_OPTIONS: { value: CollaborationMode; label: string; desc: string }[] = [
  { value: "human_lead", label: "人主AI辅", desc: "用户主导，AI辅助" },
  { value: "ai_lead", label: "人辅AI主", desc: "AI主导，用户确认" },
  { value: "full_ai", label: "全AI", desc: "AI自主，人不介入" },
  { value: "full_human", label: "全人", desc: "人操作，AI不辅助" },
];

function getAvatarLetter(name: string): string {
  return name.charAt(0);
}

function formatTime(ts: number): string {
  return dayjs(ts * 1000).format("HH:mm:ss");
}

function formatDate(ts: number): string {
  return dayjs(ts * 1000).format("YYYY-MM-DD HH:mm");
}

function getStageColor(stage: CaseStage): string {
  if (stage === "closed") return "#8c8c8c";
  if (stage === "award") return "#52c41a";
  if (stage === "hearing" || stage === "deliberation") return "#1890ff";
  if (stage === "draft") return "#d9d9d9";
  return "#722ed1";
}

function selectAgentForRole(role: RoleCategory, agents: AgentSummary[], usedAgentIds: Set<string>) {
  const normalizedAgents = agents.map((agent) => ({
    ...agent,
    lowerName: agent.name.toLowerCase(),
    lowerDescription: (agent.description || "").toLowerCase(),
  }));

  const matchKeywords = {
    arbitrator: ["仲裁员", "arbitrator", "裁判", "裁决"],
    party: ["申请人", "被申请人", "当事人", "party"],
    secretary: ["秘书", "secretary"],
    controller: ["导演", "主控", "controller", "管理"],
  } as const;

  const keywords = matchKeywords[role] || [];
  let candidate = normalizedAgents.find(
    (agent) => !usedAgentIds.has(agent.id) && keywords.some((keyword) => agent.lowerName.includes(keyword) || agent.lowerDescription.includes(keyword)),
  );
  if (candidate) return candidate.id;

  candidate = normalizedAgents.find((agent) => !usedAgentIds.has(agent.id));
  return candidate?.id;
}

const MootPage: React.FC = () => {
  const { t } = useTranslation();
  const [cases, setCases] = useState<MootCaseListItem[]>([]);
  const [currentCase, setCurrentCase] = useState<MootCaseData | null>(null);
  const [messages, setMessages] = useState<MootCaseData["messages"]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<string>("");
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [addParticipantModalOpen, setAddParticipantModalOpen] = useState(false);
  const [addPartyModalOpen, setAddPartyModalOpen] = useState(false);
  const [procAppModalOpen, setProcAppModalOpen] = useState(false);
  const [changeRulesModalOpen, setChangeRulesModalOpen] = useState(false);
  const [ruleFullText, setRuleFullText] = useState("");
  const [ruleLoading, setRuleLoading] = useState(false);
  const [changeTribunalModalOpen, setChangeTribunalModalOpen] = useState(false);
  const [changeClaimsModalOpen, setChangeClaimsModalOpen] = useState(false);
  const [caseTemplates, setCaseTemplates] = useState<CaseTemplate[]>([]);
  const [arbitrationRules, setArbitrationRules] = useState<ArbitrationRule[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [docTemplates, setDocTemplates] = useState<DocumentTemplate[]>([]);
  const [, setScoringDimensions] = useState<ScoringDimension[]>([]);
  const [docGenModalOpen, setDocGenModalOpen] = useState(false);
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [docGenLoading, setDocGenLoading] = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [autoSpeakLoading, setAutoSpeakLoading] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedGenRule, setSelectedGenRule] = useState<string>("");
  const [selectedGenAgent, setSelectedGenAgent] = useState<string>("");
  const [selectedScoreTemplate, setSelectedScoreTemplate] = useState<string>("standard");
  const [selectedScoreAgent, setSelectedScoreAgent] = useState<string>("");
  const [scoreResults, setScoreResults] = useState<ScoreResult[]>([]);
  const [selectedDocType, setSelectedDocType] = useState<string>("award");
  const [selectedScoreParticipant, setSelectedScoreParticipant] = useState<string>("");
  const [viewMode, setViewMode] = useState<"director" | "role">("director");
  const [currentRoleParticipantId, setCurrentRoleParticipantId] = useState<string>("");
  const [caseFiles, setCaseFiles] = useState<MootCaseFile[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [caseSearch, setCaseSearch] = useState("");
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareImageData, setShareImageData] = useState<string>("");
  const [collaborationPresetId, setCollaborationPresetId] = useState(() =>
    typeof window !== "undefined"
      ? window.localStorage.getItem("qwenpaw.moot.defaultCollaborationPreset") || "ai_lead_default"
      : "ai_lead_default",
  );
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [guidanceExpanded, setGuidanceExpanded] = useState(false);
  const [claimsExpanded, setClaimsExpanded] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const [createForm] = Form.useForm();
  const [addParticipantForm] = Form.useForm();
  const [addPartyForm] = Form.useForm();
  const [procAppForm] = Form.useForm();
  const [changeRulesForm] = Form.useForm();
  const [changeTribunalForm] = Form.useForm();
  const [changeClaimsForm] = Form.useForm();
  const messageListRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const didAutoSeedRef = useRef(false);

  const selectedCollaborationPreset = useMemo(() => {
    const presets = createDefaultCollaborationPresets();
    return presets.find((preset) => preset.id === collaborationPresetId) || presets[0];
  }, [collaborationPresetId]);

  const connectSSE = useCallback((caseId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const url = mootApi.streamUrl(caseId);
    const es = new EventSource(url);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "moot_message") {
          setMessages((prev: MootMessage[]) => {
            if (prev.some((m: MootMessage) => m.id === data.id)) return prev;
            return [
              ...prev,
              {
                id: data.id,
                participant_id: data.participant_id,
                agent_id: data.agent_id,
                display_name: data.display_name,
                role: data.role,
                content: data.content,
                stage: data.stage,
                timestamp: data.timestamp,
                is_system: data.is_system,
              },
            ];
          });
          setCurrentCase((prev: MootCaseData | null) => {
            if (!prev) return prev;
            return { ...prev, updated_at: data.timestamp || Date.now() / 1000 };
          });
        } else if (data.type === "stage_change") {
          setCurrentCase((prev: MootCaseData | null) => {
            if (!prev) return prev;
            return {
              ...prev,
              current_stage: data.new_stage,
              current_stage_label: data.new_stage_label,
              status: data.new_stage === "closed" ? "closed" : "active",
            };
          });
        } else if (data.type === "speaker_change") {
          setCurrentCase((prev: MootCaseData | null) => {
            if (!prev) return prev;
            return { ...prev, current_speaker: data.current_speaker };
          });
        } else if (data.type === "case_event") {
          setCurrentCase((prev: MootCaseData | null) => {
            if (!prev) return prev;
            const newEvent: MootCaseEvent = {
              event_id: data.event_id,
              event_type: data.event_type,
              description: data.description,
              data: data.data || {},
              timestamp: data.timestamp,
              actor_participant_id: data.actor_participant_id || null,
            };
            return { ...prev, events: [...prev.events, newEvent] };
          });
          if (["file_uploaded", "file_shared", "file_deleted", "file_versioned"].includes(data.event_type)) {
            mootApi.listFiles(caseId).then(setCaseFiles).catch(() => {});
          }
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      es.close();
    };
    eventSourceRef.current = es;
  }, []);

  const loadCases = useCallback(async () => {
    try {
      const data = await mootApi.listCases();
      setCases(data);
      if (!data.length && !didAutoSeedRef.current) {
        didAutoSeedRef.current = true;
        const agentsResponse = await agentsApi.listAgents().catch(() => ({ agents: [] }));
        const availableSeedAgents = agentsResponse.agents || [];
        if (availableSeedAgents.length > 0) {
          setAvailableAgents(availableSeedAgents);
        }

        const demoDraft = getDemoCaseDraft();
        const result = await mootApi.create({
          case_name: demoDraft.case_name,
          case_description: demoDraft.case_description,
          rules: demoDraft.rules,
        });
        const defaultCollabMode = selectedCollaborationPreset?.collaboration_mode || getDefaultCollaborationMode();
        const usedAgentIds = new Set<string>();

        for (const participant of demoDraft.participants) {
          const agent_id = selectAgentForRole(participant.role, availableSeedAgents, usedAgentIds);
          if (agent_id) {
            usedAgentIds.add(agent_id);
          }
          try {
            await mootApi.addParticipant(result.case_id, {
              agent_id: agent_id || undefined,
              display_name: participant.display_name,
              role: participant.role as RoleCategory,
              role_detail: participant.role_detail,
              collaboration_mode: participant.collaboration_mode || defaultCollabMode,
            });
          } catch {
            // ignore participant seeding failures
          }
        }
        const seededCase = await mootApi.getCase(result.case_id);
        setCurrentCase(seededCase);
        setMessages(seededCase.messages);
        if (seededCase.participants.length > 0) {
          const activeParticipant = seededCase.participants.find((p) => p.active);
          setSelectedParticipant(activeParticipant?.participant_id || seededCase.participants[0].participant_id);
        }
        connectSSE(result.case_id);
        try {
          const files = await mootApi.listFiles(result.case_id);
          setCaseFiles(files);
        } catch {
          setCaseFiles([]);
        }
      }
    } catch {
      antMessage.error("加载案件列表失败");
    }
  }, [connectSSE, selectedCollaborationPreset]);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  useEffect(() => {
    mootApi.listTemplates().then(setCaseTemplates).catch(() => {});
    mootApi.listRules().then(setArbitrationRules).catch(() => {});
    mootApi.listDocumentTemplates().then(setDocTemplates).catch(() => {});
    mootApi.listScoringDimensions().then(setScoringDimensions).catch(() => {});
    agentsApi.listAgents().then((res) => setAvailableAgents(res.agents || [])).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  const loadCase = useCallback(
    async (caseId: string) => {
      try {
        const data = await mootApi.getCase(caseId);
        setCurrentCase(data);
        setMessages(data.messages);
        if (data.participants.length > 0 && !selectedParticipant) {
          const activeP = data.participants.find((p) => p.active);
          setSelectedParticipant(
            activeP?.participant_id || data.participants[0].participant_id,
          );
        }
        connectSSE(caseId);
        try {
          const files = await mootApi.listFiles(caseId);
          setCaseFiles(files);
        } catch {
          setCaseFiles([]);
        }
      } catch {
        antMessage.error("加载案件详情失败");
      }
    },
    [connectSSE, selectedParticipant],
  );

  const handleCreate = useCallback(async () => {
    try {
      const values = await createForm.validateFields();
      setLoading(true);
      const rules: string[] = Array.isArray(values.rules)
        ? values.rules.filter(Boolean)
        : (values.rules || "").split(/[，,;；\n]/).map((s: string) => s.trim()).filter(Boolean);
      const defaultCollabMode = selectedCollaborationPreset?.collaboration_mode || getDefaultCollaborationMode();
      const result = await mootApi.create({
        case_name: values.case_name || "仲裁模拟案",
        case_description: values.case_description || "",
        rules: rules.length > 0 ? rules : undefined,
      });
      setCreateModalOpen(false);
      createForm.resetFields();
      await loadCases();
      await loadCase(result.case_id);

      if (selectedTemplateId) {
        const tmpl = caseTemplates.find((t) => t.template_id === selectedTemplateId);
        if (tmpl && tmpl.default_participants.length > 0) {
          for (const dp of tmpl.default_participants) {
            try {
              await mootApi.addParticipant(result.case_id, {
                display_name: dp.display_name,
                role: dp.role as RoleCategory,
                role_detail: dp.role_detail,
                collaboration_mode: defaultCollabMode,
              });
            } catch {
              // skip failed participant
            }
          }
          await loadCase(result.case_id);
        }
      }

      setSelectedTemplateId("");
      antMessage.success("仲裁模拟案创建成功");
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown; message?: string };
      if (e.errorFields) return;
      antMessage.error(e.message || "创建失败");
    } finally {
      setLoading(false);
    }
  }, [createForm, loadCases, loadCase, selectedTemplateId, caseTemplates, selectedCollaborationPreset]);

  const handleAddParticipant = useCallback(async () => {
    if (!currentCase) return;
    try {
      const values = await addParticipantForm.validateFields();
      setLoading(true);
      await mootApi.addParticipant(currentCase.case_id, {
        agent_id: values.agent_id || undefined,
        new_agent_name: !values.agent_id ? values.new_agent_name : undefined,
        new_agent_description: !values.agent_id
          ? values.new_agent_description
          : undefined,
        display_name: values.display_name,
        role: values.role,
        role_detail: values.role_detail || "",
        collaboration_mode: values.collaboration_mode || "ai_lead",
      });
      setAddParticipantModalOpen(false);
      addParticipantForm.resetFields();
      await loadCase(currentCase.case_id);
      antMessage.success("参与者添加成功");
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown; message?: string };
      if (e.errorFields) return;
      antMessage.error(e.message || "添加失败");
    } finally {
      setLoading(false);
    }
  }, [currentCase, addParticipantForm, loadCase]);

  const handleSpeak = useCallback(async () => {
    const pid = viewMode === "role" ? currentRoleParticipantId : selectedParticipant;
    if (!currentCase || !inputText.trim() || !pid) return;
    try {
      await mootApi.speak(currentCase.case_id, {
        participant_id: pid,
        content: inputText.trim(),
      });
      setInputText("");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "发言失败");
    }
  }, [currentCase, inputText, selectedParticipant, viewMode, currentRoleParticipantId]);

  const handleAutoSpeak = useCallback(
    async (participantId: string) => {
      if (!currentCase) return;
      try {
        setAutoSpeakLoading(true);
        await mootApi.autoSpeak(currentCase.case_id, {
          participant_id: participantId,
          prompt: "请根据案件上下文和你的角色发言",
        });
        antMessage.success("AI发言已发送");
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "自动发言失败");
      } finally {
        setAutoSpeakLoading(false);
      }
    },
    [currentCase],
  );

  const handleAdvanceStage = useCallback(
    async (stage: CaseStage) => {
      if (!currentCase) return;
      try {
        setLoading(true);
        await mootApi.advanceStage(currentCase.case_id, { stage });
        await loadCase(currentCase.case_id);
        antMessage.success("已切换至：" + CASE_STAGE_LABELS[stage]);
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "阶段切换失败");
      } finally {
        setLoading(false);
      }
    },
    [currentCase, loadCase],
  );

  const requestStageChange = useCallback(
    (stage: CaseStage) => {
      if (!currentCase || currentCase.status === "closed" || stage === currentCase.current_stage) return;
      if (!isStageEnabled(stage)) {
        antMessage.warning("该阶段正在开发中，敬请期待");
        return;
      }
      Modal.confirm({
        title: "确认切换阶段",
        content: `将从 “${currentCase.current_stage_label}” 切换到 “${CASE_STAGE_LABELS[stage]}”。如需撤销，可在切换后立即使用“撤销上一步”。`,
        okText: "确认切换",
        cancelText: "取消",
        onOk: () => handleAdvanceStage(stage),
      });
    },
    [currentCase, handleAdvanceStage],
  );

  const previousStage = useMemo(() => {
    if (!currentCase?.events?.length) return null;
    for (let index = currentCase.events.length - 1; index >= 0; index -= 1) {
      const event = currentCase.events[index];
      if (event.event_type !== "stage_change") continue;
      const data = event.data as { old_stage?: string };
      return data.old_stage ? (data.old_stage as CaseStage) : null;
    }
    return null;
  }, [currentCase]);

  const handleUndoStage = useCallback(async () => {
    if (!currentCase || !previousStage) return;
    try {
      setLoading(true);
      await mootApi.advanceStage(currentCase.case_id, { stage: previousStage, description: "撤销上一步阶段变更" });
      await loadCase(currentCase.case_id);
      antMessage.success("已撤销上一步阶段变更");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "撤销失败");
    } finally {
      setLoading(false);
    }
  }, [currentCase, loadCase, previousStage]);

  const handleDelete = useCallback(
    async (caseId: string) => {
      try {
        await mootApi.deleteCase(caseId);
        if (currentCase?.case_id === caseId) {
          setCurrentCase(null);
          setMessages([]);
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
        }
        await loadCases();
        antMessage.success("已删除");
      } catch {
        antMessage.error("删除失败");
      }
    },
    [currentCase, loadCases],
  );

  const handleUpdateCollabMode = useCallback(
    async (participantId: string, mode: CollaborationMode) => {
      if (!currentCase) return;
      try {
        await mootApi.updateParticipant(currentCase.case_id, participantId, {
          collaboration_mode: mode,
        });
        await loadCase(currentCase.case_id);
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "更新失败");
      }
    },
    [currentCase, loadCase],
  );

  const handleRemoveParticipant = useCallback(
    async (participantId: string) => {
      if (!currentCase) return;
      try {
        await mootApi.removeParticipant(currentCase.case_id, participantId);
        await loadCase(currentCase.case_id);
        antMessage.success("已移除参与者");
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "移除失败");
      }
    },
    [currentCase, loadCase],
  );

  // ── Message selection and operations ──────────────────────────────────────

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const selectAllMessages = useCallback(() => {
    if (selectedMessageIds.size === messages.length) {
      setSelectedMessageIds(new Set());
      setIsSelectionMode(false);
    } else {
      setSelectedMessageIds(new Set(messages.map((m) => m.id)));
    }
  }, [messages, selectedMessageIds.size]);

  const handleDeleteSelectedMessages = useCallback(async () => {
    if (selectedMessageIds.size === 0) return;
    
    Modal.confirm({
      title: "确认删除",
      content: `确定要删除选中的 ${selectedMessageIds.size} 条消息吗？此操作不可恢复。`,
      okText: "确认删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          setLoading(true);
          // Note: Current API doesn't support individual message deletion
          // This is a client-side deletion for UI purposes
          setMessages((prev) => prev.filter((m) => !selectedMessageIds.has(m.id)));
          setSelectedMessageIds(new Set());
          setIsSelectionMode(false);
          antMessage.success(`已删除 ${selectedMessageIds.size} 条消息`);
        } catch {
          antMessage.error("删除失败");
        } finally {
          setLoading(false);
        }
      },
    });
  }, [selectedMessageIds, messages]);

  const generateShareImage = useCallback(async () => {
    if (selectedMessageIds.size === 0) return;

    try {
      setLoading(true);
      
      // Create canvas for share image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Calculate dimensions
      const messageArray = messages.filter(m => selectedMessageIds.has(m.id));
      const lineHeight = 40;
      const padding = 40;
      const headerHeight = 120;
      const footerHeight = 80;
      const messageHeight = messageArray.length * lineHeight + padding * 2;
      
      canvas.width = 800;
      canvas.height = Math.max(headerHeight + messageHeight + footerHeight, 600);

      // Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Header with gradient
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, '#1890ff');
      gradient.addColorStop(1, '#722ed1');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, headerHeight);

      // Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px Arial';
      ctx.fillText('AI Arb 仲裁实训', padding, 50);
      
      ctx.font = '16px Arial';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(currentCase?.case_name || '', padding, 80);
      ctx.fillText(`${messageArray.length} 条消息`, padding, 105);

      // Messages
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, headerHeight, canvas.width, canvas.height - headerHeight - footerHeight);
      
      let yPos = headerHeight + padding;
      messageArray.forEach((msg) => {
        // Message bubble
        ctx.fillStyle = '#f5f5f5';
        const messageText = `${msg.display_name}: ${msg.content.substring(0, 100)}`;
        ctx.font = '14px Arial';
        const textWidth = ctx.measureText(messageText).width;
        const bubbleWidth = Math.min(textWidth + 40, canvas.width - padding * 2);
        
        ctx.beginPath();
        ctx.roundRect(padding, yPos - 20, bubbleWidth, 30, 5);
        ctx.fill();

        // Text
        ctx.fillStyle = '#262626';
        ctx.font = '14px Arial';
        ctx.fillText(messageText, padding + 20, yPos);

        yPos += lineHeight;
      });

      // Footer with watermark
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, canvas.height - footerHeight, canvas.width, footerHeight);
      
      ctx.fillStyle = '#8c8c8c';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('AI Arb - 仲裁实训平台', canvas.width / 2, canvas.height - footerHeight + 30);
      ctx.fillText('www.aiarb.cn', canvas.width / 2, canvas.height - footerHeight + 55);

      // Convert to data URL
      const dataUrl = canvas.toDataURL('image/png');
      setShareImageData(dataUrl);
      setShareModalOpen(true);
    } catch (err) {
      antMessage.error('生成分享图片失败');
    } finally {
      setLoading(false);
    }
  }, [messages, selectedMessageIds, currentCase]);

  const downloadShareImage = useCallback(() => {
    if (!shareImageData) return;
    
    const link = document.createElement('a');
    link.download = `arbitration-chat-${Date.now()}.png`;
    link.href = shareImageData;
    link.click();
    antMessage.success('图片已下载');
  }, [shareImageData]);

  const handleAddParty = useCallback(async () => {
    if (!currentCase) return;
    try {
      const values = await addPartyForm.validateFields();
      setLoading(true);
      await mootApi.addParty(currentCase.case_id, {
        agent_id: values.agent_id || undefined,
        new_agent_name: !values.agent_id ? values.new_agent_name : undefined,
        new_agent_description: !values.agent_id
          ? values.new_agent_description
          : undefined,
        display_name: values.display_name,
        role: values.role,
        role_detail: values.role_detail || "",
        collaboration_mode: values.collaboration_mode || "ai_lead",
      });
      setAddPartyModalOpen(false);
      addPartyForm.resetFields();
      await loadCase(currentCase.case_id);
      antMessage.success("新增当事人成功");
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown; message?: string };
      if (e.errorFields) return;
      antMessage.error(e.message || "添加失败");
    } finally {
      setLoading(false);
    }
  }, [currentCase, addPartyForm, loadCase]);

  const handleSubmitProcApp = useCallback(async () => {
    if (!currentCase) return;
    try {
      const values = await procAppForm.validateFields();
      setLoading(true);
      await mootApi.submitProceduralApplication(
        currentCase.case_id,
        values.event_type as EventType,
        values.description,
        selectedParticipant || undefined,
      );
      setProcAppModalOpen(false);
      procAppForm.resetFields();
      await loadCase(currentCase.case_id);
      antMessage.success("程序申请已提交");
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown; message?: string };
      if (e.errorFields) return;
      antMessage.error(e.message || "提交失败");
    } finally {
      setLoading(false);
    }
  }, [currentCase, procAppForm, selectedParticipant, loadCase]);

  const handleChangeRules = useCallback(async () => {
    if (!currentCase) return;
    try {
      const values = await changeRulesForm.validateFields();
      setLoading(true);
      const rules: string[] = Array.isArray(values.rules)
        ? values.rules.filter(Boolean)
        : (values.rules || "").split(/[，,;；\n]/).map((s: string) => s.trim()).filter(Boolean);
      await mootApi.changeProcedure(currentCase.case_id, rules, values.description);
      setChangeRulesModalOpen(false);
      changeRulesForm.resetFields();
      setRuleFullText("");
      await loadCase(currentCase.case_id);
      antMessage.success("仲裁规则已更新");
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown; message?: string };
      if (e.errorFields) return;
      antMessage.error(e.message || "更新失败");
    } finally {
      setLoading(false);
    }
  }, [currentCase, changeRulesForm, loadCase]);

  // 将规则全文 state 同步到表单字段，保证"智能获取全文"/"上传文件"按钮写入的内容能反映到受 Form.Item 控制的 TextArea 中
  useEffect(() => {
    changeRulesForm.setFieldsValue({ rule_full_text: ruleFullText });
  }, [ruleFullText, changeRulesForm]);

  const handleChangeTribunal = useCallback(async () => {
    if (!currentCase) return;
    try {
      const values = await changeTribunalForm.validateFields();
      setLoading(true);
      await mootApi.changeTribunal(
        currentCase.case_id,
        values.description,
        values.data as Record<string, unknown>,
      );
      setChangeTribunalModalOpen(false);
      changeTribunalForm.resetFields();
      await loadCase(currentCase.case_id);
      antMessage.success("仲裁庭变更已记录");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "变更失败");
    } finally {
      setLoading(false);
    }
  }, [currentCase, changeTribunalForm, loadCase]);

  const handleChangeClaims = useCallback(async () => {
    if (!currentCase) return;
    try {
      const values = await changeClaimsForm.validateFields();
      setLoading(true);
      await mootApi.changeClaims(
        currentCase.case_id,
        values.description,
        selectedParticipant || undefined,
      );
      setChangeClaimsModalOpen(false);
      changeClaimsForm.resetFields();
      await loadCase(currentCase.case_id);
      antMessage.success("仲裁请求已变更");
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown; message?: string };
      if (e.errorFields) return;
      antMessage.error(e.message || "变更失败");
    } finally {
      setLoading(false);
    }
  }, [currentCase, changeClaimsForm, selectedParticipant, loadCase]);

  const handleBack = useCallback(() => {
    setCurrentCase(null);
    setMessages([]);
    setSelectedParticipant("");
    setCaseFiles([]);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const activeParticipants = useMemo(
    () => currentCase?.participants.filter((p: MootParticipant) => p.active) || [],
    [currentCase],
  );

  const handleViewModeChange = useCallback((mode: "director" | "role") => {
    setViewMode(mode);
    if (mode === "director") {
      setCurrentRoleParticipantId("");
    } else {
      const firstParty = activeParticipants.find((p) => p.role === "party");
      if (firstParty) setCurrentRoleParticipantId(firstParty.participant_id);
      else if (activeParticipants.length > 0) setCurrentRoleParticipantId(activeParticipants[0].participant_id);
    }
  }, [activeParticipants]);

  const visibleFiles = useMemo(() => {
    if (!caseFiles.length) return [];
    if (viewMode === "director") return caseFiles;
    if (!currentRoleParticipantId) return [];
    return caseFiles.filter((f) => {
      if (f.visibility === "private" && f.owner_participant_id === currentRoleParticipantId) return true;
      if (f.visibility === "shared") return true;
      if (f.visibility === "directed" && f.allowed_participant_ids.includes(currentRoleParticipantId)) return true;
      return false;
    });
  }, [caseFiles, viewMode, currentRoleParticipantId]);

  const privateFiles = useMemo(() => visibleFiles.filter((f) => f.visibility === "private"), [visibleFiles]);
  const sharedFiles = useMemo(() => visibleFiles.filter((f) => f.visibility === "shared"), [visibleFiles]);
  const directedFiles = useMemo(() => visibleFiles.filter((f) => f.visibility === "directed"), [visibleFiles]);

  const [uploadForm] = Form.useForm();

  const handleUpload = useCallback(async () => {
    if (!currentCase) return;
    try {
      const values = await uploadForm.validateFields();
      const uploadFile = values.file?.[0];
      const fileInput = uploadFile?.originFileObj || uploadFile;
      if (!fileInput) {
        antMessage.error("请选择文件");
        return;
      }
      setUploadLoading(true);
      const ownerId = viewMode === "role" ? currentRoleParticipantId : values.owner_participant_id;
      if (!ownerId) {
        antMessage.error("请指定文件所有者");
        return;
      }
      await mootApi.uploadFile(
        currentCase.case_id,
        fileInput,
        ownerId,
        values.visibility || "private",
        values.visibility === "directed" ? values.allowed_participants || [] : [],
        values.category || "",
        [],
        values.description || "",
      );
      antMessage.success("文件上传成功");
      setUploadModalOpen(false);
      uploadForm.resetFields();
      const files = await mootApi.listFiles(currentCase.case_id);
      setCaseFiles(files);
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown; message?: string };
      if (e.errorFields) return;
      antMessage.error(e.message || "上传失败");
    } finally {
      setUploadLoading(false);
    }
  }, [currentCase, uploadForm, viewMode, currentRoleParticipantId]);

  const handleDeleteFile = useCallback(async (fileId: string) => {
    if (!currentCase) return;
    try {
      await mootApi.deleteFile(currentCase.case_id, fileId);
      antMessage.success("文件已删除");
      const files = await mootApi.listFiles(currentCase.case_id);
      setCaseFiles(files);
    } catch {
      antMessage.error("删除文件失败");
    }
  }, [currentCase]);

  const handleShareFile = useCallback(async (fileId: string, visibility: FileVisibility) => {
    if (!currentCase) return;
    try {
      await mootApi.updateFileVisibility(currentCase.case_id, fileId, visibility);
      antMessage.success("文件可见性已更新");
      const files = await mootApi.listFiles(currentCase.case_id);
      setCaseFiles(files);
    } catch {
      antMessage.error("更新失败");
    }
  }, [currentCase]);

  const timelineEvents = useMemo(() => {
    if (!currentCase) return [];
    return [...currentCase.events].reverse().slice(0, 20);
  }, [currentCase]);

  const visitedStages = useMemo(() => {
    if (!currentCase) return new Set<CaseStage>();
    const visited = new Set<CaseStage>();
    visited.add(currentCase.current_stage);
    if (currentCase.events) {
      for (const ev of currentCase.events) {
        if (ev.event_type === "stage_change" && ev.data) {
          const d = ev.data as { old_stage?: string; new_stage?: string };
          if (d.old_stage) visited.add(d.old_stage as CaseStage);
          if (d.new_stage) visited.add(d.new_stage as CaseStage);
        }
      }
    }
    return visited;
  }, [currentCase]);

  const stageMenuItems = useMemo<MenuProps["items"]>(() => {
    if (!currentCase || currentCase.current_stage === "closed") return [];
    return ALL_STAGES.map((s) => {
      const enabled = isStageEnabled(s);
      const isCurrent = s === currentCase.current_stage;
      const suffix = isCurrent ? " (当前)" : enabled ? "" : " (开发中)";
      return {
        key: s,
        label: CASE_STAGE_LABELS[s] + suffix,
        disabled: !enabled && !isCurrent,
        onClick: () => requestStageChange(s),
      };
    });
  }, [currentCase, requestStageChange]);

  const getParticipantMenuItems = useCallback(
    (participantId: string): MenuProps["items"] => {
      const modeItems = COLLAB_MODE_OPTIONS.map((opt) => ({
        key: opt.value,
        label: opt.label + " — " + opt.desc,
        onClick: () => handleUpdateCollabMode(participantId, opt.value),
      }));
      return [
        { type: "group" as const, key: "mode_group", label: "协作模式", children: modeItems },
        { type: "divider" as const, key: "d1" },
        {
          key: "remove",
          label: "移除参与者",
          danger: true,
          icon: <DeleteOutlined />,
          onClick: () => handleRemoveParticipant(participantId),
        },
      ];
    },
    [handleUpdateCollabMode, handleRemoveParticipant],
  );

  const participantSelectOptions = useMemo(
    () =>
      activeParticipants.map((p: MootParticipant) => ({
        label: p.display_name + " (" + ROLE_CATEGORY_LABELS[p.role as RoleCategory] + ")",
        value: p.participant_id,
      })),
    [activeParticipants],
  );

  const roleSelectOptions = useMemo(
    () =>
      (Object.entries(ROLE_CATEGORY_LABELS) as [RoleCategory, string][]).map(
        ([value, label]) => ({ value, label }),
      ),
    [],
  );

  const collabSelectOptions = useMemo(
    () =>
      COLLAB_MODE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label + " — " + opt.desc,
      })),
    [],
  );

  const templateOptions = useMemo(
    () => caseTemplates.map((t) => ({ value: t.template_id, label: t.name + " — " + t.description })),
    [caseTemplates],
  );

  const ruleOptions = useMemo(
    () => arbitrationRules.map((r) => ({ value: r.name, label: r.name + "（" + r.edition + "）" })),
    [arbitrationRules],
  );

  const agentSelectOptions = useMemo(
    () => availableAgents.map((a) => ({ value: a.id, label: a.name + (a.description ? " — " + a.description.slice(0, 30) : "") })),
    [availableAgents],
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      setSelectedTemplateId(templateId);
      if (!templateId) {
        createForm.setFieldsValue({
          case_name: "仲裁模拟案",
          case_description: "",
          rules: [],
        });
        return;
      }
      const tmpl = caseTemplates.find((t) => t.template_id === templateId);
      if (tmpl) {
        createForm.setFieldsValue({
          case_name: tmpl.case_name,
          case_description: tmpl.case_description,
          rules: tmpl.rules,
        });
      }
    },
    [caseTemplates, createForm],
  );

  const handleGenerateDocument = useCallback(async () => {
    if (!currentCase) return;
    try {
      setDocGenLoading(true);
      setGeneratedDoc("");
      const result = await mootApi.generateDocument(currentCase.case_id, selectedDocType);
      setGeneratedDoc(result.content);
      antMessage.success("文书生成成功");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "文书生成失败");
    } finally {
      setDocGenLoading(false);
    }
  }, [currentCase, selectedDocType]);

  const handleScoreParticipant = useCallback(async () => {
    if (!currentCase || !selectedScoreParticipant) return;
    try {
      setScoreLoading(true);
      setScoreResults([]);
      const result = await mootApi.scoreParticipant(currentCase.case_id, selectedScoreParticipant);
      setScoreResults(result.scores);
      antMessage.success("评分完成");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "评分失败");
    } finally {
      setScoreLoading(false);
    }
  }, [currentCase, selectedScoreParticipant]);

  const ganttData = useMemo(() => {
    if (!currentCase) return [];
    const stageEvents = currentCase.events.filter(
      (e: MootCaseEvent) => e.event_type === "stage_change",
    );
    const entries: { stage: CaseStage; label: string; start: number; end: number }[] = [];
    const now = Date.now() / 1000;

    if (stageEvents.length === 0) {
      entries.push({
        stage: currentCase.current_stage,
        label: CASE_STAGE_LABELS[currentCase.current_stage] || currentCase.current_stage,
        start: currentCase.created_at,
        end: now,
      });
      return entries;
    }

    for (let i = 0; i < stageEvents.length; i++) {
      const ev = stageEvents[i];
      const d = ev.data as { new_stage?: string };
      if (!d?.new_stage) continue;
      const start = ev.timestamp;
      const end = i < stageEvents.length - 1 ? stageEvents[i + 1].timestamp : now;
      entries.push({
        stage: d.new_stage as CaseStage,
        label: CASE_STAGE_LABELS[d.new_stage as CaseStage] || d.new_stage,
        start,
        end,
      });
    }
    const firstStage = stageEvents[0].data as { old_stage?: string };
    if (firstStage?.old_stage) {
      entries.unshift({
        stage: firstStage.old_stage as CaseStage,
        label: CASE_STAGE_LABELS[firstStage.old_stage as CaseStage] || firstStage.old_stage,
        start: currentCase.created_at,
        end: stageEvents[0].timestamp,
      });
    }
    return entries;
  }, [currentCase]);

  const filteredCases = useMemo(() => filterCasesByText(cases, caseSearch), [cases, caseSearch]);
  const guidanceSteps = useMemo(() => {
    if (!currentCase) return [];
    return getCaseGuidanceSteps({
      case_description: currentCase.case_description,
      participants: currentCase.participants,
      rules: currentCase.rules,
      messages: currentCase.messages,
      current_stage: currentCase.current_stage,
      files: caseFiles,
    });
  }, [currentCase, caseFiles]);

  const progressSummary = useMemo(() => getCaseProgressSummary(guidanceSteps), [guidanceSteps]);

  useEffect(() => {
    if (!currentCase || !caseFiles.length || currentCase.case_description) return;
    const nextDescription = buildAutoCaseSummary(
      caseFiles.map((file) => ({
        filename: file.filename,
        description: file.description,
        category: file.category,
      })),
      currentCase.case_description || "",
    );
    if (nextDescription) {
      void mootApi.changeClaims(currentCase.case_id, nextDescription, undefined).catch(() => {});
    }
  }, [caseFiles, currentCase]);

  const timelineItems = useMemo(
    () =>
      timelineEvents.map((e: MootCaseEvent) => ({
        color:
          e.event_type === "stage_change"
            ? "green"
            : e.event_type === "party_change"
            ? "blue"
            : "gray",
        children: (
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--ant-color-text)",
              }}
            >
              {e.description}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ant-color-text-quaternary)",
              }}
            >
              {formatTime(e.timestamp)}
            </div>
          </div>
        ),
      })),
    [timelineEvents],
  );

  if (!currentCase) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Users
              style={{ fontSize: 20, color: "var(--ant-color-primary)" }}
            />
            <span className={styles.caseName}>
              {t("moot.title", "仲裁模拟实训")}
            </span>
          </div>
          <div className={styles.headerRight}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalOpen(true)}
            >
              {t("moot.createCase", "新建仲裁案")}
            </Button>
          </div>
        </div>
        <div className={styles.body}>
          <div className={styles.caseListView}>
            {cases.length === 0 ? (
              <div className={styles.emptyState}>
                <Users
                  style={{
                    fontSize: 48,
                    color: "var(--ant-color-text-quaternary)",
                  }}
                />
                <Empty
                  description={t(
                    "moot.noCases",
                    "暂无仲裁模拟案，请创建新案件开始模拟仲裁实训",
                  )}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setCreateModalOpen(true)}
                >
                  {t("moot.createCase", "新建仲裁案")}
                </Button>
              </div>
            ) : (
              <div className={styles.caseList}>
                <Input.Search
                  placeholder="按案件名称、规则、参与者检索"
                  value={caseSearch}
                  onChange={(event) => setCaseSearch(event.target.value)}
                  style={{ marginBottom: 12 }}
                />
                {filteredCases.length === 0 ? (
                  <div className={styles.emptyState} style={{ minHeight: 220 }}>
                    <Empty description={caseSearch ? "没有匹配的模拟仲裁案" : "暂无模拟仲裁案，请创建一个演示案件"} />
                  </div>
                ) : (
                  filteredCases.map((c: MootCaseListItem) => (
                    <div
                      key={c.case_id}
                      className={styles.caseCard}
                      onClick={() => loadCase(c.case_id)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={styles.caseCardTitle}>{c.case_name}</div>
                        <div className={styles.caseCardMeta}>
                          <Tag color={getStageColor(c.current_stage)}>
                            {c.current_stage_label}
                          </Tag>
                          <span className={styles.caseCardMetaItem}>
                            {c.participants.length} 位参与者
                          </span>
                          <span className={styles.caseCardMetaItem}>
                            {c.message_count} 条消息
                          </span>
                          {c.rules.length > 0 && (
                            <span className={styles.caseCardMetaItem}>
                              {c.rules.length} 条规则
                            </span>
                          )}
                          <span className={styles.caseCardMetaItem}>
                            {formatDate(c.created_at)}
                          </span>
                        </div>
                      </div>
                      <Popconfirm
                        title="确认删除此仲裁案？"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          handleDelete(c.case_id);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Popconfirm>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <Modal
          title={t("moot.createTitle", "新建仲裁模拟案")}
          open={createModalOpen}
          onOk={handleCreate}
          onCancel={() => { setCreateModalOpen(false); setSelectedTemplateId(""); }}
          confirmLoading={loading}
          okText={t("common.confirm", "确认")}
          cancelText={t("common.cancel", "取消")}
          width={560}
        >
          <Form
            form={createForm}
            layout="vertical"
            initialValues={{ case_name: "仲裁模拟案" }}
          >
            <Form.Item label="案件模板" extra="选择模板自动填充案件信息，也可手动修改">
              <Select
                allowClear
                placeholder="选择案件模板（可选）"
                value={selectedTemplateId || undefined}
                onChange={handleTemplateSelect}
                options={templateOptions}
              />
            </Form.Item>
            <Form.Item
              name="case_name"
              label={t("moot.caseName", "案件名称")}
              rules={[{ required: true, message: "请输入案件名称" }]}
            >
              <Input placeholder="如：合同纠纷仲裁模拟案" />
            </Form.Item>
            <Form.Item
              name="case_description"
              label={t("moot.caseDescription", "案件描述")}
            >
              <Input.TextArea
                rows={3}
                placeholder="简要描述案件背景、仲裁协议等"
              />
            </Form.Item>
            <Form.Item label="默认人机协同模式" extra="新建案件时会沿用该配置作为参与者默认模式">
              <Select
                value={collaborationPresetId}
                onChange={(value) => {
                  setCollaborationPresetId(value);
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("qwenpaw.moot.defaultCollaborationPreset", value);
                  }
                }}
                options={createDefaultCollaborationPresets().map((preset) => ({
                  value: preset.id,
                  label: `${preset.name} · ${preset.description}`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="rules"
              label={t("moot.rules", "仲裁规则")}
              extra="可从下拉选择或手动输入，多个规则用逗号或换行分隔"
            >
              <Select
                mode="tags"
                placeholder="选择或输入仲裁规则"
                options={ruleOptions}
                tokenSeparators={["，", ",", "；", ";"]}
              />
            </Form.Item>
          </Form>
          <div
            style={{
              color: "var(--ant-color-text-quaternary)",
              fontSize: 12,
              marginTop: -8,
            }}
          >
            创建案件后，可逐步添加参与者、推进程序阶段。无需在创建时确定所有细节。
          </div>
        </Modal>
      </div>
    );
  }

  const currentSpeakerName =
    activeParticipants.find(
      (p) => p.participant_id === currentCase.current_speaker,
    )?.display_name || currentCase.current_speaker;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Users
            style={{ fontSize: 18, color: "var(--ant-color-primary)" }}
          />
          <span className={styles.caseName}>{currentCase.case_name}</span>
          <Tag color={getStageColor(currentCase.current_stage)}>
            {currentCase.current_stage_label}
          </Tag>
          {currentCase.current_speaker && (
            <span
              style={{
                fontSize: 12,
                color: "var(--ant-color-text-secondary)",
              }}
            >
              {"当前发言：" + currentSpeakerName}
            </span>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginLeft: 8,
              padding: "2px 8px",
              border: "1px solid var(--ant-color-border-secondary)",
              borderRadius: 999,
              background: "var(--ant-color-bg-layout)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>准备度 {progressSummary.percent}%</span>
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>{progressSummary.label}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
            <Segmented
              size="small"
              value={viewMode}
              onChange={(v) => handleViewModeChange(v as "director" | "role")}
              options={[
                { value: "director", label: "🎬 导演" },
                { value: "role", label: "🎭 角色" },
              ]}
            />
            {viewMode === "role" && (
              <Select
                size="small"
                value={currentRoleParticipantId || undefined}
                onChange={setCurrentRoleParticipantId}
                placeholder="选择角色"
                style={{ minWidth: 100 }}
                options={activeParticipants.map((p) => ({
                  value: p.participant_id,
                  label: p.display_name + (p.role_detail ? `(${p.role_detail})` : ""),
                }))}
              />
            )}
          </div>
        </div>
        <div className={styles.headerRight}>
          {currentCase.status !== "closed" && (
            <>
              {previousStage && (
                <Button
                  size="small"
                  onClick={handleUndoStage}
                  loading={loading}
                  style={{ marginRight: 8 }}
                >
                  撤销上一步
                </Button>
              )}
              <Dropdown
                menu={{ items: stageMenuItems }}
                placement="bottomRight"
              >
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={loading}
                  size="small"
                >
                  切换阶段
                </Button>
              </Dropdown>
            </>
          )}
          <Dropdown
            menu={{
              items: [
                {
                  key: "add_party",
                  label: "新增当事人",
                  icon: <UsergroupAddOutlined />,
                  onClick: () => setAddPartyModalOpen(true),
                },
                {
                  key: "proc_app",
                  label: "提交程序申请",
                  icon: <ExperimentOutlined />,
                  onClick: () => setProcAppModalOpen(true),
                },
                { type: "divider" },
                {
                  key: "change_rules",
                  label: "变更仲裁规则",
                  icon: <FileTextOutlined />,
                  onClick: () => {
                    changeRulesForm.setFieldsValue({ rules: currentCase.rules, description: "" });
                    setRuleFullText("");
                    setChangeRulesModalOpen(true);
                  },
                },
                {
                  key: "change_tribunal",
                  label: "变更仲裁庭",
                  icon: <TeamOutlined />,
                  onClick: () => setChangeTribunalModalOpen(true),
                },
                {
                  key: "change_claims",
                  label: "变更仲裁请求",
                  icon: <SwapOutlined />,
                  onClick: () => setChangeClaimsModalOpen(true),
                },
              ],
            }}
            trigger={["click"]}
          >
            <Button
              icon={<AppstoreOutlined />}
              loading={loading}
              size="small"
            >
              案件变更
            </Button>
          </Dropdown>
          <Tooltip title={isFullScreen ? "退出全屏" : "全屏模式"}>
            <Button
              size="small"
              icon={isFullScreen ? <CompressOutlined /> : <ExpandAltOutlined />}
              onClick={() => setIsFullScreen(!isFullScreen)}
            />
          </Tooltip>
          <Button size="small" onClick={handleBack}>
            {t("moot.back", "返回列表")}
          </Button>
        </div>
      </div>

      {/* Visual stage progression bar */}
      <div className={styles.stageBar}>
        {ALL_STAGES.map((stage) => {
          const isCurrent = stage === currentCase?.current_stage;
          const isVisited = visitedStages.has(stage) && !isCurrent;
          const enabled = isStageEnabled(stage);
          const isDisabled = !enabled && !isCurrent;
          return (
            <div
              key={stage}
              className={`${styles.stageBarItem} ${
                isCurrent ? styles.stageBarActive : isVisited ? styles.stageBarDone : ""
              } ${isDisabled ? styles.stageBarDisabled : ""}`}
              style={isDisabled ? { cursor: "not-allowed", opacity: 0.4 } : undefined}
              title={isDisabled ? "开发中，敬请期待" : CASE_STAGE_LABELS[stage]}
              onClick={() => {
                if (isDisabled) return;
                if (currentCase && currentCase.status !== "closed" && stage !== currentCase.current_stage) {
                  requestStageChange(stage);
                }
              }}
            >
              <div className={styles.stageBarDot}>
                {isVisited ? "✓" : isCurrent ? "●" : "○"}
              </div>
              <span className={styles.stageBarLabel}>
                {CASE_STAGE_LABELS[stage]}
              </span>
            </div>
          );
        })}
      </div>

      <div className={`${styles.body} ${isFullScreen ? styles.fullScreenMode : ""}`}>
        <div className={styles.contentWrapper}>
        <div className={styles.leftColumn}>
        <div className={styles.mainArea}>
          <div className={styles.messageList} ref={messageListRef} style={isSelectionMode && selectedMessageIds.size > 0 ? { paddingTop: 60 } : undefined}>
            {messages.map((msg) => (
              <div 
                key={msg.id} 
                className={styles.messageItem}
                style={selectedMessageIds.has(msg.id) ? { background: '#f0f5ff', borderRadius: 8 } : {}}
              >
                {isSelectionMode && (
                  <div style={{ paddingTop: 8, paddingRight: 8 }}>
                    <Checkbox
                      checked={selectedMessageIds.has(msg.id)}
                      onChange={() => toggleMessageSelection(msg.id)}
                    />
                  </div>
                )}
                <div
                  className={styles.avatar}
                  style={{ background: ROLE_COLORS[msg.role] || "#999" }}
                >
                  {getAvatarLetter(msg.display_name)}
                </div>
                <div className={styles.messageContent}>
                  <div className={styles.messageMeta}>
                    <span className={styles.displayName}>
                      {msg.display_name}
                    </span>
                    <Tag
                      style={{
                        fontSize: 10,
                        lineHeight: "16px",
                        padding: "0 4px",
                        color: ROLE_COLORS[msg.role] || "#999",
                        borderColor: ROLE_COLORS[msg.role] || "#999",
                      }}
                    >
                      {ROLE_CATEGORY_LABELS[msg.role] || msg.role}
                    </Tag>
                    <Tag
                      style={{
                        fontSize: 10,
                        lineHeight: "16px",
                        padding: "0 4px",
                        color: getStageColor(msg.stage),
                        borderColor: getStageColor(msg.stage),
                      }}
                    >
                      {CASE_STAGE_LABELS[msg.stage] || msg.stage}
                    </Tag>
                    <span className={styles.messageTime}>
                      {formatTime(msg.timestamp)}
                    </span>
                    
                    {/* Message actions dropdown */}
                    {!isSelectionMode && (
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'delete',
                              label: '删除',
                              icon: <DeleteOutlined />,
                              danger: true,
                              onClick: () => {
                                Modal.confirm({
                                  title: '确认删除',
                                  content: '确定要删除这条消息吗？',
                                  okText: '删除',
                                  okType: 'danger',
                                  cancelText: '取消',
                                  onOk: () => {
                                    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                                    antMessage.success('已删除');
                                  },
                                });
                              },
                            },
                            {
                              key: 'share',
                              label: '分享此消息',
                              icon: <ShareAltOutlined />,
                              onClick: () => {
                                // Create share image for single message
                                const canvas = document.createElement('canvas');
                                const ctx = canvas.getContext('2d');
                                if (!ctx) return;

                                canvas.width = 600;
                                canvas.height = 300;

                                // Background
                                ctx.fillStyle = '#ffffff';
                                ctx.fillRect(0, 0, canvas.width, canvas.height);

                                // Header
                                const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
                                gradient.addColorStop(0, '#1890ff');
                                gradient.addColorStop(1, '#722ed1');
                                ctx.fillStyle = gradient;
                                ctx.fillRect(0, 0, canvas.width, 80);

                                // Title
                                ctx.fillStyle = '#ffffff';
                                ctx.font = 'bold 24px Arial';
                                ctx.fillText('AI Arb 仲裁实训', 30, 50);

                                ctx.font = '14px Arial';
                                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                                ctx.fillText(currentCase?.case_name || '', 30, 70);

                                // Message content
                                ctx.fillStyle = '#f5f5f5';
                                ctx.fillRect(30, 100, 540, 120);

                                ctx.fillStyle = '#262626';
                                ctx.font = 'bold 14px Arial';
                                ctx.fillText(msg.display_name, 40, 125);

                                ctx.font = '14px Arial';
                                const contentLines = msg.content.split('');
                                let line = '';
                                let y = 150;
                                for (let i = 0; i < contentLines.length; i++) {
                                  const testLine = line + contentLines[i];
                                  const metrics = ctx.measureText(testLine);
                                  if (metrics.width > 500 && i > 0) {
                                    ctx.fillText(line, 40, y);
                                    line = contentLines[i];
                                    y += 20;
                                  } else {
                                    line = testLine;
                                  }
                                }
                                ctx.fillText(line, 40, y);

                                // Footer
                                ctx.fillStyle = '#fafafa';
                                ctx.fillRect(0, canvas.height - 60, canvas.width, 60);
                                ctx.fillStyle = '#8c8c8c';
                                ctx.font = '12px Arial';
                                ctx.textAlign = 'center';
                                ctx.fillText('AI Arb - 仲裁实训平台', canvas.width / 2, canvas.height - 30);
                                ctx.fillText('www.aiarb.cn', canvas.width / 2, canvas.height - 10);

                                const dataUrl = canvas.toDataURL('image/png');
                                setShareImageData(dataUrl);
                                setShareModalOpen(true);
                              },
                            },
                          ],
                        }}
                        trigger={['click']}
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<SettingOutlined />}
                          style={{ marginLeft: 8 }}
                        />
                      </Dropdown>
                    )}
                  </div>
                  <div
                    className={
                      styles.messageBubble +
                      (msg.is_system ? " " + styles.system : "")
                    }
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <Empty
                description={t(
                  "moot.noMessages",
                  "暂无消息，添加参与者后开始对话",
                )}
                style={{ marginTop: 60 }}
              />
            )}
          </div>

          <div className={styles.inputArea}>
            <div className={styles.inputRow}>
              {viewMode === "director" && (
                <Select
                  className={styles.inputSelect}
                  value={selectedParticipant}
                  onChange={setSelectedParticipant}
                  placeholder="选择参与者"
                  options={participantSelectOptions}
                />
              )}
              {viewMode === "role" && (
                <Tag color={ROLE_COLORS[activeParticipants.find((p) => p.participant_id === currentRoleParticipantId)?.role || "party"]} style={{ margin: 0, padding: "2px 8px", fontSize: 12 }}>
                  {activeParticipants.find((p) => p.participant_id === currentRoleParticipantId)?.display_name || "未选择角色"}
                </Tag>
              )}
              <Input.TextArea
                className={styles.inputText}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={viewMode === "role" ? "以当前角色身份发言..." : "输入发言内容..."}
                autoSize={{ minRows: 1, maxRows: 4 }}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    handleSpeak();
                  }
                }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSpeak}
                disabled={!inputText.trim() || (viewMode === "director" ? !selectedParticipant : !currentRoleParticipantId)}
              >
                发言
              </Button>
              <Button
                icon={<RobotOutlined />}
                onClick={() => {
                  const pid = viewMode === "role" ? currentRoleParticipantId : selectedParticipant;
                  if (pid) handleAutoSpeak(pid);
                }}
                disabled={viewMode === "director" ? !selectedParticipant : !currentRoleParticipantId}
                loading={autoSpeakLoading}
                title="让当前参与者AI自动发言"
              >
                AI发言
              </Button>
            </div>
          </div>
        </div>
        </div>

        {/* Floating selection toggle button */}
        {!isSelectionMode && messages.length > 0 && (
          <div className={styles.selectionToggleFloat}>
            <Button
              size="small"
              icon={<CheckOutlined />}
              onClick={() => setIsSelectionMode(true)}
            >
              选择消息
            </Button>
          </div>
        )}

        {/* Floating selection toolbar */}
        {isSelectionMode && selectedMessageIds.size > 0 && (
          <div className={styles.selectionBarFloat}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Checkbox
                checked={selectedMessageIds.size === messages.length && messages.length > 0}
                indeterminate={selectedMessageIds.size > 0 && selectedMessageIds.size < messages.length}
                onChange={selectAllMessages}
              >
                全选
              </Checkbox>
              <span style={{ color: '#1890ff', fontWeight: 500 }}>
                已选 {selectedMessageIds.size}/{messages.length} 条
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                size="small"
                icon={<DeleteOutlined />}
                danger
                onClick={handleDeleteSelectedMessages}
              >
                删除选中
              </Button>
              <Button
                size="small"
                icon={<ShareAltOutlined />}
                type="primary"
                onClick={generateShareImage}
              >
                分享
              </Button>
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedMessageIds(new Set());
                }}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {!isFullScreen && !sidebarCollapsed && (
        <div className={styles.sidebar}>
          <Button
            className={styles.sidebarCollapseBtn}
            icon={<MenuFoldOutlined />}
            onClick={() => setSidebarCollapsed(true)}
            size="small"
          />
          {guidanceSteps.length > 0 && (
            <div className={styles.sidebarSection}>
              <Collapse
                activeKey={guidanceExpanded ? ["guidance"] : []}
                onChange={() => setGuidanceExpanded(!guidanceExpanded)}
                size="small"
                className={styles.guidanceCollapse}
                items={[{
                  key: "guidance",
                  label: "接下来建议你做的事",
                  children: (
                    <>
                      <div style={{ minWidth: 140, marginBottom: 8 }}>
                        <Progress percent={progressSummary.percent} size="small" showInfo={false} />
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {guidanceSteps.map((step) => (
                          <Tag
                            key={step.key}
                            color={step.done ? "success" : "processing"}
                            style={{ padding: "4px 8px", borderRadius: 999, cursor: "pointer" }}
                            onClick={() => {
                              if (step.key === "background") {
                                setChangeClaimsModalOpen(true);
                              } else if (step.key === "participants") {
                                setAddParticipantModalOpen(true);
                              } else if (step.key === "rules") {
                                changeRulesForm.setFieldsValue({ rules: currentCase?.rules || [], description: "" });
                                setRuleFullText("");
                                setChangeRulesModalOpen(true);
                              } else if (step.key === "materials") {
                                setUploadModalOpen(true);
                              } else if (step.key === "dialogue") {
                                setInputText((prev) => prev || "请根据当前案情发言");
                              }
                            }}
                          >
                            {step.title}
                          </Tag>
                        ))}
                      </div>
                    </>
                  )
                }]}
              />
            </div>
          )}
          <div className={styles.sidebarSection}>
            <div className={styles.sidebarTitle}>
              <span>案件信息</span>
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ant-color-text-secondary)",
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: "var(--ant-color-text-quaternary)" }}>
                  阶段：
                </span>
                <Tag
                  color={getStageColor(currentCase.current_stage)}
                  style={{ fontSize: 12 }}
                >
                  {currentCase.current_stage_label}
                </Tag>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: "var(--ant-color-text-quaternary)" }}>
                  状态：
                </span>
                {currentCase.status === "draft"
                  ? "草稿"
                  : currentCase.status === "closed"
                  ? "已结案"
                  : "进行中"}
              </div>
              {currentCase.case_description && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ color: "var(--ant-color-text-quaternary)" }}>
                    描述：
                  </span>
                  {currentCase.case_description}
                </div>
              )}
              {currentCase.rules.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <span
                    style={{
                      color: "var(--ant-color-text-quaternary)",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    规则：
                  </span>
                  <div className={styles.rulesSection}>
                    {currentCase.rules.map((rule, idx) => (
                      <Tag key={idx} style={{ fontSize: 11 }}>
                        {rule}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <span style={{ color: "var(--ant-color-text-quaternary)" }}>
                  创建：
                </span>
                {formatDate(currentCase.created_at)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button
                size="small"
                type="dashed"
                onClick={() => { setDocGenModalOpen(true); setGeneratedDoc(""); }}
                icon={<FileTextOutlined />}
              >
                生成文书
              </Button>
              <Button
                size="small"
                type="dashed"
                onClick={() => { setScoreModalOpen(true); setScoreResults([]); setSelectedScoreParticipant(""); }}
                icon={<StarOutlined />}
              >
                评分
              </Button>
            </div>
          </div>

          <div className={styles.sidebarSection}>
            <div className={styles.sidebarTitle}>
              <span>仲裁请求</span>
            </div>
            <div style={{ padding: "0 12px 12px", fontSize: 13 }}>
              {/* 仲裁请求 */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--ant-color-primary)' }}>仲裁请求</div>
                <div style={{ color: 'var(--ant-color-text-secondary)', lineHeight: 1.6 }}>
                  {(currentCase as any)?.claims?.[0]?.content || "暂无仲裁请求"}
                </div>
              </div>

              {/* 反请求 */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: '#fa8c16' }}>反请求</div>
                <div style={{ color: 'var(--ant-color-text-secondary)', lineHeight: 1.6 }}>
                  {(currentCase as any)?.claims?.[1]?.content || "暂无反请求"}
                </div>
              </div>

              {/* 变更历史 */}
              <Collapse
                size="small"
                ghost
                activeKey={claimsExpanded ? ['history'] : []}
                onChange={() => setClaimsExpanded(!claimsExpanded)}
                items={[{
                  key: 'history',
                  label: '变更历史',
                  children: (
                    <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                      {currentCase.events.filter(e => e.event_type === 'claim_change').length > 0
                        ? currentCase.events.filter(e => e.event_type === 'claim_change').map((e, i) => (
                            <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--ant-color-border-secondary)' }}>
                              {e.description || '变更请求'}
                            </div>
                          ))
                        : '暂无变更记录'
                      }
                    </div>
                  )
                }]}
              />

              {/* 收费情况 */}
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--ant-color-fill-quaternary)', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>案件受理费</span>
                  <span>待计算</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
                  <span>处理费</span>
                  <span>待计算</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4, fontWeight: 600 }}>
                  <span>合计</span>
                  <span>待计算</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.sidebarSection}>
            <div className={styles.sidebarTitle}>
              <span>{"案件文件 (" + visibleFiles.length + ")"}</span>
              <Button
                size="small"
                type="dashed"
                icon={<UploadOutlined />}
                onClick={() => { setUploadModalOpen(true); uploadForm.resetFields(); }}
              >
                上传
              </Button>
            </div>
            {privateFiles.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", marginBottom: 4 }}>🔒 私有文件</div>
                {privateFiles.map((f) => (
                  <div key={f.file_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12 }}>
                    <FileTextOutlined style={{ color: "var(--ant-color-text-quaternary)" }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</span>
                    <Button size="small" type="link" style={{ fontSize: 10, padding: 0 }} onClick={() => handleShareFile(f.file_id, "shared")}>共享</Button>
                    <a href={mootApi.downloadFile(currentCase.case_id, f.file_id)} download style={{ fontSize: 10 }}>下载</a>
                    <Popconfirm title="确认删除？" onConfirm={() => handleDeleteFile(f.file_id)}>
                      <Button size="small" type="link" danger style={{ fontSize: 10, padding: 0 }}>删</Button>
                    </Popconfirm>
                  </div>
                ))}
              </div>
            )}
            {sharedFiles.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", marginBottom: 4 }}>📂 庭审共享</div>
                {sharedFiles.map((f) => (
                  <div key={f.file_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12 }}>
                    <FileTextOutlined style={{ color: "#1890ff" }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</span>
                    <span style={{ fontSize: 10, color: "var(--ant-color-text-quaternary)" }}>
                      {activeParticipants.find((p) => p.participant_id === f.owner_participant_id)?.display_name || ""}
                    </span>
                    <a href={mootApi.downloadFile(currentCase.case_id, f.file_id)} download style={{ fontSize: 10 }}>下载</a>
                    <Popconfirm title="确认删除？" onConfirm={() => handleDeleteFile(f.file_id)}>
                      <Button size="small" type="link" danger style={{ fontSize: 10, padding: 0 }}>删</Button>
                    </Popconfirm>
                  </div>
                ))}
              </div>
            )}
            {directedFiles.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", marginBottom: 4 }}>🔐 定向共享</div>
                {directedFiles.map((f) => (
                  <div key={f.file_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12 }}>
                    <FileTextOutlined style={{ color: "#722ed1" }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</span>
                    <a href={mootApi.downloadFile(currentCase.case_id, f.file_id)} download style={{ fontSize: 10 }}>下载</a>
                    <Popconfirm title="确认删除？" onConfirm={() => handleDeleteFile(f.file_id)}>
                      <Button size="small" type="link" danger style={{ fontSize: 10, padding: 0 }}>删</Button>
                    </Popconfirm>
                  </div>
                ))}
              </div>
            )}
            {visibleFiles.length === 0 && (
              <div style={{ color: "var(--ant-color-text-quaternary)", fontSize: 12, textAlign: "center", padding: "8px 0" }}>
                暂无文件
              </div>
            )}
          </div>

          <div className={styles.sidebarSection}>
            <div className={styles.sidebarTitle}>
              <span>{"参与者 (" + activeParticipants.length + ")"}</span>
              <Button
                size="small"
                type="dashed"
                icon={<UserAddOutlined />}
                onClick={() => setAddParticipantModalOpen(true)}
              >
                添加
              </Button>
            </div>
            {activeParticipants.map((p) => (
              <div key={p.participant_id} className={styles.participantCard}>
                <div
                  className={styles.participantAvatar}
                  style={{ background: ROLE_COLORS[p.role] || "#999" }}
                >
                  {getAvatarLetter(p.display_name)}
                </div>
                <div className={styles.participantInfo}>
                  <div className={styles.participantName}>{p.display_name}</div>
                  <div className={styles.participantRole}>
                    {ROLE_CATEGORY_LABELS[p.role]}
                    {p.role_detail ? " · " + p.role_detail : ""}
                  </div>
                </div>
                <div className={styles.participantActions}>
                  <Dropdown
                    menu={{ items: getParticipantMenuItems(p.participant_id) }}
                    trigger={["click"]}
                  >
                    <Button
                      size="small"
                      type="text"
                      icon={<SettingOutlined />}
                    />
                  </Dropdown>
                  <Tag
                    className={styles.collabModeTag}
                    color={
                      p.collaboration_mode === "full_ai"
                        ? "purple"
                        : p.collaboration_mode === "human_lead"
                        ? "blue"
                        : p.collaboration_mode === "full_human"
                        ? "default"
                        : "green"
                    }
                  >
                    {COLLABORATION_MODE_LABELS[p.collaboration_mode]}
                  </Tag>
                </div>
              </div>
            ))}
            {activeParticipants.length === 0 && (
              <div
                style={{
                  color: "var(--ant-color-text-quaternary)",
                  fontSize: 12,
                  textAlign: "center",
                  padding: "12px 0",
                }}
              >
                暂无参与者，点击上方添加
              </div>
            )}
          </div>

          <div className={styles.sidebarSection} style={{ flex: 1 }}>
            <Collapse
              defaultActiveKey={[]}
              size="small"
              className={styles.guidanceCollapse}
              items={[{
                key: "progress",
                label: "案件进展",
                children: (
                  <>
                    {ganttData.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, color: "var(--ant-color-text-quaternary)", marginBottom: 6 }}>阶段甘特图</div>
                        <div style={{ position: "relative", height: Math.max(ganttData.length * 22 + 4, 44), overflow: "hidden" }}>
                          {ganttData.map((g, idx) => {
                            const totalSpan = ganttData[ganttData.length - 1].end - ganttData[0].start || 1;
                            const left = ((g.start - ganttData[0].start) / totalSpan) * 100;
                            const width = Math.max(((g.end - g.start) / totalSpan) * 100, 2);
                            const showLabel = width >= 8;
                            return (
                              <div key={idx} style={{ position: "relative", height: 22 }}>
                                <div
                                  style={{
                                    position: "absolute",
                                    left: left + "%",
                                    width: width + "%",
                                    top: 3,
                                    height: 16,
                                    borderRadius: 3,
                                    background: getStageColor(g.stage),
                                    opacity: 0.7,
                                    minWidth: 4,
                                  }}
                                  title={g.label + "：" + formatDate(g.start) + " - " + formatDate(g.end)}
                                />
                                {showLabel && (
                                  <span
                                    style={{
                                      position: "absolute",
                                      left: (left + width + 0.5) + "%",
                                      top: 2,
                                      fontSize: 10,
                                      color: "var(--ant-color-text-secondary)",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {g.label}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {timelineItems.length > 0 ? (
                      <Timeline items={timelineItems} />
                    ) : (
                      <div
                        style={{
                          color: "var(--ant-color-text-quaternary)",
                          fontSize: 12,
                          textAlign: "center",
                        }}
                      >
                        暂无事件
                      </div>
                    )}
                  </>
                )
              }]}
            />
          </div>
        </div>
        )}
        {sidebarCollapsed && !isFullScreen && (
          <Button
            className={styles.sidebarExpandBtn}
            icon={<MenuUnfoldOutlined />}
            onClick={() => setSidebarCollapsed(false)}
            size="small"
          />
        )}
        </div>
      </div>

      <Modal
        title={t("moot.addParticipant", "添加参与者")}
        open={addParticipantModalOpen}
        onOk={handleAddParticipant}
        onCancel={() => setAddParticipantModalOpen(false)}
        confirmLoading={loading}
        okText={t("common.confirm", "确认")}
        cancelText={t("common.cancel", "取消")}
        width={520}
      >
        <Form
          form={addParticipantForm}
          layout="vertical"
          initialValues={{ role: "party", collaboration_mode: "ai_lead" }}
        >
          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[{ required: true, message: "请输入显示名称" }]}
          >
            <Input placeholder="如：张三、申请人一" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色类别"
            rules={[{ required: true, message: "请选择角色类别" }]}
          >
            <Select options={roleSelectOptions} />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.role !== cur.role}
          >
            {({ getFieldValue }) => {
              const role: RoleCategory = getFieldValue("role");
              const details = ROLE_DETAIL_OPTIONS[role] || [];
              if (details.length === 0) return null;
              return (
                <Form.Item name="role_detail" label="角色细项">
                  <Select
                    allowClear
                    placeholder="选择或输入角色细项"
                    options={details.map((d) => ({ value: d, label: d }))}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item
            name="agent_id"
            label="关联已有智能体"
            extra="从已有智能体中选择，或留空以快速创建新智能体"
          >
            <Select
              allowClear
              showSearch
              placeholder="选择已有智能体（可选）"
              options={agentSelectOptions}
              notFoundContent="暂无智能体，请先创建"
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.agent_id !== cur.agent_id}
          >
            {({ getFieldValue }) => {
              const agentId = getFieldValue("agent_id");
              if (agentId) return null;
              return (
                <>
                  <Form.Item
                    name="new_agent_name"
                    label="新智能体名称"
                    rules={[
                      { required: true, message: "请输入新智能体名称" },
                    ]}
                  >
                    <Input placeholder="为新建智能体命名" />
                  </Form.Item>
                  <Form.Item
                    name="new_agent_description"
                    label="新智能体描述"
                  >
                    <Input.TextArea
                      rows={2}
                      placeholder="描述智能体人设、行为特征等"
                    />
                  </Form.Item>
                </>
              );
            }}
          </Form.Item>
          <Form.Item
            name="collaboration_mode"
            label="人机协同模式"
            rules={[{ required: true }]}
          >
            <Select options={collabSelectOptions} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Add Party Modal (mid-case) ─────────────────────────────────────── */}
      <Modal
        title="新增当事人"
        open={addPartyModalOpen}
        onOk={handleAddParty}
        onCancel={() => setAddPartyModalOpen(false)}
        confirmLoading={loading}
        okText={t("common.confirm", "确认")}
        cancelText={t("common.cancel", "取消")}
        width={520}
      >
        <Form
          form={addPartyForm}
          layout="vertical"
          initialValues={{ role: "party", collaboration_mode: "ai_lead" }}
        >
          <div
            style={{
              color: "var(--ant-color-text-quaternary)",
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            在案件进行中新增当事人，可用于模拟当事人变更场景
          </div>
          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[{ required: true, message: "请输入显示名称" }]}
          >
            <Input placeholder="如：李四、新加入申请人" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色类别"
            rules={[{ required: true, message: "请选择角色类别" }]}
          >
            <Select options={roleSelectOptions} />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.role !== cur.role}
          >
            {({ getFieldValue }) => {
              const role: RoleCategory = getFieldValue("role");
              const details = ROLE_DETAIL_OPTIONS[role] || [];
              if (details.length === 0) return null;
              return (
                <Form.Item name="role_detail" label="角色细项">
                  <Select
                    allowClear
                    placeholder="选择或输入角色细项"
                    options={details.map((d) => ({ value: d, label: d }))}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item
            name="agent_id"
            label="关联已有智能体"
            extra="从已有智能体中选择，或留空以快速创建新智能体"
          >
            <Select
              allowClear
              showSearch
              placeholder="选择已有智能体（可选）"
              options={agentSelectOptions}
              notFoundContent="暂无智能体，请先创建"
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.agent_id !== cur.agent_id}
          >
            {({ getFieldValue }) => {
              const agentId = getFieldValue("agent_id");
              if (agentId) return null;
              return (
                <>
                  <Form.Item
                    name="new_agent_name"
                    label="新智能体名称"
                    rules={[{ required: true, message: "请输入新智能体名称" }]}
                  >
                    <Input placeholder="为新建智能体命名" />
                  </Form.Item>
                  <Form.Item
                    name="new_agent_description"
                    label="新智能体描述"
                  >
                    <Input.TextArea
                      rows={2}
                      placeholder="描述智能体人设、行为特征等"
                    />
                  </Form.Item>
                </>
              );
            }}
          </Form.Item>
          <Form.Item
            name="collaboration_mode"
            label="人机协同模式"
            rules={[{ required: true }]}
          >
            <Select options={collabSelectOptions} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Procedural Application Modal ─────────────────────────────────── */}
      <Modal
        title="提交程序申请"
        open={procAppModalOpen}
        onOk={handleSubmitProcApp}
        onCancel={() => setProcAppModalOpen(false)}
        confirmLoading={loading}
        okText={t("common.confirm", "确认")}
        cancelText={t("common.cancel", "取消")}
        width={520}
      >
        <Form
          form={procAppForm}
          layout="vertical"
          initialValues={{ event_type: "procedural_application" }}
        >
          <div
            style={{
              color: "var(--ant-color-text-quaternary)",
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            模拟当事人在案件进程中提交各类程序申请（管辖权异议、回避申请、鉴定申请等）
          </div>
          <Form.Item
            name="event_type"
            label="申请类型"
            rules={[{ required: true }]}
          >
            <Select>
              <Select.Option value="procedural_application">程序申请</Select.Option>
              <Select.Option value="jurisdiction_objection">管辖权异议</Select.Option>
              <Select.Option value="challenge">回避申请</Select.Option>
              <Select.Option value="appraisal">鉴定申请</Select.Option>
              <Select.Option value="merger">合并审理申请</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="description"
            label="申请内容"
            rules={[{ required: true, message: "请输入申请内容" }]}
          >
            <Input.TextArea rows={3} placeholder="详细描述申请事项和理由" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Change Rules Modal ───────────────────────────────────────────── */}
      <Modal
        title="变更仲裁规则"
        open={changeRulesModalOpen}
        onOk={() => changeRulesForm.submit()}
        onCancel={() => setChangeRulesModalOpen(false)}
        confirmLoading={loading}
        okText={t("common.confirm", "确认")}
        cancelText={t("common.cancel", "取消")}
        width={700}
      >
        <Form form={changeRulesForm} layout="vertical" onFinish={handleChangeRules}>
          <Form.Item label="规则名称" name="rules" rules={[{ required: true }]}>
            <Select
              mode="tags"
              placeholder="选择或输入规则名称"
              options={ruleOptions}
              tokenSeparators={["，", ",", "；", ";"]}
            />
          </Form.Item>

          <div
            style={{
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--ant-color-text-secondary)" }}>
              规则全文（仲裁规则属于公共知识，每个案件、每个智能体都能使用）
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                size="small"
                loading={ruleLoading}
                onClick={() => {
                  setRuleLoading(true);
                  // 模拟 AI 获取规则全文
                  setTimeout(() => {
                    setRuleFullText(
                      "（此处为 AI 自动获取的规则全文，可编辑修改）\n\n第一条 适用范围\n本规则适用于所有跨境商事仲裁案件...\n\n第二条 仲裁庭组成\n仲裁庭由三名仲裁员组成...",
                    );
                    setRuleLoading(false);
                  }, 1500);
                }}
              >
                智能获取全文
              </Button>
              <Upload
                accept=".txt,.md"
                showUploadList={false}
                beforeUpload={(file) => {
                  const reader = new FileReader();
                  reader.onload = (e) => {
                    setRuleFullText(e.target?.result as string);
                  };
                  reader.readAsText(file);
                  return false;
                }}
              >
                <Button size="small" icon={<UploadOutlined />}>
                  上传文件
                </Button>
              </Upload>
            </div>
          </div>

          <Form.Item name="rule_full_text">
            <Input.TextArea
              rows={10}
              value={ruleFullText}
              onChange={(e) => setRuleFullText(e.target.value)}
              placeholder={'选择规则名称后可点击"智能获取全文"或上传文件，也可直接在此编辑规则全文'}
            />
          </Form.Item>

          <Form.Item label="变更说明" name="description">
            <Input.TextArea rows={2} placeholder="说明变更原因" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Change Tribunal Modal ────────────────────────────────────────── */}
      <Modal
        title="变更仲裁庭"
        open={changeTribunalModalOpen}
        onOk={handleChangeTribunal}
        onCancel={() => setChangeTribunalModalOpen(false)}
        confirmLoading={loading}
        okText={t("common.confirm", "确认")}
        cancelText={t("common.cancel", "取消")}
        width={520}
      >
        <Form form={changeTribunalForm} layout="vertical">
          <div
            style={{
              color: "var(--ant-color-text-quaternary)",
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            变更仲裁庭组成（如1人变3人、仲裁员更换/回避/退出等）
          </div>
          <Form.Item
            name="description"
            label="变更说明"
            rules={[{ required: true, message: "请输入变更说明" }]}
          >
            <Input.TextArea
              rows={2}
              placeholder="如：因回避申请，原仲裁员张三退出，更换为李四；仲裁庭由1人变更为3人"
            />
          </Form.Item>
          <Form.Item
            name="data"
            extra="JSON格式，可选"
          >
            <Input.TextArea
              rows={3}
              placeholder='{"arbitrator_count": 3, "replaced_member": "张三", "replacement": "李四"}'
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Change Claims Modal ──────────────────────────────────────────── */}
      <Modal
        title="变更仲裁请求"
        open={changeClaimsModalOpen}
        onOk={handleChangeClaims}
        onCancel={() => setChangeClaimsModalOpen(false)}
        confirmLoading={loading}
        okText={t("common.confirm", "确认")}
        cancelText={t("common.cancel", "取消")}
        width={520}
      >
        <Form form={changeClaimsForm} layout="vertical">
          <div
            style={{
              color: "var(--ant-color-text-quaternary)",
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            变更仲裁请求/案件描述（增加、变更或减少仲裁请求）
          </div>
          <Form.Item
            name="description"
            label="变更后的仲裁请求"
            rules={[{ required: true, message: "请输入变更后的请求" }]}
          >
            <Input.TextArea
              rows={4}
              placeholder="详细描述变更后的仲裁请求内容"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Document Generation Modal ──────────────────────────────────────── */}
      <Modal
        title="生成法律文书"
        open={docGenModalOpen}
        onCancel={() => { if (!docGenLoading) { setDocGenModalOpen(false); setGeneratedDoc(""); } }}
        footer={
          docGenLoading ? null : generatedDoc ? [
            <Button key="copy" icon={<FileTextOutlined />} onClick={() => { navigator.clipboard.writeText(generatedDoc); antMessage.success("已复制到剪贴板"); }}>复制</Button>,
            <Button key="download" icon={<SwapOutlined />} onClick={() => {
              const blob = new Blob([generatedDoc], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${selectedDocType}_${new Date().toISOString().slice(0,10)}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}>下载MD</Button>,
            <Button key="save" type="primary" icon={<CheckOutlined />} onClick={() => { antMessage.success("文书修改已保存"); }}>保存修改</Button>,
            <Button key="close" onClick={() => { setDocGenModalOpen(false); setGeneratedDoc(""); }}>关闭</Button>,
          ] : [
            <Button key="cancel" onClick={() => setDocGenModalOpen(false)}>取消</Button>,
          ]
        }
        width={720}
        destroyOnClose
      >
        {!generatedDoc ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--ant-color-text-secondary)" }}>文书类型</label>
              <Select
                value={selectedDocType}
                onChange={setSelectedDocType}
                style={{ width: "100%" }}
                options={docTemplates.map((d) => ({ value: d.doc_type, label: d.name + " — " + d.description }))}
                placeholder="选择文书类型"
                disabled={docGenLoading}
              />
            </div>

            <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--ant-color-bg-layout)", borderRadius: 8, border: "1px solid var(--ant-color-border-secondary)" }}>
              <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 8 }}>
                生成配置（可选，用于指定规则、模板与执行智能体）
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="适用规则" style={{ marginBottom: 0 }}>
                    <Select
                      placeholder="选择规则"
                      options={ruleOptions}
                      value={selectedGenRule || undefined}
                      onChange={setSelectedGenRule}
                      allowClear
                      disabled={docGenLoading}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="文书模板" style={{ marginBottom: 0 }}>
                    <Select
                      placeholder="选择模板"
                      options={templateOptions}
                      value={selectedTemplate || undefined}
                      onChange={(v) => setSelectedTemplate(v || "")}
                      allowClear
                      disabled={docGenLoading}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="生成智能体" style={{ marginBottom: 0 }}>
                    <Select
                      placeholder="选择智能体"
                      options={agentSelectOptions}
                      value={selectedGenAgent || undefined}
                      onChange={setSelectedGenAgent}
                      allowClear
                      disabled={docGenLoading}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </div>

            {docGenLoading ? (
              <div style={{
                textAlign: "center",
                padding: "48px 0",
                background: "var(--ant-color-bg-layout)",
                borderRadius: 8,
                border: "1px dashed var(--ant-color-border)",
              }}>
                <RobotOutlined style={{ fontSize: 36, color: "var(--ant-color-primary)", marginBottom: 16 }} />
                <p style={{ margin: 0, color: "var(--ant-color-text-secondary)", fontSize: 14 }}>
                  正在生成{docTemplates.find(d => d.doc_type === selectedDocType)?.name || "法律文书"}...
                </p>
                <p style={{ margin: "8px 0 0", color: "var(--ant-color-text-quaternary)", fontSize: 12 }}>
                  AI正在分析案件材料并撰写文书，请稍候
                </p>
              </div>
            ) : (
              <Button
                type="primary"
                size="large"
                icon={<ThunderboltOutlined />}
                onClick={handleGenerateDocument}
                block
                disabled={!selectedDocType}
                style={{ height: 44 }}
              >
                开始生成文书
              </Button>
            )}
          </>
        ) : (
          <div>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom: "1px solid var(--ant-color-border-secondary)",
            }}>
              <span style={{ fontSize: 13, color: "var(--ant-color-text-secondary)" }}>
                ✅ 文书已生成，可直接编辑修改
              </span>
              <Tag color="success">Markdown 格式</Tag>
            </div>
            <Input.TextArea
              value={generatedDoc}
              onChange={(e) => setGeneratedDoc(e.target.value)}
              autoSize={{ minRows: 15, maxRows: 25 }}
              style={{
                fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
                fontSize: 13,
                lineHeight: 1.7,
                resize: "vertical",
                background: "#fafafa",
              }}
              placeholder="点击「生成文书」后，文书内容将显示在此处，可编辑修改"
            />
          </div>
        )}
      </Modal>

      {/* ── Scoring Modal ──────────────────────────────────────────────────── */}
      <Modal
        title="参与者评分"
        open={scoreModalOpen}
        onCancel={() => setScoreModalOpen(false)}
        footer={scoreResults.length > 0 ? [
          <Button key="close" onClick={() => setScoreModalOpen(false)}>关闭</Button>,
        ] : null}
        width={680}
      >
        <div style={{ marginBottom: 12 }}>
          <Select
            value={selectedScoreParticipant || undefined}
            onChange={setSelectedScoreParticipant}
            style={{ width: "100%" }}
            placeholder="选择要评分的参与者"
            options={activeParticipants.map((p) => ({
              value: p.participant_id,
              label: p.display_name + "（" + ROLE_CATEGORY_LABELS[p.role] + (p.role_detail ? " · " + p.role_detail : "") + "）",
            }))}
          />
        </div>

        <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--ant-color-bg-layout)", borderRadius: 8, border: "1px solid var(--ant-color-border-secondary)" }}>
          <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 8 }}>
            评分配置（可选，用于指定评分模板与执行智能体）
          </div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="评分模板" style={{ marginBottom: 0 }}>
                <Select
                  placeholder="选择评分模板"
                  options={[
                    { value: 'standard', label: '标准评分模板' },
                    { value: 'detailed', label: '详细评分模板' },
                  ]}
                  value={selectedScoreTemplate || undefined}
                  onChange={setSelectedScoreTemplate}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="评分智能体" style={{ marginBottom: 0 }}>
                <Select
                  placeholder="选择智能体"
                  options={agentSelectOptions}
                  value={selectedScoreAgent || undefined}
                  onChange={setSelectedScoreAgent}
                  allowClear
                />
              </Form.Item>
            </Col>
          </Row>
        </div>

        {scoreResults.length === 0 ? (
          <Button
            type="primary"
            loading={scoreLoading}
            onClick={handleScoreParticipant}
            disabled={!selectedScoreParticipant}
            block
          >
            开始评分
          </Button>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: "var(--ant-color-primary)" }}>
                  {scoreResults.length > 0 ? (scoreResults.reduce((sum, s) => sum + s.score, 0) / scoreResults.length).toFixed(1) : "-"}
                </div>
                <div style={{ fontSize: 12, color: "var(--ant-color-text-quaternary)" }}>综合评分</div>
              </div>
            </div>
            <Table<ScoreResult>
              dataSource={scoreResults}
              rowKey="dimension_id"
              size="small"
              pagination={false}
              columns={[
                {
                  title: "评分维度",
                  dataIndex: "dimension_name",
                  key: "dimension_name",
                  width: 120,
                },
                {
                  title: "得分",
                  dataIndex: "score",
                  key: "score",
                  width: 90,
                  align: "center" as const,
                  render: (score: number) => (
                    <span style={{ fontWeight: 600, color: score >= 7 ? "#52c41a" : score >= 5 ? "#faad14" : "#ff4d4f" }}>
                      {score} / 10
                    </span>
                  ),
                },
                {
                  title: "进度",
                  dataIndex: "score",
                  key: "progress",
                  width: 140,
                  render: (score: number) => (
                    <Progress
                      percent={score * 10}
                      size="small"
                      strokeColor={score >= 7 ? "#52c41a" : score >= 5 ? "#faad14" : "#ff4d4f"}
                      format={() => ""}
                    />
                  ),
                },
                {
                  title: "评语",
                  dataIndex: "reason",
                  key: "reason",
                  render: (reason: string) => (
                    <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>{reason}</span>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>

      <Modal
        title="上传文件"
        open={uploadModalOpen}
        onOk={handleUpload}
        onCancel={() => setUploadModalOpen(false)}
        confirmLoading={uploadLoading}
        okText="确认上传"
        cancelText="取消"
        width={520}
      >
        <Form
          form={uploadForm}
          layout="vertical"
          initialValues={{ visibility: "private", category: "evidence" }}
        >
          <Form.Item label="或选取本地文件夹地址">
            <Input.Group compact>
              <Input
                style={{ width: 'calc(100% - 100px)' }}
                placeholder="输入或选取本地文件夹路径（供智能体读取）"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
              />
              <Button
                style={{ width: 100 }}
                onClick={() => {
                  // 尝试使用 File System Access API
                  if ((window as any).showDirectoryPicker) {
                    (window as any).showDirectoryPicker().then((dirHandle: { name: string }) => {
                      setFolderPath(dirHandle.name);
                      antMessage.success(`已选取文件夹：${dirHandle.name}`);
                    }).catch(() => {});
                  } else {
                    antMessage.info("当前浏览器不支持文件夹选择，请手动输入路径");
                  }
                }}
              >
                选取文件夹
              </Button>
            </Input.Group>
          </Form.Item>
          <div style={{ textAlign: 'center', margin: '8px 0', color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>— 或 —</div>
          <Form.Item name="file" label="选择文件" valuePropName="fileList" getValueFromEvent={(e) => Array.isArray(e) ? e : e?.fileList} rules={[{ required: true, message: "请选择文件" }]}>
            <Upload beforeUpload={() => false} maxCount={1}>
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="description" label="文件说明">
            <Input placeholder="简要描述文件内容" />
          </Form.Item>
          {viewMode === "director" && (
            <Form.Item name="owner_participant_id" label="文件所有者" rules={[{ required: true, message: "请选择文件所有者" }]}>
              <Select
                placeholder="选择参与者"
                options={activeParticipants.map((p) => ({
                  value: p.participant_id,
                  label: p.display_name + (p.role_detail ? `(${p.role_detail})` : ""),
                }))}
              />
            </Form.Item>
          )}
          <Form.Item name="visibility" label="可见范围">
            <Select
              options={[
                { value: "private", label: "🔒 私有文件（仅所有者可见）" },
                { value: "shared", label: "📂 庭审共享（所有参与方可见）" },
                { value: "directed", label: "🔐 定向共享（指定参与者可见）" },
              ]}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.visibility !== cur.visibility}
          >
            {({ getFieldValue }) => {
              const vis = getFieldValue("visibility");
              if (vis !== "directed") return null;
              return (
                <Form.Item name="allowed_participants" label="可见参与者">
                  <Select
                    mode="multiple"
                    placeholder="选择可查看此文件的参与者"
                    options={activeParticipants.map((p) => ({
                      value: p.participant_id,
                      label: p.display_name + (p.role_detail ? `(${p.role_detail})` : ""),
                    }))}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item name="category" label="文件分类">
            <Select
              options={[
                { value: "evidence", label: "证据材料" },
                { value: "pleading", label: "诉状文书" },
                { value: "transcript", label: "庭审笔录" },
                { value: "appraisal", label: "鉴定报告" },
                { value: "document", label: "法律文书" },
                { value: "other", label: "其他" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Share Image Modal ─────────────────────────────────────────────── */}
      <Modal
        title="分享聊天记录"
        open={shareModalOpen}
        onCancel={() => setShareModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setShareModalOpen(false)}>
            关闭
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<UploadOutlined />}
            onClick={downloadShareImage}
          >
            下载图片
          </Button>,
        ]}
        width={800}
      >
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <p style={{ color: 'var(--ant-color-text-secondary)', fontSize: 14 }}>
            右键点击图片可保存到本地
          </p>
        </div>
        {shareImageData && (
          <img
            src={shareImageData}
            alt="Share Image"
            style={{
              maxWidth: '100%',
              borderRadius: 8,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          />
        )}
      </Modal>
    </div>
  );
};

export default MootPage;