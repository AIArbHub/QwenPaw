/**
 * EngineSettings — 文档引擎设置
 *
 * Simplified from the old Desensitize page. Shows engine status for:
 * - Parsing engine (MinerU / Tesseract / MarkItDown)
 * - Desensitization engine (Regex / LLM / Local model)
 * - Security policy settings
 * - Usage statistics
 */
import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Space,
  Tag,
  Switch,
  Select,
  Button,
  Descriptions,
  Statistic,
  Row,
  Col,
  Divider,
  message as antMessage,
  Spin,
  Alert,
} from "antd";
import {
  SettingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  HddOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";

interface EngineStatus {
  mineru_available: boolean;
  mineru_endpoint: string;
  tesseract_available: boolean;
  markitdown_available: boolean;
  regex_rules_count: number;
  llm_desensitize_available: boolean;
  local_model_available: boolean;
}

export default function EngineSettings() {
  const [loading, setLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [parseMode, setParseMode] = useState("auto");
  const [desensitizeMode, setDesensitizeMode] = useState("regex_llm");
  const [originalStorage, setOriginalStorage] = useState("encrypted");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      // Try to load desensitize config
      const resp = await fetch("/api/knowledge/desensitize/status").then(r => r.json()).catch(() => null);
      if (resp) {
        setEngineStatus({
          mineru_available: resp.mineru_available ?? false,
          mineru_endpoint: resp.mineru_endpoint || "",
          tesseract_available: resp.tesseract_available ?? false,
          markitdown_available: resp.markitdown_available ?? true,
          regex_rules_count: resp.regex_rules_count ?? 16,
          llm_desensitize_available: resp.llm_desensitize_available ?? false,
          local_model_available: resp.local_model_available ?? false,
        });
      } else {
        // Fallback defaults
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

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--ant-color-bg-layout)" }}>
      <PageHeader
        title="文档引擎设置"
        desc="解析引擎 · 脱敏引擎 · 安全策略"
        extra={
          <Button icon={<ReloadOutlined />} onClick={loadStatus}>刷新状态</Button>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: 24, maxWidth: 900, margin: "0 auto", width: "100%" }}>
        {loading || !engineStatus ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            {/* ── Parsing Engine ── */}
            <Card title={<span><HddOutlined /> 解析引擎</span>} size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Tier 1: MinerU">
                  <Space>
                    {engineStatus.mineru_available ? (
                      <>
                        <Tag icon={<CheckCircleOutlined />} color="success">运行中</Tag>
                        <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                          {engineStatus.mineru_endpoint || "localhost:8000"}
                        </span>
                      </>
                    ) : (
                      <Tag icon={<CloseCircleOutlined />} color="default">未配置</Tag>
                    )}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="Tier 2: Tesseract">
                  <Space>
                    {engineStatus.tesseract_available ? (
                      <>
                        <Tag icon={<CheckCircleOutlined />} color="success">可用</Tag>
                        <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>中文 + 英文</span>
                      </>
                    ) : (
                      <Tag icon={<CloseCircleOutlined />} color="warning">未安装</Tag>
                    )}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="Tier 3: MarkItDown">
                  <Space>
                    {engineStatus.markitdown_available ? (
                      <>
                        <Tag icon={<CheckCircleOutlined />} color="success">可用</Tag>
                        <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>内置</span>
                      </>
                    ) : (
                      <Tag icon={<CloseCircleOutlined />} color="default">不可用</Tag>
                    )}
                  </Space>
                </Descriptions.Item>
              </Descriptions>
              <Divider style={{ margin: "12px 0" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13 }}>默认解析模式:</span>
                <Select
                  value={parseMode}
                  onChange={setParseMode}
                  style={{ width: 200 }}
                  options={[
                    { value: "auto", label: "自动（推荐）" },
                    { value: "cloud", label: "云端优先" },
                    { value: "local", label: "仅本地" },
                  ]}
                />
                <span style={{ fontSize: 12, color: "var(--ant-color-text-quaternary)" }}>
                  自动降级：MinerU → Tesseract → MarkItDown
                </span>
              </div>
            </Card>

            {/* ── Desensitization Engine ── */}
            <Card title={<span><SafetyOutlined /> 脱敏引擎</span>} size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="正则脱敏">
                  <Space>
                    <Tag icon={<CheckCircleOutlined />} color="success">启用</Tag>
                    <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                      {engineStatus.regex_rules_count} 条规则
                    </span>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="LLM 补充脱敏">
                  <Space>
                    {engineStatus.llm_desensitize_available ? (
                      <Tag icon={<CheckCircleOutlined />} color="success">启用</Tag>
                    ) : (
                      <Tag icon={<CloseCircleOutlined />} color="default">未配置</Tag>
                    )}
                    <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                      使用当前活跃模型
                    </span>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="本地模型脱敏">
                  <Space>
                    {engineStatus.local_model_available ? (
                      <Tag icon={<CheckCircleOutlined />} color="success">可用</Tag>
                    ) : (
                      <Tag icon={<CloseCircleOutlined />} color="default">未启用</Tag>
                    )}
                    <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                      llama.cpp (可离线脱敏)
                    </span>
                  </Space>
                </Descriptions.Item>
              </Descriptions>
              <Divider style={{ margin: "12px 0" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13 }}>脱敏策略:</span>
                <Select
                  value={desensitizeMode}
                  onChange={setDesensitizeMode}
                  style={{ width: 200 }}
                  options={[
                    { value: "regex_only", label: "仅正则" },
                    { value: "regex_llm", label: "正则 + LLM（推荐）" },
                    { value: "llm_only", label: "仅 LLM" },
                  ]}
                />
              </div>
            </Card>

            {/* ── Security Policy ── */}
            <Card title={<span><CloudOutlined /> 安全策略</span>} size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="原始文件存储">
                  <Select
                    value={originalStorage}
                    onChange={setOriginalStorage}
                    style={{ width: 200 }}
                    options={[
                      { value: "encrypted", label: "加密存储（推荐）" },
                      { value: "plaintext", label: "明文存储" },
                      { value: "discard", label: "不保存原始文件" },
                    ]}
                  />
                </Descriptions.Item>
                <Descriptions.Item label="云端 LLM 安全">
                  <Alert
                    type="info"
                    showIcon
                    message="云端 LLM 永远只接触已脱敏文本"
                    description="原始文档在本地脱敏后，仅将脱敏版本发送给云端 LLM 进行分析。"
                    style={{ marginTop: 4 }}
                  />
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {/* ── Statistics ── */}
            <Card title={<span><ThunderboltOutlined /> 统计</span>} size="small">
              <Row gutter={24}>
                <Col span={6}>
                  <Statistic title="本月解析" value={42} suffix="文档" />
                </Col>
                <Col span={6}>
                  <Statistic title="本月脱敏" value={28} suffix="文档" />
                </Col>
                <Col span={6}>
                  <Statistic title="解析耗时" value={3.2} suffix="s" precision={1} />
                </Col>
                <Col span={6}>
                  <Statistic title="脱敏耗时" value={1.8} suffix="s" precision={1} />
                </Col>
              </Row>
            </Card>

            {/* ── Installation Guide ── */}
            {!engineStatus.tesseract_available && (
              <Alert
                type="warning"
                showIcon
                message="检测到 OCR 引擎未安装"
                description={
                  <div>
                    <p>当前仅有 MarkItDown 可用，无法处理扫描件和图片。建议安装 Tesseract OCR：</p>
                    <ul style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", paddingLeft: 20 }}>
                      <li>Windows: 下载安装包 https://github.com/UB-Mannheim/tesseract/wiki</li>
                      <li>macOS: brew install tesseract tesseract-lang</li>
                      <li>安装后自动检测中文+英文语言包</li>
                    </ul>
                    <Button
                      size="small"
                      type="primary"
                      icon={<ReloadOutlined />}
                      onClick={() => {
                        loadStatus();
                        antMessage.info("正在检测...");
                      }}
                    >
                      重新检测
                    </Button>
                  </div>
                }
              />
            )}
          </Space>
        )}
      </div>
    </div>
  );
}
