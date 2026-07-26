import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Collapse,
  Switch,
  Table,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  Popconfirm,
  message,
  InputNumber,
  Radio,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { PageHeader } from "../../../components/PageHeader";
import styles from "./index.module.less";

const API_BASE = "/api/text-selection";

interface QuickTool {
  id: string;
  name: string;
  nameEn: string;
  prompt: string;
  icon: string;
  order: number;
}

interface TSConfig {
  enabled: boolean;
  hotkey: string;
  globalEnabled: boolean;
  appFilterMode: "blacklist" | "whitelist";
  appFilterList: string[];
  quickTools: QuickTool[];
}

interface TSStatus {
  ok: boolean;
  service: string;
  enabled: boolean;
  ready: boolean;
  starting: boolean;
  running: boolean;
  pid: number | null;
}

const ICON_OPTIONS = [
  { label: "Translate", value: "translate" },
  { label: "Explain", value: "explain" },
  { label: "Summarize", value: "summarize" },
  { label: "Search", value: "search" },
  { label: "Code", value: "code" },
  { label: "Edit", value: "edit" },
  { label: "Question", value: "question" },
  { label: "Star", value: "star" },
  { label: "Book", value: "book" },
  { label: "Lightbulb", value: "lightbulb" },
];

const HOTKEY_OPTIONS = [
  { label: "Ctrl + Alt + Space", value: "ctrl+alt+space" },
  { label: "Ctrl + Shift + Space", value: "ctrl+shift+space" },
  { label: "Alt + T", value: "alt+t" },
  { label: "Alt + X", value: "alt+x" },
  { label: "Ctrl + Alt + A", value: "ctrl+alt+a" },
  { label: "Ctrl + Alt + S", value: "ctrl+alt+s" },
];

export default function TextSelectionPage() {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [toolForm] = Form.useForm();
  const [status, setStatus] = useState<TSStatus | null>(null);
  const [config, setConfig] = useState<TSConfig>({
    enabled: true,
    hotkey: "ctrl+alt+space",
    globalEnabled: true,
    appFilterMode: "blacklist",
    appFilterList: [],
    quickTools: [],
  });
  const [statusLoading, setStatusLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toolModalOpen, setToolModalOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<QuickTool | null>(null);
  const [toolSaving, setToolSaving] = useState(false);

  // ------------------------------------------------------------------
  // Fetch
  // ------------------------------------------------------------------

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      const data = await res.json();
      setStatus(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      const data = await res.json();
      setConfig(data);
      form.setFieldsValue({
        enabled: data.enabled,
        hotkey: data.hotkey,
        globalEnabled: data.globalEnabled,
        appFilterMode: data.appFilterMode,
        appFilterList: data.appFilterList?.join("\n") || "",
      });
    } catch {
      // ignore
    }
  }, [form]);

  useEffect(() => {
    fetchStatus();
    fetchConfig();
  }, [fetchStatus, fetchConfig]);

  // Poll status every 3s
  useEffect(() => {
    const timer = setInterval(fetchStatus, 3000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  // ------------------------------------------------------------------
  // Desktop Control
  // ------------------------------------------------------------------

  const handleStartDesktop = async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(`${API_BASE}/desktop/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        message.success(t("textSelection.desktopStarting"));
      }
    } catch {
      message.error(t("textSelection.desktopStartFailed"));
    } finally {
      setStatusLoading(false);
      setTimeout(fetchStatus, 1500);
    }
  };

  const handleStopDesktop = async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(`${API_BASE}/desktop/stop`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        message.success(t("textSelection.desktopStopping"));
      }
    } catch {
      message.error(t("textSelection.desktopStopFailed"));
    } finally {
      setStatusLoading(false);
      setTimeout(fetchStatus, 1500);
    }
  };

  // ------------------------------------------------------------------
  // Save Config
  // ------------------------------------------------------------------

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      const body = {
        ...values,
        appFilterList: values.appFilterList
          ? values.appFilterList
              .split("\n")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [],
      };
      const res = await fetch(`${API_BASE}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        message.success(t("common.saveSuccess"));
        fetchConfig();
      } else {
        message.error(t("common.saveFailed"));
      }
    } catch {
      message.error(t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------------
  // Quick Tools
  // ------------------------------------------------------------------

  const handleAddTool = () => {
    setEditingTool(null);
    toolForm.resetFields();
    setToolModalOpen(true);
  };

  const handleEditTool = (tool: QuickTool) => {
    setEditingTool(tool);
    toolForm.setFieldsValue(tool);
    setToolModalOpen(true);
  };

  const handleDeleteTool = async (toolId: string) => {
    try {
      const res = await fetch(`${API_BASE}/quick-tools/${toolId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        message.success(t("textSelection.toolDeleted"));
        fetchConfig();
      } else {
        message.error(t("textSelection.toolDeleteFailed"));
      }
    } catch {
      message.error(t("textSelection.toolDeleteFailed"));
    }
  };

  const handleSaveTool = async () => {
    setToolSaving(true);
    try {
      const values = await toolForm.validateFields();
      const method = editingTool ? "PUT" : "POST";
      const url = editingTool
        ? `${API_BASE}/quick-tools/${editingTool.id}`
        : `${API_BASE}/quick-tools`;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (res.ok) {
        message.success(
          editingTool
            ? t("textSelection.toolUpdated")
            : t("textSelection.toolCreated"),
        );
        setToolModalOpen(false);
        fetchConfig();
      } else {
        message.error(t("common.saveFailed"));
      }
    } catch {
      // form validation error
    } finally {
      setToolSaving(false);
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const isRunning = status?.running;
  const isStarting = status?.starting;

  const toolColumns = [
    {
      title: t("textSelection.order"),
      dataIndex: "order",
      key: "order",
      width: 70,
    },
    {
      title: t("textSelection.toolName"),
      dataIndex: "name",
      key: "name",
    },
    {
      title: t("textSelection.toolPrompt"),
      dataIndex: "prompt",
      key: "prompt",
      ellipsis: true,
      render: (text: string) => (
        <span title={text} style={{ color: "#888", fontSize: 12 }}>
          {text.length > 60 ? text.slice(0, 60) + "..." : text}
        </span>
      ),
    },
    {
      title: t("textSelection.actions"),
      key: "actions",
      width: 120,
      render: (_: unknown, record: QuickTool) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditTool(record)}
          />
          <Popconfirm
            title={t("textSelection.confirmDelete")}
            onConfirm={() => handleDeleteTool(record.id)}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        current={t("textSelection.title")}
      />

      {/* Status Card */}
      <Card
        title={t("textSelection.control")}
        className={styles.card}
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchStatus}
            size="small"
          >
            {t("common.refresh")}
          </Button>
        }
      >
        <Space>
          {isRunning ? (
            <Tag color="green">{t("textSelection.desktopRunning")}</Tag>
          ) : isStarting ? (
            <Tag color="orange">{t("textSelection.desktopStarting")}</Tag>
          ) : (
            <Tag color="default">{t("textSelection.desktopStopped")}</Tag>
          )}
          {isRunning ? (
            <Button
              icon={<PauseCircleOutlined />}
              onClick={handleStopDesktop}
              loading={statusLoading}
              danger
            >
              {t("textSelection.stopDesktop")}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStartDesktop}
              loading={statusLoading}
            >
              {t("textSelection.startDesktop")}
            </Button>
          )}
        </Space>
        {status?.pid && (
          <div className={styles.statusBar}>
            <span className={styles.statusText}>
              PID: {status.pid}
            </span>
          </div>
        )}
        <div className={styles.statusBar}>
          <span className={styles.statusText}>
            {t("textSelection.hotkeyHint")}
          </span>
        </div>
      </Card>

      {/* Global Settings Card */}
      <Card title={t("textSelection.globalSettings")} className={styles.card}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSaveConfig}
          initialValues={{
            enabled: config.enabled,
            hotkey: config.hotkey,
            globalEnabled: config.globalEnabled,
            appFilterMode: config.appFilterMode,
            appFilterList: config.appFilterList?.join("\n") || "",
          }}
        >
          <Form.Item
            name="enabled"
            label={t("textSelection.enabled")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="globalEnabled"
            label={t("textSelection.globalEnabled")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="hotkey"
            label={t("textSelection.hotkey")}
          >
            <Select className={styles.hotkeyInput}>
              {HOTKEY_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="appFilterMode"
            label={t("textSelection.appFilterMode")}
          >
            <Radio.Group>
              <Radio value="blacklist">
                {t("textSelection.blacklist")}
              </Radio>
              <Radio value="whitelist">
                {t("textSelection.whitelist")}
              </Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            name="appFilterList"
            label={t("textSelection.appFilterList")}
            help={t("textSelection.appFilterHelp")}
          >
            <Input.TextArea
              rows={3}
              className={styles.appFilterInput}
              placeholder="chrome.exe&#10;notepad.exe&#10;wechat.exe"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              {t("common.save")}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* Quick Tools Card */}
      <Card
        title={t("textSelection.quickTools")}
        className={styles.card}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddTool}
            size="small"
          >
            {t("textSelection.addTool")}
          </Button>
        }
      >
        <Table
          dataSource={config.quickTools}
          columns={toolColumns}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{
            emptyText: t("textSelection.noTools"),
          }}
        />
      </Card>

      {/* Tool Edit Modal */}
      <Modal
        title={
          editingTool
            ? t("textSelection.editTool")
            : t("textSelection.addTool")
        }
        open={toolModalOpen}
        onOk={handleSaveTool}
        onCancel={() => setToolModalOpen(false)}
        confirmLoading={toolSaving}
        destroyOnHidden
      >
        <Form
          form={toolForm}
          layout="vertical"
          initialValues={
            editingTool
              ? editingTool
              : {
                  name: "",
                  nameEn: "",
                  prompt: "请处理以下文本：\n\n{text}",
                  icon: "translate",
                  order: 10,
                }
          }
        >
          <Form.Item
            name="name"
            label={t("textSelection.toolName")}
            rules={[{ required: true }]}
          >
            <Input placeholder={t("textSelection.toolNamePlaceholder")} />
          </Form.Item>

          <Form.Item
            name="nameEn"
            label={t("textSelection.toolNameEn")}
          >
            <Input placeholder="Translate" />
          </Form.Item>

          <Form.Item
            name="prompt"
            label={t("textSelection.toolPrompt")}
            rules={[{ required: true }]}
            help={t("textSelection.toolPromptHelp")}
          >
            <Input.TextArea rows={4} />
          </Form.Item>

          <Form.Item name="icon" label={t("textSelection.toolIcon")}>
            <Select>
              {ICON_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="order" label={t("textSelection.order")}>
            <InputNumber min={1} max={999} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* FAQ */}
      <Card
        title={
          <Space>
            <QuestionCircleOutlined style={{ color: "#1677ff" }} />
            <span>{t("textSelection.faq.title")}</span>
          </Space>
        }
        className={styles.card}
      >
        <Collapse
          ghost
          size="small"
          items={[
            { key: "q1", label: t("textSelection.faq.q1"), children: <p className={styles.faqAnswer}>{t("textSelection.faq.a1")}</p> },
            { key: "q2", label: t("textSelection.faq.q2"), children: <p className={styles.faqAnswer}>{t("textSelection.faq.a2")}</p> },
            { key: "q3", label: t("textSelection.faq.q3"), children: <p className={styles.faqAnswer}>{t("textSelection.faq.a3")}</p> },
            { key: "q4", label: t("textSelection.faq.q4"), children: <p className={styles.faqAnswer}>{t("textSelection.faq.a4")}</p> },
            { key: "q5", label: t("textSelection.faq.q5"), children: <p className={styles.faqAnswer}>{t("textSelection.faq.a5")}</p> },
            { key: "q6", label: t("textSelection.faq.q6"), children: <p className={styles.faqAnswer}>{t("textSelection.faq.a6")}</p> },
          ]}
        />
      </Card>
    </div>
  );
}