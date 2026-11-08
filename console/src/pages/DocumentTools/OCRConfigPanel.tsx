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
  Row,
  Col,
  Spin,
  message,
  Typography,
  Collapse,
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
  RocketOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { documentToolsApi } from "../../api/modules/documentTools";

const { Text } = Typography;

/**
 * OCR Config Panel — simplified, user-friendly configuration.
 *
 * Design principles (inspired by legalwork):
 *   - Clean card-based layout with clear visual hierarchy
 *   - Radio buttons that actually work (no flex layout issues)
 *   - Switch toggles that are always clickable
 *   - Graceful error handling — never block the UI
 *   - Auto-install only on explicit user action (not on page load)
 */
export default function OCRConfigPanel() {
  const { t } = useTranslation();

  const [ocrConfig, setOcrConfig] = useState<any>(null);
  const [ocrEngines, setOcrEngines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // -- Data loading --
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await documentToolsApi.getOCRConfig();
      setOcrConfig(data.config);
      setOcrEngines(data.available_engines || []);
    } catch (err: any) {
      setLoadError(
        err?.message ||
          t("documentTools.ocr.loadFailed", "加载 OCR 配置失败，请检查后端服务是否正常运行"),
      );
      // Set default config so UI is still usable
      setOcrConfig({
        text_engine: { mode: "local", provider: "auto", use_gpu: true },
        layout_parser: null,
        language: "ch",
        confidence_threshold: 0.5,
        dpi: 300,
        max_workers: 2,
        enable_ocr: true,
        fallback_to_cloud: false,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // -- Helper: update config and refresh (optimistic) --
  const updateConfig = useCallback(
    async (patch: Record<string, any>) => {
      // Optimistic: update local state immediately so UI never feels stuck
      setOcrConfig((prev: any) => {
        if (!prev) return patch;
        const next = { ...prev };
        for (const [key, val] of Object.entries(patch)) {
          if (val && typeof val === "object" && !Array.isArray(val)) {
            next[key] = { ...(prev[key] || {}), ...val };
          } else {
            next[key] = val;
          }
        }
        return next;
      });
      setSaving(true);
      try {
        await documentToolsApi.updateOCRConfig(patch);
        // Refresh config from server to get canonical state
        const data = await documentToolsApi.getOCRConfig();
        setOcrConfig(data.config);
        setOcrEngines(data.available_engines || []);
      } catch (err: any) {
        // Show error but don't block — local state is already updated
        message.warning(
          err?.message || t("documentTools.ocr.saveFailed", "保存失败，配置已更新但可能需要重启后端"),
        );
        // Refresh to get server's actual state
        try {
          const data = await documentToolsApi.getOCRConfig();
          setOcrConfig(data.config);
          setOcrEngines(data.available_engines || []);
        } catch {
          // Keep optimistic state if refresh also fails
        }
      } finally {
        setSaving(false);
      }
    },
    [t],
  );

  // -- Manual install handler --
  const handleInstall = useCallback(
    async (engine: string) => {
      setInstalling(true);
      setInstallError(null);
      message.info(
        t(
          "documentTools.ocr.installing",
          "正在安装 OCR 引擎...（已根据网络自动选择镜像源）",
        ),
      );
      try {
        const result = await documentToolsApi.installOCREngines(engine);
        if (result.success) {
          message.success(
            t("documentTools.ocr.installSuccess", "OCR 引擎安装成功！") +
              (result.mirror_used ? "（已使用国内镜像源）" : ""),
          );
          // Refresh config to show newly installed engines
          const data = await documentToolsApi.getOCRConfig();
          setOcrConfig(data.config);
          setOcrEngines(data.available_engines || []);
        } else {
          const errMsg =
            result.stderr_tail ||
            t("documentTools.ocr.installFailed", "安装失败，请检查网络或手动安装");
          setInstallError(errMsg);
          message.error(
            t("documentTools.ocr.installFailed", "安装失败：") + errMsg,
          );
        }
      } catch (err: any) {
        const errMsg =
          err?.message ||
          t("documentTools.ocr.installFailed", "安装失败，请检查网络");
        setInstallError(errMsg);
        message.error(errMsg);
      } finally {
        setInstalling(false);
      }
    },
    [t],
  );

  if (loading && !ocrConfig) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin tip={t("common.loading", "加载中...")}><div /></Spin>
      </div>
    );
  }

  const ocrEnabled = ocrConfig?.enable_ocr !== false;
  const textMode = ocrConfig?.text_engine?.mode || "local";
  const layoutEnabled = ocrConfig?.layout_parser != null;
  const layoutMode = ocrConfig?.layout_parser?.mode || "local";

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      {loadError && (
        <Alert
          type="warning"
          showIcon
          message={loadError}
          description={t(
            "documentTools.ocr.loadErrorDesc",
            "后端 OCR 模块可能未正确安装。您可以尝试一键安装，或使用云端 API 模式。",
          )}
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" onClick={() => loadConfig()}>
              {t("common.retry", "重试")}
            </Button>
          }
        />
      )}

      {installError && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setInstallError(null)}
          message={t("documentTools.ocr.installFailedTitle", "OCR 引擎安装失败")}
          description={
            <div>
              <Text style={{ fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", display: "block", maxHeight: 120, overflow: "auto" }}>
                {installError}
              </Text>
              <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: "block" }}>
                {t(
                  "documentTools.ocr.manualInstallHint",
                  "您也可以在终端中手动执行：pip install paddlepaddle paddleocr",
                )}
              </Text>
            </div>
          }
          style={{ marginBottom: 16 }}
        />
      )}

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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <Text strong style={{ fontSize: 15 }}>
                {t("documentTools.redaction.globalOcrToggle", "OCR 总开关")}
              </Text>
              <div style={{ fontSize: 13, color: "#999" }}>
                {t(
                  "documentTools.ocr.globalToggleDesc",
                  "关闭后，图片和扫描件将无法识别文字",
                )}
              </div>
            </div>
            <Switch
              checked={ocrEnabled}
              onChange={(checked) => updateConfig({ enable_ocr: checked })}
              loading={saving}
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
                  {t("documentTools.redaction.textRecognition", "1. 文字识别引擎")}
                </span>
                <Tag color="blue">
                  {t("documentTools.redaction.required", "必需")}
                </Tag>
              </Space>
            }
            style={{ background: "#fafafa" }}
          >
            {/* Mode selector — use Radio.Group with buttonStyle="solid" for reliable clicking */}
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>
                {t("documentTools.redaction.engineMode", "引擎模式")}
              </Text>
              <Radio.Group
                value={textMode}
                onChange={(e) => {
                  const mode = e.target.value;
                  updateConfig({
                    text_engine: {
                      ...(ocrConfig?.text_engine || {}),
                      mode,
                      ...(mode === "local"
                        ? { provider: "", api_key: "", endpoint: "" }
                        : {}),
                    },
                  });
                }}
                buttonStyle="solid"
                disabled={saving}
              >
                <Radio.Button value="local">
                  <DesktopOutlined /> {t("documentTools.redaction.localDeployment", "本地部署")}
                </Radio.Button>
                <Radio.Button value="cloud_api">
                  <CloudServerOutlined /> {t("documentTools.redaction.cloudApi", "云端 API")}
                </Radio.Button>
              </Radio.Group>
            </div>

            {textMode === "local" ? (
              /* ===== LOCAL ENGINE CONFIG ===== */
              <div>
                <Alert
                  type="info"
                  showIcon
                  icon={<DesktopOutlined />}
                  message={t(
                    "documentTools.redaction.localEngineDesc",
                    "在本地电脑上运行，数据不出本机，安全但需要足够硬件",
                  )}
                  style={{ marginBottom: 12 }}
                />

                {/* Local engine selection */}
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 14, display: "block", marginBottom: 6 }}>
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
                    disabled={saving}
                    options={[
                      {
                        label: t("documentTools.redaction.autoDetectBest", "自动选择最佳（推荐）"),
                        value: "auto",
                      },
                      { label: "MiniCPM-V (AI 智能识别，准确率最高)", value: "minicpm" },
                      { label: "PaddleOCR (中文最优，需 ~3GB 磁盘)", value: "paddleocr" },
                      { label: "EasyOCR (多语言，需 ~500MB)", value: "easyocr" },
                      { label: "Tesseract (最快最轻，~50MB)", value: "tesseract" },
                    ]}
                  />
                </div>

                {/* GPU toggle */}
                <div style={{ marginBottom: 12 }}>
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
                    disabled={saving}
                  />
                  <Text style={{ marginLeft: 8, fontSize: 13 }}>
                    {t("documentTools.redaction.useGpuAcceleration", "GPU 加速（推荐，速度更快）")}
                  </Text>
                </div>

                {/* Installation status */}
                {ocrEngines.length > 0 ? (
                  <Alert
                    type="success"
                    showIcon
                    icon={<CheckCircleFilled />}
                    message={`${t("documentTools.ocr.installedEngines", "已安装引擎")}: ${ocrEngines.join(", ")}`}
                    style={{ marginBottom: 8 }}
                  />
                ) : installing ? (
                  <Alert
                    type="info"
                    showIcon
                    icon={<LoadingOutlined />}
                    message={t("documentTools.ocr.installing", "正在安装 OCR 引擎...")}
                    style={{ marginBottom: 8 }}
                  />
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    icon={<WarningOutlined />}
                    message={t(
                      "documentTools.ocr.noEngineDetected",
                      "未检测到 OCR 引擎，请点击下方按钮安装",
                    )}
                    style={{ marginBottom: 8 }}
                  />
                )}

                {/* Install buttons */}
                <Space wrap>
                  <Button
                    type="primary"
                    loading={installing}
                    onClick={() => handleInstall("auto")}
                    style={{ fontSize: 15, height: 40 }}
                  >
                    {t("documentTools.ocr.installNow", "一键安装 PaddleOCR（推荐）")}
                  </Button>
                  <Button loading={installing} onClick={() => handleInstall("minicpm")} style={{ fontSize: 14, height: 40 }}>
                    MiniCPM-V (AI)
                  </Button>
                  <Button loading={installing} onClick={() => handleInstall("paddleocr")} style={{ fontSize: 14, height: 40 }}>
                    PaddleOCR
                  </Button>
                  <Button loading={installing} onClick={() => handleInstall("easyocr")} style={{ fontSize: 14, height: 40 }}>
                    EasyOCR
                  </Button>
                  <Button loading={installing} onClick={() => handleInstall("tesseract")} style={{ fontSize: 14, height: 40 }}>
                    Tesseract (含二进制)
                  </Button>
                </Space>

                {/* Engine status hints */}
                <div style={{ marginTop: 12, fontSize: 12, color: "#888", lineHeight: 1.8 }}>
                  <div>
                    <CheckCircleFilled style={{ color: ocrEngines.includes("minicpm") ? "#52c41a" : "#d9d9d9", marginRight: 6 }} />
                    MiniCPM-V: {ocrEngines.includes("minicpm")
                      ? "已安装（AI 智能识别，推荐用于扫描件/手写/印章）"
                      : "未安装（需 torch + transformers，约 4GB 模型，首次运行自动下载）"}
                  </div>
                  <div>
                    <CheckCircleFilled style={{ color: ocrEngines.includes("paddleocr") ? "#52c41a" : "#d9d9d9", marginRight: 6 }} />
                    PaddleOCR: {ocrEngines.includes("paddleocr")
                      ? "已安装（中文最优）"
                      : "未安装（需 paddlepaddle + paddleocr + paddlex，约 3GB）"}
                  </div>
                  <div>
                    <CheckCircleFilled style={{ color: ocrEngines.includes("easyocr") ? "#52c41a" : "#d9d9d9", marginRight: 6 }} />
                    EasyOCR: {ocrEngines.includes("easyocr")
                      ? "已安装（多语言支持）"
                      : "未安装（需 easyocr，约 500MB）"}
                  </div>
                  <div>
                    <CheckCircleFilled style={{ color: ocrEngines.includes("tesseract") ? "#52c41a" : "#d9d9d9", marginRight: 6 }} />
                    Tesseract: {ocrEngines.includes("tesseract")
                      ? "已安装（最轻最快）"
                      : "未安装（点击按钮自动安装 Python 库 + Windows 二进制程序）"}
                  </div>
                  {!ocrEngines.includes("minicpm") && !ocrEngines.includes("paddleocr") && !ocrEngines.includes("easyocr") && !ocrEngines.includes("tesseract") && (
                    <div style={{ marginTop: 8, padding: "8px 12px", background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 6 }}>
                      <InfoCircleOutlined style={{ color: "#52c41a", marginRight: 6 }} />
                      <span style={{ color: "#389e0d" }}>
                        无需安装本地引擎也可使用 OCR：切换到「云端 API」模式，填写 API 密钥即可。推荐百度 OCR（国内首选）或 OCR.space（免费 500 次/月）。
                      </span>
                    </div>
                  )}
                </div>
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
                    "使用云端识别服务，无需本地硬件，按次付费，数据经网络传输",
                  )}
                  style={{ marginBottom: 12 }}
                />

                {/* Cloud provider selection */}
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 14, display: "block", marginBottom: 6 }}>
                    {t("documentTools.redaction.selectCloudProvider", "选择云服务商")}
                  </Text>
                  <Select
                    value={ocrConfig?.text_engine?.provider || "ocr-space"}
                    onChange={(val) => {
                      const defaultEndpoints: Record<string, string> = {
                        "ocr-space": "https://api.ocr.space",
                        "baidu-ocr": "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic",
                        "tencent-ocr": "https://ocr.tencentcloudapi.com/",
                        "mineru-cloud": "https://mineru.net",
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
                    disabled={saving}
                    options={[
                      { label: "OCR.space（免费 500次/月，适合少量文档）", value: "ocr-space" },
                      { label: "百度智能云 OCR（国内速度快，推荐）", value: "baidu-ocr" },
                      { label: "腾讯云 OCR（表格识别能力强）", value: "tencent-ocr" },
                      { label: "MinerU 云端（mineru.net，版面解析最强）", value: "mineru-cloud" },
                      { label: "自定义 API 端点", value: "custom" },
                    ]}
                  />
                </div>

                {/* Custom endpoint */}
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
                      disabled={saving}
                    />
                  </div>
                )}

                {/* API Key input */}
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 14, display: "block", marginBottom: 6 }}>
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
                    disabled={saving}
                  />
                </div>

                <div style={{ fontSize: 12, color: "#888" }}>
                  <InfoCircleOutlined style={{ marginRight: 4 }} />
                  {t(
                    "documentTools.redaction.costWarning",
                    "费用参考：约 ¥0.01-0.07/页，批量处理建议购买套餐",
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
                  {t("documentTools.redaction.layoutParsing", "2. 版面解析引擎")}
                </span>
                <Tag color="purple">
                  {t("documentTools.redaction.optional", "可选增强")}
                </Tag>
              </Space>
            }
            style={{ background: "#fafafa" }}
          >
            {/* Enable/disable toggle — placed in the card body, not in `extra`, to ensure clickability */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: layoutEnabled ? 12 : 0 }}>
              <div>
                <Text strong style={{ fontSize: 15 }}>
                  {t("documentTools.redaction.enableLayoutParser", "启用版面解析")}
                </Text>
                <div style={{ fontSize: 14, color: "#999", lineHeight: 1.6 }}>
                  {t(
                    "documentTools.redaction.layoutParserDesc",
                    "处理复杂表格、双栏排版、公式等。日常简单文档无需启用。开启后可使用 MinerU 进行智能版面解析。",
                  )}
                </div>
              </div>
              <Switch
                checked={layoutEnabled}
                onChange={(checked) => {
                  if (checked) {
                    updateConfig({
                      layout_parser: {
                        mode: "cloud_api",
                        provider: "mineru-cloud",
                        endpoint: "https://mineru.net",
                        use_gpu: true,
                        model_size: "auto",
                      },
                    });
                  } else {
                    updateConfig({ layout_parser: null });
                  }
                }}
                loading={saving}
              />
            </div>

            {layoutEnabled && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>
                    {t("documentTools.redaction.engineMode", "引擎模式")}
                  </Text>
                  <Radio.Group
                    value={layoutMode}
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
                    buttonStyle="solid"
                    disabled={saving}
                  >
                    <Radio.Button value="local">
                      <DesktopOutlined /> {t("documentTools.redaction.localDeployment", "本地部署")}
                    </Radio.Button>
                    <Radio.Button value="cloud_api">
                      <CloudServerOutlined /> {t("documentTools.redaction.cloudApi", "云端 API")}
                    </Radio.Button>
                  </Radio.Group>
                </div>

                {layoutMode === "local" ? (
                  /* ===== MINERU LOCAL CONFIG ===== */
                  <div>
                <Alert
                  type="info"
                  showIcon
                  icon={<InfoCircleOutlined />}
                  message={t(
                    "documentTools.redaction.mineruLocalRequirements",
                    "MinerU 本地部署说明",
                  )}
                  description={
                    <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                      <div>· 本地运行需要较强硬件：<Text strong>显卡 ≥8GB 显存</Text>，内存 16GB+，磁盘 ~10GB</div>
                      <div>· 首次运行需下载模型文件（约 10GB），之后可直接离线使用</div>
                      <div>· 数据完全不出本机，适合涉密卷宗</div>
                      <div>· 安装命令：<Text code>pip install mineru</Text>（原 magic-pdf 已更名）</div>
                      <div style={{ marginTop: 6, color: "#1677ff" }}>
                        <InfoCircleOutlined style={{ marginRight: 4 }} />
                        如果您的电脑配置不够，推荐使用右侧「云端 API」模式，无需安装任何软件
                      </div>
                    </div>
                  }
                  style={{ marginBottom: 12 }}
                />

                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 14, display: "block", marginBottom: 4 }}>
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
                        disabled={saving}
                        options={[
                          { label: t("documentTools.redaction.autoSelect", "自动（根据硬件选择）"), value: "auto" },
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
                        disabled={saving}
                      />
                    <Text style={{ marginLeft: 8, fontSize: 13 }}>
                      {t("documentTools.redaction.useGpuForMinerU", "GPU 加速（强烈推荐）")}
                    </Text>
                    </div>

                    <div style={{ fontSize: 13, color: "#666", marginTop: 8, lineHeight: 1.6 }}>
                      {t(
                        "documentTools.redaction.mineruInstallCommand",
                        "如需手动安装，请在终端执行：pip install mineru",
                      )}
                    </div>
                  </div>
                ) : (
                  /* ===== MINERU CLOUD API CONFIG ===== */
                  <div>
                  <Alert
                  type="success"
                  showIcon
                  icon={<RocketOutlined />}
                  message={t(
                    "documentTools.redaction.mineruCloudDesc",
                    "MinerU 云端 API — 推荐方案",
                  )}
                  description={
                    <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                      <div>· 无需安装任何软件，无需 GPU，打开浏览器即可使用</div>
                      <div>· 访问 <a href="https://mineru.net" target="_blank" rel="noopener noreferrer" style={{ color: "#1677ff" }}>mineru.net</a> 注册账号并获取 API Token</div>
                      <div>· 支持四种解析层级：Flash（秒级）、Basic（OCR）、Standard（标准）、Advanced（精细）</div>
                      <div>· 适合处理复杂表格、双栏排版、扫描件等难解析文档</div>
                      <div style={{ marginTop: 6, color: "#52c41a" }}>
                        <CheckCircleFilled style={{ marginRight: 4 }} />
                        最适合仲裁员：无需懂技术，注册即用
                      </div>
                    </div>
                  }
                  style={{ marginBottom: 12 }}
                />

                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 14, display: "block", marginBottom: 6 }}>
                    {t("documentTools.redaction.mineruCloudProvider", "云服务商")}
                  </Text>
                  <Select
                    value={ocrConfig?.layout_parser?.provider || "mineru-cloud"}
                    onChange={(val) => {
                      const defaultEndpoints: Record<string, string> = {
                        "mineru-cloud": "https://mineru.net",
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
                    disabled={saving}
                    options={[
                      { label: "MinerU 官方云服务 (mineru.net) — 推荐", value: "mineru-cloud" },
                      { label: "自定义端点（私有化部署）", value: "custom" },
                    ]}
                  />
                </div>

                {/* MinerU 解析层级选择 */}
                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 14, display: "block", marginBottom: 6 }}>
                    解析层级（质量越高越慢）
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
                    disabled={saving}
                    options={[
                      { label: "Flash — 极速预览（秒级，适合快速浏览）", value: "flash" },
                      { label: "Basic — OCR 基础解析（适合一般文档）", value: "basic" },
                      { label: "Standard — 标准解析（适合复杂表格、双栏）", value: "standard" },
                      { label: "Advanced — 精细解析（最准，速度较慢）", value: "advanced" },
                      { label: "自动选择（推荐）", value: "auto" },
                    ]}
                  />
                </div>

                    {ocrConfig?.layout_parser?.provider === "custom" && (
                      <div style={{ marginBottom: 12 }}>
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
                          disabled={saving}
                        />
                      </div>
                    )}

                    <div style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 14, display: "block", marginBottom: 6 }}>
                        API Token（访问密钥）
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
                          "输入从 mineru.net 获取的 API Token",
                        )}
                        style={{ width: "100%", height: 40, fontSize: 15 }}
                        disabled={saving}
                      />
                      <div style={{ fontSize: 13, color: "#999", marginTop: 6, lineHeight: 1.6 }}>
                        <InfoCircleOutlined style={{ marginRight: 4 }} />
                        获取方式：访问 <a href="https://mineru.net" target="_blank" rel="noopener noreferrer" style={{ color: "#1677ff" }}>mineru.net</a> →
                        登录 → 个人中心 → API Token → 复制
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {!layoutEnabled && (
              <div style={{ textAlign: "center", padding: "8px 0", color: "#999" }}>
                <TableOutlined style={{ fontSize: 24, marginBottom: 8, display: "block" }} />
                <div style={{ fontSize: 12 }}>
                  {t("documentTools.redaction.layoutParserDisabled", "版面解析未启用。启用后可处理复杂表格、双栏排版、公式等。")}
                </div>
              </div>
            )}
          </Card>

          {/* Common settings — collapsible */}
          <Collapse
            size="small"
            items={[
              {
                key: "common",
                label: t("documentTools.redaction.commonSettings", "通用设置"),
                children: (
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
                          disabled={saving}
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
                          disabled={saving}
                        />
                      </div>
                    </Col>
                    <Col span={12}>
                      <div>
                        <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                          {t("documentTools.ocr.confidenceThreshold", "置信度阈值")}
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
                          disabled={saving}
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
                          disabled={saving}
                        />
                      </div>
                    </Col>
                  </Row>
                ),
              },
            ]}
          />

          {/* Fallback option */}
          <div>
            <Switch
              checked={ocrConfig?.fallback_to_cloud || false}
              onChange={(checked) => updateConfig({ fallback_to_cloud: checked })}
              size="small"
              disabled={saving}
            />
                    <Text style={{ marginLeft: 8, fontSize: 13 }}>
                      {t("documentTools.redaction.autoFallbackToCloud", "本地失败时自动切换到云端")}
                    </Text>
          </div>

          {/* Config file path */}
          {loadError === null && (
            <div style={{ fontSize: 12, color: "#999" }}>
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              {t(
                "documentTools.ocr.configPersisted",
                "配置保存在本地，修改后立即生效。",
              )}
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
}
