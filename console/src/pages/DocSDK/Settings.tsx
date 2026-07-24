import { useCallback, useEffect, useState } from "react";
import {
  Card,
  Tabs,
  Form,
  Select,
  Switch,
  Input,
  InputNumber,
  Button,
  Space,
  Spin,
  message,
  Popconfirm,
} from "antd";
import {
  FolderOpenOutlined,
  ApiOutlined,
  UndoOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { docProcessingApi } from "@/api/modules/docProcessing";
import { browseFolder } from "@/utils/browseFolder";

/* ── Default settings used as fallback ─────────────────────────────── */

const DEFAULT_SETTINGS: Record<string, any> = {
  default_strategy: {
    engine_strategy: "local_only",
  },
  processing: {
    quality: "balanced",
    cache_enabled: true,
    smart_retry: true,
    ocr_engine: "tesseract",
    ocr_language: "zh",
    image_enhancement: false,
    table_recognition: false,
  },
  privacy: {
    auto_redaction: true,
    redaction_level: "standard",
    local_encryption: true,
    transfer_encryption: true,
    allow_cloud: true,
    auto_cleanup: false,
    retention_hours: 24,
  },
  file_management: {
    max_file_size_mb: 50,
    auto_backup: true,
    keep_history: true,
    default_output_dir: "",
  },
  ui: {
    language: "zh-CN",
    theme: "auto",
    auto_save: true,
    verbose_logging: false,
  },
  api_keys: {
    mineru: { key: "", endpoint: "" },
    baidu_ocr: { key: "" },
    tencent_ocr: { key: "" },
    aliyun_ocr: { key: "" },
    wechat_miniapp: { key: "" },
  },
};

/* ── Option arrays ─────────────────────────────────────────────────── */

const LANGUAGE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
];

const THEME_OPTIONS = [
  { value: "light", labelKey: "docSdk.settings.light" },
  { value: "dark", labelKey: "docSdk.settings.dark" },
  { value: "auto", labelKey: "docSdk.settings.auto" },
];

const ENGINE_STRATEGY_OPTIONS = [
  { value: "local_only", labelKey: "docSdk.engineLocalOnly" },
  { value: "hybrid", labelKey: "docSdk.engineHybrid" },
  { value: "cloud_only", labelKey: "docSdk.engineCloudOnly" },
];

const QUALITY_OPTIONS = [
  { value: "fast", labelKey: "docSdk.settings.qualityFast" },
  { value: "balanced", labelKey: "docSdk.settings.qualityBalanced" },
  { value: "high", labelKey: "docSdk.settings.qualityHigh" },
  { value: "maximum", labelKey: "docSdk.settings.qualityMaximum" },
];

const OCR_ENGINE_OPTIONS = [
  { value: "tesseract", label: "Tesseract" },
  { value: "paddle-ocr", label: "PaddleOCR" },
  { value: "easy-ocr", label: "EasyOCR" },
  { value: "google-vision", label: "Google Vision" },
  { value: "tencent-ocr", label: "Tencent Cloud OCR" },
  { value: "aliyun-ocr", label: "Aliyun OCR" },
  { value: "baidu-ocr", label: "Baidu OCR" },
];

const REDACTION_LEVEL_OPTIONS = [
  { value: "light", labelKey: "docSdk.settings.levelLight" },
  { value: "standard", labelKey: "docSdk.settings.levelStandard" },
  { value: "strict", labelKey: "docSdk.settings.levelStrict" },
  { value: "maximum", labelKey: "docSdk.settings.levelMaximum" },
];

const RETENTION_OPTIONS = [
  { value: 1, label: "1h" },
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 72, label: "72h" },
  { value: 168, label: "7d" },
  { value: 720, label: "30d" },
  { value: 0, labelKey: "docSdk.settings.permanent" },
];

/* ── Helper: deep‐merge nested defaults ───────────────────────────── */

function mergeDefaults(settings: Record<string, any>): Record<string, any> {
  const result = { ...DEFAULT_SETTINGS };
  for (const section of Object.keys(DEFAULT_SETTINGS)) {
    if (settings[section] && typeof settings[section] === "object") {
      result[section] = { ...DEFAULT_SETTINGS[section], ...settings[section] };
    }
  }
  return result;
}

function getSection(
  settings: Record<string, any>,
  section: string,
): Record<string, any> {
  return settings?.[section] ?? DEFAULT_SETTINGS[section] ?? {};
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function DocSDKSettings() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, any>>(DEFAULT_SETTINGS);
  const [testLoading, setTestLoading] = useState(false);

  /* ── Fetch settings ──────────────────────────────────────────────── */

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await docProcessingApi.getSettings();
      setSettings(mergeDefaults(data));
    } catch (err: any) {
      // Detect HTML response (Vite SPA fallback / backend not running)
      const errMsg = String(err?.message || err);
      if (errMsg.includes("<!") || errMsg.includes("doctype")) {
        message.error(t("docSdk.settings.backendNotRunning"));
      } else {
        message.error(t("docSdk.settings.loadFailed"));
      }
      console.error(err);
      // Fall back to defaults so the UI is still usable
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  /* ── Update helpers ─────────────────────────────────────────────── */

  const updateSection = useCallback(
    (section: string, field: string, value: any) => {
      setSettings((prev) => ({
        ...prev,
        [section]: { ...prev[section], [field]: value },
      }));
    },
    [],
  );

  /* ── Save all settings ──────────────────────────────────────────── */

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await docProcessingApi.updateSettings(settings);
      message.success(t("docSdk.settings.saveSuccess"));
    } catch (err) {
      message.error(t("docSdk.settings.saveFailed"));
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [settings, t]);

  /* ── Save API keys section only ──────────────────────────────────── */

  const handleSaveApiKeys = useCallback(async () => {
    setSaving(true);
    try {
      await docProcessingApi.updateSettingsSection("api_keys", settings.api_keys);
      message.success(t("docSdk.settings.saveSuccess"));
    } catch (err) {
      message.error(t("docSdk.settings.saveFailed"));
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [settings.api_keys, t]);

  /* ── Reset to defaults ──────────────────────────────────────────── */

  const handleReset = useCallback(async () => {
    try {
      await docProcessingApi.resetConfig();
      message.success(t("docSdk.settings.resetSuccess"));
      fetchSettings();
    } catch (err) {
      message.error(t("docSdk.settings.resetFailed"));
      console.error(err);
    }
  }, [t, fetchSettings]);

  /* ── Test cloud connection ─────────────────────────────────────── */

  const handleTestConnection = useCallback(async () => {
    const apiKey = settings.api_keys?.mineru?.key;
    if (!apiKey) {
      message.warning(t("docSdk.settings.enterApiKeyFirst"));
      return;
    }
    setTestLoading(true);
    try {
      const result = await docProcessingApi.testCloudConnection("mineru", apiKey);
      if (result.success) {
        message.success(t("docSdk.testConnectionSuccess"));
      } else {
        message.error(result.message || t("docSdk.testConnectionFailed"));
      }
    } catch (err) {
      message.error(t("docSdk.testConnectionFailed"));
      console.error(err);
    } finally {
      setTestLoading(false);
    }
  }, [settings.api_keys, t]);

  /* ── Browse folder ─────────────────────────────────────────────── */

  const handleBrowseOutputDir = useCallback(async () => {
    const result = await browseFolder(getSection(settings, "file_management").default_output_dir);
    if (result.path) {
      updateSection("file_management", "default_output_dir", result.path);
    }
  }, [settings, updateSection]);

  /* ── Loading state ──────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  /* ── Shared form item layout ────────────────────────────────────── */

  const formItemLayout = {
    labelCol: { span: 6 },
    wrapperCol: { span: 16 },
  };

  const ui = getSection(settings, "ui");
  const fm = getSection(settings, "file_management");
  const apiKeys = getSection(settings, "api_keys");
  const proc = getSection(settings, "processing");
  const strat = getSection(settings, "default_strategy");
  const priv = getSection(settings, "privacy");

  /* ── Tab panels ────────────────────────────────────────────────── */

  const generalTab = (
    <Form {...formItemLayout} style={{ maxWidth: 640 }}>
      <Form.Item label={t("docSdk.settings.language")}>
        <Select
          value={ui.language}
          onChange={(v) => updateSection("ui", "language", v)}
          options={LANGUAGE_OPTIONS}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.theme")}>
        <Select
          value={ui.theme}
          onChange={(v) => updateSection("ui", "theme", v)}
          options={THEME_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.labelKey),
          }))}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.autoSave")}>
        <Switch
          checked={ui.auto_save}
          onChange={(v) => updateSection("ui", "auto_save", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.verboseLogging")}>
        <Switch
          checked={ui.verbose_logging}
          onChange={(v) => updateSection("ui", "verbose_logging", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.defaultOutputDir")}>
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={fm.default_output_dir}
            onChange={(e) =>
              updateSection("file_management", "default_output_dir", e.target.value)
            }
            placeholder={t("docSdk.settings.outputDirPlaceholder")}
            style={{ flex: 1 }}
          />
          <Button icon={<FolderOpenOutlined />} onClick={handleBrowseOutputDir}>
            {t("docSdk.browse")}
          </Button>
        </Space.Compact>
      </Form.Item>
      <Form.Item label={t("docSdk.settings.maxFileSize")}>
        <Space.Compact style={{ width: 200 }}>
          <InputNumber
            value={fm.max_file_size_mb}
            onChange={(v) => updateSection("file_management", "max_file_size_mb", v ?? 50)}
            min={1}
            max={500}
            style={{ width: '70%' }}
          />
          <Input
            value="MB"
            disabled
            style={{ width: '30%', textAlign: 'center' }}
          />
        </Space.Compact>
      </Form.Item>
      <Form.Item label={t("docSdk.settings.autoBackup")}>
        <Switch
          checked={fm.auto_backup}
          onChange={(v) => updateSection("file_management", "auto_backup", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.keepHistory")}>
        <Switch
          checked={fm.keep_history}
          onChange={(v) => updateSection("file_management", "keep_history", v)}
        />
      </Form.Item>
    </Form>
  );

  const apiKeysTab = (
    <Form {...formItemLayout} style={{ maxWidth: 640 }}>
      <Form.Item label="MinerU API Key">
        <Input.Password
          value={apiKeys.mineru?.key ?? ""}
          onChange={(e) =>
            updateSection("api_keys", "mineru", {
              ...apiKeys.mineru,
              key: e.target.value,
            })
          }
          placeholder={t("docSdk.settings.mineruKeyPlaceholder")}
        />
      </Form.Item>
      <Form.Item label="MinerU Endpoint">
        <Input
          value={apiKeys.mineru?.endpoint ?? ""}
          onChange={(e) =>
            updateSection("api_keys", "mineru", {
              ...apiKeys.mineru,
              endpoint: e.target.value,
            })
          }
          placeholder={t("docSdk.settings.mineruEndpointPlaceholder")}
        />
      </Form.Item>
      <Form.Item label=" ">
        <Space>
          <Button
            size="small"
            icon={<ApiOutlined />}
            loading={testLoading}
            onClick={handleTestConnection}
          >
            {t("docSdk.settings.testConnection")}
          </Button>
        </Space>
      </Form.Item>
      <Form.Item label={t("docSdk.settings.baiduOcrKey")}>
        <Input.Password
          value={apiKeys.baidu_ocr?.key ?? ""}
          onChange={(e) =>
            updateSection("api_keys", "baidu_ocr", {
              ...apiKeys.baidu_ocr,
              key: e.target.value,
            })
          }
          placeholder={t("docSdk.settings.baiduOcrKeyPlaceholder")}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.tencentOcrKey")}>
        <Input.Password
          value={apiKeys.tencent_ocr?.key ?? ""}
          onChange={(e) =>
            updateSection("api_keys", "tencent_ocr", {
              ...apiKeys.tencent_ocr,
              key: e.target.value,
            })
          }
          placeholder={t("docSdk.settings.tencentOcrKeyPlaceholder")}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.aliyunOcrKey")}>
        <Input.Password
          value={apiKeys.aliyun_ocr?.key ?? ""}
          onChange={(e) =>
            updateSection("api_keys", "aliyun_ocr", {
              ...apiKeys.aliyun_ocr,
              key: e.target.value,
            })
          }
          placeholder={t("docSdk.settings.aliyunOcrKeyPlaceholder")}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.wechatMiniappKey")}>
        <Input.Password
          value={apiKeys.wechat_miniapp?.key ?? ""}
          onChange={(e) =>
            updateSection("api_keys", "wechat_miniapp", {
              ...apiKeys.wechat_miniapp,
              key: e.target.value,
            })
          }
          placeholder={t("docSdk.settings.wechatMiniappKeyPlaceholder")}
        />
      </Form.Item>
      <Form.Item label=" ">
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSaveApiKeys}
        >
          {t("docSdk.settings.saveApiKeys")}
        </Button>
      </Form.Item>
    </Form>
  );

  const processingTab = (
    <Form {...formItemLayout} style={{ maxWidth: 640 }}>
      <Form.Item label={t("docSdk.settings.engineStrategy")}>
        <Select
          value={strat.engine_strategy}
          onChange={(v) =>
            updateSection("default_strategy", "engine_strategy", v)
          }
          options={ENGINE_STRATEGY_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.labelKey),
          }))}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.quality")}>
        <Select
          value={proc.quality}
          onChange={(v) => updateSection("processing", "quality", v)}
          options={QUALITY_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.labelKey),
          }))}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.cacheEnabled")}>
        <Switch
          checked={proc.cache_enabled}
          onChange={(v) => updateSection("processing", "cache_enabled", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.smartRetry")}>
        <Switch
          checked={proc.smart_retry}
          onChange={(v) => updateSection("processing", "smart_retry", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.ocrEngine")}>
        <Select
          value={proc.ocr_engine}
          onChange={(v) => updateSection("processing", "ocr_engine", v)}
          options={OCR_ENGINE_OPTIONS}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.ocrLanguage")}>
        <Input
          value={proc.ocr_language}
          onChange={(e) => updateSection("processing", "ocr_language", e.target.value)}
          placeholder="zh"
          style={{ width: 200 }}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.imageEnhancement")}>
        <Switch
          checked={proc.image_enhancement}
          onChange={(v) => updateSection("processing", "image_enhancement", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.tableRecognition")}>
        <Switch
          checked={proc.table_recognition}
          onChange={(v) => updateSection("processing", "table_recognition", v)}
        />
      </Form.Item>
    </Form>
  );

  const privacyTab = (
    <Form {...formItemLayout} style={{ maxWidth: 640 }}>
      <Form.Item label={t("docSdk.settings.autoRedaction")}>
        <Switch
          checked={priv.auto_redaction}
          onChange={(v) => updateSection("privacy", "auto_redaction", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.redactionLevel")}>
        <Select
          value={priv.redaction_level}
          onChange={(v) => updateSection("privacy", "redaction_level", v)}
          options={REDACTION_LEVEL_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.labelKey),
          }))}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.localEncryption")}>
        <Switch
          checked={priv.local_encryption}
          onChange={(v) => updateSection("privacy", "local_encryption", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.transferEncryption")}>
        <Switch
          checked={priv.transfer_encryption}
          onChange={(v) => updateSection("privacy", "transfer_encryption", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.allowCloud")}>
        <Switch
          checked={priv.allow_cloud}
          onChange={(v) => updateSection("privacy", "allow_cloud", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.autoCleanup")}>
        <Switch
          checked={priv.auto_cleanup}
          onChange={(v) => updateSection("privacy", "auto_cleanup", v)}
        />
      </Form.Item>
      <Form.Item label={t("docSdk.settings.retentionHours")}>
        <Select
          value={priv.retention_hours}
          onChange={(v) => updateSection("privacy", "retention_hours", v)}
          options={RETENTION_OPTIONS.map((o) => ({
            value: o.value,
            label: o.labelKey ? t(o.labelKey) : o.label,
          }))}
          style={{ width: 200 }}
        />
      </Form.Item>
    </Form>
  );

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16, gap: 8 }}>
        <Popconfirm
          title={t("docSdk.settings.confirmReset")}
          onConfirm={handleReset}
          okText={t("common.confirm")}
          cancelText={t("common.cancel")}
        >
          <Button icon={<UndoOutlined />}>{t("docSdk.settings.resetDefault")}</Button>
        </Popconfirm>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
        >
          {t("docSdk.settings.saveAll")}
        </Button>
      </div>

      <Tabs
        items={[
          {
            key: "general",
            label: t("docSdk.settings.tabGeneral"),
            children: (
              <Card size="small">{generalTab}</Card>
            ),
          },
          {
            key: "apiKeys",
            label: t("docSdk.settings.tabApiKeys"),
            children: (
              <Card size="small">{apiKeysTab}</Card>
            ),
          },
          {
            key: "processing",
            label: t("docSdk.settings.tabProcessing"),
            children: (
              <Card size="small">{processingTab}</Card>
            ),
          },
          {
            key: "privacy",
            label: t("docSdk.settings.tabPrivacy"),
            children: (
              <Card size="small">{privacyTab}</Card>
            ),
          },
        ]}
      />
    </div>
  );
}
