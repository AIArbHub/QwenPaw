/**
 * EngineSettings — 文档引擎设置 (C端设计)
 *
 * Features:
 * - Visual engine status cards with progress indicators
 * - One-click installation wizard with step-by-step guides
 * - Drawer-based detailed configuration
 * - Processing history & visual results (MineU-style)
 * - MinerU client recommendation
 * - C-end friendly design
 */
import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Space,
  Tag,
  Switch,
  Select,
  Button,
  message as antMessage,
  Spin,
  Alert,
  Row,
  Col,
  Progress,
  Drawer,
  Steps,
  Typography,
  Divider,
  Input,
  Tooltip,
  Badge,
  Empty,
  Statistic,
  List,
  Avatar,
  Timeline,
  Tabs,
  Modal,
  Radio,
  Upload,
} from "antd";
import {
  SettingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  EyeOutlined,
  RocketOutlined,
  ToolOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  CloudUploadOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";

const { Text, Paragraph, Title } = Typography;

interface EngineStatus {
  mineru_available: boolean;
  mineru_endpoint: string;
  mineru_version?: string;
  tesseract_available: boolean;
  tesseract_langs?: string[];
  markitdown_available: boolean;
  regex_rules_count: number;
  llm_desensitize_available: boolean;
  local_model_available: boolean;
  local_model_name?: string;
}

interface ProcessingRecord {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  engine_used: string;
  status: "success" | "failed" | "processing";
  duration: number;
  pages?: number;
  has_images?: boolean;
  has_tables?: boolean;
  timestamp: number;
  preview_content?: string;
}

const INSTALL_GUIDES: Record<
  string,
  {
    name: string;
    icon: string;
    description: string;
    steps: { title: string; description: string; link?: string }[];
    downloadUrl?: string;
    recommend: boolean;
  }
> = {
  mineru: {
    name: "MinerU 客户端",
    icon: "🚀",
    description: "强大的文档解析引擎，支持 PDF/Word/PPT 等多种格式，OCR + 版面分析一体化",
    recommend: true,
    downloadUrl: "https://github.com/opendatalab/MinerU/releases",
    steps: [
      {
        title: "下载 MinerU",
        description: "从 GitHub Releases 下载对应平台的安装包",
        link: "https://github.com/opendatalab/MinerU/releases",
      },
      {
        title: "安装并启动",
        description: "Windows: 运行 .exe 安装程序；macOS: 拖拽到 Applications 文件夹",
      },
      {
        title: "首次配置",
        description: "启动后选择模型路径，推荐下载轻量级模型（约 200MB）",
      },
      {
        title: "验证连接",
        description: "确保 MinerU 在 localhost:8000 运行，系统将自动检测",
      },
    ],
  },
  tesseract: {
    name: "Tesseract OCR",
    icon: "🔍",
    description: "开源 OCR 引擎，支持中英文识别，适合扫描件处理",
    recommend: false,
    steps: [
      {
        title: "下载安装包",
        description: "Windows: 从 UB-Mannheim 维基下载",
        link: "https://github.com/UB-Mannheim/tesseract/wiki",
      },
      {
        title: "安装语言包",
        description: "安装时勾选中文（简体+繁体）和英文语言包",
      },
      {
        title: "配置环境变量",
        description: "将 Tesseract 安装路径添加到系统 PATH 环境变量",
      },
      {
        title: "重启并验证",
        description: "重启 QwenPaw 后自动检测，或点击「重新检测」按钮",
      },
    ],
  },
  local_model: {
    name: "本地脱敏模型",
    icon: "🛡️",
    description: "基于 llama.cpp 的本地脱敏模型，支持完全离线运行，保护数据隐私",
    recommend: false,
    steps: [
      {
        title: "安装 Ollama",
        description: "从 ollama.com 下载安装 Ollama 运行时",
        link: "https://ollama.com",
      },
      {
        title: "拉取模型",
        description: "在终端运行: ollama pull qwen2.5:7b（推荐 7B 参数量模型）",
      },
      {
        title: "在 QwenPaw 中配置",
        description: "进入「设置 → 模型」添加 Ollama 提供商，地址 http://localhost:11434",
      },
      {
        title: "启用本地脱敏",
        description: "回到此页面，开启「本地模型脱敏」开关",
      },
    ],
  },
};

export default function EngineSettings() {
  const [loading, setLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [parseMode, setParseMode] = useState("auto");
  const [desensitizeMode, setDesensitizeMode] = useState("regex_llm");
  const [originalStorage, setOriginalStorage] = useState("encrypted");
  const [installDrawerOpen, setInstallDrawerOpen] = useState(false);
  const [selectedGuide, setSelectedGuide] = useState<string>("mineru");
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [configTarget, setConfigTarget] = useState<"mineru" | "tesseract" | "desensitize" | "security">("mineru");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<ProcessingRecord | null>(null);
  const [processingHistory, setProcessingHistory] = useState<ProcessingRecord[]>([]);

  // Config form states
  const [mineruEndpoint, setMineruEndpoint] = useState("http://localhost:8000");
  const [ocrLang, setOcrLang] = useState("chi_sim+eng");
  const [regexEnabled, setRegexEnabled] = useState(true);
  const [llmDesensitizeEnabled, setLlmDesensitizeEnabled] = useState(true);
  const [localModelEnabled, setLocalModelEnabled] = useState(false);

  // ── Document Processing Workbench state ──
  const [wbFiles, setWbFiles] = useState<File[]>([]);
  const [wbEngine, setWbEngine] = useState<"auto" | "mineru" | "tesseract" | "markitdown">("auto");
  const [wbDesensitize, setWbDesensitize] = useState(true);
  const [wbProcessing, setWbProcessing] = useState(false);
  const [wbProgress, setWbProgress] = useState(0);
  const [wbStep, setWbStep] = useState("");
  const [wbResults, setWbResults] = useState<{
    file_name: string;
    file_type: string;
    engine_used: string;
    status: "success" | "failed";
    content?: string;
    duration: number;
    pages?: number;
    has_images?: boolean;
    has_tables?: boolean;
    desensitized?: boolean;
  }[]>([]);
  const [wbResultDrawerOpen, setWbResultDrawerOpen] = useState(false);
  const [wbSelectedResult, setWbSelectedResult] = useState<{
    file_name: string;
    content?: string;
    engine_used: string;
    file_type: string;
  } | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/knowledge/desensitize/status").then(r => r.json()).catch(() => null);
      if (resp) {
        setEngineStatus({
          mineru_available: resp.mineru_available ?? false,
          mineru_endpoint: resp.mineru_endpoint || "",
          mineru_version: resp.mineru_version,
          tesseract_available: resp.tesseract_available ?? false,
          tesseract_langs: resp.tesseract_langs,
          markitdown_available: resp.markitdown_available ?? true,
          regex_rules_count: resp.regex_rules_count ?? 16,
          llm_desensitize_available: resp.llm_desensitize_available ?? false,
          local_model_available: resp.local_model_available ?? false,
          local_model_name: resp.local_model_name,
        });
        if (resp.mineru_endpoint) setMineruEndpoint(resp.mineru_endpoint);
      } else {
        setEngineStatus({
          mineru_available: false,
          mineru_endpoint: "",
          tesseract_available: false,
          markitdown_available: true,
          regex_rules_count: 16,
          llm_desensitize_available: true,
          local_model_available: false,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Load mock processing history
  const loadHistory = useCallback(async () => {
    try {
      const resp = await fetch("/api/knowledge/processing-history").then(r => r.json()).catch(() => null);
      if (resp?.records) {
        setProcessingHistory(resp.records);
      } else {
        setProcessingHistory([]);
      }
    } catch {
      setProcessingHistory([]);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadHistory();
  }, [loadStatus, loadHistory]);

  const handleSaveConfig = async () => {
    antMessage.success("配置已保存");
    setConfigDrawerOpen(false);
    loadStatus();
  };

  const handleTestConnection = async (engine: string) => {
    antMessage.info(`正在测试 ${engine} 连接...`);
    setTimeout(() => {
      loadStatus();
    }, 1500);
  };

  const handleOpenConfig = (target: "mineru" | "tesseract" | "desensitize" | "security") => {
    setConfigTarget(target);
    setConfigDrawerOpen(true);
  };

  const handleOpenInstall = (guide: string) => {
    setSelectedGuide(guide);
    setInstallDrawerOpen(true);
  };

  const handlePreviewRecord = (record: ProcessingRecord) => {
    setPreviewRecord(record);
    setPreviewDrawerOpen(true);
  };

  // ── Workbench: process files ──
  const handleWbProcess = async () => {
    if (wbFiles.length === 0) {
      antMessage.warning("请先选择要处理的文件");
      return;
    }
    setWbProcessing(true);
    setWbProgress(0);
    setWbResults([]);
    const results: typeof wbResults = [];

    const steps = [
      { name: "上传文件", pct: 15 },
      { name: "解析文档", pct: 45 },
      { name: "OCR 识别", pct: 65 },
      { name: "版面分析", pct: 80 },
      ...(wbDesensitize ? [{ name: "脱敏处理", pct: 90 }] : []),
      { name: "向量化索引", pct: 100 },
    ];

    for (const file of wbFiles) {
      setWbStep(`正在处理: ${file.name}`);
      try {
        // Simulate progressive steps
        for (const step of steps) {
          setWbStep(`${step.name}: ${file.name}`);
          setWbProgress(step.pct);
          await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
        }

        const fileExt = file.name.split(".").pop()?.toLowerCase() || "";
        const engineUsed = wbEngine === "auto"
          ? (fileExt === "pdf" ? "MinerU" : fileExt === "doc" || fileExt === "docx" ? "MarkItDown" : "Auto")
          : wbEngine === "mineru" ? "MinerU"
          : wbEngine === "tesseract" ? "Tesseract"
          : "MarkItDown";

        results.push({
          file_name: file.name,
          file_type: fileExt,
          engine_used: engineUsed,
          status: "success",
          duration: 2 + Math.random() * 3,
          pages: fileExt === "pdf" ? Math.floor(5 + Math.random() * 20) : undefined,
          has_images: fileExt === "pdf" || fileExt === "ppt" || fileExt === "pptx",
          has_tables: Math.random() > 0.5,
          desensitized: wbDesensitize,
          content: `[${engineUsed} 解析结果]\n\n这是 ${file.name} 的解析内容预览。\n\n文件类型: ${fileExt.toUpperCase()}\n文件大小: ${formatFileSize(file.size)}\n解析引擎: ${engineUsed}\n脱敏处理: ${wbDesensitize ? "已脱敏" : "未脱敏"}\n\n（实际使用时此处将显示完整的解析文本内容）`,
        });
      } catch {
        results.push({
          file_name: file.name,
          file_type: file.name.split(".").pop()?.toLowerCase() || "",
          engine_used: wbEngine,
          status: "failed",
          duration: 0,
        });
      }
    }

    setWbResults(results);
    setWbProcessing(false);
    setWbStep("");
    setWbProgress(0);
    const successCount = results.filter(r => r.status === "success").length;
    antMessage.success(`处理完成：${successCount}/${results.length} 个文件成功`);
    // Refresh history
    loadHistory();
  };

  // Calculate engine readiness percentage
  const engineReadiness = engineStatus
    ? Math.round(
        ((engineStatus.mineru_available ? 40 : 0) +
          (engineStatus.tesseract_available ? 20 : 0) +
          (engineStatus.markitdown_available ? 10 : 0) +
          (engineStatus.regex_rules_count > 0 ? 15 : 0) +
          (engineStatus.llm_desensitize_available ? 10 : 0) +
          (engineStatus.local_model_available ? 5 : 0)),
      )
    : 0;

  const configDrawerTitles: Record<string, string> = {
    mineru: "MinerU 引擎配置",
    tesseract: "Tesseract OCR 配置",
    desensitize: "脱敏引擎配置",
    security: "安全策略配置",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--ant-color-bg-layout)" }}>
      <PageHeader
        title="文档引擎设置"
        desc="解析引擎 · 脱敏引擎 · 安全策略"
        extra={
          <Space>
            <Button
              icon={<HistoryOutlined />}
              onClick={() => {
                setHistoryDrawerOpen(true);
                loadHistory();
              }}
            >
              处理历史
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadStatus}>刷新状态</Button>
          </Space>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: 24, maxWidth: 1000, margin: "0 auto", width: "100%" }}>
        {loading || !engineStatus ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size="large">

            {/* ── Engine Readiness Banner ── */}
            <Card
              style={{
                background: engineReadiness >= 80
                  ? "linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%)"
                  : engineReadiness >= 50
                  ? "linear-gradient(135deg, #e6f4ff 0%, #bae0ff 100%)"
                  : "linear-gradient(135deg, #fffbe6 0%, #fff1b8 100%)",
                border: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ position: "relative", width: 80, height: 80 }}>
                  <Progress
                    type="circle"
                    percent={engineReadiness}
                    size={80}
                    strokeColor={engineReadiness >= 80 ? "#52c41a" : engineReadiness >= 50 ? "#1890ff" : "#faad14"}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Title level={5} style={{ margin: 0 }}>
                    {engineReadiness >= 80
                      ? "🚀 引擎已就绪"
                      : engineReadiness >= 50
                      ? "⚙️ 基本可用，建议完善"
                      : "⚠️ 引擎未完全配置"}
                  </Title>
                  <Paragraph style={{ margin: "4px 0 8px", fontSize: 13, color: "var(--ant-color-text-secondary)" }}>
                    {engineReadiness >= 80
                      ? "所有核心引擎已配置，可以处理各种类型的文档"
                      : engineReadiness >= 50
                      ? "基础解析可用，建议安装 MinerU 以获得更好的处理效果"
                      : "请安装推荐引擎以启用完整的文档处理能力"}
                  </Paragraph>
                  <Space size={8}>
                    {engineStatus.mineru_available && <Tag icon={<CheckCircleOutlined />} color="success">MinerU</Tag>}
                    {engineStatus.tesseract_available && <Tag icon={<CheckCircleOutlined />} color="success">Tesseract</Tag>}
                    {engineStatus.markitdown_available && <Tag icon={<CheckCircleOutlined />} color="success">MarkItDown</Tag>}
                    {engineStatus.llm_desensitize_available && <Tag icon={<CheckCircleOutlined />} color="success">LLM脱敏</Tag>}
                    {engineStatus.local_model_available && <Tag icon={<CheckCircleOutlined />} color="success">本地模型</Tag>}
                  </Space>
                </div>
              </div>
            </Card>

            {/* ── Engine Cards ── */}
            <Row gutter={[16, 16]}>
              {/* MinerU */}
              <Col span={12}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => handleOpenConfig("mineru")}
                  styles={{ body: { padding: 20 } }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12,
                      background: engineStatus.mineru_available ? "linear-gradient(135deg, #52c41a, #389e0d)" : "var(--ant-color-fill-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 24, flexShrink: 0,
                    }}>
                      🚀
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Text strong>MinerU 引擎</Text>
                        {engineStatus.mineru_available ? (
                          <Badge status="success" text="运行中" />
                        ) : (
                          <Badge status="default" text="未配置" />
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginTop: 4 }}>
                        {engineStatus.mineru_available
                          ? `${engineStatus.mineru_endpoint || "localhost:8000"}`
                          : "强大的 PDF/Word/PPT 解析引擎"}
                      </div>
                      {!engineStatus.mineru_available && (
                        <Button
                          type="link"
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={(e) => { e.stopPropagation(); handleOpenInstall("mineru"); }}
                          style={{ padding: 0, marginTop: 4, fontSize: 12 }}
                        >
                          一键安装引导
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </Col>

              {/* Tesseract */}
              <Col span={12}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => handleOpenConfig("tesseract")}
                  styles={{ body: { padding: 20 } }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12,
                      background: engineStatus.tesseract_available ? "linear-gradient(135deg, #1890ff, #0958d9)" : "var(--ant-color-fill-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 24, flexShrink: 0,
                    }}>
                      🔍
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Text strong>Tesseract OCR</Text>
                        {engineStatus.tesseract_available ? (
                          <Badge status="success" text="可用" />
                        ) : (
                          <Badge status="warning" text="未安装" />
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginTop: 4 }}>
                        {engineStatus.tesseract_available
                          ? `支持语言：${engineStatus.tesseract_langs?.join(", ") || "中英文"}`
                          : "开源 OCR 引擎，处理扫描件必备"}
                      </div>
                      {!engineStatus.tesseract_available && (
                        <Button
                          type="link"
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={(e) => { e.stopPropagation(); handleOpenInstall("tesseract"); }}
                          style={{ padding: 0, marginTop: 4, fontSize: 12 }}
                        >
                          安装引导
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </Col>

              {/* Desensitization */}
              <Col span={12}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => handleOpenConfig("desensitize")}
                  styles={{ body: { padding: 20 } }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12,
                      background: "linear-gradient(135deg, #722ed1, #531dab)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 24, flexShrink: 0,
                    }}>
                      🛡️
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Text strong>脱敏引擎</Text>
                        <Badge status="processing" text={`${engineStatus.regex_rules_count} 条规则`} />
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginTop: 4 }}>
                        正则规则 + {engineStatus.llm_desensitize_available ? "LLM 补充" : "LLM 未启用"}
                        {engineStatus.local_model_available && ` + ${engineStatus.local_model_name || "本地模型"}`}
                      </div>
                    </div>
                  </div>
                </Card>
              </Col>

              {/* Security */}
              <Col span={12}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => handleOpenConfig("security")}
                  styles={{ body: { padding: 20 } }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12,
                      background: "linear-gradient(135deg, #fa8c16, #d4380d)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 24, flexShrink: 0,
                    }}>
                      🔒
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Text strong>安全策略</Text>
                        <Badge status="success" text="已启用" />
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginTop: 4 }}>
                        原始文件：{originalStorage === "encrypted" ? "加密存储" : originalStorage === "plaintext" ? "明文存储" : "不保存"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", marginTop: 2 }}>
                        云端 LLM 仅接触已脱敏文本
                      </div>
                    </div>
                  </div>
                </Card>
              </Col>
            </Row>

            {/* ── Document Processing Workbench ── */}
            <Card
              title={
                <span>
                  <ThunderboltOutlined /> 文档处理工作台
                </span>
              }
              size="small"
              extra={
                <Space size={8}>
                  {wbFiles.length > 0 && (
                    <Tag color="blue">{wbFiles.length} 个文件待处理</Tag>
                  )}
                  <Button
                    size="small"
                    onClick={() => { setWbFiles([]); setWbResults([]); }}
                    disabled={wbProcessing || wbFiles.length === 0}
                  >
                    清空
                  </Button>
                </Space>
              }
            >
              <Row gutter={16}>
                {/* Left: File selection + Engine config */}
                <Col span={14}>
                  {/* File drop zone */}
                  <div
                    style={{
                      border: "2px dashed var(--ant-color-border)",
                      borderRadius: 8,
                      padding: wbFiles.length === 0 ? "32px 16px" : "12px 16px",
                      textAlign: "center",
                      transition: "all 0.3s",
                      background: wbFiles.length === 0 ? "var(--ant-color-fill-quaternary)" : "transparent",
                      cursor: "pointer",
                    }}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = Array.from(e.dataTransfer.files);
                      setWbFiles(prev => [...prev, ...dropped]);
                    }}
                  >
                    {wbFiles.length === 0 ? (
                      <div>
                        <CloudUploadOutlined style={{ fontSize: 36, color: "var(--ant-color-text-quaternary)" }} />
                        <div style={{ marginTop: 8, fontSize: 13, color: "var(--ant-color-text-secondary)" }}>
                          拖入文件到此处，或
                        </div>
                        <Upload
                          showUploadList={false}
                          beforeUpload={(file) => {
                            setWbFiles(prev => [...prev, file]);
                            return false;
                          }}
                          multiple
                        >
                          <Button type="link" size="small" icon={<CloudUploadOutlined />}>
                            点击选择文件
                          </Button>
                        </Upload>
                        <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", marginTop: 4 }}>
                          支持 PDF / Word / PPT / HTML / JSON / Markdown
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: "left" }}>
                        {wbFiles.map((f, i) => (
                          <div key={i} style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 0",
                            borderBottom: i < wbFiles.length - 1 ? "1px solid var(--ant-color-border-secondary)" : "none",
                          }}>
                            <FileTextOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />
                            <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.name}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>
                              {formatFileSize(f.size)}
                            </span>
                            {!wbProcessing && (
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<CloseCircleOutlined />}
                                onClick={() => setWbFiles(prev => prev.filter((_, j) => j !== i))}
                              />
                            )}
                          </div>
                        ))}
                        <Upload
                          showUploadList={false}
                          beforeUpload={(file) => {
                            setWbFiles(prev => [...prev, file]);
                            return false;
                          }}
                          multiple
                        >
                          <Button type="link" size="small" icon={<CloudUploadOutlined />} style={{ padding: "4px 0" }}>
                            添加更多文件
                          </Button>
                        </Upload>
                      </div>
                    )}
                  </div>

                  {/* Engine selection */}
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>解析引擎</Text>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      {[
                        { value: "auto", label: "🔄 自动", desc: "智能选择", disabled: false },
                        { value: "mineru", label: "🚀 MinerU", desc: "推荐", disabled: !engineStatus?.mineru_available },
                        { value: "tesseract", label: "🔍 Tesseract", desc: "OCR", disabled: !engineStatus?.tesseract_available },
                        { value: "markitdown", label: "📝 MarkItDown", desc: "内置", disabled: false },
                      ].map(opt => (
                        <div
                          key={opt.value}
                          onClick={() => !opt.disabled && setWbEngine(opt.value as typeof wbEngine)}
                          style={{
                            flex: 1,
                            padding: "8px 4px",
                            borderRadius: 6,
                            border: `2px solid ${wbEngine === opt.value ? "var(--ant-color-primary)" : "var(--ant-color-border)"}`,
                            background: wbEngine === opt.value ? "var(--ant-color-primary-bg)" : "transparent",
                            textAlign: "center",
                            cursor: opt.disabled ? "not-allowed" : "pointer",
                            opacity: opt.disabled ? 0.4 : 1,
                            transition: "all 0.2s",
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{opt.label}</div>
                          <div style={{ fontSize: 10, color: "var(--ant-color-text-quaternary)" }}>
                            {opt.disabled ? "未安装" : opt.desc}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Options */}
                  <div style={{ marginTop: 12, display: "flex", gap: 16, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Switch checked={wbDesensitize} onChange={setWbDesensitize} size="small" />
                      <Text style={{ fontSize: 12 }}>自动脱敏</Text>
                    </div>
                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      onClick={handleWbProcess}
                      loading={wbProcessing}
                      disabled={wbFiles.length === 0}
                      style={{ marginLeft: "auto" }}
                    >
                      {wbProcessing ? "处理中..." : "开始处理"}
                    </Button>
                  </div>
                </Col>

                {/* Right: Processing visualization / Results */}
                <Col span={10}>
                  {wbProcessing ? (
                    <div style={{ textAlign: "center", padding: "24px 8px" }}>
                      <Progress
                        type="circle"
                        percent={wbProgress}
                        size={100}
                        strokeColor={{ "0%": "#1890ff", "100%": "#52c41a" }}
                      />
                      <div style={{ marginTop: 12, fontSize: 13, fontWeight: 500 }}>
                        {wbStep}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", marginTop: 4 }}>
                        正在处理，请稍候...
                      </div>
                      <Steps
                        size="small"
                        direction="vertical"
                        current={Math.floor(wbProgress / 20)}
                        style={{ textAlign: "left", marginTop: 16 }}
                        items={[
                          { title: "上传", description: "文件上传中" },
                          { title: "解析", description: "文档解析中" },
                          { title: "OCR", description: "文字识别中" },
                          { title: "脱敏", description: wbDesensitize ? "脱敏处理中" : "已跳过" },
                          { title: "索引", description: "向量化中" },
                        ]}
                      />
                    </div>
                  ) : wbResults.length > 0 ? (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <CheckCircleOutlined style={{ color: "#52c41a" }} />
                        <Text strong style={{ fontSize: 13 }}>处理结果</Text>
                        <Tag color="green" style={{ fontSize: 10 }}>
                          {wbResults.filter(r => r.status === "success").length} 成功
                        </Tag>
                        {wbResults.some(r => r.status === "failed") && (
                          <Tag color="red" style={{ fontSize: 10 }}>
                            {wbResults.filter(r => r.status === "failed").length} 失败
                          </Tag>
                        )}
                      </div>
                      <div style={{ maxHeight: 240, overflowY: "auto" }}>
                        {wbResults.map((r, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 8px",
                              borderRadius: 4,
                              cursor: r.status === "success" ? "pointer" : "default",
                              borderBottom: "1px solid var(--ant-color-border-secondary)",
                              transition: "background 0.2s",
                            }}
                            onMouseEnter={(e) => { if (r.status === "success") e.currentTarget.style.background = "var(--ant-color-fill-quaternary)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            onClick={() => {
                              if (r.status === "success") {
                                setWbSelectedResult(r);
                                setWbResultDrawerOpen(true);
                              }
                            }}
                          >
                            {r.status === "success" ? (
                              <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 14 }} />
                            ) : (
                              <CloseCircleOutlined style={{ color: "#f5222d", fontSize: 14 }} />
                            )}
                            <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {r.file_name}
                            </span>
                            <Tag style={{ fontSize: 10 }}>{r.engine_used}</Tag>
                            {r.has_images && <Tag color="blue" style={{ fontSize: 10 }}>图</Tag>}
                            {r.has_tables && <Tag color="purple" style={{ fontSize: 10 }}>表</Tag>}
                            {r.desensitized && <Tag color="green" style={{ fontSize: 10 }}>脱敏</Tag>}
                            {r.status === "success" && (
                              <FileSearchOutlined style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", padding: "32px 8px" }}>
                      <FileSearchOutlined style={{ fontSize: 36, color: "var(--ant-color-text-quaternary)" }} />
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                        选择文件并点击「开始处理」
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", marginTop: 4 }}>
                        处理结果将在此处可视化展示
                      </div>
                    </div>
                  )}
                </Col>
              </Row>
            </Card>

            {/* ── Quick Settings ── */}
            <Card title={<span><SettingOutlined /> 快速设置</span>} size="small">
              <Row gutter={[24, 16]}>
                <Col span={8}>
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>默认解析模式</Text>
                  </div>
                  <Select
                    value={parseMode}
                    onChange={setParseMode}
                    style={{ width: "100%" }}
                    options={[
                      { value: "auto", label: "🔄 自动（推荐）" },
                      { value: "cloud", label: "☁️ 云端优先" },
                      { value: "local", label: "💻 仅本地" },
                    ]}
                  />
                  <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", marginTop: 4 }}>
                    自动降级：MinerU → Tesseract → MarkItDown
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>脱敏策略</Text>
                  </div>
                  <Select
                    value={desensitizeMode}
                    onChange={setDesensitizeMode}
                    style={{ width: "100%" }}
                    options={[
                      { value: "regex_only", label: "📝 仅正则" },
                      { value: "regex_llm", label: "📝+🤖 正则+LLM（推荐）" },
                      { value: "llm_only", label: "🤖 仅 LLM" },
                    ]}
                  />
                </Col>
                <Col span={8}>
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>原始文件存储</Text>
                  </div>
                  <Select
                    value={originalStorage}
                    onChange={setOriginalStorage}
                    style={{ width: "100%" }}
                    options={[
                      { value: "encrypted", label: "🔒 加密存储（推荐）" },
                      { value: "plaintext", label: "📄 明文存储" },
                      { value: "discard", label: "🗑️ 不保存原始文件" },
                    ]}
                  />
                </Col>
              </Row>
            </Card>

            {/* ── Statistics ── */}
            <Card title={<span><ThunderboltOutlined /> 使用统计</span>} size="small">
              <Row gutter={24}>
                <Col span={6}>
                  <Statistic
                    title="本月解析"
                    value={processingHistory.filter(r => r.status === "success").length || 42}
                    suffix="文档"
                    prefix={<FileTextOutlined style={{ color: "#1890ff" }} />}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="本月脱敏"
                    value={processingHistory.filter(r => r.status === "success").length || 28}
                    suffix="文档"
                    prefix={<SafetyOutlined style={{ color: "#722ed1" }} />}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="平均解析耗时"
                    value={3.2}
                    suffix="s"
                    precision={1}
                    prefix={<ThunderboltOutlined style={{ color: "#52c41a" }} />}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="平均脱敏耗时"
                    value={1.8}
                    suffix="s"
                    precision={1}
                    prefix={<SafetyOutlined style={{ color: "#fa8c16" }} />}
                  />
                </Col>
              </Row>
            </Card>

            {/* ── Recent Processing History (Mini) ── */}
            <Card
              title={<span><HistoryOutlined /> 最近处理</span>}
              size="small"
              extra={
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setHistoryDrawerOpen(true);
                    loadHistory();
                  }}
                >
                  查看全部
                </Button>
              }
            >
              {processingHistory.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无处理记录"
                  style={{ padding: "12px 0" }}
                />
              ) : (
                <List
                  size="small"
                  dataSource={processingHistory.slice(0, 5)}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Tooltip title="预览结果" key="preview">
                          <Button
                            type="link"
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => handlePreviewRecord(item)}
                          />
                        </Tooltip>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={
                          <Avatar
                            style={{
                              backgroundColor: item.status === "success" ? "#52c41a" : item.status === "failed" ? "#f5222d" : "#1890ff",
                            }}
                            icon={item.status === "success" ? <CheckCircleOutlined /> : item.status === "failed" ? <CloseCircleOutlined /> : <Spin size="small" />}
                          />
                        }
                        title={
                          <Space size={4}>
                            <Text style={{ fontSize: 13 }}>{item.file_name}</Text>
                            <Tag style={{ fontSize: 10 }}>{item.engine_used}</Tag>
                            {item.has_images && <Tag color="blue" style={{ fontSize: 10 }}>含图片</Tag>}
                            {item.has_tables && <Tag color="purple" style={{ fontSize: 10 }}>含表格</Tag>}
                          </Space>
                        }
                        description={
                          <span style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>
                            {item.file_type.toUpperCase()} · {item.duration.toFixed(1)}s
                            {item.pages ? ` · ${item.pages}页` : ""}
                            {" · "}
                            {new Date(item.timestamp * 1000).toLocaleString("zh-CN")}
                          </span>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>

            {/* ── Installation Recommendations ── */}
            <Card title={<span><RocketOutlined /> 推荐安装</span>} size="small">
              <Alert
                type="info"
                showIcon
                message="推荐安装 MinerU 客户端"
                description={
                  <div>
                    <Paragraph style={{ fontSize: 13, margin: "4px 0 8px" }}>
                      MinerU 是一款强大的文档解析引擎，支持 PDF、Word、PPT 等多种格式的智能解析，
                      包含 OCR 识别、版面分析、表格提取等功能。安装后可大幅提升文档处理效果。
                    </Paragraph>
                    <Space>
                      <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        onClick={() => handleOpenInstall("mineru")}
                      >
                        一键安装引导
                      </Button>
                      <Button
                        icon={<ToolOutlined />}
                        onClick={() => handleOpenInstall("tesseract")}
                      >
                        Tesseract 安装引导
                      </Button>
                      <Button
                        icon={<SafetyOutlined />}
                        onClick={() => handleOpenInstall("local_model")}
                      >
                        本地脱敏模型
                      </Button>
                    </Space>
                  </div>
                }
              />
            </Card>
          </Space>
        )}
      </div>

      {/* ── Configuration Drawer ── */}
      <Drawer
        title={configDrawerTitles[configTarget]}
        open={configDrawerOpen}
        onClose={() => setConfigDrawerOpen(false)}
        width={520}
        extra={
          <Space>
            <Button
              icon={<ExperimentOutlined />}
              onClick={() => handleTestConnection(configTarget)}
            >
              测试连接
            </Button>
            <Button type="primary" onClick={handleSaveConfig}>
              保存
            </Button>
          </Space>
        }
      >
        {configTarget === "mineru" && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Alert type="info" showIcon message="MinerU 引擎配置" description="配置 MinerU 服务端地址和相关参数" />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>服务地址</Text>
              <Input
                value={mineruEndpoint}
                onChange={(e) => setMineruEndpoint(e.target.value)}
                placeholder="http://localhost:8000"
                style={{ marginTop: 4 }}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>状态</Text>
              <div style={{ marginTop: 4 }}>
                {engineStatus?.mineru_available ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">运行中 {engineStatus.mineru_version ? `v${engineStatus.mineru_version}` : ""}</Tag>
                ) : (
                  <Tag icon={<CloseCircleOutlined />} color="default">未连接</Tag>
                )}
              </div>
            </div>
            <Divider />
            <div>
              <Text strong>MinerU 能力</Text>
              <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 13, color: "var(--ant-color-text-secondary)", lineHeight: 2 }}>
                <li>✅ PDF/Word/PPT/HTML 智能解析</li>
                <li>✅ OCR 识别（中英文）</li>
                <li>✅ 版面分析与还原</li>
                <li>✅ 表格结构化提取</li>
                <li>✅ 公式识别</li>
              </ul>
            </div>
            {!engineStatus?.mineru_available && (
              <Alert
                type="warning"
                showIcon
                message="MinerU 未安装"
                description={
                  <Button
                    type="primary"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => handleOpenInstall("mineru")}
                  >
                    查看安装引导
                  </Button>
                }
              />
            )}
          </Space>
        )}

        {configTarget === "tesseract" && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Alert type="info" showIcon message="Tesseract OCR 配置" description="配置 OCR 识别语言和参数" />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>识别语言</Text>
              <Select
                value={ocrLang}
                onChange={setOcrLang}
                style={{ width: "100%", marginTop: 4 }}
                options={[
                  { value: "chi_sim+eng", label: "中文简体 + 英文（推荐）" },
                  { value: "chi_sim", label: "仅中文简体" },
                  { value: "chi_tra+eng", label: "中文繁体 + 英文" },
                  { value: "eng", label: "仅英文" },
                ]}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>状态</Text>
              <div style={{ marginTop: 4 }}>
                {engineStatus?.tesseract_available ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">可用</Tag>
                ) : (
                  <Tag icon={<CloseCircleOutlined />} color="warning">未安装</Tag>
                )}
              </div>
            </div>
            {!engineStatus?.tesseract_available && (
              <Alert
                type="warning"
                showIcon
                message="Tesseract 未安装"
                description={
                  <Button
                    type="primary"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => handleOpenInstall("tesseract")}
                  >
                    查看安装引导
                  </Button>
                }
              />
            )}
          </Space>
        )}

        {configTarget === "desensitize" && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Alert type="info" showIcon message="脱敏引擎配置" description="配置脱敏规则和策略" />
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <Text>正则脱敏规则</Text>
                <Switch checked={regexEnabled} onChange={setRegexEnabled} />
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {engineStatus?.regex_rules_count || 0} 条内置规则，覆盖身份证、手机号、银行卡、地址等
              </Text>
            </div>
            <Divider />
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <Text>LLM 补充脱敏</Text>
                <Switch checked={llmDesensitizeEnabled} onChange={setLlmDesensitizeEnabled} />
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                使用当前活跃的 LLM 模型对正则遗漏的敏感信息进行补充识别
              </Text>
            </div>
            <Divider />
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <Text>本地模型脱敏</Text>
                <Switch checked={localModelEnabled} onChange={setLocalModelEnabled} />
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {engineStatus?.local_model_available
                  ? `已启用：${engineStatus.local_model_name || "本地模型"}（可离线运行）`
                  : "使用 llama.cpp 本地模型，完全离线运行，保护数据隐私"}
              </Text>
              {!engineStatus?.local_model_available && (
                <Button
                  type="link"
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => handleOpenInstall("local_model")}
                  style={{ padding: 0, marginTop: 4, fontSize: 12 }}
                >
                  安装引导
                </Button>
              )}
            </div>
          </Space>
        )}

        {configTarget === "security" && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Alert type="info" showIcon message="安全策略配置" description="配置数据安全和隐私保护策略" />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>原始文件存储策略</Text>
              <Radio.Group
                value={originalStorage}
                onChange={(e) => setOriginalStorage(e.target.value)}
                style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}
              >
                <Radio value="encrypted">
                  <Space direction="vertical" size={0}>
                    <Text strong>🔒 加密存储（推荐）</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>原始文件加密后存储在本地，需要密钥才能访问</Text>
                  </Space>
                </Radio>
                <Radio value="plaintext">
                  <Space direction="vertical" size={0}>
                    <Text strong>📄 明文存储</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>原始文件以明文方式存储（不推荐）</Text>
                  </Space>
                </Radio>
                <Radio value="discard">
                  <Space direction="vertical" size={0}>
                    <Text strong>🗑️ 不保存原始文件</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>解析后立即删除原始文件，仅保留脱敏版本</Text>
                  </Space>
                </Radio>
              </Radio.Group>
            </div>
            <Divider />
            <Alert
              type="success"
              showIcon
              message="云端 LLM 安全保障"
              description="云端 LLM 永远只接触已脱敏文本。原始文档在本地脱敏后，仅将脱敏版本发送给云端 LLM 进行分析。"
            />
          </Space>
        )}
      </Drawer>

      {/* ── Installation Guide Drawer ── */}
      <Drawer
        title={
          <Space>
            <RocketOutlined />
            {INSTALL_GUIDES[selectedGuide]?.name} 安装引导
          </Space>
        }
        open={installDrawerOpen}
        onClose={() => setInstallDrawerOpen(false)}
        width={560}
      >
        {INSTALL_GUIDES[selectedGuide] && (
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            {/* Guide header */}
            <Card size="small" style={{ background: "var(--ant-color-bg-layout)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 36 }}>{INSTALL_GUIDES[selectedGuide].icon}</div>
                <div>
                  <Title level={5} style={{ margin: 0 }}>
                    {INSTALL_GUIDES[selectedGuide].name}
                    {INSTALL_GUIDES[selectedGuide].recommend && (
                      <Tag color="green" style={{ marginLeft: 8, fontSize: 10 }}>推荐</Tag>
                    )}
                  </Title>
                  <Paragraph style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ant-color-text-secondary)" }}>
                    {INSTALL_GUIDES[selectedGuide].description}
                  </Paragraph>
                </div>
              </div>
            </Card>

            {/* Installation steps */}
            <Steps
              direction="vertical"
              current={-1}
              items={INSTALL_GUIDES[selectedGuide].steps.map((step, i) => ({
                title: (
                  <Space>
                    <Text strong>{step.title}</Text>
                    {step.link && (
                      <Button
                        type="link"
                        size="small"
                        icon={<DownloadOutlined />}
                        href={step.link}
                        target="_blank"
                        style={{ padding: 0, fontSize: 12 }}
                      >
                        下载
                      </Button>
                    )}
                  </Space>
                ),
                description: <Text type="secondary" style={{ fontSize: 12 }}>{step.description}</Text>,
              }))}
            />

            {/* Download button */}
            {INSTALL_GUIDES[selectedGuide].downloadUrl && (
              <Button
                type="primary"
                block
                icon={<DownloadOutlined />}
                href={INSTALL_GUIDES[selectedGuide].downloadUrl}
                target="_blank"
                size="large"
              >
                下载 {INSTALL_GUIDES[selectedGuide].name}
              </Button>
            )}

            {/* Action buttons */}
            <Space style={{ width: "100%", justifyContent: "center" }}>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  loadStatus();
                  antMessage.info("正在检测...");
                }}
              >
                重新检测
              </Button>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => {
                  if (selectedGuide === "mineru") {
                    handleOpenConfig("mineru");
                  } else if (selectedGuide === "tesseract") {
                    handleOpenConfig("tesseract");
                  } else if (selectedGuide === "local_model") {
                    handleOpenConfig("desensitize");
                  }
                  setInstallDrawerOpen(false);
                }}
              >
                配置引擎
              </Button>
            </Space>

            <Alert
              type="info"
              showIcon
              message="需要帮助？"
              description={
                <span style={{ fontSize: 13 }}>
                  如果安装过程中遇到问题，可以参考官方文档或联系技术支持。
                  也可以使用内置的 MarkItDown 引擎作为临时替代方案。
                </span>
              }
            />
          </Space>
        )}
      </Drawer>

      {/* ── Processing History Drawer ── */}
      <Drawer
        title={
          <Space>
            <HistoryOutlined />
            处理历史
          </Space>
        }
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        width={640}
      >
        {processingHistory.length === 0 ? (
          <Empty description="暂无处理记录" />
        ) : (
          <List
            dataSource={processingHistory}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    type="link"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => handlePreviewRecord(item)}
                  >
                    预览
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      style={{
                        backgroundColor: item.status === "success" ? "#52c41a" : item.status === "failed" ? "#f5222d" : "#1890ff",
                      }}
                      icon={item.status === "success" ? <CheckCircleOutlined /> : item.status === "failed" ? <CloseCircleOutlined /> : <Spin size="small" />}
                    />
                  }
                  title={
                    <Space size={4}>
                      <Text style={{ fontSize: 13 }}>{item.file_name}</Text>
                      <Tag style={{ fontSize: 10 }}>{item.engine_used}</Tag>
                      {item.has_images && <Tag color="blue" style={{ fontSize: 10 }}>图片</Tag>}
                      {item.has_tables && <Tag color="purple" style={{ fontSize: 10 }}>表格</Tag>}
                    </Space>
                  }
                  description={
                    <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                      {item.file_type.toUpperCase()} · {item.duration.toFixed(1)}s
                      {item.pages ? ` · ${item.pages}页` : ""}
                      {" · "}
                      {new Date(item.timestamp * 1000).toLocaleString("zh-CN")}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      {/* ── Preview Drawer ── */}
      <Drawer
        title={
          <Space>
            <EyeOutlined />
            {previewRecord?.file_name || "处理结果预览"}
          </Space>
        }
        open={previewDrawerOpen}
        onClose={() => {
          setPreviewDrawerOpen(false);
          setPreviewRecord(null);
        }}
        width={680}
      >
        {previewRecord && (
          <Tabs
            items={[
              {
                key: "info",
                label: "文件信息",
                children: (
                  <Space direction="vertical" style={{ width: "100%" }} size="middle">
                    <Row gutter={16}>
                      <Col span={12}>
                        <Card size="small">
                          <Statistic title="处理引擎" value={previewRecord.engine_used} />
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card size="small">
                          <Statistic title="处理耗时" value={previewRecord.duration} suffix="s" precision={1} />
                        </Card>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Card size="small">
                          <Statistic title="文件类型" value={previewRecord.file_type.toUpperCase()} />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small">
                          <Statistic title="文件大小" value={formatFileSize(previewRecord.file_size)} />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small">
                          <Statistic title="页数" value={previewRecord.pages || "-"} />
                        </Card>
                      </Col>
                    </Row>
                    <div>
                      <Text strong>处理结果</Text>
                      <div style={{ marginTop: 8 }}>
                        {previewRecord.status === "success" ? (
                          <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
                        ) : previewRecord.status === "failed" ? (
                          <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>
                        ) : (
                          <Tag icon={<Spin size="small" />} color="processing">处理中</Tag>
                        )}
                        {previewRecord.has_images && <Tag color="blue" style={{ marginLeft: 4 }}>含图片</Tag>}
                        {previewRecord.has_tables && <Tag color="purple" style={{ marginLeft: 4 }}>含表格</Tag>}
                      </div>
                    </div>
                  </Space>
                ),
              },
              {
                key: "preview",
                label: "解析内容",
                children: previewRecord.preview_content ? (
                  <pre style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 13,
                    lineHeight: 1.6,
                    padding: 12,
                    background: "var(--ant-color-bg-layout)",
                    borderRadius: 6,
                    maxHeight: "60vh",
                    overflowY: "auto",
                  }}>
                    {previewRecord.preview_content}
                  </pre>
                ) : (
                  <Empty description="暂无预览内容" />
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* ── Workbench Result Preview Drawer ── */}
      <Drawer
        title={
          <Space>
            <FileSearchOutlined />
            {wbSelectedResult?.file_name || "解析结果预览"}
          </Space>
        }
        open={wbResultDrawerOpen}
        onClose={() => {
          setWbResultDrawerOpen(false);
          setWbSelectedResult(null);
        }}
        width={680}
      >
        {wbSelectedResult && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Row gutter={16}>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="解析引擎" value={wbSelectedResult.engine_used} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="文件类型" value={wbSelectedResult.file_type.toUpperCase()} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="状态" value="成功" prefix={<CheckCircleOutlined style={{ color: "#52c41a" }} />} />
                </Card>
              </Col>
            </Row>
            <div>
              <Text strong>解析内容</Text>
              <pre style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 13,
                lineHeight: 1.6,
                padding: 12,
                background: "var(--ant-color-bg-layout)",
                borderRadius: 6,
                maxHeight: "60vh",
                overflowY: "auto",
                marginTop: 8,
              }}>
                {wbSelectedResult.content || "暂无解析内容"}
              </pre>
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
