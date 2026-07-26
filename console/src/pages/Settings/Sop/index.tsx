import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Table,
  Tag,
  Tooltip,
  message,
} from "@agentscope-ai/design";
import { Divider, Space, Spin } from "antd";
import { useTranslation } from "react-i18next";
import {
  ReloadOutlined,
  DeleteOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined,
  BranchesOutlined,
  ToolOutlined,
  SearchOutlined,
  MessageOutlined,
  SwapOutlined,
  StopOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  ApartmentOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { PageHeader } from "@/components/PageHeader";
import { ResizableTextArea } from "@/components/ResizableTextArea";
import sopApi, {
  type SkillCard,
  type SkillGraphNode,
  type SkillNodeType,
  type SkillStatus,
  type ReflectionResult,
} from "@/api/modules/sop";
import GraphEditor from "./GraphEditor";
import TracePanel from "./TracePanel";
import styles from "./index.module.less";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a SkillStatus to the antd Tag color used across the page. */
function statusColor(status: SkillStatus): string {
  switch (status) {
    case "active":
      return "green";
    case "draft":
      return "orange";
    case "archived":
    default:
      return "default";
  }
}

/** Map a SkillNodeType to an icon + color used in the node list. */
function nodeTypeVisual(type: SkillNodeType): {
  icon: ReactNode;
  color: string;
} {
  switch (type) {
    case "start":
      return { icon: <PlayCircleOutlined />, color: "#52c41a" };
    case "action":
      return { icon: <ThunderboltOutlined />, color: "#1677ff" };
    case "decision":
      return { icon: <BranchesOutlined />, color: "#722ed1" };
    case "tool_call":
      return { icon: <ToolOutlined />, color: "#fa8c16" };
    case "knowledge_query":
      return { icon: <SearchOutlined />, color: "#13c2c2" };
    case "reply":
      return { icon: <MessageOutlined />, color: "#2f54eb" };
    case "handoff":
      return { icon: <SwapOutlined />, color: "#eb2f96" };
    case "terminal":
      return { icon: <StopOutlined />, color: "#8c8c8c" };
    default:
      return { icon: <ApartmentOutlined />, color: "#8c8c8c" };
  }
}

/** Map a SkillNodeType to an antd Tag preset color name. */
function nodeTypeTagColor(type: SkillNodeType): string {
  switch (type) {
    case "start":
      return "green";
    case "action":
      return "blue";
    case "decision":
      return "purple";
    case "tool_call":
      return "orange";
    case "knowledge_query":
      return "cyan";
    case "reply":
      return "geekblue";
    case "handoff":
      return "magenta";
    case "terminal":
    default:
      return "default";
  }
}

/** Build a localized node-type label. */
function nodeTypeLabel(t: TFunction, type: SkillNodeType): string {
  const key = `sop.nodeType.${type}`;
  const fallback: Record<SkillNodeType, string> = {
    start: "开始",
    action: "动作",
    decision: "决策",
    tool_call: "工具调用",
    knowledge_query: "知识查询",
    reply: "回复",
    handoff: "移交",
    terminal: "终止",
  };
  return t(key, fallback[type]);
}

// ---------------------------------------------------------------------------
// Detail Drawer — shows a SkillCard's nodes/edges and a validate action.
// ---------------------------------------------------------------------------

interface DetailDrawerProps {
  open: boolean;
  skill: SkillCard | null;
  onClose: () => void;
  onValidated: () => void;
}

function DetailDrawer({ open, skill, onClose, onValidated }: DetailDrawerProps) {
  const { t } = useTranslation();
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{
    valid: boolean;
    issues: string[];
  } | null>(null);

  // Reset validation result whenever the drawer closes or switches skills.
  useEffect(() => {
    if (!open) {
      setValidation(null);
      setValidating(false);
    }
  }, [open, skill?.id]);

  const handleValidate = useCallback(async () => {
    if (!skill) return;
    setValidating(true);
    setValidation(null);
    try {
      const res = await sopApi.validateSkill(skill.id);
      setValidation(res);
      if (res.valid) {
        message.success(t("sop.validatePassed", "校验通过"));
      } else {
        message.warning(
          t("sop.validateFailed", "发现 {{count}} 个问题").replace(
            "{{count}}",
            String(res.issues.length),
          ),
        );
      }
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("sop.validateError", "校验失败"),
      );
    } finally {
      setValidating(false);
      onValidated();
    }
  }, [skill, t, onValidated]);

  if (!skill) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        width={560}
        title={t("sop.detailTitle", "技能详情")}
      >
        <Empty description={t("sop.noSkillSelected", "未选择技能")} />
      </Drawer>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={
        <Space>
          <ApartmentOutlined />
          {skill.name}
        </Space>
      }
    >
      {/* ── Basic info ── */}
      <div className={styles.detailSection}>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>
            {t("sop.fieldName", "名称")}
          </span>
          <span className={styles.detailValue}>{skill.name}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>
            {t("sop.fieldDescription", "描述")}
          </span>
          <span className={styles.detailValue}>
            {skill.description || "-"}
          </span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>
            {t("sop.fieldStatus", "状态")}
          </span>
          <span className={styles.detailValue}>
            <Tag color={statusColor(skill.status)}>{skill.status}</Tag>
          </span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>
            {t("sop.fieldVersion", "版本")}
          </span>
          <span className={styles.detailValue}>
            <code>{skill.version || "-"}</code>
          </span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>
            {t("sop.fieldKnowledgeScope", "知识范围")}
          </span>
          <span className={styles.detailValue}>
            {skill.knowledge_scope || "-"}
          </span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>
            {t("sop.fieldTags", "标签")}
          </span>
          <span className={styles.detailValue}>
            {skill.tags.length > 0 ? (
              <Space size={[4, 4]} wrap>
                {skill.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Space>
            ) : (
              "-"
            )}
          </span>
        </div>
      </div>

      <Divider style={{ margin: "16px 0" }} />

      {/* ── Validate ── */}
      <div className={styles.detailSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <ExperimentOutlined />
            {t("sop.validateSection", "图校验")}
          </span>
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            loading={validating}
            onClick={handleValidate}
          >
            {t("sop.validate", "校验")}
          </Button>
        </div>
        {validation && (
          <Alert
            type={validation.valid ? "success" : "warning"}
            showIcon
            style={{ marginTop: 12 }}
            message={
              validation.valid
                ? t("sop.validatePassed", "校验通过")
                : t("sop.validateIssuesTitle", "发现问题")
            }
            description={
              validation.issues.length > 0 ? (
                <ul className={styles.issueList}>
                  {validation.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              ) : undefined
            }
          />
        )}
      </div>

      <Divider style={{ margin: "16px 0" }} />

      {/* ── Nodes ── */}
      <div className={styles.detailSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <ApartmentOutlined />
            {t("sop.nodesSection", "节点")}
            <Tag style={{ marginInlineStart: 8 }}>
              {skill.nodes.length}
            </Tag>
          </span>
        </div>
        {skill.nodes.length === 0 ? (
          <Empty
            description={t("sop.noNodes", "暂无节点")}
          />
        ) : (
          <div className={styles.nodeList}>
            {skill.nodes.map((node) => (
              <NodeItem
                key={node.id}
                node={node}
                isStart={node.id === skill.start_node_id}
              />
            ))}
          </div>
        )}
      </div>

      <Divider style={{ margin: "16px 0" }} />

      {/* ── Edges ── */}
      <div className={styles.detailSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <BranchesOutlined />
            {t("sop.edgesSection", "连接")}
            <Tag style={{ marginInlineStart: 8 }}>
              {skill.edges.length}
            </Tag>
          </span>
        </div>
        {skill.edges.length === 0 ? (
          <Empty
            description={t("sop.noEdges", "暂无连接")}
          />
        ) : (
          <div className={styles.edgeList}>
            {skill.edges
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((edge, idx) => (
                <div key={idx} className={styles.edgeItem}>
                  <code className={styles.edgeNode}>{edge.from_node}</code>
                  <span className={styles.edgeArrow}>-&gt;</span>
                  <code className={styles.edgeNode}>{edge.to_node}</code>
                  {edge.condition && (
                    <Tag style={{ marginInlineStart: 8 }}>
                      {edge.condition}
                    </Tag>
                  )}
                  <span className={styles.edgePriority}>
                    P{edge.priority}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}

interface NodeItemProps {
  node: SkillGraphNode;
  isStart: boolean;
}

function NodeItem({ node, isStart }: NodeItemProps) {
  const { t } = useTranslation();
  const visual = nodeTypeVisual(node.type);
  return (
    <div className={styles.nodeItem}>
      <div
        className={styles.nodeIcon}
        style={{ color: visual.color, borderColor: visual.color }}
      >
        {visual.icon}
      </div>
      <div className={styles.nodeBody}>
        <div className={styles.nodeTitleRow}>
          <span className={styles.nodeTitle}>{node.title || node.id}</span>
          <Space size={4}>
            <Tag
              style={{ marginInlineEnd: 0 }}
              color={nodeTypeTagColor(node.type)}
            >
              {nodeTypeLabel(t, node.type)}
            </Tag>
            {isStart && (
              <Tag color="green" style={{ marginInlineEnd: 0 }}>
                {t("sop.startNode", "起点")}
              </Tag>
            )}
          </Space>
        </div>
        {node.description && (
          <div className={styles.nodeDesc}>{node.description}</div>
        )}
        {node.tool_name && (
          <div className={styles.nodeMeta}>
            <ToolOutlined />
            <code>{node.tool_name}</code>
          </div>
        )}
        {node.knowledge_scope && (
          <div className={styles.nodeMeta}>
            <SearchOutlined />
            <span>{node.knowledge_scope}</span>
          </div>
        )}
        {node.prompt_hint && (
          <div className={styles.nodeHint}>{node.prompt_hint}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distill Panel — distill a new SkillCard from document text.
// ---------------------------------------------------------------------------

interface DistillFormValues {
  skill_id: string;
  skill_name: string;
  persona_content?: string;
  knowledge_scope?: string;
  tags?: string;
  soul_md_ref?: string;
  agent_id?: string;
}

function DistillPanel({ onDistilled }: { onDistilled: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<DistillFormValues>();
  const [distilling, setDistilling] = useState(false);
  const [docContent, setDocContent] = useState("");

  const handleDistill = async () => {
    let values: DistillFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!docContent.trim()) {
      message.warning(t("sop.distillDocRequired", "请输入文档内容"));
      return;
    }
    setDistilling(true);
    try {
      const tags = values.tags
        ? values.tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      await sopApi.distill({
        doc_content: docContent,
        skill_id: values.skill_id,
        skill_name: values.skill_name,
        persona_content: values.persona_content || undefined,
        knowledge_scope: values.knowledge_scope || undefined,
        tags: tags.length > 0 ? tags : undefined,
        soul_md_ref: values.soul_md_ref || undefined,
        agent_id: values.agent_id || undefined,
      });
      message.success(
        t("sop.distillSuccess", "已从文档生成技能 {name}").replace(
          "{name}",
          values.skill_name,
        ),
      );
      form.resetFields();
      setDocContent("");
      onDistilled();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("sop.distillError", "生成失败"),
      );
    } finally {
      setDistilling(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <ExperimentOutlined />
          {t("sop.distillTitle", "从文档生成技能")}
        </Space>
      }
      className={styles.card}
    >
      <div className={styles.distillHint}>
        {t(
          "sop.distillHint",
          "将流程文档/SOP 文本粘贴到下方，填写技能标识与名称，系统会自动解析并生成对应的技能状态机。",
        )}
      </div>
      <Form form={form} layout="vertical" requiredMark>
        <div className={styles.distillDocLabel}>
          <span className={styles.distillDocRequired}>*</span>
          {t("sop.distillDocContent", "文档内容")}
        </div>
        <div className={styles.distillDocInput}>
          <ResizableTextArea
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
            defaultHeight={180}
            placeholder={t(
              "sop.distillDocPlaceholder",
              "在此粘贴 SOP / 流程文档的完整文本...",
            )}
          />
        </div>

        <div className={styles.distillFormRow}>
          <Form.Item
            name="skill_id"
            label={t("sop.distillSkillId", "技能标识")}
            rules={[
              {
                required: true,
                message: t("sop.skillIdRequired", "请输入技能标识"),
              },
            ]}
          >
            <Input
              placeholder={t("sop.distillSkillIdPlaceholder", "如：arb-review")}
            />
          </Form.Item>
          <Form.Item
            name="skill_name"
            label={t("sop.distillSkillName", "技能名称")}
            rules={[
              {
                required: true,
                message: t("sop.skillNameRequired", "请输入技能名称"),
              },
            ]}
          >
            <Input
              placeholder={t("sop.distillSkillNamePlaceholder", "如：裁决核阅流程")}
            />
          </Form.Item>
        </div>

        <div className={styles.distillFormRow}>
          <Form.Item
            name="knowledge_scope"
            label={t("sop.distillKnowledgeScope", "知识范围（可选）")}
          >
            <Input
              placeholder={t(
                "sop.distillKnowledgeScopePlaceholder",
                "如：仲裁规则",
              )}
            />
          </Form.Item>
          <Form.Item
            name="tags"
            label={t("sop.distillTags", "标签（可选，逗号分隔）")}
          >
            <Input placeholder={t("sop.distillTagsPlaceholder", "如：仲裁,流程")} />
          </Form.Item>
        </div>

        <Form.Item
          name="persona_content"
          label={t("sop.distillPersona", "角色设定（可选）")}
        >
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder={t(
              "sop.distillPersonaPlaceholder",
              "描述执行该技能时智能体的角色与风格...",
            )}
          />
        </Form.Item>

        <div className={styles.distillFooter}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={distilling}
            onClick={handleDistill}
          >
            {t("sop.distillGenerate", "生成技能")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard Panel — SOP skills sorted by calls / positive / negative.
// ---------------------------------------------------------------------------

type SortField = "calls" | "positive" | "negative";

function LeaderboardPanel({ skills }: { skills: SkillCard[] }) {
  const { t } = useTranslation();
  const [sortField, setSortField] = useState<SortField>("calls");

  const sorted = useMemo(() => {
    return [...skills].sort((a, b) => {
      const getVal = (s: SkillCard, f: SortField) => {
        if (f === "calls") return s.call_count ?? 0;
        if (f === "positive") return s.positive_feedback_count ?? 0;
        return s.negative_feedback_count ?? 0;
      };
      return getVal(b, sortField) - getVal(a, sortField);
    });
  }, [skills, sortField]);

  const sortOptions: Array<{ key: SortField; label: string }> = [
    { key: "calls", label: t("sop.sortCalls", "调用次数") },
    { key: "positive", label: t("sop.sortPositive", "正向反馈") },
    { key: "negative", label: t("sop.sortNegative", "负向反馈") },
  ];

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          {t("sop.leaderboard", "技能排行榜")}
        </Space>
      }
      className={styles.card}
    >
      <div className={styles.leaderboardTabs}>
        {sortOptions.map((opt) => (
          <button
            key={opt.key}
            className={`${styles.leaderboardTab} ${sortField === opt.key ? styles.leaderboardTabActive : ""}`}
            onClick={() => setSortField(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className={styles.leaderboardList}>
        {sorted.slice(0, 10).map((skill, idx) => {
          const calls = skill.call_count ?? 0;
          const positive = skill.positive_feedback_count ?? 0;
          const negative = skill.negative_feedback_count ?? 0;
          const score = calls > 0 ? ((positive - negative) / calls * 100).toFixed(0) : "--";
          return (
            <div key={skill.id} className={styles.leaderboardItem}>
              <span className={styles.leaderboardRank}>#{idx + 1}</span>
              <div className={styles.leaderboardInfo}>
                <span className={styles.leaderboardName}>{skill.name || skill.id}</span>
                <code className={styles.leaderboardId}>{skill.id}</code>
              </div>
              <div className={styles.leaderboardStats}>
                <span className={styles.leaderboardStat}>
                  {t("sop.calls", "调用")}: <strong>{calls}</strong>
                </span>
                <span className={styles.leaderboardStat} style={{ color: "var(--sd-online)" }}>
                  +{positive}
                </span>
                <span className={styles.leaderboardStat} style={{ color: "var(--sd-danger)" }}>
                  -{negative}
                </span>
                <span className={styles.leaderboardStat} style={{ color: "var(--sd-accent)" }}>
                  {score}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reflection Panel — 7-dimension RUBRIC scores.
// ---------------------------------------------------------------------------

function ReflectionPanel({ skillId }: { skillId: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<ReflectionResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleReflect = async () => {
    if (!skillId) return;
    setLoading(true);
    try {
      const res = await sopApi.reflect({ skill_id: skillId });
      setResult(res);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : t("sop.reflectError", "反思失败"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <ExperimentOutlined />
          {t("sop.reflectionTitle", "7 维反思")}
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<ExperimentOutlined />}
          loading={loading}
          onClick={handleReflect}
        >
          {t("sop.runReflection", "执行反思")}
        </Button>
      }
      className={styles.card}
    >
      {result ? (
        <div>
          {/* 7 维评分进度条 */}
          <div className={styles.rubricGrid}>
            {Object.entries(result.rubric_scores).map(([key, dim]) => (
              <div key={key} className={styles.rubricItem}>
                <div className={styles.rubricHeader}>
                  <span className={styles.rubricLabel}>{dim.label}</span>
                  <span
                    className={styles.rubricScore}
                    style={{
                      color: dim.score >= 0.6 ? "var(--sd-online)" : "var(--sd-danger)",
                    }}
                  >
                    {dim.score.toFixed(2)}
                  </span>
                </div>
                <div className={styles.rubricBar}>
                  <div
                    className={styles.rubricBarFill}
                    style={{
                      width: `${dim.score * 100}%`,
                      background: dim.score >= 0.6 ? "var(--sd-accent)" : "var(--sd-danger)",
                    }}
                  />
                </div>
                {dim.issues && dim.issues.length > 0 && (
                  <div className={styles.rubricIssues}>
                    {dim.issues.map((issue, i) => (
                      <div key={i} className={styles.rubricIssue}>• {issue}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 优势与短板 */}
          <div className={styles.reflectionSections}>
            {result.strengths.length > 0 && (
              <div className={styles.reflectionSection}>
                <div className={styles.reflectionSectionTitle} style={{ color: "var(--sd-online)" }}>
                  {t("sop.strengths", "优势")}
                </div>
                <ul className={styles.reflectionList}>
                  {result.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.weaknesses.length > 0 && (
              <div className={styles.reflectionSection}>
                <div className={styles.reflectionSectionTitle} style={{ color: "var(--sd-danger)" }}>
                  {t("sop.weaknesses", "短板")}
                </div>
                <ul className={styles.reflectionList}>
                  {result.weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.suggestions.length > 0 && (
              <div className={styles.reflectionSection}>
                <div className={styles.reflectionSectionTitle} style={{ color: "var(--sd-accent)" }}>
                  {t("sop.suggestions", "建议")}
                </div>
                <ul className={styles.reflectionList}>
                  {result.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {result.summary && (
            <div className={styles.reflectionSummary}>
              <strong>{t("sop.summary", "汇总")}：</strong>
              {result.summary}
            </div>
          )}
        </div>
      ) : (
        <Empty
          description={t("sop.noReflection", "点击「执行反思」生成 7 维评分")}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SopPage() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [graphEditorOpen, setGraphEditorOpen] = useState(false);
  const [tracePanelOpen, setTracePanelOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillCard | null>(null);
  const [ensuringBuiltin, setEnsuringBuiltin] = useState(false);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sopApi.listSkills();
      setSkills(Array.isArray(data.skills) ? data.skills : []);
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("sop.loadError", "加载技能列表失败"),
      );
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleView = useCallback(async (record: SkillCard) => {
    // Prefer the fresh detail from the backend so nodes/edges are complete.
    try {
      const detail = await sopApi.getSkill(record.id);
      setSelectedSkill(detail);
    } catch {
      // Fall back to the list-row snapshot if the detail call fails.
      setSelectedSkill(record);
    }
    setDrawerOpen(true);
  }, []);

  const handleEditGraph = useCallback(async (record: SkillCard) => {
    try {
      const detail = await sopApi.getSkill(record.id);
      setSelectedSkill(detail);
    } catch {
      setSelectedSkill(record);
    }
    setGraphEditorOpen(true);
  }, []);

  const handleTrace = useCallback(async (record: SkillCard) => {
    setSelectedSkill(record);
    setTracePanelOpen(true);
  }, []);

  const handleValidate = useCallback(
    async (record: SkillCard) => {
      try {
        const res = await sopApi.validateSkill(record.id);
        if (res.valid) {
          message.success(t("sop.validatePassed", "校验通过"));
        } else {
          Modal.info({
            title: t("sop.validateIssuesTitle", "发现问题"),
            width: 520,
            content: (
              <div style={{ paddingTop: 8 }}>
                <p style={{ marginBottom: 8 }}>
                  {t(
                    "sop.validateIssuesCount",
                    "共发现 {{count}} 个问题：",
                  ).replace("{{count}}", String(res.issues.length))}
                </p>
                <ul style={{ paddingLeft: 20, margin: 0 }}>
                  {res.issues.map((issue, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          });
        }
      } catch (err) {
        message.error(
          err instanceof Error
            ? err.message
            : t("sop.validateError", "校验失败"),
        );
      }
    },
    [t],
  );

  const handleDelete = useCallback(
    (record: SkillCard) => {
      const name = record.name || record.id;
      Modal.confirm({
        title: t("sop.deleteConfirm", "删除技能"),
        icon: <ExclamationCircleOutlined />,
        content: t(
          "sop.deleteConfirmText",
          "确定要删除技能 {name} 吗？此操作不可恢复。",
        ).replace("{name}", name),
        okText: t("sop.delete", "删除"),
        okButtonProps: { danger: true },
        cancelText: t("sop.cancel", "取消"),
        onOk: async () => {
          try {
            await sopApi.deleteSkill(record.id);
            message.success(
              t("sop.deleteSuccess", "已删除 {name}").replace(
                "{name}",
                name,
              ),
            );
            fetchSkills();
          } catch (err) {
            message.error(
              err instanceof Error
                ? err.message
                : t("sop.deleteError", "删除失败"),
            );
          }
        },
      });
    },
    [t, fetchSkills],
  );

  const handleEnsureBuiltin = useCallback(async () => {
    setEnsuringBuiltin(true);
    try {
      const res = await sopApi.ensureBuiltin();
      const created = res.created?.length ?? 0;
      const updated = res.updated?.length ?? 0;
      if (created === 0 && updated === 0) {
        message.info(t("sop.builtinUpToDate", "内置技能已是最新"));
      } else {
        message.success(
          t("sop.builtinSynced", "已同步内置技能（新增 {{created}}，更新 {{updated}}）")
            .replace("{{created}}", String(created))
            .replace("{{updated}}", String(updated)),
        );
      }
      fetchSkills();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("sop.builtinError", "同步内置技能失败"),
      );
    } finally {
      setEnsuringBuiltin(false);
    }
  }, [t, fetchSkills]);

  const columns = useMemo(
    () => [
      {
        title: t("sop.colName", "名称"),
        dataIndex: "name",
        key: "name",
        ellipsis: true,
        render: (v: string, record: SkillCard) => (
          <Space direction="vertical" size={0}>
            <span style={{ fontWeight: 600 }}>{v || record.id}</span>
            <code style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
              {record.id}
            </code>
          </Space>
        ),
      },
      {
        title: t("sop.colDescription", "描述"),
        dataIndex: "description",
        key: "description",
        ellipsis: true,
        render: (v: string) =>
          v || (
            <span style={{ color: "var(--ant-color-text-tertiary)" }}>-</span>
          ),
      },
      {
        title: t("sop.colStatus", "状态"),
        dataIndex: "status",
        key: "status",
        width: 100,
        render: (v: SkillStatus) => (
          <Tag color={statusColor(v)}>{v}</Tag>
        ),
      },
      {
        title: t("sop.colNodes", "节点数"),
        key: "nodes",
        width: 90,
        align: "center" as const,
        render: (_: unknown, record: SkillCard) => record.nodes?.length ?? 0,
      },
      {
        title: t("sop.colTags", "标签"),
        key: "tags",
        width: 200,
        render: (_: unknown, record: SkillCard) =>
          record.tags.length > 0 ? (
            <Space size={[4, 4]} wrap>
              {record.tags.slice(0, 4).map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
              {record.tags.length > 4 && (
                <Tag>+{record.tags.length - 4}</Tag>
              )}
            </Space>
          ) : (
            <span style={{ color: "var(--ant-color-text-tertiary)" }}>-</span>
          ),
      },
      {
        title: t("sop.colAction", "操作"),
        key: "action",
        width: 320,
        render: (_: unknown, record: SkillCard) => (
          <Space>
            <Button
              size="small"
              type="primary"
              ghost
              icon={<EyeOutlined />}
              onClick={() => handleView(record)}
            >
              {t("sop.view", "查看")}
            </Button>
            <Tooltip title="图编辑器">
              <Button
                size="small"
                icon={<BranchesOutlined />}
                onClick={() => handleEditGraph(record)}
              />
            </Tooltip>
            <Tooltip title="执行追踪">
              <Button
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => handleTrace(record)}
              />
            </Tooltip>
            <Tooltip title={t("sop.validate", "校验")}>
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                onClick={() => handleValidate(record)}
              />
            </Tooltip>
            <Tooltip title={t("sop.delete", "删除")}>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(record)}
              />
            </Tooltip>
          </Space>
        ),
      },
    ],
    [t, handleView, handleEditGraph, handleTrace, handleValidate, handleDelete],
  );

  return (
    <div className={styles.page}>
      <PageHeader
        current={t("sop.title", "流程引擎")}
        subRow={
          <div className={styles.intro}>
            {t(
              "sop.intro",
              "管理 SOP 技能状态机（SkillCard），支持从文档蒸馏生成、图校验与运行时调度。",
            )}
          </div>
        }
      />

      <Card
        title={
          <Space>
            <ApartmentOutlined />
            {t("sop.skillListTitle", "技能列表")}
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ExperimentOutlined />}
              loading={ensuringBuiltin}
              onClick={handleEnsureBuiltin}
            >
              {t("sop.ensureBuiltin", "同步内置技能")}
            </Button>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={fetchSkills}
            >
              {t("sop.refresh", "刷新")}
            </Button>
          </Space>
        }
        className={styles.card}
      >
        <Spin spinning={loading}>
          <Table
            dataSource={skills}
            columns={columns}
            rowKey="id"
            pagination={false}
            locale={{
              emptyText: t("sop.tableEmpty", "暂无技能，可从下方文档生成或同步内置技能"),
            }}
          />
        </Spin>
      </Card>

      <DistillPanel onDistilled={fetchSkills} />

      {/* ── 排行榜 ── */}
      <LeaderboardPanel skills={skills} />

      {/* ── 7 维反思 ── */}
      {selectedSkill && (
        <ReflectionPanel skillId={selectedSkill.id} />
      )}

      <DetailDrawer
        open={drawerOpen}
        skill={selectedSkill}
        onClose={() => setDrawerOpen(false)}
        onValidated={fetchSkills}
      />

      <GraphEditor
        open={graphEditorOpen}
        skill={selectedSkill}
        onClose={() => setGraphEditorOpen(false)}
        onSaved={fetchSkills}
      />

      <TracePanel
        open={tracePanelOpen}
        skill={selectedSkill}
        onClose={() => setTracePanelOpen(false)}
      />
    </div>
  );
}
