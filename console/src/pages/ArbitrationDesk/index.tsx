/**
 * ArbitrationDesk — 仲裁工作台
 *
 * Combines Moot (模拟仲裁) + Cases (案件卷宗) + Award (裁决书) into a unified
 * 3-column workspace: case sidebar | main area (tabs) | AI copilot panel.
 *
 * Landing page: recent cases grid with welcome card.
 * Case workspace: 3-column layout with tabs for Documents, Trial, and Award.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Button,
  Tag,
  Space,
  Spin,
  Empty,
  Tooltip,
  Popconfirm,
  message as antMessage,
  Card,
  Radio,
  Steps,
  Input,
  Avatar,
  Divider,
  Badge,
  Tabs,
  Timeline,
  Descriptions,
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
  FolderOpenOutlined,
  FileTextOutlined,
  AuditOutlined,
  BookOutlined,
  BulbOutlined,
  PaperClipOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  HomeOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import {
  mootApi,
  CASE_STAGE_LABELS,
  ROLE_CATEGORY_LABELS,
  SIDE_LABELS,
  COLLABORATION_MODE_LABELS,
  TRIAL_STYLE_LABELS,
  TRIAL_STAGE_FLOW,
  type MootCaseData,
  type MootCaseListItem,
  type MootMessage,
  type MootParticipant,
  type CaseStage,
} from "@/api/modules/moot";
import { deskApi, type CopilotMessage, type CaseLink } from "@/api/modules/desk";
import styles from "./index.module.less";

type NavSection = "overview" | "documents" | "trial" | "award" | "knowledge";
type MainTab = "documents" | "trial" | "award";

export default function ArbitrationDesk() {
  const [cases, setCases] = useState<MootCaseListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState<MootCaseData | null>(null);
  const [caseDetailLoading, setCaseDetailLoading] = useState(false);
  const [navSection, setNavSection] = useState<NavSection>("overview");
  const [mainTab, setMainTab] = useState<MainTab>("documents");
  const [caseLinks, setCaseLinks] = useState<CaseLink[]>([]);

  // Copilot state
  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([]);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);

  // Trial state
  const [trialAdvancing, setTrialAdvancing] = useState(false);

  // Create case state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStyle, setCreateStyle] = useState<"civil_style" | "common_style">("civil_style");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");

  const copilotBodyRef = useRef<HTMLDivElement>(null);

  // Load case list
  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mootApi.listCases();
      setCases(data || []);
    } catch (e) {
      antMessage.error("加载案件列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  // Open case
  const openCase = useCallback(async (caseId: string) => {
    setCaseDetailLoading(true);
    setNavSection("overview");
    setMainTab("documents");
    try {
      const data = await mootApi.getCase(caseId);
      setSelectedCase(data);
      // Load case links
      try {
        const links = await deskApi.getCaseLinks(caseId);
        setCaseLinks(links || []);
      } catch {
        setCaseLinks([]);
      }
      // Load copilot history
      try {
        const history = await deskApi.getCopilotHistory(caseId);
        setCopilotMessages(history || []);
      } catch {
        setCopilotMessages([]);
      }
    } catch (e) {
      antMessage.error("加载案件详情失败");
    } finally {
      setCaseDetailLoading(false);
    }
  }, []);

  // Close case → back to list
  const closeCase = useCallback(() => {
    setSelectedCase(null);
    setCopilotMessages([]);
    setCaseLinks([]);
    loadCases();
  }, [loadCases]);

  // Create case
  const handleCreate = useCallback(async () => {
    if (!createName.trim()) {
      antMessage.warning("请输入案件名称");
      return;
    }
    try {
      await mootApi.create({
        case_name: createName.trim(),
        case_description: createDesc.trim(),
        trial_style: createStyle,
        global_collaboration_mode: "full_ai",
      });
      antMessage.success("案件创建成功");
      setShowCreateModal(false);
      setCreateName("");
      setCreateDesc("");
      loadCases();
    } catch (e) {
      antMessage.error("创建案件失败");
    }
  }, [createName, createDesc, createStyle, loadCases]);

  // Delete case
  const handleDelete = useCallback(async (caseId: string) => {
    try {
      await mootApi.deleteCase(caseId);
      antMessage.success("案件已删除");
      loadCases();
    } catch (e) {
      antMessage.error("删除失败");
    }
  }, [loadCases]);

  // Copilot send
  const handleCopilotSend = useCallback(async () => {
    if (!selectedCase || !copilotInput.trim()) return;
    const userMsg = copilotInput.trim();
    setCopilotInput("");
    setCopilotLoading(true);
    // Add user message immediately
    setCopilotMessages(prev => [...prev, {
      id: `temp_${Date.now()}`,
      role: "user",
      content: userMsg,
      timestamp: Date.now() / 1000,
    }]);
    try {
      const result = await deskApi.copilotChat({
        case_id: selectedCase.case_id,
        message: userMsg,
        context_tab: mainTab,
      });
      setCopilotMessages(prev => [...prev, {
        id: `resp_${Date.now()}`,
        role: "assistant",
        content: result.response,
        timestamp: Date.now() / 1000,
      }]);
    } catch (e) {
      antMessage.error("AI 助手回复失败");
    } finally {
      setCopilotLoading(false);
    }
  }, [selectedCase, copilotInput, mainTab]);

  // Scroll copilot to bottom
  useEffect(() => {
    if (copilotBodyRef.current) {
      copilotBodyRef.current.scrollTop = copilotBodyRef.current.scrollHeight;
    }
  }, [copilotMessages]);

  // Trial advance
  const handleAdvanceTrial = useCallback(async () => {
    if (!selectedCase) return;
    setTrialAdvancing(true);
    try {
      const result = await mootApi.advanceTrial(selectedCase.case_id);
      if (result.messages_sent > 0) {
        antMessage.success(`AI 角色已发言 (${result.messages_sent} 条)`);
      }
      // Reload case
      await openCase(selectedCase.case_id);
    } catch (e) {
      antMessage.error("推进庭审失败");
    } finally {
      setTrialAdvancing(false);
    }
  }, [selectedCase, openCase]);

  // ── Render: Case List (Landing) ───────────────────────────────────────────

  if (!selectedCase) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="仲裁工作台"
          desc="案件管理 · 模拟庭审 · 裁决生成 — 一站式仲裁工作平台"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreateModal(true)}>
              新建案件
            </Button>
          }
        />
        <div className={styles.listBody}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px" }}>
              <Spin size="large" />
            </div>
          ) : cases.length === 0 ? (
            <div className={styles.welcomeCard}>
              <div className={styles.welcomeTitle}>🏛️ 欢迎使用仲裁工作台</div>
              <div className={styles.welcomeDesc}>
                在这里，您可以将案件文档、模拟庭审和裁决书整合在一个工作台中。
                AI 助手将全程陪伴，提供智能建议。
              </div>
              <div className={styles.welcomeActions}>
                <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setShowCreateModal(true)}>
                  新建案件工作台
                </Button>
                <Button size="large" icon={<ThunderboltOutlined />} onClick={() => setShowCreateModal(true)}>
                  快速模拟庭审
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.welcomeCard} style={{ padding: "20px 24px", marginBottom: 16 }}>
                <div className={styles.welcomeTitle} style={{ fontSize: 18 }}>🏛️ 仲裁工作台</div>
                <div className={styles.welcomeDesc} style={{ marginBottom: 0 }}>
                  选择一个案件进入工作台，或创建新案件
                </div>
              </div>
              <div className={styles.caseGrid}>
                {cases.map((c) => (
                  <div
                    key={c.case_id}
                    className={styles.caseCard}
                    onClick={() => openCase(c.case_id)}
                  >
                    <div className={styles.caseCardHeader}>
                      <span className={styles.caseCardName}>{c.case_name}</span>
                      <Tag color={c.status === "closed" ? "default" : "processing"}>
                        {CASE_STAGE_LABELS[c.current_stage] || c.current_stage}
                      </Tag>
                    </div>
                    <div className={styles.caseCardMeta}>
                      <span><TeamOutlined /> {c.participants?.length || 0} 参与人</span>
                      <span><FileTextOutlined /> {c.message_count} 条发言</span>
                      <span><ClockCircleOutlined /> {new Date(c.created_at * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className={styles.caseCardTags}>
                      <Tag>{TRIAL_STYLE_LABELS[c.trial_style] || c.trial_style}</Tag>
                      {c.rules?.slice(0, 1).map((r, i) => (
                        <Tag key={i} color="blue">{r}</Tag>
                      ))}
                    </div>
                    <Popconfirm
                      title="确定删除此案件？"
                      onConfirm={(e) => { e?.stopPropagation(); handleDelete(c.case_id); }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <Button
                        size="small"
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                        style={{ position: "absolute", top: 12, right: 12, opacity: 0.5 }}
                      />
                    </Popconfirm>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Create Modal */}
        {showCreateModal && (
          <Card
            title="新建案件工作台"
            style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 480, zIndex: 1000 }}
            extra={<Button type="text" icon={<DeleteOutlined />} onClick={() => setShowCreateModal(false)} />}
          >
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>案件名称</label>
                <Input
                  placeholder="例如：买卖合同纠纷案"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>案件描述</label>
                <Input.TextArea
                  placeholder="简要描述案件背景..."
                  rows={3}
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>庭审风格</label>
                <Radio.Group value={createStyle} onChange={(e) => setCreateStyle(e.target.value)}>
                  <Radio value="civil_style">大陆法系风格（职权探知）</Radio>
                  <Radio value="common_style">普通法系风格（当事人对抗）</Radio>
                </Radio.Group>
              </div>
              <Button type="primary" block onClick={handleCreate}>
                创建案件工作台
              </Button>
            </Space>
          </Card>
        )}
      </div>
    );
  }

  // ── Render: Case Workspace (3-column) ─────────────────────────────────────

  if (caseDetailLoading) {
    return (
      <div className={styles.page}>
        <div style={{ textAlign: "center", padding: "100px" }}>
          <Spin size="large" tip="加载案件工作台..." />
        </div>
      </div>
    );
  }

  const trialStageIdx = selectedCase ? TRIAL_STAGE_FLOW.indexOf(selectedCase.current_stage as CaseStage) : -1;
  const evidenceLinks = caseLinks.filter(l => l.link_type === "evidence");
  const referenceLinks = caseLinks.filter(l => l.link_type === "reference");

  return (
    <div className={styles.page}>
      {/* ── Left: Case Sidebar ── */}
      <div className={styles.workspace}>
        <div className={styles.caseSidebar}>
          <div className={styles.caseSidebarHeader}>
            <span className={styles.caseSidebarBack} onClick={closeCase}>
              <ArrowLeftOutlined /> 返回
            </span>
            <span className={styles.caseSidebarTitle}>{selectedCase.case_name}</span>
          </div>

          <div className={styles.caseSidebarNav}>
            <div
              className={`${styles.navItem} ${navSection === "overview" ? styles.active : ""}`}
              onClick={() => { setNavSection("overview"); setMainTab("documents"); }}
            >
              <HomeOutlined className={styles.navItemIcon} />
              <span className={styles.navItemLabel}>概览</span>
            </div>
            <div
              className={`${styles.navItem} ${navSection === "documents" ? styles.active : ""}`}
              onClick={() => { setNavSection("documents"); setMainTab("documents"); }}
            >
              <FolderOpenOutlined className={styles.navItemIcon} />
              <span className={styles.navItemLabel}>材料中心</span>
              {evidenceLinks.length > 0 && (
                <span className={styles.navItemBadge}>{evidenceLinks.length}</span>
              )}
            </div>
            <div
              className={`${styles.navItem} ${navSection === "trial" ? styles.active : ""}`}
              onClick={() => { setNavSection("trial"); setMainTab("trial"); }}
            >
              <AuditOutlined className={styles.navItemIcon} />
              <span className={styles.navItemLabel}>庭审</span>
              {selectedCase.messages.length > 0 && (
                <span className={styles.navItemBadge}>{selectedCase.messages.length}</span>
              )}
            </div>
            <div
              className={`${styles.navItem} ${navSection === "award" ? styles.active : ""}`}
              onClick={() => { setNavSection("award"); setMainTab("award"); }}
            >
              <FileTextOutlined className={styles.navItemIcon} />
              <span className={styles.navItemLabel}>文书</span>
            </div>
            <div
              className={`${styles.navItem} ${navSection === "knowledge" ? styles.active : ""}`}
              onClick={() => { setNavSection("knowledge"); setMainTab("documents"); }}
            >
              <BookOutlined className={styles.navItemIcon} />
              <span className={styles.navItemLabel}>知识与记忆</span>
              {referenceLinks.length > 0 && (
                <span className={styles.navItemBadge}>{referenceLinks.length}</span>
              )}
            </div>
          </div>

          {/* Status footer */}
          <div className={styles.caseSidebarFooter}>
            <div className={styles.statusItem}>
              <span>庭审阶段</span>
              <span className={styles.statusValue}>
                {CASE_STAGE_LABELS[selectedCase.current_stage] || selectedCase.current_stage}
              </span>
            </div>
            <div className={styles.statusItem}>
              <span>参与人</span>
              <span className={styles.statusValue}>{selectedCase.participants.length}</span>
            </div>
            <div className={styles.statusItem}>
              <span>关联证据</span>
              <span className={styles.statusValue}>{evidenceLinks.length}</span>
            </div>
            <div className={styles.statusItem}>
              <span>庭审风格</span>
              <span className={styles.statusValue}>
                {TRIAL_STYLE_LABELS[selectedCase.trial_style] || selectedCase.trial_style}
              </span>
            </div>
          </div>
        </div>

        {/* ── Center: Main Area ── */}
        <div className={styles.mainArea}>
          <div className={styles.mainHeader}>
            <Tabs
              activeKey={mainTab}
              onChange={(key) => setMainTab(key as MainTab)}
              size="small"
              style={{ flex: 1 }}
              items={[
                { key: "documents", label: <span><FolderOpenOutlined /> 材料</span> },
                { key: "trial", label: <span><AuditOutlined /> 庭审</span> },
                { key: "award", label: <span><FileTextOutlined /> 裁决</span> },
              ]}
            />
            <Space>
              {mainTab === "trial" && (
                <Button
                  type="primary"
                  icon={<FastForwardOutlined />}
                  loading={trialAdvancing}
                  onClick={handleAdvanceTrial}
                >
                  推进庭审
                </Button>
              )}
              <Button icon={<ReloadOutlined />} onClick={() => openCase(selectedCase.case_id)} />
            </Space>
          </div>

          <div className={styles.mainBody}>
            {/* ─── Overview Tab ─── */}
            {navSection === "overview" && (
              <div style={{ maxWidth: 800 }}>
                <Descriptions title="案件信息" bordered column={2} size="small">
                  <Descriptions.Item label="案件名称">{selectedCase.case_name}</Descriptions.Item>
                  <Descriptions.Item label="案件状态">
                    <Tag color={selectedCase.status === "closed" ? "default" : "processing"}>
                      {selectedCase.status}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="当前阶段">
                    {CASE_STAGE_LABELS[selectedCase.current_stage] || selectedCase.current_stage}
                  </Descriptions.Item>
                  <Descriptions.Item label="庭审风格">
                    {TRIAL_STYLE_LABELS[selectedCase.trial_style] || selectedCase.trial_style}
                  </Descriptions.Item>
                  <Descriptions.Item label="仲裁规则" span={2}>
                    {selectedCase.rules.map((r, i) => (
                      <Tag key={i} color="blue">{r}</Tag>
                    ))}
                  </Descriptions.Item>
                  <Descriptions.Item label="案件描述" span={2}>
                    {selectedCase.case_description || "无"}
                  </Descriptions.Item>
                </Descriptions>

                <Divider>程序时间线</Divider>
                <Timeline
                  items={selectedCase.events.slice(-10).map(e => ({
                    color: e.event_type === "stage_change" ? "green" : "blue",
                    children: (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{e.description}</div>
                        <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>
                          {new Date(e.timestamp * 1000).toLocaleString()}
                        </div>
                      </div>
                    ),
                  }))}
                />

                {selectedCase.participants.length > 0 && (
                  <>
                    <Divider>参与人</Divider>
                    <Space wrap>
                      {selectedCase.participants.map(p => (
                        <Tag
                          key={p.participant_id}
                          color={p.side === "claimant" ? "blue" : p.side === "respondent" ? "red" : "default"}
                        >
                          {p.display_name} ({ROLE_CATEGORY_LABELS[p.role]})
                          {p.active ? "" : " (未激活)"}
                        </Tag>
                      ))}
                    </Space>
                  </>
                )}
              </div>
            )}

            {/* ─── Documents Tab ─── */}
            {mainTab === "documents" && navSection !== "overview" && (
              <div style={{ maxWidth: 800 }}>
                {navSection === "knowledge" ? (
                  <div>
                    <h3>📜 知识与记忆</h3>
                    <p style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
                      本案相关的知识页和 AI 记忆自动关联在此。
                    </p>
                    <Divider />
                    {referenceLinks.length > 0 ? (
                      referenceLinks.map(link => (
                        <Card key={link.link_id} size="small" style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>
                              <BookOutlined /> {link.wiki_page_path || "知识页"}
                            </span>
                            <Tag>{link.link_type}</Tag>
                          </div>
                        </Card>
                      ))
                    ) : (
                      <Empty description="暂无关联知识页" />
                    )}
                    <Divider />
                    <h4>AI 记忆</h4>
                    <p style={{ color: "var(--ant-color-text-quaternary)", fontSize: 12 }}>
                      AI 助手在此案件中的对话和分析会自动存入记忆，下次打开时仍记得。
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                      <h3>📁 材料中心</h3>
                      <Button icon={<PlusOutlined />} disabled>上传材料</Button>
                    </div>
                    {evidenceLinks.length > 0 ? (
                      evidenceLinks.map(link => (
                        <Card key={link.link_id} size="small" style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>
                              <PaperClipOutlined /> {link.doc_id || "文档"}
                              {link.side && <Tag style={{ marginLeft: 8 }}>{SIDE_LABELS[link.side as keyof typeof SIDE_LABELS] || link.side}</Tag>}
                            </span>
                            <Space>
                              <Tooltip title="AI 分析">
                                <Button size="small" icon={<RobotOutlined />}
                                  onClick={async () => {
                                    try {
                                      const result = await deskApi.analyzeDocument(link.doc_id, selectedCase.case_id);
                                      antMessage.success(`分析完成: ${result.summary}`);
                                      const links = await deskApi.getCaseLinks(selectedCase.case_id);
                                      setCaseLinks(links || []);
                                    } catch {
                                      antMessage.error("分析失败");
                                    }
                                  }}
                                />
                              </Tooltip>
                              <Button size="small" danger icon={<DeleteOutlined />}
                                onClick={async () => {
                                  await deskApi.removeCaseLink(selectedCase.case_id, link.link_id);
                                  const links = await deskApi.getCaseLinks(selectedCase.case_id);
                                  setCaseLinks(links || []);
                                }}
                              />
                            </Space>
                          </div>
                          {link.ai_analysis && (
                            <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginTop: 4 }}>
                              {link.ai_analysis.substring(0, 200)}...
                            </div>
                          )}
                        </Card>
                      ))
                    ) : (
                      <Empty description="暂无关联材料。在知识工作台中上传文档后，可在此关联到案件。" />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ─── Trial Tab ─── */}
            {mainTab === "trial" && (
              <div style={{ maxWidth: 800 }}>
                {/* Stage Steps */}
                <Steps
                  size="small"
                  current={trialStageIdx >= 0 ? trialStageIdx : 0}
                  items={TRIAL_STAGE_FLOW.filter(s => s !== "closed").map(s => ({
                    title: CASE_STAGE_LABELS[s] || s,
                  }))}
                  style={{ marginBottom: 16 }}
                />

                {/* Trial messages */}
                <div style={{
                  background: "var(--ant-color-bg-container)",
                  borderRadius: 10,
                  border: "1px solid var(--ant-color-border-secondary)",
                  padding: 16,
                  maxHeight: 500,
                  overflowY: "auto",
                }}>
                  {selectedCase.messages.length > 0 ? (
                    selectedCase.messages.map((msg) => (
                      <div key={msg.id} style={{ marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <Avatar
                          size="small"
                          style={{
                            background: msg.is_system ? "#ccc" :
                              msg.role === "arbitrator" ? "#722ed1" :
                              msg.role === "party" ? "#1890ff" : "#52c41a"
                          }}
                        >
                          {msg.is_system ? "系" : msg.display_name?.charAt(0) || "?"}
                        </Avatar>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 2 }}>
                            {msg.display_name}
                            {msg.is_system && <Tag style={{ marginLeft: 4 }}>系统</Tag>}
                            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>
                              {new Date(msg.timestamp * 1000).toLocaleTimeString()}
                            </span>
                          </div>
                          <div style={{
                            padding: "8px 12px",
                            borderRadius: "4px 12px 12px 12px",
                            background: msg.is_system ? "var(--ant-color-fill-quaternary)" : "var(--ant-color-bg-layout)",
                            border: "1px solid var(--ant-color-border-secondary)",
                            fontSize: 13,
                            lineHeight: 1.6,
                            wordBreak: "break-word",
                          }}>
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty description="暂无庭审记录。点击「推进庭审」开始 AI 模拟。" />
                  )}
                </div>

                {/* Trial checklist */}
                <Card size="small" style={{ marginTop: 12 }} title="庭审准备">
                  <div style={{ fontSize: 13, lineHeight: 2 }}>
                    <CheckCircleOutlined style={{ color: "#52c41a" }} />
                    <span style={{ marginLeft: 6 }}>仲裁规则已加载</span>
                    <br />
                    {evidenceLinks.length > 0 ? (
                      <>
                        <CheckCircleOutlined style={{ color: "#52c41a" }} />
                        <span style={{ marginLeft: 6 }}>证据材料已关联 ({evidenceLinks.length} 份)</span>
                      </>
                    ) : (
                      <>
                        <ExclamationCircleOutlined style={{ color: "#faad14" }} />
                        <span style={{ marginLeft: 6 }}>暂无关联证据材料，AI 角色将无法引用证据</span>
                      </>
                    )}
                    <br />
                    {selectedCase.participants.length > 0 ? (
                      <>
                        <CheckCircleOutlined style={{ color: "#52c41a" }} />
                        <span style={{ marginLeft: 6 }}>AI 角色已就位 ({selectedCase.participants.filter(p => p.active).length} 人)</span>
                      </>
                    ) : (
                      <>
                        <ExclamationCircleOutlined style={{ color: "#faad14" }} />
                        <span style={{ marginLeft: 6 }}>暂无参与人，请添加庭审角色</span>
                      </>
                    )}
                  </div>
                </Card>
              </div>
            )}

            {/* ─── Award Tab ─── */}
            {mainTab === "award" && (
              <div style={{ maxWidth: 800 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <h3>📝 裁决书</h3>
                  <Space>
                    <Button
                      icon={<RobotOutlined />}
                      onClick={async () => {
                        try {
                          const result = await mootApi.generateDocument(selectedCase.case_id, "award");
                          antMessage.success("AI 裁决书已生成");
                          // Navigate to award page for editing
                          window.open(`/award?case_id=${selectedCase.case_id}`, "_self");
                        } catch {
                          antMessage.error("生成失败");
                        }
                      }}
                    >
                      AI 起草
                    </Button>
                    <Button onClick={() => window.open(`/award?case_id=${selectedCase.case_id}`, "_self")}>
                      打开裁决书编辑器
                    </Button>
                  </Space>
                </div>
                <Card size="small">
                  <p style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
                    AI 将基于庭审记录和案件证据，自动生成裁决书草稿。
                    生成后可在裁决书编辑器中进行编辑、核阅和导出。
                  </p>
                  <Divider />
                  <div style={{ fontSize: 13, lineHeight: 2 }}>
                    <CheckCircleOutlined style={{ color: selectedCase.messages.length > 0 ? "#52c41a" : "#d9d9d9" }} />
                    <span style={{ marginLeft: 6 }}>
                      庭审记录 {selectedCase.messages.length > 0 ? `(${selectedCase.messages.length} 条)` : "(无)"}
                    </span>
                    <br />
                    <CheckCircleOutlined style={{ color: evidenceLinks.length > 0 ? "#52c41a" : "#d9d9d9" }} />
                    <span style={{ marginLeft: 6 }}>
                      证据材料 {evidenceLinks.length > 0 ? `(${evidenceLinks.length} 份)` : "(无)"}
                    </span>
                    <br />
                    <CheckCircleOutlined style={{ color: selectedCase.rules.length > 0 ? "#52c41a" : "#d9d9d9" }} />
                    <span style={{ marginLeft: 6 }}>
                      仲裁规则 {selectedCase.rules.length > 0 ? `(${selectedCase.rules.length} 条)` : "(无)"}
                    </span>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Copilot Panel ── */}
        <div className={styles.copilotPanel}>
          <div className={styles.copilotHeader}>
            <RobotOutlined style={{ fontSize: 18, color: "var(--ant-color-primary)" }} />
            <div>
              <div className={styles.copilotHeaderTitle}>AI 仲裁员助手</div>
              <div className={styles.copilotHeaderSub}>上下文感知 · 记忆连通</div>
            </div>
          </div>

          <div className={styles.copilotBody} ref={copilotBodyRef}>
            {copilotMessages.length === 0 && !copilotLoading ? (
              <div className={styles.copilotEmpty}>
                <BulbOutlined className={styles.copilotEmptyIcon} />
                <div className={styles.copilotEmptyText}>
                  AI 助手了解当前案件的全部上下文。<br />
                  问问「这个案件的主要争议点是什么？」<br />
                  或「证据3和答辩状有什么矛盾？」
                </div>
              </div>
            ) : (
              <>
                {/* Suggestion */}
                {copilotMessages.length === 0 && (
                  <div className={styles.copilotSuggestion}>
                    <div className={styles.copilotSuggestionTitle}>
                      <BulbOutlined /> 智能提示
                    </div>
                    {evidenceLinks.length > 1
                      ? "已关联多份证据，建议检查证据之间的矛盾点。"
                      : "建议先在材料中心关联案件证据，AI 可以更好地分析案件。"}
                  </div>
                )}
                {copilotMessages.map(msg => (
                  <div
                    key={msg.id}
                    className={`${styles.copilotMessage} ${msg.role === "user" ? styles.copilotMessageUser : styles.copilotMessageAI}`}
                  >
                    <div className={styles.copilotBubble}>{msg.content}</div>
                  </div>
                ))}
                {copilotLoading && (
                  <div className={`${styles.copilotMessage} ${styles.copilotMessageAI}`}>
                    <div className={styles.copilotBubble}>
                      <Spin size="small" /> AI 正在思考...
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={styles.copilotInput}>
            <Input.TextArea
              rows={2}
              placeholder="向 AI 仲裁员提问..."
              value={copilotInput}
              onChange={(e) => setCopilotInput(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleCopilotSend();
                }
              }}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={copilotLoading}
              onClick={handleCopilotSend}
              disabled={!copilotInput.trim()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
