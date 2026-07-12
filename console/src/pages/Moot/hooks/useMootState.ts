/**
 * Central state management for the Moot (模拟仲裁) page.
 *
 * Extracted from the original 3252-line monolith to provide a single
 * source of truth for case data, messages, participants, and SSE.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { message as antMessage, Modal } from "antd";
import {
  mootApi,
  CASE_STAGE_LABELS,
  type MootCaseData,
  type MootCaseListItem,
  type MootMessage,
  type MootParticipant,
  type MootCaseEvent,
  type MootCaseFile,
  type CaseStage,
  type RoleCategory,
  type CollaborationMode,
  type CaseTemplate,
  type ArbitrationRule,
  type DocumentTemplate,
  type ScoringDimension,
  type ScoreResult,
  type FileVisibility,
  type EventType,
} from "@/api/modules/moot";
import { agentsApi } from "@/api/modules/agents";
import type { AgentSummary } from "@/api/types/agents";
import {
  createDefaultCollaborationPresets,
  filterCasesByText,
  getDemoCaseDraft,
  getDefaultCollaborationMode,
} from "../utils";

// ── Stage whitelist ────────────────────────────────────────────────────────
const ENABLED_STAGES: CaseStage[] = ["hearing"];

function isStageEnabled(stage: CaseStage): boolean {
  return ENABLED_STAGES.includes(stage);
}

function selectAgentForRole(
  role: RoleCategory,
  agents: AgentSummary[],
  usedAgentIds: Set<string>,
): string | undefined {
  const keywords: Record<RoleCategory, string[]> = {
    arbitrator: ["仲裁员", "arbitrator", "裁判", "裁决"],
    party: ["申请人", "被申请人", "当事人", "party"],
    secretary: ["秘书", "secretary"],
    controller: ["导演", "主控", "controller", "管理"],
  };
  const normalized = agents.map((a) => ({
    ...a,
    ln: a.name.toLowerCase(),
    ld: (a.description || "").toLowerCase(),
  }));
  const kws = keywords[role] || [];
  let candidate = normalized.find(
    (a) =>
      !usedAgentIds.has(a.id) &&
      kws.some((kw) => a.ln.includes(kw) || a.ld.includes(kw)),
  );
  if (candidate) return candidate.id;
  candidate = normalized.find((a) => !usedAgentIds.has(a.id));
  return candidate?.id;
}

export interface MootState {
  // ── Case list ──
  cases: MootCaseListItem[];
  caseSearch: string;
  setCaseSearch: (v: string) => void;
  filteredCases: MootCaseListItem[];

  // ── Current case ──
  currentCase: MootCaseData | null;
  messages: MootMessage[];
  caseFiles: MootCaseFile[];
  loading: boolean;

  // ── Input ──
  selectedParticipant: string;
  setSelectedParticipant: (v: string) => void;
  inputText: string;
  setInputText: (v: string) => void;

  // ── View mode ──
  viewMode: "director" | "role";
  setViewMode: (v: "director" | "role") => void;
  currentRoleParticipantId: string;
  setCurrentRoleParticipantId: (v: string) => void;

  // ── Selection mode ──
  isSelectionMode: boolean;
  setIsSelectionMode: (v: boolean) => void;
  selectedMessageIds: Set<string>;
  toggleMessageSelection: (id: string) => void;
  selectAllMessages: () => void;
  clearSelection: () => void;

  // ── UI state ──
  isFullScreen: boolean;
  setIsFullScreen: (v: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;

  // ── Reference data ──
  caseTemplates: CaseTemplate[];
  arbitrationRules: ArbitrationRule[];
  docTemplates: DocumentTemplate[];
  scoringDimensions: ScoringDimension[];
  availableAgents: AgentSummary[];

  // ── Collaboration preset ──
  collaborationPresetId: string;
  setCollaborationPresetId: (v: string) => void;

  // ── Actions ──
  loadCases: () => Promise<void>;
  loadCase: (caseId: string) => Promise<void>;
  handleCreate: (params: {
    case_name: string;
    case_description?: string;
    rules?: string[];
    templateId?: string;
  }) => Promise<void>;
  handleDelete: (caseId: string) => Promise<void>;
  handleSpeak: () => Promise<void>;
  handleAutoSpeak: (participantId: string) => Promise<void>;
  handleAdvanceStage: (stage: CaseStage) => Promise<void>;
  requestStageChange: (stage: CaseStage) => void;
  handleUndoStage: () => Promise<void>;
  handleBack: () => void;
  handleUpdateCollabMode: (
    participantId: string,
    mode: CollaborationMode,
  ) => Promise<void>;
  handleRemoveParticipant: (participantId: string) => Promise<void>;
  handleAddParticipant: (params: {
    agent_id?: string;
    new_agent_name?: string;
    new_agent_description?: string;
    display_name: string;
    role: RoleCategory;
    role_detail?: string;
    collaboration_mode?: CollaborationMode;
  }) => Promise<void>;
  handleUploadFile: (
    file: File,
    ownerParticipantId: string,
    visibility: FileVisibility,
    category: string,
    description: string,
  ) => Promise<void>;
  handleDeleteFile: (fileId: string) => Promise<void>;
  handleShareFile: (
    fileId: string,
    visibility: FileVisibility,
  ) => Promise<void>;
  handleGenerateDocument: (
    docType: string,
    participantId?: string,
  ) => Promise<string>;
  handleScoreParticipant: (
    participantId: string,
    dimensionId?: string,
  ) => Promise<ScoreResult[]>;

  // ── Derived ──
  activeParticipants: MootParticipant[];
  visitedStages: Set<CaseStage>;
  previousStage: CaseStage | null;
  isStageEnabled: (stage: CaseStage) => boolean;
}

export function useMootState(): MootState {
  // ── State ──
  const [cases, setCases] = useState<MootCaseListItem[]>([]);
  const [currentCase, setCurrentCase] = useState<MootCaseData | null>(null);
  const [messages, setMessages] = useState<MootMessage[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState("");
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [caseSearch, setCaseSearch] = useState("");
  const [viewMode, setViewMode] = useState<"director" | "role">("director");
  const [currentRoleParticipantId, setCurrentRoleParticipantId] = useState("");
  const [caseFiles, setCaseFiles] = useState<MootCaseFile[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    new Set(),
  );
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Reference data ──
  const [caseTemplates, setCaseTemplates] = useState<CaseTemplate[]>([]);
  const [arbitrationRules, setArbitrationRules] = useState<ArbitrationRule[]>(
    [],
  );
  const [docTemplates, setDocTemplates] = useState<DocumentTemplate[]>([]);
  const [, setScoringDimensions] = useState<ScoringDimension[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([]);
  const [collaborationPresetId, setCollaborationPresetId] = useState(() =>
    typeof window !== "undefined"
      ? window.localStorage.getItem("qwenpaw.moot.defaultCollaborationPreset") ||
        "ai_lead_default"
      : "ai_lead_default",
  );

  // ── Refs ──
  const eventSourceRef = useRef<EventSource | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const didAutoSeedRef = useRef(false);

  // ── SSE ──
  const connectSSE = useCallback((caseId: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource(mootApi.streamUrl(caseId));
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "moot_message") {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.id)) return prev;
            return [...prev, data as MootMessage];
          });
          setCurrentCase((prev) =>
            prev
              ? { ...prev, updated_at: data.timestamp || Date.now() / 1000 }
              : prev,
          );
        } else if (data.type === "stage_change") {
          setCurrentCase((prev) =>
            prev
              ? {
                  ...prev,
                  current_stage: data.new_stage,
                  current_stage_label: data.new_stage_label,
                  status: data.new_stage === "closed" ? "closed" : "active",
                }
              : prev,
          );
        } else if (data.type === "speaker_change") {
          setCurrentCase((prev) =>
            prev ? { ...prev, current_speaker: data.current_speaker } : prev,
          );
        } else if (data.type === "case_event") {
          const newEvent: MootCaseEvent = {
            event_id: data.event_id,
            event_type: data.event_type as EventType,
            description: data.description,
            data: data.data || {},
            timestamp: data.timestamp,
            actor_participant_id: data.actor_participant_id || null,
          };
          setCurrentCase((prev) =>
            prev ? { ...prev, events: [...prev.events, newEvent] } : prev,
          );
          if (
            ["file_uploaded", "file_shared", "file_deleted", "file_versioned"].includes(
              data.event_type,
            )
          ) {
            mootApi.listFiles(caseId).then(setCaseFiles).catch(() => {});
          }
        }
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => es.close();
    eventSourceRef.current = es;
  }, []);

  // ── Load cases ──
  const loadCases = useCallback(async () => {
    try {
      const data = await mootApi.listCases();
      setCases(data);
      // Auto-seed demo case for first-time users
      if (!data.length && !didAutoSeedRef.current) {
        didAutoSeedRef.current = true;
        const agentsRes = await agentsApi.listAgents().catch(() => ({
          agents: [],
        }));
        const seedAgents = agentsRes.agents || [];
        if (seedAgents.length > 0) setAvailableAgents(seedAgents);

        const draft = getDemoCaseDraft();
        const result = await mootApi.create({
          case_name: draft.case_name,
          case_description: draft.case_description,
          rules: draft.rules,
        });
        const usedIds = new Set<string>();
        for (const p of draft.participants) {
          const aid = selectAgentForRole(p.role, seedAgents, usedIds);
          if (aid) usedIds.add(aid);
          try {
            await mootApi.addParticipant(result.case_id, {
              agent_id: aid || undefined,
              display_name: p.display_name,
              role: p.role,
              role_detail: p.role_detail,
              collaboration_mode: p.collaboration_mode,
            });
          } catch {
            // skip
          }
        }
        const seeded = await mootApi.getCase(result.case_id);
        setCurrentCase(seeded);
        setMessages(seeded.messages);
        if (seeded.participants.length > 0) {
          const active = seeded.participants.find((p) => p.active);
          setSelectedParticipant(
            active?.participant_id || seeded.participants[0].participant_id,
          );
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
  }, [connectSSE]);

  // ── Load single case ──
  const loadCase = useCallback(
    async (caseId: string) => {
      try {
        const data = await mootApi.getCase(caseId);
        setCurrentCase(data);
        setMessages(data.messages);
        if (data.participants.length > 0 && !selectedParticipant) {
          const active = data.participants.find((p) => p.active);
          setSelectedParticipant(
            active?.participant_id || data.participants[0].participant_id,
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

  // ── Create case ──
  const handleCreate = useCallback(
    async (params: {
      case_name: string;
      case_description?: string;
      rules?: string[];
      templateId?: string;
    }) => {
      try {
        setLoading(true);
        const defaultMode =
          createDefaultCollaborationPresets().find(
            (p) => p.id === collaborationPresetId,
          )?.collaboration_mode || getDefaultCollaborationMode();
        const result = await mootApi.create({
          case_name: params.case_name || "仲裁模拟案",
          case_description: params.case_description || "",
          rules: params.rules?.length ? params.rules : undefined,
        });
        await loadCases();
        await loadCase(result.case_id);

        if (params.templateId) {
          const tmpl = caseTemplates.find(
            (t) => t.template_id === params.templateId,
          );
          if (tmpl && tmpl.default_participants.length > 0) {
            for (const dp of tmpl.default_participants) {
              try {
                await mootApi.addParticipant(result.case_id, {
                  display_name: dp.display_name,
                  role: dp.role as RoleCategory,
                  role_detail: dp.role_detail,
                  collaboration_mode: defaultMode,
                });
              } catch {
                // skip
              }
            }
            await loadCase(result.case_id);
          }
        }
        antMessage.success("仲裁模拟案创建成功");
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "创建失败");
      } finally {
        setLoading(false);
      }
    },
    [collaborationPresetId, caseTemplates, loadCases, loadCase],
  );

  // ── Delete case ──
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

  // ── Speak ──
  const handleSpeak = useCallback(async () => {
    const pid =
      viewMode === "role" ? currentRoleParticipantId : selectedParticipant;
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

  // ── Auto speak ──
  const handleAutoSpeak = useCallback(
    async (participantId: string) => {
      if (!currentCase) return;
      try {
        await mootApi.autoSpeak(currentCase.case_id, {
          participant_id: participantId,
          prompt: "请根据案件上下文和你的角色发言",
        });
        antMessage.success("AI发言已发送");
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "自动发言失败");
      }
    },
    [currentCase],
  );

  // ── Stage management ──
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
      if (!currentCase || currentCase.status === "closed") return;
      if (stage === currentCase.current_stage) return;
      if (!isStageEnabled(stage)) {
        antMessage.warning("该阶段正在开发中，敬请期待");
        return;
      }
      Modal.confirm({
        title: "确认切换阶段",
        content: `将从 "${currentCase.current_stage_label}" 切换到 "${CASE_STAGE_LABELS[stage]}"。如需撤销，可在切换后立即使用"撤销上一步"。`,
        okText: "确认切换",
        cancelText: "取消",
        onOk: () => handleAdvanceStage(stage),
      });
    },
    [currentCase, handleAdvanceStage],
  );

  const handleUndoStage = useCallback(async () => {
    if (!currentCase || !previousStage) return;
    try {
      setLoading(true);
      await mootApi.advanceStage(currentCase.case_id, {
        stage: previousStage,
        description: "撤销上一步阶段变更",
      });
      await loadCase(currentCase.case_id);
      antMessage.success("已撤销上一步阶段变更");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "撤销失败");
    } finally {
      setLoading(false);
    }
  }, [currentCase, loadCase, previousStage]);

  // ── Back to list ──
  const handleBack = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setCurrentCase(null);
    setMessages([]);
    setSelectedParticipant("");
    setInputText("");
    setCaseFiles([]);
    setIsSelectionMode(false);
    setSelectedMessageIds(new Set());
    loadCases();
  }, [loadCases]);

  // ── Participant management ──
  const handleAddParticipant = useCallback(
    async (params: {
      agent_id?: string;
      new_agent_name?: string;
      new_agent_description?: string;
      display_name: string;
      role: RoleCategory;
      role_detail?: string;
      collaboration_mode?: CollaborationMode;
    }) => {
      if (!currentCase) return;
      try {
        setLoading(true);
        await mootApi.addParticipant(currentCase.case_id, params);
        await loadCase(currentCase.case_id);
        antMessage.success("参与者添加成功");
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "添加失败");
      } finally {
        setLoading(false);
      }
    },
    [currentCase, loadCase],
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

  // ── File management ──
  const handleUploadFile = useCallback(
    async (
      file: File,
      ownerParticipantId: string,
      visibility: FileVisibility,
      category: string,
      description: string,
    ) => {
      if (!currentCase) return;
      try {
        setLoading(true);
        await mootApi.uploadFile(
          currentCase.case_id,
          file,
          ownerParticipantId,
          visibility,
          [],
          category,
          [],
          description,
        );
        const files = await mootApi.listFiles(currentCase.case_id);
        setCaseFiles(files);
        antMessage.success("文件上传成功");
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "上传失败");
      } finally {
        setLoading(false);
      }
    },
    [currentCase],
  );

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      if (!currentCase) return;
      try {
        await mootApi.deleteFile(currentCase.case_id, fileId);
        const files = await mootApi.listFiles(currentCase.case_id);
        setCaseFiles(files);
        antMessage.success("文件已删除");
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "删除失败");
      }
    },
    [currentCase],
  );

  const handleShareFile = useCallback(
    async (fileId: string, visibility: FileVisibility) => {
      if (!currentCase) return;
      try {
        await mootApi.updateFileVisibility(
          currentCase.case_id,
          fileId,
          visibility,
        );
        const files = await mootApi.listFiles(currentCase.case_id);
        setCaseFiles(files);
        antMessage.success("文件可见性已更新");
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "更新失败");
      }
    },
    [currentCase],
  );

  // ── Document generation ──
  const handleGenerateDocument = useCallback(
    async (docType: string, participantId?: string) => {
      if (!currentCase) return "";
      try {
        const res = await mootApi.generateDocument(
          currentCase.case_id,
          docType,
          participantId,
        );
        return res.content;
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "文书生成失败");
        return "";
      }
    },
    [currentCase],
  );

  // ── Score participant ──
  const handleScoreParticipant = useCallback(
    async (participantId: string, dimensionId?: string) => {
      if (!currentCase) return [];
      try {
        const res = await mootApi.scoreParticipant(
          currentCase.case_id,
          participantId,
          dimensionId,
        );
        return res.scores;
      } catch (err: unknown) {
        const e = err as { message?: string };
        antMessage.error(e.message || "评分失败");
        return [];
      }
    },
    [currentCase],
  );

  // ── Message selection ──
  const toggleMessageSelection = useCallback((id: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  const clearSelection = useCallback(() => {
    setSelectedMessageIds(new Set());
    setIsSelectionMode(false);
  }, []);

  // ── Derived values ──
  const filteredCases = useMemo(
    () => filterCasesByText(cases, caseSearch),
    [cases, caseSearch],
  );

  const activeParticipants = useMemo(
    () => currentCase?.participants.filter((p) => p.active) || [],
    [currentCase],
  );

  const visitedStages = useMemo(() => {
    const set = new Set<CaseStage>();
    if (!currentCase) return set;
    set.add(currentCase.current_stage);
    for (const e of currentCase.events) {
      if (e.event_type === "stage_change") {
        const d = e.data as { old_stage?: string; new_stage?: string };
        if (d.old_stage) set.add(d.old_stage as CaseStage);
        if (d.new_stage) set.add(d.new_stage as CaseStage);
      }
    }
    return set;
  }, [currentCase]);

  const previousStage = useMemo<CaseStage | null>(() => {
    if (!currentCase?.events?.length) return null;
    for (let i = currentCase.events.length - 1; i >= 0; i--) {
      const e = currentCase.events[i];
      if (e.event_type !== "stage_change") continue;
      const d = e.data as { old_stage?: string };
      return d.old_stage ? (d.old_stage as CaseStage) : null;
    }
    return null;
  }, [currentCase]);

  // ── Effects ──
  useEffect(() => {
    loadCases();
  }, [loadCases]);

  useEffect(() => {
    mootApi.listTemplates().then(setCaseTemplates).catch(() => {});
    mootApi.listRules().then(setArbitrationRules).catch(() => {});
    mootApi.listDocumentTemplates().then(setDocTemplates).catch(() => {});
    mootApi.listScoringDimensions().then(setScoringDimensions).catch(() => {});
    agentsApi
      .listAgents()
      .then((res) => setAvailableAgents(res.agents || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  return {
    cases,
    caseSearch,
    setCaseSearch,
    filteredCases,
    currentCase,
    messages,
    caseFiles,
    loading,
    selectedParticipant,
    setSelectedParticipant,
    inputText,
    setInputText,
    viewMode,
    setViewMode,
    currentRoleParticipantId,
    setCurrentRoleParticipantId,
    isSelectionMode,
    setIsSelectionMode,
    selectedMessageIds,
    toggleMessageSelection,
    selectAllMessages,
    clearSelection,
    isFullScreen,
    setIsFullScreen,
    sidebarCollapsed,
    setSidebarCollapsed,
    caseTemplates,
    arbitrationRules,
    docTemplates,
    scoringDimensions: [],
    availableAgents,
    collaborationPresetId,
    setCollaborationPresetId: (v: string) => {
      setCollaborationPresetId(v);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("qwenpaw.moot.defaultCollaborationPreset", v);
      }
    },
    loadCases,
    loadCase,
    handleCreate,
    handleDelete,
    handleSpeak,
    handleAutoSpeak,
    handleAdvanceStage,
    requestStageChange,
    handleUndoStage,
    handleBack,
    handleUpdateCollabMode,
    handleRemoveParticipant,
    handleAddParticipant,
    handleUploadFile,
    handleDeleteFile,
    handleShareFile,
    handleGenerateDocument,
    handleScoreParticipant,
    activeParticipants,
    visitedStages,
    previousStage,
    isStageEnabled,
  };
}
