import { useCallback, useEffect, useState } from "react";
import {
  Table,
  Switch,
  Modal,
  Form,
  Input,
  Select,
  Button,
  Tag,
  Space,
  Popconfirm,
  message,
  Statistic,
  Row,
  Col,
  Card,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  ImportOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { docProcessingApi } from "@/api/modules/docProcessing";
import type {
  RedactionRule,
  RedactionStrategy,
  RedactionTestResult,
} from "@/api/modules/docProcessing";

const STRATEGY_OPTIONS: { value: RedactionStrategy; labelKey: string }[] = [
  { value: "mask", labelKey: "docSdk.strategyMask" },
  { value: "hash", labelKey: "docSdk.strategyHash" },
  { value: "replace", labelKey: "docSdk.strategyReplace" },
  { value: "simulate", labelKey: "docSdk.strategySimulate" },
  { value: "delete", labelKey: "docSdk.strategyDelete" },
  { value: "partial_mask", labelKey: "docSdk.strategyPartialMask" },
];

const strategyColorMap: Record<RedactionStrategy, string> = {
  mask: "blue",
  hash: "purple",
  replace: "green",
  simulate: "cyan",
  delete: "red",
  partial_mask: "orange",
};

export default function DocSDKRedaction() {
  const { t } = useTranslation();

  const [rules, setRules] = useState<RedactionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [ruleModalVisible, setRuleModalVisible] = useState(false);
  const [testModalVisible, setTestModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<RedactionRule | null>(null);
  const [testTarget, setTestTarget] = useState<RedactionRule | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [testResult, setTestResult] = useState<RedactionTestResult | null>(null);
  const [testText, setTestText] = useState("");

  const [form] = Form.useForm();

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await docProcessingApi.listRedactionRules();
      // API returns { rules: [...], statistics: {...} } — unwrap the array
      setRules(Array.isArray(data) ? data : (data as any)?.rules ?? []);
    } catch (err) {
      message.error(t("docSdk.rulesFetchFailed"));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // ── Stats ──────────────────────────────────────────────────────────

  const enabledCount = rules.filter((r) => r.enabled).length;
  const disabledCount = rules.length - enabledCount;

  // ── Rule CRUD ──────────────────────────────────────────────────────

  const openCreateModal = useCallback(() => {
    setEditingRule(null);
    form.resetFields();
    form.setFieldsValue({
      strategy: "mask",
      replacement: "***",
    });
    setRuleModalVisible(true);
  }, [form]);

  const openEditModal = useCallback(
    (rule: RedactionRule) => {
      setEditingRule(rule);
      form.setFieldsValue({
        name: rule.name,
        pattern: rule.pattern,
        replacement: rule.replacement,
        strategy: rule.strategy,
        description: rule.description ?? "",
        tags: rule.tags?.join(", ") ?? "",
      });
      setRuleModalVisible(true);
    },
    [form],
  );

  const handleSubmitRule = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSubmitLoading(true);

      const payload = {
        name: values.name,
        pattern: values.pattern,
        replacement: values.replacement,
        strategy: values.strategy as RedactionStrategy,
        ...(values.description ? { description: values.description } : {}),
        ...(values.tags
          ? {
              tags: (values.tags as string)
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean),
            }
          : {}),
      };

      if (editingRule) {
        await docProcessingApi.updateRedactionRule(editingRule.id, payload);
        message.success(t("docSdk.ruleUpdateSuccess"));
      } else {
        await docProcessingApi.createRedactionRule(payload);
        message.success(t("docSdk.ruleCreateSuccess"));
      }

      setRuleModalVisible(false);
      fetchRules();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return; // form validation
      message.error(t("docSdk.ruleSaveFailed"));
      console.error(err);
    } finally {
      setSubmitLoading(false);
    }
  }, [form, editingRule, t, fetchRules]);

  const handleToggle = useCallback(
    async (ruleId: string, checked: boolean) => {
      try {
        await docProcessingApi.toggleRedactionRule(ruleId, checked);
        fetchRules();
      } catch (err) {
        message.error(t("docSdk.ruleToggleFailed"));
        console.error(err);
      }
    },
    [t, fetchRules],
  );

  const handleDelete = useCallback(
    async (ruleId: string) => {
      try {
        await docProcessingApi.deleteRedactionRule(ruleId);
        message.success(t("docSdk.ruleDeleteSuccess"));
        fetchRules();
      } catch (err) {
        message.error(t("docSdk.ruleDeleteFailed"));
        console.error(err);
      }
    },
    [t, fetchRules],
  );

  // ── Import presets ─────────────────────────────────────────────────

  const handleImportPresets = useCallback(async () => {
    setImportLoading(true);
    try {
      const result = await docProcessingApi.importRedactionPresets();
      message.success(
        t("docSdk.importPresetsSuccess", { count: result.imported }),
      );
      fetchRules();
    } catch (err) {
      message.error(t("docSdk.importPresetsFailed"));
      console.error(err);
    } finally {
      setImportLoading(false);
    }
  }, [t, fetchRules]);

  // ── Test ───────────────────────────────────────────────────────────

  const openTestModal = useCallback((rule: RedactionRule) => {
    setTestTarget(rule);
    setTestText("");
    setTestResult(null);
    setTestModalVisible(true);
  }, []);

  const handleTest = useCallback(async () => {
    if (!testTarget || !testText.trim()) return;
    setTestLoading(true);
    try {
      const result = await docProcessingApi.testRedactionPattern(
        testTarget.pattern,
        testTarget.replacement,
        testTarget.strategy,
        testText.trim(),
      );
      setTestResult(result);
    } catch (err) {
      message.error(t("docSdk.testRedactionFailed"));
      console.error(err);
    } finally {
      setTestLoading(false);
    }
  }, [testTarget, testText, t]);

  // ── Columns ────────────────────────────────────────────────────────

  const columns: ColumnsType<RedactionRule> = [
    {
      title: t("docSdk.ruleName"),
      dataIndex: "name",
      key: "name",
      width: 160,
      ellipsis: true,
    },
    {
      title: t("docSdk.rulePattern"),
      dataIndex: "pattern",
      key: "pattern",
      width: 200,
      ellipsis: true,
      render: (val: string) => (
        <code style={{ fontSize: 12, background: "#f5f5f5", padding: "2px 6px", borderRadius: 3 }}>
          {val}
        </code>
      ),
    },
    {
      title: t("docSdk.ruleStrategy"),
      dataIndex: "strategy",
      key: "strategy",
      width: 120,
      render: (val: RedactionStrategy) => (
        <Tag color={strategyColorMap[val]}>
          {t(`docSdk.strategy${val.charAt(0).toUpperCase() + val.slice(1)}`)}
        </Tag>
      ),
    },
    {
      title: t("docSdk.ruleReplacement"),
      dataIndex: "replacement",
      key: "replacement",
      width: 100,
      ellipsis: true,
    },
    {
      title: t("docSdk.ruleStatus"),
      dataIndex: "enabled",
      key: "enabled",
      width: 80,
      render: (val: boolean, record: RedactionRule) => (
        <Switch
          size="small"
          checked={val}
          onChange={(checked) => handleToggle(record.id, checked)}
        />
      ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 160,
      render: (_: unknown, record: RedactionRule) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            {t("common.edit")}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<ExperimentOutlined />}
            onClick={() => openTestModal(record)}
          >
            {t("docSdk.test")}
          </Button>
          <Popconfirm
            title={t("docSdk.confirmDeleteRule")}
            onConfirm={() => handleDelete(record.id)}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              {t("common.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {/* Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title={t("docSdk.statTotalRules")}
              value={rules.length}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title={t("docSdk.statEnabledRules")}
              value={enabledCount}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title={t("docSdk.statDisabledRules")}
              value={disabledCount}
              valueStyle={{ color: "#d9d9d9" }}
            />
          </Card>
        </Col>
      </Row>

      {/* Toolbar */}
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreateModal}
        >
          {t("docSdk.createRule")}
        </Button>
        <Button
          icon={<ImportOutlined />}
          loading={importLoading}
          onClick={handleImportPresets}
        >
          {t("docSdk.importPresets")}
        </Button>
      </div>

      {/* Table */}
      <Table
        dataSource={rules}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
      />

      {/* Create / Edit Modal */}
      <Modal
        title={
          editingRule
            ? t("docSdk.editRuleTitle")
            : t("docSdk.createRuleTitle")
        }
        open={ruleModalVisible}
        onOk={handleSubmitRule}
        onCancel={() => setRuleModalVisible(false)}
        confirmLoading={submitLoading}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label={t("docSdk.ruleName")}
            rules={[{ required: true, message: t("docSdk.ruleNameRequired") }]}
          >
            <Input placeholder={t("docSdk.ruleNamePlaceholder")} />
          </Form.Item>
          <Form.Item
            name="pattern"
            label={t("docSdk.rulePattern")}
            rules={[{ required: true, message: t("docSdk.rulePatternRequired") }]}
          >
            <Input placeholder={t("docSdk.rulePatternPlaceholder")} />
          </Form.Item>
          <Form.Item
            name="replacement"
            label={t("docSdk.ruleReplacement")}
            rules={[{ required: true, message: t("docSdk.ruleReplacementRequired") }]}
          >
            <Input placeholder={t("docSdk.ruleReplacementPlaceholder")} />
          </Form.Item>
          <Form.Item
            name="strategy"
            label={t("docSdk.ruleStrategy")}
            rules={[{ required: true }]}
          >
            <Select>
              {STRATEGY_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="description" label={t("docSdk.ruleDescription")}>
            <Input.TextArea rows={2} placeholder={t("docSdk.ruleDescriptionPlaceholder")} />
          </Form.Item>
          <Form.Item name="tags" label={t("docSdk.ruleTags")}>
            <Input placeholder={t("docSdk.ruleTagsPlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Test Modal */}
      <Modal
        title={t("docSdk.testRuleTitle", { name: testTarget?.name ?? "" })}
        open={testModalVisible}
        onCancel={() => setTestModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setTestModalVisible(false)}>
            {t("common.cancel")}
          </Button>,
          <Button
            key="test"
            type="primary"
            loading={testLoading}
            onClick={handleTest}
            icon={<ExperimentOutlined />}
          >
            {t("docSdk.runTest")}
          </Button>,
        ]}
        width={640}
        destroyOnHidden
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>
            {t("docSdk.testInputLabel")}
          </div>
          <Input.TextArea
            rows={3}
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder={t("docSdk.testInputPlaceholder")}
          />
        </div>

        {testResult && (
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>
              {t("docSdk.testResultLabel")}
            </div>
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue">
                {t("docSdk.testMatchCount", { count: testResult.matches })}
              </Tag>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>
                {t("docSdk.testOriginal")}:
              </div>
              <div
                style={{
                  background: "#fafafa",
                  padding: "8px 12px",
                  borderRadius: 4,
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {testResult.original_text}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>
                {t("docSdk.testRedacted")}:
              </div>
              <div
                style={{
                  background: "#f6ffed",
                  border: "1px solid #b7eb8f",
                  padding: "8px 12px",
                  borderRadius: 4,
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {testResult.redacted_text}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}