import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Space,
  Typography,
  Alert,
  Divider,
  Tag,
  Radio,
  RadioGroupProps,
  Input,
  InputNumber,
  Button,
  Switch,
  Table,
  Modal,
  Form,
  message,
  Tooltip,
  Spin,
  Badge,
} from "antd";
import {
  SettingOutlined,
  ScanOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  LockOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { knowledgeApi } from "@/api/modules/knowledge";

const { Text, Title } = Typography;
const { TextArea } = Input;

type SecurityLevel = "T1" | "T2" | "T3";
type ParseMode = "auto" | "local_only" | "cloud_ocr";
type DesensMode = "local" | "local_ai" | "ai";
type AiValidationMode = "skip" | "local" | "cloud";
type CodenameStrategy = "global" | "doc_level";

interface RuleRow {
  name: string;
  pattern: string;
  placeholder: string;
  group: number;
  enabled: boolean;
}

export default function EngineSettings() {
  const { t } = useTranslation();

  // ── Security Level ──
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>("T2");
  const [securityLoading, setSecurityLoading] = useState(false);

  // ── Parse Engine ──
  const [parseMode, setParseMode] = useState<ParseMode>("auto");
  const [parseConfig, setParseConfig] = useState<{
    mineru_api_key: string;
    mineru_base_url: string;
    mineru_mode: string;
    tesseract_langs: string;
    tesseract_available: boolean;
    tesseract_version: string;
    mineru_configured: boolean;
  } | null>(null);
  const [ocrStatus, setOcrStatus] = useState<{
    local_mineru?: { reachable: boolean; error?: string };
    tesseract?: { available: boolean; version?: string; langs?: string };
    cloud_token_valid?: boolean | null;
  } | null>(null);
  const [parseLoading, setParseLoading] = useState(false);

  // ── Desens Rules ──
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleRow | null>(null);
  const [ruleForm] = Form.useForm();
  const [aiGenOpen, setAiGenOpen] = useState(false);
  const [aiGenDesc, setAiGenDesc] = useState("");
  const [aiGenLoading, setAiGenLoading] = useState(false);

  // ── Desens Mode / AI Validation / Codename Strategy ──
  const [desensMode, setDesensMode] = useState<DesensMode>("local_ai");
  const [aiValidation, setAiValidation] = useState<AiValidationMode>("cloud");
  const [codenameStrategy, setCodenameStrategy] =
    useState<CodenameStrategy>("global");

  // ── AI Model Info ──
  const [aiModel, setAiModel] = useState<{
    has_model: boolean;
    display_name: string;
    hint?: string;
  } | null>(null);

  // ────────── Load data ──────────
  const loadAll = useCallback(async () => {
    setSecurityLoading(true);
    setParseLoading(true);
    setRulesLoading(true);
    try {
      const [pc, ocr, ruleRes, modelRes] = await Promise.all([
        knowledgeApi.getParserConfig(),
        knowledgeApi.getOcrStatus(),
        knowledgeApi.getDesensitizeRules(),
        knowledgeApi.getDesensitizeActiveModel(),
      ]);
      setParseConfig(pc);
      setOcrStatus(ocr);
      setParseMode((pc.default_mode as ParseMode) || "auto");
      setRules(
        ruleRes.rules.map((r) => ({ ...r, enabled: true })),
      );
      setAiModel({
        has_model: modelRes.has_model,
        display_name: modelRes.display_name,
        hint: modelRes.hint,
      });
    } catch (e) {
      console.error("Failed to load engine settings:", e);
    } finally {
      setSecurityLoading(false);
      setParseLoading(false);
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ────────── Handlers ──────────
  const handleSecurityChange = async (level: SecurityLevel) => {
    setSecurityLevel(level);
    message.success(t("documents.security.levelSaved"));
  };

  const handleParseModeChange = async (mode: ParseMode) => {
    setParseMode(mode);
    try {
      await knowledgeApi.updateParserConfig({ default_mode: mode });
      message.success(t("documents.security.levelSaved"));
    } catch (e) {
      console.error("Failed to update parse mode:", e);
    }
  };

  const handleSaveMineruConfig = async () => {
    if (!parseConfig) return;
    try {
      const res = await knowledgeApi.updateParserConfig({
        mineru_api_key: parseConfig.mineru_api_key,
        mineru_base_url: parseConfig.mineru_base_url,
        mineru_mode: parseConfig.mineru_mode,
        tesseract_langs: parseConfig.tesseract_langs,
      });
      setParseConfig(res);
      message.success(t("documents.security.levelSaved"));
    } catch (e) {
      console.error("Failed to save MinerU config:", e);
    }
  };

  const handleToggleRule = async (name: string, enabled: boolean) => {
    const updated = rules.map((r) =>
      r.name === name ? { ...r, enabled } : r,
    );
    setRules(updated);
    try {
      await knowledgeApi.updateDesensitizeRules(
        updated.map(({ enabled: _en, ...rest }) => rest),
      );
    } catch (e) {
      console.error("Failed to toggle rule:", e);
    }
  };

  const handleAddRule = () => {
    setEditingRule(null);
    ruleForm.resetFields();
    ruleForm.setFieldsValue({
      name: "",
      pattern: "",
      placeholder: "",
      group: 0,
    });
    setRuleModalOpen(true);
  };

  const handleEditRule = (rule: RuleRow) => {
    setEditingRule(rule);
    ruleForm.setFieldsValue(rule);
    setRuleModalOpen(true);
  };

  const handleSaveRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      let updated: RuleRow[];
      if (editingRule) {
        updated = rules.map((r) =>
          r.name === editingRule.name ? { ...r, ...values } : r,
        );
      } else {
        updated = [...rules, { ...values, enabled: true }];
      }
      setRules(updated);
      await knowledgeApi.updateDesensitizeRules(
        updated.map(({ enabled: _en, ...rest }) => rest),
      );
      setRuleModalOpen(false);
      message.success(t("documents.security.levelSaved"));
    } catch (e) {
      console.error("Failed to save rule:", e);
    }
  };

  const handleDeleteRule = async (name: string) => {
    const updated = rules.filter((r) => r.name !== name);
    setRules(updated);
    try {
      await knowledgeApi.updateDesensitizeRules(
        updated.map(({ enabled: _en, ...rest }) => rest),
      );
    } catch (e) {
      console.error("Failed to delete rule:", e);
    }
  };

  const handleResetRules = async () => {
    Modal.confirm({
      title: t("documents.rule.reset"),
      content: t("documents.rule.reset"),
      onOk: async () => {
        try {
          const res = await knowledgeApi.resetDesensitizeRules();
          setRules(res.rules.map((r) => ({ ...r, enabled: true })));
          message.success(t("documents.security.levelSaved"));
        } catch (e) {
          console.error("Failed to reset rules:", e);
        }
      },
    });
  };

  const handleAiGenRules = async () => {
    if (!aiGenDesc.trim()) return;
    setAiGenLoading(true);
    try {
      const res = await knowledgeApi.generateAIRules(aiGenDesc.trim());
      const newRules: RuleRow[] = res.rules.map((r) => ({
        ...r,
        enabled: true,
      }));
      const existing = new Set(rules.map((r) => r.name));
      const merged = [
        ...rules,
        ...newRules.filter((r) => !existing.has(r.name)),
      ];
      setRules(merged);
      await knowledgeApi.updateDesensitizeRules(
        merged.map(({ enabled: _en, ...rest }) => rest),
      );
      setAiGenOpen(false);
      setAiGenDesc("");
      message.success(
        t("documents.security.levelSaved") +
          ` (${res.rules.length} rules)`,
      );
    } catch (e) {
      console.error("AI rule generation failed:", e);
      message.error("AI rule generation failed");
    } finally {
      setAiGenLoading(false);
    }
  };

  // ────────── Render ──────────
  const securityOptions: RadioGroupProps["options"] = [
    {
      label: (
        <Space>
          <LockOutlined style={{ color: "#52c41a" }} />
          <span>
            🔒 T1 — {t("documents.security.t1")}
          </span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("documents.security.t1Desc")}
          </Text>
        </Space>
      ),
      value: "T1",
    },
    {
      label: (
        <Space>
          <SafetyOutlined style={{ color: "#1677ff" }} />
          <span>
            ⚖️ T2 — {t("documents.security.t2")}
          </span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("documents.security.t2Desc")}
          </Text>
        </Space>
      ),
      value: "T2",
    },
    {
      label: (
        <Space>
          <CloudServerOutlined style={{ color: "#faad14" }} />
          <span>
            ☁️ T3 — {t("documents.security.t3")}
          </span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("documents.security.t3Desc")}
          </Text>
        </Space>
      ),
      value: "T3",
    },
  ];

  const ruleColumns = [
    {
      title: t("documents.rule.enabled"),
      dataIndex: "enabled",
      width: 70,
      render: (_: boolean, record: RuleRow) => (
        <Switch
          size="small"
          checked={record.enabled}
          onChange={(v) => handleToggleRule(record.name, v)}
        />
      ),
    },
    {
      title: t("documents.rule.ruleName"),
      dataIndex: "name",
      ellipsis: true,
    },
    {
      title: t("documents.rule.pattern"),
      dataIndex: "pattern",
      ellipsis: true,
      render: (v: string) => (
        <Text code style={{ fontSize: 12 }}>
          {v.length > 50 ? v.substring(0, 50) + "..." : v}
        </Text>
      ),
    },
    {
      title: t("documents.rule.placeholder"),
      dataIndex: "placeholder",
      width: 140,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: t("documents.rule.actions"),
      width: 100,
      render: (_: unknown, record: RuleRow) => (
        <Space size="small">
          <Tooltip title={t("documents.rule.editRule")}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEditRule(record)}
            />
          </Tooltip>
          <Tooltip title={t("documents.rule.actions")}>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteRule(record.name)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Spin spinning={parseLoading && !parseConfig}>
      <div style={{ padding: "24px 0", maxWidth: 960, margin: "0 auto" }}>
        {/* ── Security Level ── */}
        <Card
          title={
            <Space>
              <LockOutlined />
              <span>{t("documents.security.defaultLevel")}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
          loading={securityLoading}
        >
          <Alert
            type="info"
            showIcon
            message={t(
              "documents.engineSettingsHint",
              "配置文档解析、脱敏和 AI 验证的引擎选项。不同引擎在精度、速度和隐私方面各有取舍。",
            )}
            style={{ marginBottom: 16 }}
          />
          <Radio.Group
            value={securityLevel}
            onChange={(e) => handleSecurityChange(e.target.value)}
            options={securityOptions}
            optionType="button"
            buttonStyle="solid"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          />
        </Card>

        {/* ── Parse Engine ── */}
        <Card
          title={
            <Space>
              <ScanOutlined />
              <span>{t("documents.parseEngine", "解析引擎")}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            {/* Parse Mode */}
            <div>
              <Text strong style={{ display: "block", marginBottom: 8 }}>
                {t("documents.parseMode.auto", "解析模式")}
              </Text>
              <Radio.Group
                value={parseMode}
                onChange={(e) => handleParseModeChange(e.target.value)}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="auto">
                  {t("documents.parseMode.auto")}
                </Radio.Button>
                <Radio.Button value="local_only">
                  {t("documents.parseMode.localOnly")}
                </Radio.Button>
                <Radio.Button value="cloud_ocr">
                  {t("documents.parseMode.cloudOcr")}
                </Radio.Button>
              </Radio.Group>
            </div>

            <Divider style={{ margin: "8px 0" }} />

            {/* Tesseract status */}
            <div>
              <Space>
                <DesktopOutlined />
                <Text strong>Tesseract OCR</Text>
                {ocrStatus?.tesseract?.available ? (
                  <Badge status="success" text={t("documents.security.t1")} />
                ) : (
                  <Badge status="error" text="未安装" />
                )}
                {ocrStatus?.tesseract?.version && (
                  <Tag>{ocrStatus.tesseract.version}</Tag>
                )}
              </Space>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t(
                  "documents.tesseractDesc",
                  "开源 OCR 引擎，无需网络，适合扫描件和图片文字识别。",
                )}
              </Text>
            </div>

            <Divider style={{ margin: "8px 0" }} />

            {/* MinerU Cloud */}
            <div>
              <Space>
                <CloudServerOutlined />
                <Text strong>MinerU Cloud API</Text>
                {parseConfig?.mineru_configured ? (
                  <Badge status="success" text="已配置" />
                ) : (
                  <Badge status="warning" text="未配置" />
                )}
                {ocrStatus?.cloud_token_valid === false && (
                  <Tag color="red">Token 无效</Tag>
                )}
              </Space>
              <div style={{ marginTop: 8 }}>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    placeholder="MinerU API Key"
                    value={parseConfig?.mineru_api_key || ""}
                    onChange={(e) =>
                      setParseConfig({
                        ...(parseConfig as NonNullable<typeof parseConfig>),
                        mineru_api_key: e.target.value,
                      })
                    }
                    style={{ width: "40%" }}
                  />
                  <Input
                    placeholder="Base URL (mineru.net)"
                    value={parseConfig?.mineru_base_url || ""}
                    onChange={(e) =>
                      setParseConfig({
                        ...(parseConfig as NonNullable<typeof parseConfig>),
                        mineru_base_url: e.target.value,
                      })
                    }
                    style={{ width: "40%" }}
                  />
                  <Button type="primary" onClick={handleSaveMineruConfig}>
                    {t("documents.security.levelSaved")}
                  </Button>
                </Space.Compact>
              </div>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
                {t(
                  "documents.mineruDesc",
                  "高精度云端 OCR + 版面分析，适合复杂排版的 PDF 文档。",
                )}
              </Text>
            </div>

            <Divider style={{ margin: "8px 0" }} />

            {/* MinerU Local */}
            <div>
              <Space>
                <DesktopOutlined />
                <Text strong>MinerU Local</Text>
                {ocrStatus?.local_mineru?.reachable ? (
                  <Badge status="success" text="运行中" />
                ) : (
                  <Badge status="default" text="未检测到" />
                )}
              </Space>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                本地部署的 MinerU，完全离线运行，需 GPU 或高性能 CPU。
              </Text>
            </div>

            <Divider style={{ margin: "8px 0" }} />

            {/* MarkItDown */}
            <div>
              <Space>
                <DesktopOutlined />
                <Text strong>MarkItDown</Text>
                <Tag color="green">本地</Tag>
                <Tag>兜底</Tag>
              </Space>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t(
                  "documents.markitdownDesc",
                  "微软开源文档解析工具，支持 Office 文档、HTML、CSV 等格式。",
                )}
              </Text>
            </div>
          </Space>
        </Card>

        {/* ── Desens Engine ── */}
        <Card
          title={
            <Space>
              <SafetyOutlined />
              <span>{t("documents.desensEngine", "脱敏引擎")}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            {/* Desens Mode */}
            <div>
              <Text strong style={{ display: "block", marginBottom: 8 }}>
                脱敏模式
              </Text>
              <Radio.Group
                value={desensMode}
                onChange={(e) => setDesensMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="local">
                  🔒 {t("documents.desensMode.local")}
                </Radio.Button>
                <Radio.Button value="local_ai">
                  ⚖️ {t("documents.desensMode.localAi")}
                </Radio.Button>
                <Radio.Button value="ai">
                  ☁️ {t("documents.desensMode.ai")}
                </Radio.Button>
              </Radio.Group>
              <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                {desensMode === "local" &&
                  t("documents.security.t1Desc")}
                {desensMode === "local_ai" &&
                  t("documents.security.t2Desc")}
                {desensMode === "ai" &&
                  "纯 AI 脱敏，精度最高但数据需上传云端"}
              </Text>
            </div>

            <Divider style={{ margin: "8px 0" }} />

            {/* AI Model Status */}
            {aiModel && (
              <div>
                <Space>
                  <CloudServerOutlined />
                  <Text strong>AI 模型</Text>
                  {aiModel.has_model ? (
                    <Tag color="green">{aiModel.display_name}</Tag>
                  ) : (
                    <Tag color="orange">未配置</Tag>
                  )}
                </Space>
                {aiModel.hint && (
                  <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                    {aiModel.hint}
                  </Text>
                )}
              </div>
            )}

            <Divider style={{ margin: "8px 0" }} />

            {/* Codename Strategy */}
            <div>
              <Text strong style={{ display: "block", marginBottom: 8 }}>
                {t("documents.entityRegistry.title", "代号策略")}
              </Text>
              <Radio.Group
                value={codenameStrategy}
                onChange={(e) => setCodenameStrategy(e.target.value)}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="global">
                  {t("documents.codenameStrategy.global")}
                </Radio.Button>
                <Radio.Button value="doc_level">
                  {t("documents.codenameStrategy.docLevel")}
                </Radio.Button>
              </Radio.Group>
              <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                {codenameStrategy === "global"
                  ? "所有文档共用同一套代号映射，确保跨文档一致性"
                  : "每个文档独立维护代号映射"}
              </Text>
            </div>
          </Space>
        </Card>

        {/* ── AI Validation ── */}
        <Card
          title={
            <Space>
              <CheckCircleOutlined />
              <span>{t("documents.aiValidation", "AI 验证")}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          <Radio.Group
            value={aiValidation}
            onChange={(e) => setAiValidation(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="skip">跳过</Radio.Button>
            <Radio.Button value="local">
              <DesktopOutlined /> {t("documents.localValidation")}
            </Radio.Button>
            <Radio.Button value="cloud">
              <CloudServerOutlined /> {t("documents.cloudValidation")}
            </Radio.Button>
          </Radio.Group>
          <Alert
            type="warning"
            showIcon
            icon={<InfoCircleOutlined />}
            message="AI 验证只处理已脱敏文本，不接触原始文档"
            style={{ marginTop: 12 }}
          />
        </Card>

        {/* ── Desens Rules Management ── */}
        <Card
          title={
            <Space>
              <SettingOutlined />
              <span>{t("documents.rule.title", "脱敏规则管理")}</span>
              <Tag>{rules.length} rules</Tag>
            </Space>
          }
          extra={
            <Space>
              <Button
                icon={<ThunderboltOutlined />}
                onClick={() => setAiGenOpen(true)}
              >
                {t("documents.rule.generateAI")}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleResetRules}
              >
                {t("documents.rule.reset")}
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAddRule}
              >
                {t("documents.rule.addRule")}
              </Button>
            </Space>
          }
        >
          <Spin spinning={rulesLoading}>
            <Table
              dataSource={rules}
              columns={ruleColumns}
              rowKey="name"
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 600 }}
            />
          </Spin>
        </Card>
      </div>

      {/* ── Rule Edit Modal ── */}
      <Modal
        title={
          editingRule
            ? t("documents.rule.editRule")
            : t("documents.rule.addRule")
        }
        open={ruleModalOpen}
        onOk={handleSaveRule}
        onCancel={() => setRuleModalOpen(false)}
        width={600}
      >
        <Form form={ruleForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("documents.rule.ruleName")}
            rules={[{ required: true }]}
          >
            <Input placeholder="e.g. 身份证号" />
          </Form.Item>
          <Form.Item
            name="pattern"
            label={t("documents.rule.pattern")}
            rules={[{ required: true }]}
          >
            <Input placeholder="e.g. \d{17}[\dXx]" />
          </Form.Item>
          <Form.Item
            name="placeholder"
            label={t("documents.rule.placeholder")}
            rules={[{ required: true }]}
          >
            <Input placeholder="e.g. [ID_CARD]" />
          </Form.Item>
          <Form.Item
            name="group"
            label={t("documents.rule.group")}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={9} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── AI Generate Rules Modal ── */}
      <Modal
        title={t("documents.rule.generateAI")}
        open={aiGenOpen}
        onOk={handleAiGenRules}
        onCancel={() => setAiGenOpen(false)}
        confirmLoading={aiGenLoading}
        width={500}
      >
        <Alert
          type="info"
          message={t("documents.rule.generateAIDesc")}
          style={{ marginBottom: 12 }}
        />
        <TextArea
          rows={4}
          value={aiGenDesc}
          onChange={(e) => setAiGenDesc(e.target.value)}
          placeholder="e.g. 识别中国仲裁案号格式，包含地域代码和年份..."
        />
      </Modal>
    </Spin>
  );
}
