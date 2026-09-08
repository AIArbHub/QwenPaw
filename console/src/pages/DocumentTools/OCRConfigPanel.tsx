import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Switch,
  Radio,
  Select,
  Input,
  InputNumber,
  Button,
  Alert,
  Tag,
  Space,
  Divider,
  Row,
  Col,
  Spin,
  message,
  Typography,
} from "antd";
import {
  ScanOutlined,
  DesktopOutlined,
  CloudServerOutlined,
  InfoCircleOutlined,
  TableOutlined,
  WarningOutlined,
  LinkOutlined,
  FontSizeOutlined,
  CheckCircleFilled,
  LoadingOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { documentToolsApi } from "../../api/modules/documentTools";

const { Text } = Typography;

/**
 * OCR Config Panel — standalone configuration for OCR engines.
 *
 * This panel is shown as a dedicated tab in the DocumentTools page and also
 * embedded in the Settings sidebar. It manages:
 *   1. Text Recognition engine (local vs cloud)
 *   2. Layout Parsing / MinerU (optional, local vs cloud)
 *   3. Common settings (language, DPI, fallback)
 *
 * Configuration is persisted server-side at ~/.aiarb/ocr_config.json and
 * takes effect immediately (no restart required).
 */
export default function OCRConfigPanel() {
  const { t } = useTranslation();

  const [ocrConfig, setOcrConfig] = useState<any>(null);
  const [ocrEngines, setOcrEngines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [autoInstallTriggered, setAutoInstallTriggered] = useState(false);

  // -- Data loading --
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await documentToolsApi.getOCRConfig();
      setOcrConfig(data.config);
      setOcrEngines(data.available_engines || []);

      // Auto-install if no engines available and mode is local
      if (
        !autoInstallTriggered &&
        data.available_engines?.length === 0 &&
        data.config?.text_engine?.mode !== "cloud_api"
      ) {
        setAutoInstallTriggered(true);
        // Trigger auto-install in background
        (async () => {
          setInstalling(true);
          message.info(
            t(
              "documentTools.ocr.autoInstalling",
              "未检测到 OCR 引擎，正在自动安装...（已根据网络自动选择镜像源）",
            ),
          );
          try {
            const result = await documentToolsApi.installOCREngines("auto");
            if (result.success) {
              message.success(
                t("documentTools.ocr.installSuccess", "OCR 引擎安装成功！") +
                  (result.mirror_used ? "（已使用国内镜像源）" : ""),
              );
              // Refresh config to show newly installed engines
              const data2 = await documentToolsApi.getOCRConfig();
              setOcrConfig(data2.config);
              setOcrEngines(data2.available_engines || []);
            } else {
              message.error(
                t("documentTools.ocr.installFailed", "安装失败：") +
                  (result.stderr_tail || ""),
              );
            }
          } catch {
            message.error(
              t("documentTools.ocr.installFailed", "安装失败，请检查网络或手动安装"),
            );
          } finally {
            setInstalling(false);
          }
        })();
      }
    } catch {
      // Silently fail — panel shows empty state
    } finally {
      setLoading(false);
    }
  }, [t, autoInstallTriggered]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // -- Helper: update config and refresh --
  const updateConfig = useCallback(
    async (patch: Record<string, any>) => {
      setSaving(true);
      try {
        await documentToolsApi.updateOCRConfig(patch);
        // Refresh config from server to get canonical state
        const data = await documentToolsApi.getOCRConfig();
        setOcrConfig(data.config);
        setOcrEngines(data.available_engines || []);
      } catch {
        message.error(t("documentTools.ocr.saveFailed", "保存失败，请重试"));
      } finally {
        setSaving(false);
      }
    },
    [t],
  );

  // -- Manual install handler --
  const handleManualInstall = useCallback(async (engine: string) => {
    setInstalling(true);
    message.info(t("documentTools.ocr.installing", "正在安装 OCR 引擎..."));
    try {
      const result = await documentToolsApi.installOCREngines(engine);
      if (result.success) {
        message.success(
          t("documentTools.ocr.installSuccess", "OCR 引擎安装成功！") +
            (result.mirror_used ? "（已使用国内镜像源）" : ""),
        );
        const data = await documentToolsApi.getOCRConfig();
        setOcrConfig(data.config);
        setOcrEngines(data.available_engines || []);
      } else {
        message.error(
          t("documentTools.ocr.installFailed", "安装失败：") +
            (result.stderr_tail || ""),
        );
      }
    } catch {
      message.error(t("documentTools.ocr.installFailed", "安装失败，请检查网络"));
    } finally {
      setInstalling(false);
    }
  }, [t]);

  if (loading && !ocrConfig) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  const ocrEnabled = ocrConfig?.enable_ocr !== false;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <Card
        size="small"
        title={
          <Space>
            <ScanOutlined />
            {t("documentTools.ocr.title", "OCR 引擎配置")}
            <Tag color={ocrEnabled ? "green" : "default"}>
              {ocrEnabled
                ? t("documentTools.redaction.ocrEnabled", "已启用")
                : t("documentTools.redaction.ocrDisabled", "未启用")}
            </Tag>
            {saving && <Spin size="small" />}
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          {/* Global OCR toggle */}
          <div>
            <Text strong>
              {t("documentTools.redaction.globalOcrToggle", "全局 OCR 开关")}
            </Text>
            <Switch
              checked={ocrEnabled}
              onChange={(checked) => updateConfig({ enable_ocr: checked })}
              size="small"
              style={{ marginLeft: 8 }}
            />
          </div>

          {/* ============================================ */}
          {/* CAPABILITY 1: Text Recognition (文字识别) */}
          {/* ============================================ */}
          <Card
            size="small"
            type="inner"
            title={
              <Space>
                <FontSizeOutlined />
                <span style={{ fontWeight: 600 }}>
                  {t(
                    "documentTools.redaction.textRecognition",
                    "1. 文字识别引擎",
                  )}
                </span>
                <Tag color="blue">
                  {t("documentTools.redaction.required", "必需")}
                </Tag>
              </Space>
            }
            style={{ background: "#fafafa" }}
          >
            <Radio.Group
              value={ocrConfig?.text_engine?.mode || "local"}
              onChange={(e) => {
                const mode = e.target.value;
                updateConfig({
                  text_engine: {
                    ...(ocrConfig?.text_engine || {}),
                    mode,
                    // Reset provider-specific fields when switching mode
                    ...(mode === "local"
                      ? { provider: "", api_key: "", endpoint: "" }
                      : {}),
                  },
                });
              }}
              style={{ width: "100%", marginBottom: 12 }}
            >
              <Radio.Button value="local" style={{ flex: 1, textAlign: "center" }}>
                <DesktopOutlined />{" "}
                {t("documentTools.redaction.localDeployment", "本地部署")}
              </Radio.Button>
              <Radio.Button value="cloud_api" style={{ flex: 1, textAlign: "center" }}>
                <CloudServerOutlined />{" "}
                {t("documentTools.redaction.cloudApi", "云端 API")}
              </Radio.Button>
            </Radio.Group>

            {(ocrConfig?.text_engine?.mode || "local") === "local" ? (
              /* ===== LOCAL ENGINE CONFIG ===== */
              <div>
                <Alert
                  type="info"
                  showIcon
                  icon={<DesktopOutlined />}
                  message={t(
                    "documentTools.redaction.localEngineDesc",
                    "使用本地安装的 OCR 引擎，数据不出服务器，需要足够的硬件资源",
                  )}
                  style={{ marginBottom: 12 }}
                />

                {/* Local engine selection */}
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                    {t("documentTools.redaction.selectLocalEngine", "选择本地引擎")}
                  </Text>
                  <Select
                    value={ocrConfig?.text_engine?.provider || "auto"}
                    onChange={(val) =>
                      updateConfig({
                        text_engine: {
                          ...(ocrConfig?.text_engine || {}),
                          provider: val,
                        },
                      })
                    }
                    style={{ width: "100%" }}
                    options={[
                      {
                        label: t(
                          "documentTools.redaction.autoDetectBest",
                          "自动选择最佳（推荐）",
                        ),
                        value: "auto",
                      },
                      {
                        label: "🔷 PaddleOCR (中文最优，需 ~3GB 磁盘)",
                        value: "paddleocr",
                      },
                      {
                        label: "🌐 EasyOCR (多语言，需 ~500MB)",
                        value: "easyocr",
                      },
                      {
                        label: "⚡ Tesseract (最快最轻，~50MB)",
                        value: "tesseract",
                      },
                    ]}
                  />
                </div>

                {/* GPU toggle for local engines */}
                <div>
                  <Switch
                    checked={ocrConfig?.text_engine?.use_gpu !== false}
                    onChange={(checked) =>
                      updateConfig({
                        text_engine: {
                          ...(ocrConfig?.text_engine || {}),
                          use_gpu: checked,
                        },
                      })
                    }
                    size="small"
                  />
                  <Text style={{ marginLeft: 8, fontSize: 12 }}>
                    {t(
                      "documentTools.redaction.useGpuAcceleration",
                      "使用 GPU 加速（推荐，大幅提升速度）",
                    )}
                  </Text>
                </div>

                {/* Installation status */}
                {ocrEngines.length > 0 ? (
                  <Alert
                    type="success"
                    showIcon
                    icon={<CheckCircleFilled />}
                    message={`${t("documentTools.ocr.installedEngines", "已安装引擎")}: ${ocrEngines.join(", ")}`}
                    style={{ marginTop: 8 }}
                  />
                ) : installing ? (
                  <Alert
                    type="info"
                    showIcon
                    icon={<LoadingOutlined />}
                    message={t("documentTools.ocr.autoInstalling", "正在自动安装 OCR 引擎...（已根据网络自动选择镜像源）")}
                    style={{ marginTop: 8 }}
                  />
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    message={t("documentTools.ocr.noEngineDetected", "未检测到 OCR 引擎，正在准备自动安装...")}
                    style={{ marginTop: 8 }}
                  />
                )}

                {/* Install buttons */}
                <Space style={{ marginTop: 8 }}>
                  <Button
                    size="small"
                    type="primary"
                    loading={installing}
                    onClick={() => handleManualInstall("auto")}
                  >
                    {t("documentTools.ocr.installNow", "一键安装")}
                  </Button>
                  <Button
                    size="small"
                    loading={installing}
                    onClick={() => handleManualInstall("paddleocr")}
                  >
                    PaddleOCR
                  </Button>
                  <Button
                    size="small"
                    loading={installing}
                    onClick={() => handleManualInstall("easyocr")}
                  >
                    EasyOCR
                  </Button>
                  <Button
                    size="small"
                    loading={installing}
                    onClick={() => handleManualInstall("tesseract")}
                  >
                    Tesseract
                  </Button>
                </Space>
              </div>
            ) : (
              /* ===== CLOUD API CONFIG ===== */
              <div>
                <Alert
                  type="info"
                  showIcon
                  icon={<CloudServerOutlined />}
                  message={t(
                    "documentTools.redaction.cloudApiDesc",
                    "使用云端 OCR 服务，无需本地硬件，按量付费，数据经网络传输",
                  )}
                  style={{ marginBottom: 12 }}
                />

                {/* Cloud provider selection */}
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                    {t("documentTools.redaction.selectCloudProvider", "选择云服务商")}
                  </Text>
                  <Select
                    value={ocrConfig?.text_engine?.provider || "ocr-space"}
                    onChange={(val) => {
                      const defaultEndpoints: Record<string, string> = {
                        "ocr-space": "https://api.ocr.space",
                        "baidu-ocr":
                          "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic",
                        "tencent-ocr": "https://ocr.tencentcloudapi.com/",
                        "mineru-cloud": "https://api.mineru.org",
                      };
                      updateConfig({
                        text_engine: {
                          ...(ocrConfig?.text_engine || {}),
                          provider: val,
                          endpoint:
                            ocrConfig?.text_engine?.endpoint ||
                            defaultEndpoints[val] ||
                            "",
                        },
                      });
                    }}
                    style={{ width: "100%" }}
                    options={[
                      {
                        label: "OCR.space (免费 500次/月, $0.001/页)",
                        value: "ocr-space",
                      },
                      { label: "百度智能云 OCR (国内首选)", value: "baidu-ocr" },
                      { label: "腾讯云 OCR (表格识别强)", value: "tencent-ocr" },
                      { label: "MinerU 云服务 (版面解析)", value: "mineru-cloud" },
                      { label: "自定义 API 端点", value: "custom" },
                    ]}
                  />
                </div>

                {/* Custom endpoint (if "custom" selected) */}
                {(ocrConfig?.text_engine?.provider === "custom" ||
                  !ocrConfig?.text_engine?.provider) && (
                  <div style={{ marginBottom: 8 }}>
                    <Input
                      placeholder="https://your-api-endpoint.com/ocr"
                      value={ocrConfig?.text_engine?.endpoint}
                      onChange={(e) =>
                        updateConfig({
                          text_engine: {
                            ...(ocrConfig?.text_engine || {}),
                            endpoint: e.target.value,
                          },
                        })
                      }
                      addonBefore={<LinkOutlined />}
                    />
                  </div>
                )}

                {/* API Key input */}
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                    {t("documentTools.redaction.apiKeyInput", "API 密钥")}
                  </Text>
                  <Input.Password
                    value={ocrConfig?.text_engine?.api_key || ""}
                    onChange={(e) =>
                      updateConfig({
                        text_engine: {
                          ...(ocrConfig?.text_engine || {}),
                          api_key: e.target.value,
                        },
                      })
                    }
                    placeholder={t(
                      "documentTools.redaction.apiKeyPlaceholder",
                      "输入 API Key 以启用云端 OCR 服务",
                    )}
                    style={{ width: "100%" }}
                  />
                </div>

                {/* Test connection button */}
                <Button
                  icon={<CloudServerOutlined />}
                  onClick={async () => {
                    setLoading(true);
                    try {
                      const result = await documentToolsApi.listOCREngines();
                      if (!ocrConfig?.text_engine?.api_key) {
                        message.warning(
                          t("documentTools.redaction.noCloudKey", "请先输入 API Key"),
                        );
                        return;
                      }
                      message.success(
                        t(
                          "documentTools.redaction.connectionSuccess",
                          "连接测试成功！可用引擎：",
                        ) + result.available?.join(", "),
                      );
                    } finally {
                      setLoading(false);
                    }
                  }}
                  loading={loading}
                  size="small"
                >
                  {t("documentTools.redaction.testConnection", "测试连接")}
                </Button>

                <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>
                  <InfoCircleOutlined style={{ marginRight: 4 }} />
                  {t(
                    "documentTools.redaction.costWarning",
                    "费用提示：通常 $0.001-0.01/页，批量处理建议购买包月套餐",
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* ============================================ */}
          {/* CAPABILITY 2: Layout Parsing (版面解析) */}
          {/* ============================================ */}
          <Card
            size="small"
            type="inner"
            title={
              <Space>
                <TableOutlined />
                <span style={{ fontWeight: 600 }}>
                  {t(
                    "documentTools.redaction.layoutParsing",
                    "2. 版面解析引擎 (MinerU)",
                  )}
                </span>
                <Tag color="purple">
                  {t("documentTools.redaction.optional", "可选增强")}
                </Tag>
              </Space>
            }
            style={{ background: "#fafafa" }}
            extra={
              <Switch
                checked={
                  ocrConfig?.layout_parser !== null &&
                  ocrConfig?.layout_parser !== undefined
                }
                onChange={(checked) => {
                  if (checked) {
                    updateConfig({
                      layout_parser: {
                        mode: "local",
                        provider: "mineru-local",
                        use_gpu: true,
                        model_size: "auto",
                      },
                    });
                  } else {
                    updateConfig({ layout_parser: null });
                  }
                }}
                size="small"
              />
            }
          >
            {ocrConfig?.layout_parser && (
              <>
                <Radio.Group
                  value={ocrConfig?.layout_parser?.mode || "local"}
                  onChange={(e) => {
                    const mode = e.target.value;
                    updateConfig({
                      layout_parser: {
                        ...(ocrConfig?.layout_parser || {}),
                        mode,
                        ...(mode === "local"
                          ? { provider: "", api_key: "", endpoint: "" }
                          : {}),
                      },
                    });
                  }}
                  style={{ width: "100%", marginBottom: 12 }}
                >
                  <Radio.Button value="local" style={{ flex: 1, textAlign: "center" }}>
                    <DesktopOutlined />{" "}
                    {t("documentTools.redaction.localDeployment", "本地部署")}
                  </Radio.Button>
                  <Radio.Button value="cloud_api" style={{ flex: 1, textAlign: "center" }}>
                    <CloudServerOutlined />{" "}
                    {t("documentTools.redaction.cloudApi", "云端 API")}
                  </Radio.Button>
                </Radio.Group>

                {(ocrConfig?.layout_parser?.mode || "local") === "local" ? (
                  /* ===== MINERU LOCAL CONFIG ===== */
                  <div>
                    <Alert
                      type="warning"
                      showIcon
                      icon={<WarningOutlined />}
                      message={t(
                        "documentTools.redaction.mineruLocalRequirements",
                        "MinerU 本地部署需要较强硬件：GPU ≥8GB VRAM (推荐)，首次运行下载 ~10GB 模型。CPU 模式极慢 (~30秒/页)。",
                      )}
                      style={{ marginBottom: 12 }}
                    />

                    <div style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                        {t("documentTools.redaction.modelSize", "模型大小")}
                      </Text>
                      <Select
                        value={ocrConfig?.layout_parser?.model_size || "auto"}
                        onChange={(val) =>
                          updateConfig({
                            layout_parser: {
                              ...(ocrConfig?.layout_parser || {}),
                              model_size: val,
                            },
                          })
                        }
                        style={{ width: "100%" }}
                        options={[
                          {
                            label: t(
                              "documentTools.redaction.autoSelect",
                              "自动（根据硬件选择）",
                            ),
                            value: "auto",
                          },
                          { label: "Small (~2GB VRAM, 较快)", value: "small" },
                          { label: "Medium (~6GB VRAM, 平衡)", value: "medium" },
                          { label: "Large (~10GB+ VRAM, 最准)", value: "large" },
                        ]}
                      />
                    </div>

                    <div>
                      <Switch
                        checked={ocrConfig?.layout_parser?.use_gpu !== false}
                        onChange={(checked) =>
                          updateConfig({
                            layout_parser: {
                              ...(ocrConfig?.layout_parser || {}),
                              use_gpu: checked,
                            },
                          })
                        }
                        size="small"
                      />
                      <Text style={{ marginLeft: 8, fontSize: 12 }}>
                        {t(
                          "documentTools.redaction.useGpuForMinerU",
                          "使用 GPU 加速（强烈推荐）",
                        )}
                      </Text>
                    </div>

                    <div style={{ fontSize: 11, color: "#666", marginTop: 8 }}>
                      💡{" "}
                      {t(
                        "documentTools.redaction.mineruInstallCommand",
                        "安装命令：pip install \"magic-pdf[full]\" (需要 Python 3.10+)",
                      )}
                    </div>
                  </div>
                ) : (
                  /* ===== MINERU CLOUD API CONFIG ===== */
                  <div>
                    <Alert
                      type="info"
                      showIcon
                      icon={<CloudServerOutlined />}
                      message={t(
                        "documentTools.redaction.mineruCloudDesc",
                        "使用 MinerU 云端 API 进行版面解析，无需本地 GPU，适合无高性能硬件的环境。",
                      )}
                      style={{ marginBottom: 12 }}
                    />

                    <div style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                        {t(
                          "documentTools.redaction.mineruCloudProvider",
                          "MinerU 云服务商",
                        )}
                      </Text>
                      <Select
                        value={ocrConfig?.layout_parser?.provider || "mineru-cloud"}
                        onChange={(val) => {
                          const defaultEndpoints: Record<string, string> = {
                            "mineru-cloud": "https://api.mineru.org",
                            custom: "",
                          };
                          updateConfig({
                            layout_parser: {
                              ...(ocrConfig?.layout_parser || {}),
                              provider: val,
                              endpoint: defaultEndpoints[val] || "",
                            },
                          });
                        }}
                        style={{ width: "100%" }}
                        options={[
                          {
                            label: "MinerU 官方云服务 (api.mineru.org)",
                            value: "mineru-cloud",
                          },
                          { label: "自定义端点 (私有化部署)", value: "custom" },
                        ]}
                      />
                    </div>

                    {ocrConfig?.layout_parser?.provider === "custom" && (
                      <div style={{ marginBottom: 8 }}>
                        <Input
                          placeholder="https://your-mineru-instance.com/api"
                          value={ocrConfig?.layout_parser?.endpoint}
                          onChange={(e) =>
                            updateConfig({
                              layout_parser: {
                                ...(ocrConfig?.layout_parser || {}),
                                endpoint: e.target.value,
                              },
                            })
                          }
                          addonBefore={<LinkOutlined />}
                        />
                      </div>
                    )}

                    <div style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                        {t("documentTools.redaction.apiKeyInput", "API 密钥")}
                      </Text>
                      <Input.Password
                        value={ocrConfig?.layout_parser?.api_key || ""}
                        onChange={(e) =>
                          updateConfig({
                            layout_parser: {
                              ...(ocrConfig?.layout_parser || {}),
                              api_key: e.target.value,
                            },
                          })
                        }
                        placeholder={t(
                          "documentTools.redaction.mineruApiKeyPlaceholder",
                          "输入 MinerU 云服务 API Key",
                        )}
                        style={{ width: "100%" }}
                      />
                    </div>

                    <div style={{ fontSize: 11, color: "#888" }}>
                      <InfoCircleOutlined style={{ marginRight: 4 }} />
                      {t(
                        "documentTools.redaction.mineruCloudNote",
                        "MinerU 云服务按文档页数计费，适合偶尔处理复杂版面的场景。日常简单文档可仅使用文字识别引擎。",
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {!ocrConfig?.layout_parser && (
              <div style={{ textAlign: "center", padding: "12px 0", color: "#999" }}>
                <TableOutlined style={{ fontSize: 24, marginBottom: 8, display: "block" }} />
                <div style={{ fontSize: 12 }}>
                  {t(
                    "documentTools.redaction.layoutParserDisabled",
                    "版面解析已禁用。启用后可处理复杂表格、双栏排版、公式等场景。",
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Common settings */}
          <Divider orientation="left" plain>
            {t("documentTools.redaction.commonSettings", "通用设置")}
          </Divider>

          <Row gutter={[12, 12]}>
            <Col span={12}>
              <div>
                <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  {t("documentTools.redaction.language", "识别语言")}
                </Text>
                <Select
                  value={ocrConfig?.language || "ch"}
                  onChange={(val) => updateConfig({ language: val })}
                  style={{ width: "100%" }}
                  options={[
                    { label: "中文 (推荐)", value: "ch" },
                    { label: "English", value: "en" },
                    { label: "中英混合", value: "ch_en" },
                  ]}
                />
              </div>
            </Col>
            <Col span={12}>
              <div>
                <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  DPI ({t("documentTools.redaction.imageQuality", "图像质量")})
                </Text>
                <InputNumber
                  value={ocrConfig?.dpi || 300}
                  onChange={(val) => {
                    if (val && val >= 72 && val <= 600) {
                      updateConfig({ dpi: parseInt(String(val)) });
                    }
                  }}
                  min={72}
                  max={600}
                  style={{ width: "100%" }}
                  addonAfter="DPI"
                />
              </div>
            </Col>
          </Row>

          {/* Confidence threshold */}
          <Row gutter={[12, 12]}>
            <Col span={12}>
              <div>
                <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  {t(
                    "documentTools.ocr.confidenceThreshold",
                    "置信度阈值",
                  )}
                </Text>
                <InputNumber
                  value={ocrConfig?.confidence_threshold ?? 0.5}
                  onChange={(val) => {
                    if (val !== null && val >= 0 && val <= 1) {
                      updateConfig({ confidence_threshold: val });
                    }
                  }}
                  min={0}
                  max={1}
                  step={0.05}
                  style={{ width: "100%" }}
                />
              </div>
            </Col>
            <Col span={12}>
              <div>
                <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  {t("documentTools.ocr.maxWorkers", "并行工作线程")}
                </Text>
                <InputNumber
                  value={ocrConfig?.max_workers ?? 2}
                  onChange={(val) => {
                    if (val && val >= 1 && val <= 16) {
                      updateConfig({ max_workers: parseInt(String(val)) });
                    }
                  }}
                  min={1}
                  max={16}
                  style={{ width: "100%" }}
                />
              </div>
            </Col>
          </Row>

          {/* Fallback option */}
          <div>
            <Switch
              checked={ocrConfig?.fallback_to_cloud || false}
              onChange={(checked) => updateConfig({ fallback_to_cloud: checked })}
              size="small"
            />
            <Text style={{ marginLeft: 8, fontSize: 12 }}>
              {t(
                "documentTools.redaction.autoFallbackToCloud",
                "本地引擎失败时自动切换到云端 API",
              )}
            </Text>
          </div>

          {/* Config file path */}
          {loading === false && (
            <div style={{ fontSize: 11, color: "#999" }}>
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              {t(
                "documentTools.ocr.configPersisted",
                "配置持久化保存在 ~/.aiarb/ocr_config.json，修改后立即生效。",
              )}
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
}
