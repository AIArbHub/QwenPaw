/**
 * Moot (模拟仲裁庭审) — Complete rewrite v2.
 *
 * Features:
 * - Trial style selection (大陆法系风格 / 普通法系风格)
 * - Case template selection (dispute types)
 * - 6-stage trial flow with AI auto-speak
 * - 4 collaboration modes (full_ai / ai_lead / human_lead / full_human)
 * - Real-time SSE for messages
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Button,
  Input,
  Select,
  Tag,
  Space,
  Modal,
  Form,
  Spin,
  Empty,
  Tooltip,
  Popconfirm,
  message as antMessage,
  Avatar,
  Card,
  Radio,
  Steps,
  Drawer,
  Alert,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  ArrowLeftOutlined,
  SendOutlined,
  RobotOutlined,
  ReloadOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  FastForwardOutlined,
  MenuOutlined,
  CloseOutlined,
  ImportOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import {
  mootApi,
  strategyApi,
  CASE_STAGE_LABELS,
  ROLE_CATEGORY_LABELS,
  ROLE_COLORS,
  SIDE_LABELS,
  SIDE_COLORS,
  COLLABORATION_MODE_LABELS,
  TRIAL_STYLE_LABELS,
  TRIAL_STAGE_FLOW,
  VIEW_PERSPECTIVE_LABELS,
  type MootCaseData,
  type MootCaseListItem,
  type MootMessage,
  type MootParticipant,
  type CaseStage,
  type RoleCategory,
  type CollaborationMode,
  type TrialStyle,
  type Side,
  type TrialStyleTemplate,
  type CaseTemplate,
  type ViewPerspective,
  type StrategyAnalysis,
} from "@/api/modules/moot";
import { agentsApi } from "@/api/modules/agents";
import { casesApi } from "@/api/modules/cases";
import type { AgentSummary } from "@/api/types/agents";
import type { CaseRef } from "@/api/modules/cases";
import styles from "./index.module.less";

const { TextArea } = Input;

export default function MootPage() {
  const [cases, setCases] = useState<MootCaseListItem[]>([]);
  const [currentCase, setCurrentCase] = useState<MootCaseData | null>(null);
  const [messages, setMessages] = useState<MootMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");

  // Input
  const [selectedParticipant, setSelectedParticipant] = useState("");
  const [inputText, setInputText] = useState("");

  // UI
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [advancing, setAdvancing] = useState(false);

  // Refs
  const eventSourceRef = useRef<EventSource | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  // Agents
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  // Trial styles & templates
  const [trialStyles, setTrialStyles] = useState<TrialStyleTemplate[]>([]);
  const [caseTemplates, setCaseTemplates] = useState<CaseTemplate[]>([]);

  // View perspective & strategy analysis
  const [viewPerspective, setViewPerspective] = useState<ViewPerspective>("god");
  const [strategyAnalysis, setStrategyAnalysis] = useState<StrategyAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [strategyVisible, setStrategyVisible] = useState(false);

  // Case import
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importableCases, setImportableCases] = useState<CaseRef[]>([]);
  const [importLoading, setImportLoading] = useState(false);

  // ── Load cases ──
  const loadCases = useCallback(async () => {
    try {
      const data = await mootApi.listCases();
      setCases(data);
    } catch {
      antMessage.error("加载案件列表失败");
    }
  }, []);

  // ── Load case detail ──
  const loadCase = useCallback(async (caseId: string) => {
    setLoading(true);
    try {
      const data = await mootApi.getCase(caseId);
      setCurrentCase(data);
      setMessages(data.messages);
      if (data.participants.length > 0) {
        const active = data.participants.find((p) => p.active);
        setSelectedParticipant(
          active?.participant_id || data.participants[0].participant_id,
        );
      }
      // Connect SSE
      if (eventSourceRef.current) eventSourceRef.current.close();
      const es = new EventSource(mootApi.streamUrl(caseId));
      es.onmessage = (event) => {
        try {
          const d = JSON.parse(event.data);
          if (d.type === "moot_message") {
            setMessages((prev) =>
              prev.some((m) => m.id === d.id) ? prev : [...prev, d as MootMessage],
            );
          } else if (d.type === "stage_change") {
            setCurrentCase((prev) =>
              prev
                ? {
                    ...prev,
                    current_stage: d.new_stage,
                    current_stage_label: d.new_stage_label,
                    status: d.new_stage === "closed" ? "closed" : "active",
                  }
                : prev,
            );
          } else if (d.type === "case_event") {
            setCurrentCase((prev) =>
              prev
                ? {
                    ...prev,
                    events: [
                      ...prev.events,
                      {
                        event_id: d.event_id,
                        event_type: d.event_type,
                        description: d.description,
                        data: d.data || {},
                        timestamp: d.timestamp,
                        actor_participant_id: d.actor_participant_id || null,
                      },
                    ],
                  }
                : prev,
            );
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => es.close();
      eventSourceRef.current = es;
    } catch {
      antMessage.error("加载案件详情失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial load ──
  useEffect(() => {
    loadCases();
    agentsApi
      .listAgents()
      .then((res) => setAgents(res.agents || []))
      .catch(() => {});
    mootApi
      .listTrialStyles()
      .then(setTrialStyles)
      .catch(() => {});
    mootApi
      .listTemplates()
      .then(setCaseTemplates)
      .catch(() => {});
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [loadCases]);

  // ── Auto scroll ──
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Actions ──
  const handleCreate = async (values: {
    trial_style: TrialStyle;
    template_id: string;
    case_name: string;
    case_description?: string;
    rules?: string[];
    global_collaboration_mode?: CollaborationMode;
  }) => {
    try {
      setLoading(true);
      const tmpl = caseTemplates.find((t) => t.template_id === values.template_id);
      const result = await mootApi.create({
        case_name: values.case_name || tmpl?.case_name || "仲裁模拟案",
        case_description: values.case_description || tmpl?.case_description,
        rules: values.rules || tmpl?.rules,
        trial_style: values.trial_style,
        global_collaboration_mode: values.global_collaboration_mode || "full_ai",
      });
      setCreateModalOpen(false);
      await loadCases();
      await loadCase(result.case_id);

      // Auto-add participants from template
      if (tmpl && tmpl.default_participants.length > 0) {
        const styleTemplate = trialStyles.find(
          (s) => s.style_id === values.trial_style,
        );
        const participantsToAdd =
          styleTemplate?.default_participants || tmpl.default_participants;
        for (const p of participantsToAdd) {
          try {
            await mootApi.addParticipant(result.case_id, {
              display_name: p.display_name,
              role: p.role as RoleCategory,
              role_detail: p.role_detail,
              side: p.side as Side,
              new_agent_name: `${p.display_name}_${result.case_id.slice(-4)}`,
              new_agent_description: `模拟仲裁庭审智能体 - ${p.display_name} (${p.role_detail})`,
              collaboration_mode: values.global_collaboration_mode || "full_ai",
            });
          } catch (err) {
            console.warn("Failed to add participant:", p.display_name, err);
          }
        }
        await loadCase(result.case_id);
      }
      antMessage.success("创建成功，已自动添加角色");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (caseId: string) => {
    try {
      await mootApi.deleteCase(caseId);
      if (currentCase?.case_id === caseId) {
        handleBack();
      }
      await loadCases();
      antMessage.success("已删除");
    } catch {
      antMessage.error("删除失败");
    }
  };

  const handleBack = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setCurrentCase(null);
    setMessages([]);
    setSelectedParticipant("");
    setInputText("");
    loadCases();
  };

  const handleSpeak = async () => {
    if (!currentCase || !inputText.trim()) return;
    if (!selectedParticipant) {
      antMessage.warning("请选择发言者");
      return;
    }
    try {
      await mootApi.speak(currentCase.case_id, {
        participant_id: selectedParticipant,
        content: inputText.trim(),
      });
      setInputText("");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "发言失败");
    }
  };

  const handleAutoSpeak = async (participantId: string) => {
    if (!currentCase) return;
    try {
      await mootApi.autoSpeak(currentCase.case_id, {
        participant_id: participantId,
        prompt: "请根据当前阶段和你的角色发言",
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "AI 发言失败");
    }
  };

  const handleAdvanceTrial = async () => {
    if (!currentCase) return;
    try {
      setAdvancing(true);
      const result = await mootApi.advanceTrial(currentCase.case_id);
      if (result.message) {
        antMessage.info(result.message);
      } else if (result.messages_sent > 0) {
        antMessage.success(`AI 发言 ${result.messages_sent} 条`);
      } else {
        antMessage.info("本轮无 AI 自动发言（所有角色为人工模式）");
      }
      await loadCase(currentCase.case_id);
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "推进失败");
    } finally {
      setAdvancing(false);
    }
  };

  const handleAdvanceToNextStage = async () => {
    if (!currentCase) return;
    try {
      setAdvancing(true);
      await mootApi.advanceToNextStage(currentCase.case_id);
      await loadCase(currentCase.case_id);
      antMessage.success("已跳转到下一阶段");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "跳转失败");
    } finally {
      setAdvancing(false);
    }
  };

  const handleAddParticipant = async (values: {
    display_name: string;
    role: RoleCategory;
    role_detail?: string;
    side?: Side;
    agent_id?: string;
    collaboration_mode?: CollaborationMode;
  }) => {
    if (!currentCase) return;
    try {
      setLoading(true);
      await mootApi.addParticipant(currentCase.case_id, {
        display_name: values.display_name,
        role: values.role,
        role_detail: values.role_detail,
        side: values.side,
        agent_id: values.agent_id,
        collaboration_mode: values.collaboration_mode || "full_ai",
      });
      await loadCase(currentCase.case_id);
      setAddParticipantOpen(false);
      antMessage.success("参与者添加成功");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "添加失败");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveParticipant = async (participantId: string) => {
    if (!currentCase) return;
    try {
      await mootApi.removeParticipant(currentCase.case_id, participantId);
      await loadCase(currentCase.case_id);
      antMessage.success("已移除参与者");
    } catch {
      antMessage.error("移除失败");
    }
  };

  const handleUpdateCollabMode = async (
    participantId: string,
    mode: CollaborationMode,
  ) => {
    if (!currentCase) return;
    try {
      await mootApi.updateParticipant(currentCase.case_id, participantId, {
        collaboration_mode: mode,
      });
      await loadCase(currentCase.case_id);
    } catch {
      antMessage.error("更新失败");
    }
  };

  // ── Strategy Analysis ──
  const handleAnalyzeStrategy = async () => {
    if (!currentCase) return;
    setAnalyzing(true);
    setStrategyVisible(true);
    try {
      const result = await strategyApi.analyzeStrategy(currentCase.case_id, viewPerspective);
      setStrategyAnalysis(result);
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "策略分析失败，请确保案件有足够的对话内容");
      setStrategyAnalysis(null);
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Case Import ──
  const handleOpenImport = async () => {
    setImportModalOpen(true);
    setImportLoading(true);
    try {
      const resp = await casesApi.listCases();
      setImportableCases(resp.cases || []);
    } catch {
      antMessage.error("加载案件列表失败");
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportCase = async (sourceCaseId: string, caseName: string) => {
    setImportLoading(true);
    try {
      const result = await strategyApi.importFromCase("new", {
        source_case_id: sourceCaseId,
        case_name: caseName,
      });
      setImportModalOpen(false);
      await loadCases();
      await loadCase(result.case_id);
      antMessage.success(`已从案件「${caseName}」导入信息，创建为新的模拟仲裁案`);
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "导入失败");
    } finally {
      setImportLoading(false);
    }
  };

  // ── Derived ──
  const filteredCases = useMemo(
    () =>
      searchText
        ? cases.filter((c) =>
            c.case_name.toLowerCase().includes(searchText.toLowerCase()),
          )
        : cases,
    [cases, searchText],
  );

  const activeParticipants = useMemo(
    () => currentCase?.participants.filter((p) => p.active) || [],
    [currentCase],
  );

  const currentStageIndex = useMemo(() => {
    if (!currentCase) return -1;
    return TRIAL_STAGE_FLOW.indexOf(currentCase.current_stage);
  }, [currentCase]);

  // ── Render: Case List ──
  if (!currentCase) {
    return (
      <div className={styles.page}>
        <PageHeader
          current="模拟仲裁庭审"
          subRow={
            <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            新建仲裁案
          </Button>
          <Button
            icon={<ImportOutlined />}
            onClick={handleOpenImport}
          >
            从案件导入
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadCases}>
            刷新
          </Button>
            </Space>
          }
        />
        <div className={styles.listBody}>
          <Input.Search
            placeholder="搜索案件..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ maxWidth: 400, marginBottom: 16 }}
            allowClear
          />
          {loading ? (
            <Spin style={{ display: "block", margin: "20vh auto" }} />
          ) : filteredCases.length === 0 ? (
            <Empty
              description="暂无仲裁案，点击「新建仲裁案」开始"
              style={{ marginTop: "20vh" }}
            >
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreateModalOpen(true)}
              >
                新建仲裁案
              </Button>
            </Empty>
          ) : (
            <div className={styles.caseGrid}>
              {filteredCases.map((c) => (
                <div
                  key={c.case_id}
                  className={styles.caseCard}
                  onClick={() => loadCase(c.case_id)}
                >
                  <div className={styles.caseCardHeader}>
                    <span className={styles.caseCardName}>{c.case_name}</span>
                    <Tag color="blue">{c.current_stage_label}</Tag>
                  </div>
                  <div className={styles.caseCardMeta}>
                    <span>
                      <TeamOutlined /> {c.participants?.length || 0} 角色
                    </span>
                    <span>{c.message_count || 0} 条发言</span>
                    <span>{new Date(c.created_at * 1000).toLocaleDateString("zh-CN")}</span>
                  </div>
                  <div className={styles.caseCardTags}>
                    {c.trial_style && (
                      <Tag color="purple" style={{ fontSize: 11 }}>
                        {TRIAL_STYLE_LABELS[c.trial_style]}
                      </Tag>
                    )}
                    {c.rules?.slice(0, 2).map((r, i) => (
                      <Tag key={i} style={{ fontSize: 11 }}>{r}</Tag>
                    ))}
                  </div>
                  <Popconfirm
                    title="确定删除此案件？"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDelete(c.case_id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button
                      className={styles.caseCardDelete}
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
              ))}
            </div>
          )}
        </div>

        <CreateCaseModal
          open={createModalOpen}
          onCancel={() => setCreateModalOpen(false)}
          onSubmit={handleCreate}
          loading={loading}
          trialStyles={trialStyles}
          caseTemplates={caseTemplates}
        />
      </div>
    );
  }

  // ── Render: Case Detail ──
  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderLeft}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
          />
          <span className={styles.caseTitle}>{currentCase.case_name}</span>
          <Tag color="purple">
            {TRIAL_STYLE_LABELS[currentCase.trial_style] || currentCase.trial_style}
          </Tag>
          <Tag color="blue">{currentCase.current_stage_label}</Tag>
          {currentCase.status === "closed" && <Tag color="default">已结案</Tag>}
        </div>
        <div className={styles.detailHeaderRight}>
          <Select
            value={viewPerspective}
            onChange={setViewPerspective}
            style={{ minWidth: 180 }}
            options={(Object.keys(VIEW_PERSPECTIVE_LABELS) as ViewPerspective[]).map(p => ({
              value: p,
              label: VIEW_PERSPECTIVE_LABELS[p],
            }))}
          />
          <Button
            icon={<ThunderboltOutlined />}
            onClick={handleAnalyzeStrategy}
            loading={analyzing}
            disabled={currentCase.status === "closed"}
          >
            策略分析
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={advancing}
            disabled={currentCase.status === "closed"}
            onClick={handleAdvanceTrial}
          >
            推进庭审
          </Button>
          <Tooltip title="跳转到下一阶段（不触发AI发言）">
            <Button
              icon={<FastForwardOutlined />}
              loading={advancing}
              disabled={currentCase.status === "closed"}
              onClick={handleAdvanceToNextStage}
            />
          </Tooltip>
          <Tooltip title={sidebarVisible ? "隐藏侧栏" : "显示侧栏"}>
            <Button
              type="text"
              size="small"
              icon={<MenuOutlined />}
              onClick={() => setSidebarVisible(!sidebarVisible)}
            />
          </Tooltip>
        </div>
      </div>

      {/* Stage bar */}
      <div className={styles.stageBar}>
        <Steps
          size="small"
          current={currentStageIndex >= 0 ? currentStageIndex : 0}
          items={TRIAL_STAGE_FLOW.map((s) => ({
            title: CASE_STAGE_LABELS[s],
          }))}
        />
      </div>

      {/* Body */}
      <div className={styles.detailBody}>
        {/* Chat area */}
        <div className={styles.chatArea}>
          {/* Messages */}
          <div className={styles.messageList} ref={messageListRef}>
            {messages.length === 0 ? (
              <Empty
                description="暂无消息，点击「推进庭审」开始AI自动发言，或在下方手动输入"
                style={{ marginTop: "20vh" }}
              />
            ) : (
              messages.map((msg) => {
                const participant = currentCase.participants.find(
                  (p) => p.participant_id === msg.participant_id,
                );
                const roleColor = participant
                  ? ROLE_COLORS[participant.role] || "#999"
                  : "#999";
                return (
                  <div key={msg.id} className={styles.messageItem}>
                    <Avatar
                      size={36}
                      style={{ backgroundColor: roleColor, flexShrink: 0 }}
                    >
                      {msg.display_name?.[0] || "?"}
                    </Avatar>
                    <div className={styles.messageContent}>
                      <div className={styles.messageMeta}>
                        <span className={styles.messageName}>{msg.display_name}</span>
                        {participant && (
                          <>
                            <Tag
                              style={{
                                fontSize: 10,
                                lineHeight: "16px",
                                padding: "0 4px",
                                margin: 0,
                                color: roleColor,
                                borderColor: roleColor,
                              }}
                            >
                              {ROLE_CATEGORY_LABELS[participant.role]}
                            </Tag>
                            {participant.side !== "neutral" && (
                              <Tag
                                style={{
                                  fontSize: 10,
                                  lineHeight: "16px",
                                  padding: "0 4px",
                                  margin: 0,
                                  color: SIDE_COLORS[participant.side],
                                  borderColor: SIDE_COLORS[participant.side],
                                }}
                              >
                                {SIDE_LABELS[participant.side]}
                              </Tag>
                            )}
                          </>
                        )}
                        <span className={styles.messageTime}>
                          {new Date(msg.timestamp * 1000).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div
                        className={`${styles.messageBubble} ${
                          msg.is_system ? styles.messageSystem : ""
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Input area */}
          <div className={styles.inputArea}>
            <Select
              value={selectedParticipant}
              onChange={setSelectedParticipant}
              style={{ minWidth: 180 }}
              placeholder="选择发言者"
              options={activeParticipants.map((p) => ({
                value: p.participant_id,
                label: `${p.display_name} (${ROLE_CATEGORY_LABELS[p.role]})`,
              }))}
            />
            <TextArea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入发言内容..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleSpeak();
                }
              }}
              className={styles.inputText}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSpeak}
              disabled={!inputText.trim()}
            >
              发送
            </Button>
          </div>
        </div>

        {/* Sidebar */}
        {sidebarVisible && (
          <div className={styles.sidebar}>
            {/* Participants */}
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarTitle}>
                <Space>
                  <TeamOutlined />
                  角色 ({activeParticipants.length})
                </Space>
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setAddParticipantOpen(true)}
                />
              </div>
              {activeParticipants.map((p) => (
                <div key={p.participant_id} className={styles.participantCard}>
                  <Avatar
                    size={32}
                    style={{
                      backgroundColor: ROLE_COLORS[p.role] || "#999",
                      flexShrink: 0,
                    }}
                  >
                    {p.display_name[0]}
                  </Avatar>
                  <div className={styles.participantInfo}>
                    <div className={styles.participantName}>{p.display_name}</div>
                    <div className={styles.participantRole}>
                      {ROLE_CATEGORY_LABELS[p.role]}
                      {p.side !== "neutral" && ` · ${SIDE_LABELS[p.side]}`}
                      {p.role_detail && ` · ${p.role_detail}`}
                    </div>
                    <Select
                      size="small"
                      value={p.collaboration_mode}
                      onChange={(v: CollaborationMode) =>
                        handleUpdateCollabMode(p.participant_id, v)
                      }
                      style={{ width: "100%", marginTop: 4 }}
                      options={(Object.keys(COLLABORATION_MODE_LABELS) as CollaborationMode[]).map(
                        (m) => ({
                          value: m,
                          label: COLLABORATION_MODE_LABELS[m],
                        }),
                      )}
                    />
                  </div>
                  <div className={styles.participantActions}>
                    <Tooltip title="AI 自动发言">
                      <Button
                        type="text"
                        size="small"
                        icon={<RobotOutlined />}
                        onClick={() => handleAutoSpeak(p.participant_id)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="确定移除此参与者？"
                      onConfirm={() => handleRemoveParticipant(p.participant_id)}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<CloseOutlined />}
                      />
                    </Popconfirm>
                  </div>
                </div>
              ))}
            </div>

            {/* Case info */}
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarTitle}>案件信息</div>
              {currentCase.case_description && (
                <div className={styles.infoBlock}>
                  <span className={styles.infoLabel}>描述</span>
                  <span className={styles.infoValue}>{currentCase.case_description}</span>
                </div>
              )}
              <div className={styles.infoBlock}>
                <span className={styles.infoLabel}>庭审风格</span>
                <span className={styles.infoValue}>
                  {TRIAL_STYLE_LABELS[currentCase.trial_style]}
                </span>
              </div>
              <div className={styles.infoBlock}>
                <span className={styles.infoLabel}>协作模式</span>
                <span className={styles.infoValue}>
                  {COLLABORATION_MODE_LABELS[currentCase.global_collaboration_mode]}
                </span>
              </div>
              {currentCase.rules?.length > 0 && (
                <div className={styles.infoBlock}>
                  <span className={styles.infoLabel}>规则</span>
                  <div className={styles.rulesTags}>
                    {currentCase.rules.map((r, i) => (
                      <Tag key={i} style={{ fontSize: 11 }}>{r}</Tag>
                    ))}
                  </div>
                </div>
              )}
              <div className={styles.infoBlock}>
                <span className={styles.infoLabel}>创建时间</span>
                <span className={styles.infoValue}>
                  {new Date(currentCase.created_at * 1000).toLocaleString("zh-CN")}
                </span>
              </div>
            </div>

            {/* Timeline */}
            {currentCase.events?.length > 0 && (
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarTitle}>案件进展</div>
                <div className={styles.timeline}>
                  {currentCase.events.slice(-10).reverse().map((e) => (
                    <div key={e.event_id} className={styles.timelineItem}>
                      <div className={styles.timelineItemTitle}>{e.description}</div>
                      <div className={styles.timelineItemTime}>
                        {new Date(e.timestamp * 1000).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateCaseModal
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onSubmit={handleCreate}
        loading={loading}
        trialStyles={trialStyles}
        caseTemplates={caseTemplates}
      />
      <AddParticipantModal
        open={addParticipantOpen}
        onCancel={() => setAddParticipantOpen(false)}
        onSubmit={handleAddParticipant}
        loading={loading}
        agents={agents}
      />

      {/* Strategy Analysis Drawer */}
      <Drawer
        title="策略分析"
        open={strategyVisible}
        onClose={() => setStrategyVisible(false)}
        width={560}
      >
        {analyzing ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <Spin size="large" tip="AI 正在分析策略...">
              <div style={{ minHeight: 100 }} />
            </Spin>
          </div>
        ) : strategyAnalysis ? (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Alert
              type="info"
              showIcon
              message={`当前视角: ${VIEW_PERSPECTIVE_LABELS[strategyAnalysis.perspective]}`}
            />

            {/* Win Rate */}
            <Card title="胜率预测" size="small">
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{
                  width: 80, height: 80, borderRadius: "50%",
                  background: `conic-gradient(var(--ant-color-primary) ${strategyAnalysis.win_rate.score * 3.6}deg, var(--ant-color-fill-secondary) 0deg)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: "50%",
                    background: "var(--ant-color-bg-container)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, fontWeight: 700, color: "var(--ant-color-primary)",
                  }}>
                    {strategyAnalysis.win_rate.score}%
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>{strategyAnalysis.win_rate.analysis}</div>
                  {strategyAnalysis.win_rate.key_factors.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                      <strong>关键因素:</strong>
                      {strategyAnalysis.win_rate.key_factors.map((f, i) => (
                        <Tag key={i} style={{ fontSize: 11, margin: 2 }}>{f}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* Own Strategies */}
            {strategyAnalysis.own_strategies.length > 0 && (
              <Card title="己方可选策略" size="small">
                {strategyAnalysis.own_strategies.map((s, i) => (
                  <div key={i} style={{ padding: "8px 0", borderBottom: i < strategyAnalysis.own_strategies.length - 1 ? "1px solid var(--ant-color-border-secondary)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <strong style={{ fontSize: 13 }}>{s.name}</strong>
                      <Tag color={s.risk_level === "high" ? "red" : s.risk_level === "medium" ? "orange" : "green"} style={{ fontSize: 10 }}>
                        {s.risk_level === "high" ? "高风险" : s.risk_level === "medium" ? "中风险" : "低风险"}
                      </Tag>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 2 }}>{s.description}</div>
                    <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>预期结果: {s.expected_outcome}</div>
                  </div>
                ))}
              </Card>
            )}

            {/* Opponent Predictions */}
            {strategyAnalysis.opponent_predictions.length > 0 && (
              <Card title="他方策略预测" size="small">
                {strategyAnalysis.opponent_predictions.map((p, i) => (
                  <div key={i} style={{ padding: "8px 0", borderBottom: i < strategyAnalysis.opponent_predictions.length - 1 ? "1px solid var(--ant-color-border-secondary)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <strong style={{ fontSize: 13 }}>{p.display_name}</strong>
                      <Tag color="blue" style={{ fontSize: 10 }}>置信度 {p.confidence}%</Tag>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>{p.predicted_strategy}</div>
                  </div>
                ))}
              </Card>
            )}

            {/* Recommendations */}
            {strategyAnalysis.recommendations.length > 0 && (
              <Card title="AI 建议" size="small">
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
                  {strategyAnalysis.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Risk Assessment */}
            {strategyAnalysis.risk_assessment && (
              <Alert
                type="warning"
                showIcon
                message="风险评估"
                description={strategyAnalysis.risk_assessment}
              />
            )}
          </Space>
        ) : (
          <Empty description="点击「策略分析」按钮开始 AI 分析" />
        )}
      </Drawer>

      {/* Case Import Modal */}
      <Modal
        title="从案件管理导入"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        footer={null}
        width={560}
      >
        {importLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin tip="加载案件列表...">
              <div style={{ minHeight: 100 }} />
            </Spin>
          </div>
        ) : importableCases.length === 0 ? (
          <Empty description="暂无可导入的案件，请先在案件管理中创建案件" />
        ) : (
          <div>
            <Alert
              type="info"
              showIcon
              message="导入说明"
              description="从案件管理导入案件基本信息和文件引用，创建为独立的模拟仲裁案。模拟仲裁数据与案件管理数据相互独立。"
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {importableCases.map(c => (
                <Card
                  key={c.case_id}
                  size="small"
                  hoverable
                  onClick={() => handleImportCase(c.case_id, c.case_name)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 20 }}>⚖️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{c.case_name}</div>
                      <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>
                        {c.source_path} · {c.file_count} 个文件
                      </div>
                    </div>
                    <Button type="link" size="small">导入</Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function CreateCaseModal({
  open,
  onCancel,
  onSubmit,
  loading,
  trialStyles,
  caseTemplates,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    trial_style: TrialStyle;
    template_id: string;
    case_name: string;
    case_description?: string;
    rules?: string[];
    global_collaboration_mode?: CollaborationMode;
  }) => void;
  loading: boolean;
  trialStyles: TrialStyleTemplate[];
  caseTemplates: CaseTemplate[];
}) {
  const [form] = Form.useForm();
  const [selectedStyle, setSelectedStyle] = useState<TrialStyle>("civil_style");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("sales_contract");

  // Auto-fill case info when template changes
  useEffect(() => {
    if (!open) return;
    const tmpl = caseTemplates.find((t) => t.template_id === selectedTemplate);
    if (tmpl) {
      form.setFieldsValue({
        case_name: tmpl.case_name,
        case_description: tmpl.case_description,
        rules: tmpl.rules,
      });
    }
  }, [selectedTemplate, open, caseTemplates, form]);

  return (
    <Modal
      title="新建仲裁庭审案"
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={() => form.validateFields().then((v) => onSubmit(v))}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
      destroyOnClose
      width={680}
    >
      <Form form={form} layout="vertical">
        {/* Step 1: Trial style */}
        <Form.Item
          name="trial_style"
          label="庭审风格"
          rules={[{ required: true, message: "请选择庭审风格" }]}
          initialValue="civil_style"
        >
          <Radio.Group
            onChange={(e) => setSelectedStyle(e.target.value)}
            style={{ width: "100%" }}
          >
            {trialStyles.map((s) => (
              <Radio.Button
                key={s.style_id}
                value={s.style_id}
                style={{ width: "50%", textAlign: "center", height: "auto", padding: "8px 0" }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: "#999" }}>{s.description}</div>
                </div>
              </Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>

        {/* Step 2: Case template */}
        <Form.Item
          name="template_id"
          label="案件模板"
          rules={[{ required: true, message: "请选择案件模板" }]}
          initialValue="sales_contract"
        >
          <Select
            placeholder="选择案件模板"
            onChange={(v) => setSelectedTemplate(v)}
            options={caseTemplates.map((t) => ({
              value: t.template_id,
              label: `${t.name} — ${t.description}`,
            }))}
          />
        </Form.Item>

        {/* Step 3: Case info */}
        <Form.Item
          name="case_name"
          label="案件名称"
          rules={[{ required: true, message: "请输入案件名称" }]}
        >
          <Input placeholder="如：买卖合同纠纷仲裁案" />
        </Form.Item>
        <Form.Item name="case_description" label="案件描述">
          <TextArea
            rows={3}
            placeholder="简要描述案件背景和争议焦点..."
          />
        </Form.Item>
        <Form.Item name="rules" label="仲裁规则">
          <Select
            mode="multiple"
            placeholder="选择适用的仲裁规则"
            options={[
              { value: "北京仲裁委员会仲裁规则", label: "北京仲裁委员会仲裁规则" },
              { value: "CIETAC仲裁规则", label: "CIETAC仲裁规则" },
              { value: "国际商事仲裁规则", label: "国际商事仲裁规则" },
              { value: "数字经济仲裁程序规定", label: "数字经济仲裁程序规定" },
              { value: "建设工程争议评审规则", label: "建设工程争议评审规则" },
              { value: "SCIA仲裁规则", label: "SCIA仲裁规则" },
              { value: "SHIAC仲裁规则", label: "SHIAC仲裁规则" },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="global_collaboration_mode"
          label="全局协作模式"
          initialValue="full_ai"
        >
          <Select
            options={[
              { value: "full_ai", label: "AI全自动（观摩模式）" },
              { value: "ai_lead", label: "AI主导（辅助模式）" },
              { value: "human_lead", label: "人主导（实训模式）" },
              { value: "full_human", label: "纯人工（考试模式）" },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function AddParticipantModal({
  open,
  onCancel,
  onSubmit,
  loading,
  agents,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    display_name: string;
    role: RoleCategory;
    role_detail?: string;
    side?: Side;
    agent_id?: string;
    collaboration_mode?: CollaborationMode;
  }) => void;
  loading: boolean;
  agents: AgentSummary[];
}) {
  const [form] = Form.useForm();
  return (
    <Modal
      title="添加参与者"
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={() => form.validateFields().then((v) => onSubmit(v))}
      confirmLoading={loading}
      okText="添加"
      cancelText="取消"
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="display_name"
          label="显示名称"
          rules={[{ required: true, message: "请输入名称" }]}
        >
          <Input placeholder="如：张三（申请人）" />
        </Form.Item>
        <Form.Item
          name="role"
          label="角色"
          rules={[{ required: true, message: "请选择角色" }]}
        >
          <Select
            placeholder="选择角色"
            options={[
              { value: "arbitrator", label: "仲裁员" },
              { value: "party", label: "当事人" },
              { value: "counsel", label: "代理人" },
              { value: "secretary", label: "仲裁秘书" },
            ]}
          />
        </Form.Item>
        <Form.Item name="side" label="阵营" initialValue="neutral">
          <Select
            options={[
              { value: "claimant", label: "申请人方" },
              { value: "respondent", label: "被申请人方" },
              { value: "neutral", label: "中立" },
            ]}
          />
        </Form.Item>
        <Form.Item name="role_detail" label="角色描述">
          <Input placeholder="如：申请人 / 被申请人 / 首席仲裁员" />
        </Form.Item>
        <Form.Item name="agent_id" label="关联智能体">
          <Select
            placeholder="选择关联的 AI 智能体（可选）"
            allowClear
            showSearch
            optionFilterProp="label"
            options={agents.map((a) => ({
              value: a.id,
              label: a.name,
            }))}
          />
        </Form.Item>
        <Form.Item name="collaboration_mode" label="协作模式" initialValue="full_ai">
          <Select
            options={[
              { value: "full_ai", label: "AI全自动" },
              { value: "ai_lead", label: "AI主导" },
              { value: "human_lead", label: "人主导" },
              { value: "full_human", label: "纯人工" },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
