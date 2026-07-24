import { useCallback, useEffect, useState } from "react";
import {
  Card,
  Button,
  Tag,
  Modal,
  Input,
  Popconfirm,
  Space,
  Spin,
  Empty,
  message,
  Row,
  Col,
  Progress,
  Alert,
  Tooltip,
} from "antd";
import {
  DownloadOutlined,
  DeleteOutlined,
  SettingOutlined,
  ApiOutlined,
  CloudOutlined,
  DesktopOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { docProcessingApi } from "@/api/modules/docProcessing";
import type { DocComponent, EnvironmentReport } from "@/api/modules/docProcessing";

const COMPONENT_HINTS: Record<
  string,
  { minRam?: number; gpuRequired?: boolean; installTime?: string; guide?: string }
> = {
  basic_parser: { guide: "PDF/Word/Excel/PPT 文本提取，需要 PyMuPDF (fitz)" },
  ocr_paddle: { minRam: 4, installTime: "约5-10分钟", guide: "百度飞桨 OCR，支持中英文，建议 4GB+ 内存" },
  ocr_tesseract: { installTime: "约1-2分钟", guide: "开源 OCR 引擎，需安装 Tesseract 系统依赖" },
  advanced_mineru_local: { minRam: 8, gpuRequired: true, installTime: "约15-30分钟", guide: "MinerU 本地引擎，需 GPU 和 8GB+ 显存" },
  advanced_mineru_cloud: { guide: "MinerU 云端引擎，需要 API Key，无需本地资源" },
  redaction_local: { guide: "基于正则的本地脱敏，无需额外依赖" },
  cloud_baidu_ocr: { guide: "百度智能云 OCR，需要 API Key" },
  cloud_tencent_ocr: { guide: "腾讯云 OCR，需要 SecretId/SecretKey" },
  cloud_aliyun_ocr: { guide: "阿里云 OCR，需要 AccessKey" },
};

export default function DocSDKComponents() {
  const { t } = useTranslation();

  const [components, setComponents] = useState<DocComponent[]>([]);
  const [envReport, setEnvReport] = useState<EnvironmentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [configTarget, setConfigTarget] = useState<DocComponent | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);

  const fetchComponents = useCallback(async () => {
    setLoading(true);
    try {
      const [data, env] = await Promise.all([
        docProcessingApi.listComponents(),
        docProcessingApi.getEnvironmentReport().catch(() => null),
      ]);
      const rawComponents = Array.isArray(data) ? data : (data as any)?.components ?? [];
      // Map backend ComponentInfo to frontend DocComponent
      const mapped: DocComponent[] = rawComponents.map((c: any) => ({
        id: c.component_id ?? c.id ?? c.componentId ?? "",
        name: c.name ?? "",
        description: c.description ?? "",
        type: c.component_type === "cloud" || c.type === "cloud" ? "cloud" : "local",
        version: c.version ?? "1.0.0",
        installed: c.is_installed ?? c.installed ?? false,
        configured: c.is_enabled ?? c.configured ?? c.enabled ?? false,
        capabilities: c.capabilities ?? c.required_packages ?? [],
      }));
      setComponents(mapped);
      if (env) setEnvReport(env);
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      if (errMsg.includes("<!") || errMsg.includes("doctype")) {
        message.error(t("docSdk.settings.backendNotRunning"));
      } else {
        message.error(t("docSdk.componentsFetchFailed"));
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchComponents();
  }, [fetchComponents]);

  useEffect(() => {
    if (installingId) {
      setInstallProgress(10);
      const timer = setInterval(() => {
        setInstallProgress((p) => (p >= 90 ? 90 : p + Math.random() * 15));
      }, 800);
      return () => clearInterval(timer);
    }
    setInstallProgress(0);
  }, [installingId]);

  const handleInstall = useCallback(
    async (componentId: string) => {
      setInstallingId(componentId);
      setInstallProgress(5);
      try {
        const result = await docProcessingApi.installComponent(componentId);
        const resp = result as any;
        if (resp && resp.success === false) {
          const errMsg = resp.error || resp.message || "";
          message.error(`${t("docSdk.installFailed")}${errMsg ? ": " + errMsg : ""}`);
          return;
        }
        setInstallProgress(100);
        message.success(t("docSdk.installSuccess"));
        await fetchComponents();
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        message.error(`${t("docSdk.installFailed")}: ${errMsg.slice(0, 200)}`);
        console.error(err);
      } finally {
        setInstallingId(null);
        setInstallProgress(0);
      }
    },
    [t, fetchComponents],
  );

  const handleUninstall = useCallback(
    async (componentId: string) => {
      setUninstallingId(componentId);
      try {
        const result = await docProcessingApi.uninstallComponent(componentId);
        if (result && (result as any).success === false) {
          message.error(t("docSdk.uninstallFailed"));
          return;
        }
        message.success(t("docSdk.uninstallSuccess"));
        await fetchComponents();
      } catch (err) {
        message.error(t("docSdk.uninstallFailed"));
        console.error(err);
      } finally {
        setUninstallingId(null);
      }
    },
    [t, fetchComponents],
  );

  const openConfigModal = useCallback((comp: DocComponent) => {
    setConfigTarget(comp);
    setApiKeyInput("");
    setConfigModalVisible(true);
  }, []);

  const handleConfigSave = useCallback(async () => {
    if (!configTarget || !apiKeyInput.trim()) return;
    setConfigLoading(true);
    try {
      await docProcessingApi.configureComponent(configTarget.id, apiKeyInput.trim());
      message.success(t("docSdk.configSaveSuccess"));
      setConfigModalVisible(false);
      fetchComponents();
    } catch (err) {
      message.error(t("docSdk.configSaveFailed"));
      console.error(err);
    } finally {
      setConfigLoading(false);
    }
  }, [configTarget, apiKeyInput, t, fetchComponents]);

  const handleTestConnection = useCallback(async () => {
    if (!configTarget || !apiKeyInput.trim()) return;
    setTestLoading(true);
    try {
      const result = await docProcessingApi.testCloudConnection(
        configTarget.id,
        apiKeyInput.trim(),
      );
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
  }, [configTarget, apiKeyInput, t]);

  const getHint = (compId: string) => COMPONENT_HINTS[compId];

  const checkCompatibility = (compId: string) => {
    const hint = getHint(compId);
    if (!hint || !envReport) return { ok: true, warnings: [] as string[] };
    const warnings: string[] = [];
    if (envReport.system_status === "error") {
      warnings.push(t("docSdk.component.envError"));
    }
    if (envReport.missing_packages?.length) {
      warnings.push(`${t("docSdk.component.missingPackages")}: ${envReport.missing_packages.join(", ")}`);
    }
    return { ok: warnings.length === 0, warnings };
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (components.length === 0) {
    return <Empty description={t("docSdk.noComponents")} />;
  }

  const installedCount = components.filter((c) => c.installed).length;

  return (
    <>
      {envReport && (
        <Alert
          type={envReport.system_status === "ok" ? "success" : envReport.system_status === "degraded" ? "warning" : "error"}
          showIcon
          message={
            <Space>
              <span>{t("docSdk.component.envStatus")}:</span>
              <Tag color={envReport.system_status === "ok" ? "green" : envReport.system_status === "degraded" ? "orange" : "red"}>
                {envReport.system_status === "ok" ? t("docSdk.systemStatusOk") : envReport.system_status === "degraded" ? t("docSdk.systemStatusDegraded") : t("docSdk.systemStatusError")}
              </Tag>
              {envReport.python_version && <Tag>Python {envReport.python_version}</Tag>}
              {envReport.missing_packages?.length ? (
                <Tag color="orange">{t("docSdk.component.missingPackages")}: {envReport.missing_packages.length}</Tag>
              ) : null}
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <div style={{ marginBottom: 12, color: "#888", fontSize: 13 }}>
        {t("docSdk.component.installedCount", { installed: installedCount, total: components.length })}
      </div>

      <Row gutter={[16, 16]}>
        {components.map((comp) => {
          const hint = getHint(comp.id);
          const compat = checkCompatibility(comp.id);
          const isInstalling = installingId === comp.id;

          return (
            <Col key={comp.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                size="small"
                title={
                  <Space>
                    {comp.type === "local" ? <DesktopOutlined /> : <CloudOutlined />}
                    <span>{comp.name}</span>
                  </Space>
                }
                extra={
                  <Tag color={comp.type === "local" ? "blue" : "purple"}>
                    {comp.type === "local" ? t("docSdk.typeLocal") : t("docSdk.typeCloud")}
                  </Tag>
                }
                style={{ height: "100%" }}
              >
                <p style={{ color: "#666", marginBottom: 12, minHeight: 32, fontSize: 13 }}>
                  {comp.description || "-"}
                </p>

                {hint?.guide && (
                  <div style={{ marginBottom: 8, padding: "4px 8px", background: "rgba(0,0,0,0.02)", borderRadius: 4, fontSize: 12, color: "#999" }}>
                    <InfoCircleOutlined style={{ marginRight: 4 }} />
                    {hint.guide}
                  </div>
                )}

                {hint?.minRam && (
                  <div style={{ marginBottom: 8 }}>
                    <Tag icon={<DesktopOutlined />} style={{ fontSize: 11 }}>RAM ≥ {hint.minRam}GB</Tag>
                    {hint.gpuRequired && <Tag color="red" style={{ fontSize: 11 }}>GPU</Tag>}
                    {hint.installTime && <Tag style={{ fontSize: 11 }}>{hint.installTime}</Tag>}
                  </div>
                )}

                <div style={{ marginBottom: 8 }}>
                  <Tag>{t("docSdk.version")}: {comp.version}</Tag>
                  <Tag color={comp.installed ? "green" : "default"}>
                    {comp.installed ? t("docSdk.installed") : t("docSdk.notInstalled")}
                  </Tag>
                </div>

                {comp.capabilities && comp.capabilities.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {comp.capabilities.map((cap) => (
                      <Tag key={cap}>{cap}</Tag>
                    ))}
                  </div>
                )}

                {!comp.installed && compat.warnings.length > 0 && (
                  <Tooltip title={compat.warnings.join("; ")}>
                    <Tag color="orange" icon={<WarningOutlined />} style={{ marginBottom: 8, cursor: "help" }}>
                      {t("docSdk.component.checkEnv")}
                    </Tag>
                  </Tooltip>
                )}

                {isInstalling && (
                  <div style={{ marginBottom: 8 }}>
                    <Progress percent={Math.round(installProgress)} size="small" status="active" />
                  </div>
                )}

                <Space wrap>
                  {comp.type === "local" && (
                    !comp.installed ? (
                      <Popconfirm
                        title={t("docSdk.confirmInstall")}
                        description={hint?.guide}
                        onConfirm={() => handleInstall(comp.id)}
                        okText={t("common.confirm")}
                        cancelText={t("common.cancel")}
                      >
                        <Button type="primary" size="small" icon={<DownloadOutlined />} loading={isInstalling}>
                          {t("docSdk.install")}
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Popconfirm
                        title={t("docSdk.confirmUninstall")}
                        onConfirm={() => handleUninstall(comp.id)}
                        okText={t("common.confirm")}
                        cancelText={t("common.cancel")}
                      >
                        <Button danger size="small" icon={<DeleteOutlined />} loading={uninstallingId === comp.id}>
                          {t("docSdk.uninstall")}
                        </Button>
                      </Popconfirm>
                    )
                  )}
                  {comp.type === "cloud" && (
                    <>
                      <Button size="small" icon={<SettingOutlined />} onClick={() => openConfigModal(comp)}>
                        {t("docSdk.configureApiKey")}
                      </Button>
                      <Button size="small" icon={<ApiOutlined />} onClick={() => openConfigModal(comp)}>
                        {t("docSdk.testConnection")}
                      </Button>
                    </>
                  )}
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Modal
        title={t("docSdk.configureApiKeyTitle", { name: configTarget?.name ?? "" })}
        open={configModalVisible}
        onOk={handleConfigSave}
        onCancel={() => setConfigModalVisible(false)}
        confirmLoading={configLoading}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        footer={[
          <Button key="cancel" onClick={() => setConfigModalVisible(false)}>
            {t("common.cancel")}
          </Button>,
          <Button key="test" loading={testLoading} onClick={handleTestConnection} icon={<ApiOutlined />}>
            {t("docSdk.testConnection")}
          </Button>,
          <Button key="save" type="primary" loading={configLoading} onClick={handleConfigSave}>
            {t("common.save")}
          </Button>,
        ]}
      >
        <Input.Password
          placeholder={t("docSdk.apiKeyPlaceholder")}
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          style={{ marginTop: 16 }}
          onPressEnter={handleConfigSave}
        />
      </Modal>
    </>
  );
}
