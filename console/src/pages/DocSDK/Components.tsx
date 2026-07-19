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
} from "antd";
import {
  DownloadOutlined,
  DeleteOutlined,
  SettingOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloudOutlined,
  DesktopOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { docProcessingApi } from "@/api/modules/docProcessing";
import type { DocComponent } from "@/api/modules/docProcessing";

export default function DocSDKComponents() {
  const { t } = useTranslation();

  const [components, setComponents] = useState<DocComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [configTarget, setConfigTarget] = useState<DocComponent | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);

  const fetchComponents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await docProcessingApi.listComponents();
      setComponents(data);
    } catch (err) {
      message.error(t("docSdk.componentsFetchFailed"));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchComponents();
  }, [fetchComponents]);

  const handleInstall = useCallback(
    async (componentId: string) => {
      setInstallingId(componentId);
      try {
        await docProcessingApi.installComponent(componentId);
        message.success(t("docSdk.installSuccess"));
        fetchComponents();
      } catch (err) {
        message.error(t("docSdk.installFailed"));
        console.error(err);
      } finally {
        setInstallingId(null);
      }
    },
    [t, fetchComponents],
  );

  const handleUninstall = useCallback(
    async (componentId: string) => {
      setUninstallingId(componentId);
      try {
        await docProcessingApi.uninstallComponent(componentId);
        message.success(t("docSdk.uninstallSuccess"));
        fetchComponents();
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

  return (
    <>
      <Row gutter={[16, 16]}>
        {components.map((comp) => (
          <Col key={comp.id} xs={24} sm={12} lg={8} xl={6}>
            <Card
              size="small"
              title={
                <Space>
                  {comp.type === "local" ? (
                    <DesktopOutlined />
                  ) : (
                    <CloudOutlined />
                  )}
                  <span>{comp.name}</span>
                </Space>
              }
              extra={
                <Tag color={comp.type === "local" ? "blue" : "purple"}>
                  {comp.type === "local"
                    ? t("docSdk.typeLocal")
                    : t("docSdk.typeCloud")}
                </Tag>
              }
              style={{ height: "100%" }}
            >
              <p style={{ color: "#666", marginBottom: 12, minHeight: 40 }}>
                {comp.description || "-"}
              </p>
              <div style={{ marginBottom: 8 }}>
                <Tag>{t("docSdk.version")}: {comp.version}</Tag>
                <Tag color={comp.installed ? "green" : "default"}>
                  {comp.installed
                    ? t("docSdk.installed")
                    : t("docSdk.notInstalled")}
                </Tag>
              </div>
              {comp.capabilities && comp.capabilities.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {comp.capabilities.map((cap) => (
                    <Tag key={cap}>{cap}</Tag>
                  ))}
                </div>
              )}
              <Space wrap>
                {comp.type === "local" && (
                  <>
                    {!comp.installed ? (
                      <Popconfirm
                        title={t("docSdk.confirmInstall")}
                        onConfirm={() => handleInstall(comp.id)}
                        okText={t("common.confirm")}
                        cancelText={t("common.cancel")}
                      >
                        <Button
                          type="primary"
                          size="small"
                          icon={<DownloadOutlined />}
                          loading={installingId === comp.id}
                        >
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
                        <Button
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          loading={uninstallingId === comp.id}
                        >
                          {t("docSdk.uninstall")}
                        </Button>
                      </Popconfirm>
                    )}
                  </>
                )}
                {comp.type === "cloud" && (
                  <>
                    <Button
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={() => openConfigModal(comp)}
                    >
                      {t("docSdk.configureApiKey")}
                    </Button>
                    <Button
                      size="small"
                      icon={<ApiOutlined />}
                      onClick={() => openConfigModal(comp)}
                    >
                      {t("docSdk.testConnection")}
                    </Button>
                  </>
                )}
              </Space>
            </Card>
          </Col>
        ))}
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
          <Button
            key="test"
            loading={testLoading}
            onClick={handleTestConnection}
            icon={<ApiOutlined />}
          >
            {t("docSdk.testConnection")}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={configLoading}
            onClick={handleConfigSave}
          >
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