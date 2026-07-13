/**
 * Award (裁决书) — Independent award generation and review page.
 *
 * Completely decoupled from the Moot page. Users select a moot case,
 * then generate, edit, review, and export arbitration awards.
 *
 * Three tabs:
 * 1. 生成与编辑 — Generate award from case context, edit content
 * 2. 核阅报告  — Review award against rules, view issues
 * 3. 核阅规则  — Manage custom review rules
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Button,
  Input,
  Select,
  Space,
  Tag,
  Tabs,
  Spin,
  Alert,
  Empty,
  Tooltip,
  Form,
  Modal,
  Switch,
  Popconfirm,
  Table,
  Statistic,
  Row,
  Col,
  Card,
  message as antMessage,
  Segmented,
  Badge,
  Collapse,
  Divider,
} from "antd";
import {
  FileTextOutlined,
  ThunderboltOutlined,
  EditOutlined,
  CheckCircleOutlined,
  ExportOutlined,
  SettingOutlined,
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  CopyOutlined,
  EyeOutlined,
  CodeOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/PageHeader";
import {
  mootApi,
  CASE_STAGE_LABELS,
  type MootCaseListItem,
  type AwardDraft,
  type ReviewReport,
  type ReviewRule,
  type ReviewRuleCategory,
  type ReviewIssue,
  type ReviewIssueCategory,
  type ReviewIssueSeverity,
  type AwardTemplateType,
  type CreateReviewRuleParams,
  REVIEW_ISSUE_CATEGORY_LABELS,
  REVIEW_ISSUE_SEVERITY_LABELS,
  REVIEW_ISSUE_CATEGORY_COLORS,
  REVIEW_ISSUE_SEVERITY_COLORS,
} from "@/api/modules/moot";
import styles from "./index.module.less";

const { TextArea } = Input;

type TabKey = "generate" | "review" | "rules";

export default function AwardPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("generate");
  const [cases, setCases] = useState<MootCaseListItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Award state
  const [award, setAward] = useState<AwardDraft | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [institutionName, setInstitutionName] = useState("");
  const [templateType, setTemplateType] = useState<AwardTemplateType>("domestic");
  const [customInstructions, setCustomInstructions] = useState("");

  // Review state
  const [reviewReport, setReviewReport] = useState<ReviewReport | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // Rules state
  const [reviewRules, setReviewRules] = useState<ReviewRule[]>([]);
  const [ruleCategories, setRuleCategories] = useState<ReviewRuleCategory[]>([]);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ReviewRule | null>(null);
  const [ruleForm] = Form.useForm<CreateReviewRuleParams>();
  const [rulesLoading, setRulesLoading] = useState(false);

  // ── Load cases ──
  const loadCases = useCallback(async () => {
    try {
      const data = await mootApi.listCases();
      setCases(data);
    } catch {
      antMessage.error("加载案件列表失败");
    }
  }, []);

  // ── Load award for selected case ──
  const loadAward = useCallback(async (caseId: string) => {
    if (!caseId) {
      setAward(null);
      setEditedContent("");
      setReviewReport(null);
      return;
    }
    setLoading(true);
    try {
      const data = await mootApi.getAward(caseId);
      setAward(data);
      if (data) {
        setEditedContent(data.content);
        setInstitutionName(data.institution_name || "");
        setTemplateType(data.template_type);
      } else {
        setEditedContent("");
      }
      // Also load review report if exists
      const report = await mootApi.getReviewReport(caseId);
      setReviewReport(report);
    } catch {
      setAward(null);
      setEditedContent("");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load review rules ──
  const loadReviewRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const [rules, cats] = await Promise.all([
        mootApi.listReviewRules(),
        mootApi.listReviewRuleCategories(),
      ]);
      setReviewRules(rules);
      setRuleCategories(cats);
    } catch {
      antMessage.error("加载核阅规则失败");
    } finally {
      setRulesLoading(false);
    }
  }, []);

  // ── Initial load ──
  useEffect(() => {
    loadCases();
    loadReviewRules();
  }, [loadCases, loadReviewRules]);

  // ── When case changes, load award ──
  useEffect(() => {
    if (selectedCaseId) {
      loadAward(selectedCaseId);
    }
  }, [selectedCaseId, loadAward]);

  // ── Generate award ──
  const handleGenerate = async () => {
    if (!selectedCaseId) {
      antMessage.warning("请先选择案件");
      return;
    }
    setGenerating(true);
    try {
      const data = await mootApi.generateAward(selectedCaseId, {
        template_type: templateType,
        institution_name: institutionName || undefined,
        custom_instructions: customInstructions || undefined,
      });
      setAward(data);
      setEditedContent(data.content);
      setReviewReport(null);
      antMessage.success("裁决书生成成功");
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  // ── Save edited content ──
  const handleSaveContent = async () => {
    if (!selectedCaseId || !award) return;
    try {
      setLoading(true);
      const data = await mootApi.updateAward(selectedCaseId, editedContent);
      setAward(data);
      setIsEditing(false);
      antMessage.success("保存成功");
    } catch {
      antMessage.error("保存失败");
    } finally {
      setLoading(false);
    }
  };

  // ── Run review ──
  const handleReview = async () => {
    if (!selectedCaseId || !award) {
      antMessage.warning("请先生成裁决书");
      return;
    }
    setReviewing(true);
    try {
      const report = await mootApi.reviewAward(selectedCaseId, {});
      setReviewReport(report);
      setActiveTab("review");
      antMessage.success(`核阅完成，发现 ${report.total_issues} 个问题`);
    } catch (err: unknown) {
      const e = err as { message?: string };
      antMessage.error(e.message || "核阅失败");
    } finally {
      setReviewing(false);
    }
  };

  // ── Export ──
  const handleExport = async () => {
    if (!selectedCaseId || !award) return;
    try {
      const res = await mootApi.exportAward(selectedCaseId, "markdown");
      if (res.url) {
        const blob = new Blob([award.content], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename || "裁决书.md";
        a.click();
        URL.revokeObjectURL(url);
        antMessage.success("导出成功");
      }
    } catch {
      antMessage.error("导出失败");
    }
  };

  // ── Copy ──
  const handleCopy = () => {
    if (editedContent) {
      navigator.clipboard.writeText(editedContent);
      antMessage.success("已复制到剪贴板");
    }
  };

  // ── Rule CRUD ──
  const handleCreateRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      await mootApi.createReviewRule(values);
      await loadReviewRules();
      setRuleModalOpen(false);
      ruleForm.resetFields();
      antMessage.success("规则创建成功");
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return; // validation
      antMessage.error("创建失败");
    }
  };

  const handleUpdateRule = async (ruleId: string, params: Partial<CreateReviewRuleParams>) => {
    try {
      await mootApi.updateReviewRule(ruleId, params);
      await loadReviewRules();
    } catch {
      antMessage.error("更新失败");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await mootApi.deleteReviewRule(ruleId);
      await loadReviewRules();
      antMessage.success("已删除");
    } catch {
      antMessage.error("删除失败");
    }
  };

  const handleEditRule = (rule: ReviewRule) => {
    setEditingRule(rule);
    ruleForm.setFieldsValue(rule);
    setRuleModalOpen(true);
  };

  const handleAddRule = () => {
    setEditingRule(null);
    ruleForm.resetFields();
    ruleForm.setFieldsValue({
      category: "format",
      severity: "must_fix",
      is_active: true,
      applicable_template_types: ["domestic", "international"],
    });
    setRuleModalOpen(true);
  };

  const handleSaveRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      if (editingRule) {
        await mootApi.updateReviewRule(editingRule.rule_id, values);
        antMessage.success("规则更新成功");
      } else {
        await mootApi.createReviewRule(values);
        antMessage.success("规则创建成功");
      }
      await loadReviewRules();
      setRuleModalOpen(false);
      ruleForm.resetFields();
      setEditingRule(null);
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      antMessage.error("保存失败");
    }
  };

  const selectedCase = useMemo(
    () => cases.find((c) => c.case_id === selectedCaseId),
    [cases, selectedCaseId],
  );

  // ── Tab items ──
  const tabItems = [
    {
      key: "generate" as TabKey,
      label: (
        <span>
          <FileTextOutlined /> 生成与编辑
        </span>
      ),
      children: (
        <GenerateTab
          cases={cases}
          selectedCaseId={selectedCaseId}
          onSelectCase={setSelectedCaseId}
          selectedCase={selectedCase}
          award={award}
          editedContent={editedContent}
          isEditing={isEditing}
          generating={generating}
          loading={loading}
          institutionName={institutionName}
          templateType={templateType}
          customInstructions={customInstructions}
          onInstitutionChange={setInstitutionName}
          onTemplateChange={setTemplateType}
          onInstructionsChange={setCustomInstructions}
          onGenerate={handleGenerate}
          onSave={handleSaveContent}
          onEdit={() => setIsEditing(true)}
          onCancelEdit={() => {
            setIsEditing(false);
            setEditedContent(award?.content || "");
          }}
          onContentChange={setEditedContent}
          onCopy={handleCopy}
          onExport={handleExport}
          onReview={handleReview}
          reviewing={reviewing}
        />
      ),
    },
    {
      key: "review" as TabKey,
      label: (
        <Badge count={reviewReport?.total_issues || 0} size="small" offset={[6, 0]}>
          <span>
            <SafetyCertificateOutlined /> 核阅报告
          </span>
        </Badge>
      ),
      children: (
        <ReviewTab
          report={reviewReport}
          loading={reviewing}
          onReview={handleReview}
          hasAward={!!award}
        />
      ),
    },
    {
      key: "rules" as TabKey,
      label: (
        <span>
          <SettingOutlined /> 核阅规则
        </span>
      ),
      children: (
        <RulesTab
          rules={reviewRules}
          categories={ruleCategories}
          loading={rulesLoading}
          onAdd={handleAddRule}
          onEdit={handleEditRule}
          onDelete={handleDeleteRule}
          onToggle={(ruleId, active) => handleUpdateRule(ruleId, { is_active: active })}
        />
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        current="裁决书"
        subRow={
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
            裁决书生成 · 智能核阅 · 规则管理
          </span>
        }
      />
      <div className={styles.body}>
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
          items={tabItems}
          size="large"
          className={styles.tabs}
          tabBarStyle={{ paddingLeft: 20, marginBottom: 0 }}
        />
      </div>

      {/* Rule Modal */}
      <Modal
        title={editingRule ? "编辑核阅规则" : "新建核阅规则"}
        open={ruleModalOpen}
        onOk={handleSaveRule}
        onCancel={() => {
          setRuleModalOpen(false);
          setEditingRule(null);
          ruleForm.resetFields();
        }}
        width={640}
        destroyOnHidden
      >
        <Form form={ruleForm} layout="vertical">
          <Form.Item
            name="name"
            label="规则名称"
            rules={[{ required: true, message: "请输入规则名称" }]}
          >
            <Input placeholder="如：标题格式规范" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="category"
                label="规则类别"
                rules={[{ required: true, message: "请选择类别" }]}
              >
                <Select
                  options={Object.entries(REVIEW_ISSUE_CATEGORY_LABELS).map(([v, l]) => ({
                    value: v as ReviewIssueCategory,
                    label: l,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sub_category" label="子类别">
                <Input placeholder="如：标题格式" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="severity"
            label="严重程度"
            rules={[{ required: true, message: "请选择严重程度" }]}
          >
            <Select
              options={Object.entries(REVIEW_ISSUE_SEVERITY_LABELS).map(([v, l]) => ({
                value: v as ReviewIssueSeverity,
                label: l,
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label="规则描述">
            <TextArea rows={2} placeholder="描述规则要检查的问题..." />
          </Form.Item>
          <Form.Item name="detection_logic" label="检测逻辑">
            <TextArea rows={2} placeholder="描述检测方法..." />
          </Form.Item>
          <Form.Item name="suggestion_template" label="建议模板">
            <Input placeholder="如：将「{wrong_text}」改为「{correct_text}」" />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ── Generate Tab ────────────────────────────────────────────────────────────

function GenerateTab(props: {
  cases: MootCaseListItem[];
  selectedCaseId: string;
  onSelectCase: (id: string) => void;
  selectedCase?: MootCaseListItem;
  award: AwardDraft | null;
  editedContent: string;
  isEditing: boolean;
  generating: boolean;
  loading: boolean;
  institutionName: string;
  templateType: AwardTemplateType;
  customInstructions: string;
  onInstitutionChange: (v: string) => void;
  onTemplateChange: (v: AwardTemplateType) => void;
  onInstructionsChange: (v: string) => void;
  onGenerate: () => void;
  onSave: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onContentChange: (v: string) => void;
  onCopy: () => void;
  onExport: () => void;
  onReview: () => void;
  reviewing: boolean;
}) {
  if (!props.selectedCaseId) {
    return (
      <div className={styles.tabBody}>
        <Empty description="请选择一个仲裁案件开始" style={{ marginTop: "15vh" }}>
          <Select
            placeholder="选择仲裁案件"
            style={{ width: 360 }}
            showSearch
            optionFilterProp="label"
            options={props.cases.map((c) => ({
              value: c.case_id,
              label: `${c.case_name} (${c.current_stage_label})`,
            }))}
            onChange={props.onSelectCase}
          />
        </Empty>
      </div>
    );
  }

  return (
    <div className={styles.tabBody}>
      {/* Case selector + generation params */}
      <div className={styles.genConfig}>
        <div className={styles.genConfigRow}>
          <Select
            value={props.selectedCaseId}
            onChange={props.onSelectCase}
            style={{ minWidth: 280 }}
            showSearch
            optionFilterProp="label"
            options={props.cases.map((c) => ({
              value: c.case_id,
              label: `${c.case_name} (${c.current_stage_label})`,
            }))}
          />
          <Select
            value={props.templateType}
            onChange={(v) => props.onTemplateChange(v as AwardTemplateType)}
            style={{ width: 140 }}
            options={[
              { value: "domestic", label: "国内仲裁" },
              { value: "international", label: "国际仲裁" },
            ]}
          />
          <Input
            value={props.institutionName}
            onChange={(e) => props.onInstitutionChange(e.target.value)}
            placeholder="仲裁机构名称（如：北京仲裁委员会）"
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
        <div className={styles.genConfigRow}>
          <TextArea
            value={props.customInstructions}
            onChange={(e) => props.onInstructionsChange(e.target.value)}
            placeholder="补充生成指令（可选）：如重点关注违约金计算、引用特定法条等..."
            rows={2}
            style={{ flex: 1 }}
          />
        </div>
        <Space>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={props.onGenerate}
            loading={props.generating}
          >
            {props.award ? "重新生成" : "生成裁决书"}
          </Button>
          {props.award && (
            <>
              <Button
                icon={<SafetyCertificateOutlined />}
                onClick={props.onReview}
                loading={props.reviewing}
              >
                核阅
              </Button>
              <Button icon={<ExportOutlined />} onClick={props.onExport}>
                导出
              </Button>
            </>
          )}
        </Space>
      </div>

      <Divider />

      {/* Award content */}
      {props.loading ? (
        <Spin style={{ display: "block", margin: "10vh auto" }} />
      ) : !props.award ? (
        <Empty
          description="尚未生成裁决书，点击上方按钮生成"
          style={{ marginTop: "10vh" }}
        />
      ) : (
        <div className={styles.awardContent}>
          {/* Toolbar */}
          <div className={styles.awardToolbar}>
            <Space>
              <Tag color="blue">{props.award.template_type === "domestic" ? "国内仲裁" : "国际仲裁"}</Tag>
              {props.award.institution_name && (
                <Tag>{props.award.institution_name}</Tag>
              )}
              <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                版本 v{props.award.version} · {new Date(props.award.updated_at * 1000).toLocaleString("zh-CN")}
              </span>
            </Space>
            <Space>
              <Tooltip title="复制">
                <Button size="small" icon={<CopyOutlined />} onClick={props.onCopy} />
              </Tooltip>
              {props.isEditing ? (
                <>
                  <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={props.onSave} loading={props.loading}>
                    保存
                  </Button>
                  <Button size="small" onClick={props.onCancelEdit}>取消</Button>
                </>
              ) : (
                <Button size="small" icon={<EditOutlined />} onClick={props.onEdit}>
                  编辑
                </Button>
              )}
            </Space>
          </div>

          {/* Content */}
          {props.isEditing ? (
            <TextArea
              value={props.editedContent}
              onChange={(e) => props.onContentChange(e.target.value)}
              className={styles.awardEditor}
              autoSize={{ minRows: 20 }}
            />
          ) : (
            <div className={styles.awardPreview}>
              <ReactMarkdown remarkGfm>
                {props.editedContent || props.award.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Review Tab ──────────────────────────────────────────────────────────────

function ReviewTab(props: {
  report: ReviewReport | null;
  loading: boolean;
  onReview: () => void;
  hasAward: boolean;
}) {
  if (!props.hasAward) {
    return (
      <div className={styles.tabBody}>
        <Empty description="请先生成裁决书再进行核阅" style={{ marginTop: "15vh" }} />
      </div>
    );
  }

  if (!props.report) {
    return (
      <div className={styles.tabBody}>
        <Empty description="尚未生成核阅报告" style={{ marginTop: "15vh" }}>
          <Button
            type="primary"
            icon={<SafetyCertificateOutlined />}
            onClick={props.onReview}
            loading={props.loading}
          >
            开始核阅
          </Button>
        </Empty>
      </div>
    );
  }

  const { report } = props;
  const mustFixIssues = report.issues.filter((i) => i.severity === "must_fix");
  const suggestFixIssues = report.issues.filter((i) => i.severity === "suggest_fix");

  return (
    <div className={styles.tabBody}>
      {/* Summary stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="总问题数" value={report.total_issues} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="必须修改"
              value={report.must_fix_count}
              valueStyle={{ color: REVIEW_ISSUE_SEVERITY_COLORS.must_fix }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="建议修改"
              value={report.suggest_fix_count}
              valueStyle={{ color: REVIEW_ISSUE_SEVERITY_COLORS.suggest_fix }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <div style={{ marginBottom: 4, fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
              按类别分布
            </div>
            <Space size={4} wrap>
              {Object.entries(report.issues_by_category).map(([cat, count]) => (
                <Tag
                  key={cat}
                  style={{
                    fontSize: 11,
                    color: REVIEW_ISSUE_CATEGORY_COLORS[cat as ReviewIssueCategory],
                    borderColor: REVIEW_ISSUE_CATEGORY_COLORS[cat as ReviewIssueCategory],
                  }}
                >
                  {REVIEW_ISSUE_CATEGORY_LABELS[cat as ReviewIssueCategory]}: {count}
                </Tag>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={props.onReview}
          loading={props.loading}
        >
          重新核阅
        </Button>
      </Space>

      {/* Issues list */}
      {report.issues.length === 0 ? (
        <Alert
          type="success"
          showIcon
          message="核阅通过，未发现任何问题！"
          description="裁决书符合所有核阅规则的要求。"
        />
      ) : (
        <div className={styles.issuesList}>
          {mustFixIssues.length > 0 && (
            <>
              <div className={styles.issueGroupTitle}>
                <WarningOutlined style={{ color: REVIEW_ISSUE_SEVERITY_COLORS.must_fix }} />
                必须修改 ({mustFixIssues.length})
              </div>
              {mustFixIssues.map((issue) => (
                <IssueCard key={issue.issue_id} issue={issue} />
              ))}
            </>
          )}
          {suggestFixIssues.length > 0 && (
            <>
              <div className={styles.issueGroupTitle} style={{ marginTop: 16 }}>
                <EditOutlined style={{ color: REVIEW_ISSUE_SEVERITY_COLORS.suggest_fix }} />
                建议修改 ({suggestFixIssues.length})
              </div>
              {suggestFixIssues.map((issue) => (
                <IssueCard key={issue.issue_id} issue={issue} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function IssueCard({ issue }: { issue: ReviewIssue }) {
  const catColor = REVIEW_ISSUE_CATEGORY_COLORS[issue.category];
  const sevColor = REVIEW_ISSUE_SEVERITY_COLORS[issue.severity];

  return (
    <Card
      size="small"
      className={styles.issueCard}
      style={{ borderLeft: `3px solid ${sevColor}` }}
    >
      <div className={styles.issueHeader}>
        <Space>
          <Tag style={{ color: catColor, borderColor: catColor, fontSize: 11 }}>
            {REVIEW_ISSUE_CATEGORY_LABELS[issue.category]}
          </Tag>
          <Tag style={{ color: sevColor, borderColor: sevColor, fontSize: 11 }}>
            {REVIEW_ISSUE_SEVERITY_LABELS[issue.severity]}
          </Tag>
          <span className={styles.issueRuleName}>{issue.rule_name}</span>
        </Space>
        <span className={styles.issueSection}>{issue.section_title}</span>
      </div>
      <div className={styles.issueBody}>
        <div className={styles.issueField}>
          <strong>问题：</strong> {issue.problem_description}
        </div>
        {issue.position_description && (
          <div className={styles.issueField}>
            <strong>位置：</strong> {issue.position_description}
          </div>
        )}
        <div className={styles.issueField}>
          <strong>建议：</strong> {issue.suggestion}
        </div>
        {issue.original_text && (
          <div className={styles.issueField}>
            <strong>原文：</strong>
            <code className={styles.issueCode}>{issue.original_text}</code>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Rules Tab ───────────────────────────────────────────────────────────────

function RulesTab(props: {
  rules: ReviewRule[];
  categories: ReviewRuleCategory[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (rule: ReviewRule) => void;
  onDelete: (ruleId: string) => void;
  onToggle: (ruleId: string, active: boolean) => void;
}) {
  const columns = [
    {
      title: "规则名称",
      dataIndex: "name",
      width: 180,
      render: (v: string, record: ReviewRule) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 500 }}>{v}</span>
          {record.sub_category && (
            <span style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>
              {record.sub_category}
            </span>
          )}
        </Space>
      ),
    },
    {
      title: "类别",
      dataIndex: "category",
      width: 100,
      render: (v: ReviewIssueCategory) => (
        <Tag style={{ color: REVIEW_ISSUE_CATEGORY_COLORS[v], borderColor: REVIEW_ISSUE_CATEGORY_COLORS[v] }}>
          {REVIEW_ISSUE_CATEGORY_LABELS[v]}
        </Tag>
      ),
    },
    {
      title: "严重程度",
      dataIndex: "severity",
      width: 100,
      render: (v: ReviewIssueSeverity) => (
        <Tag style={{ color: REVIEW_ISSUE_SEVERITY_COLORS[v], borderColor: REVIEW_ISSUE_SEVERITY_COLORS[v] }}>
          {REVIEW_ISSUE_SEVERITY_LABELS[v]}
        </Tag>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      ellipsis: true,
    },
    {
      title: "类型",
      dataIndex: "is_builtin",
      width: 80,
      render: (v: boolean) => (v ? <Tag>内置</Tag> : <Tag color="cyan">自定义</Tag>),
    },
    {
      title: "启用",
      dataIndex: "is_active",
      width: 70,
      render: (v: boolean, record: ReviewRule) => (
        <Switch
          size="small"
          checked={v}
          onChange={(checked) => props.onToggle(record.rule_id, checked)}
        />
      ),
    },
    {
      title: "操作",
      width: 100,
      render: (_: unknown, record: ReviewRule) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => props.onEdit(record)}
          />
          {!record.is_builtin && (
            <Popconfirm
              title="确定删除此规则？"
              onConfirm={() => props.onDelete(record.rule_id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.tabBody}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Space>
          {props.categories.map((c) => (
            <Tag key={c.category} style={{ fontSize: 12 }}>
              {c.label}: 内置 {c.builtin_count} / 自定义 {c.custom_count}
            </Tag>
          ))}
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={props.onAdd}>
          新建规则
        </Button>
      </div>
      <Table
        dataSource={props.rules}
        columns={columns}
        rowKey="rule_id"
        size="small"
        loading={props.loading}
        pagination={{ pageSize: 20 }}
      />
    </div>
  );
}