import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Input,
  Button,
  Upload,
  message,
  Card,
  Descriptions,
  Tag,
  Table,
  Alert,
  Statistic,
  Row,
  Col,
  Select,
  Space,
  Tooltip,
  Typography,
  Empty,
  Divider,
  Progress,
} from "antd";
import {
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  ExclamationCircleOutlined,
  SafetyOutlined,
  ScanOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  FileMarkdownOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  CheckCircleFilled,
  LoadingOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  InboxOutlined,
  HistoryOutlined,
  EyeOutlined,
  FileDoneOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  documentToolsApi,
  type RedactTextResult,
  type EntityTypeEntry,
  type PolicyEntry,
  type StrengthLevelEntry,
  type RedactionMode,
  type OutputFormat,
  type BatchRedactResult,
  type BatchFileResult,
} from "../../api/modules/documentTools";
import { providerApi } from "../../api/modules/provider";
import type { ProviderInfo } from "../../api/types";
import { entityColor, modeColor, formatMode } from "./utils";
import { Collapse } from "antd";

const { TextArea } = Input;
const { Text } = Typography;
const { Dragger } = Upload;

/** Redaction history entry stored in localStorage */
interface RedactionHistoryEntry {
  id: string;
  timestamp: string;
  mode: string;
  inputType: "text" | "file" | "batch";
  inputName: string;
  entityCount: number;
  policy: string;
  redactionMode: RedactionMode;
  preview: string;
}

/** Load redaction history from localStorage */
function loadHistory(): RedactionHistoryEntry[] {
  try {
    const raw = localStorage.getItem("aiarb_redaction_history");
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Save redaction history to localStorage */
function saveHistory(entries: RedactionHistoryEntry[]) {
  try {
    localStorage.setItem(
      "aiarb_redaction_history",
      JSON.stringify(entries.slice(0, 50)),
    );
  } catch {
    // Ignore quota errors
  }
}

/** 文件类型 → 图标和颜色映射 */
function fileTypeMeta(filename: string): {
  icon: React.ReactNode;
  color: string;
  label: string;
} {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf")
    return { icon: <FilePdfOutlined />, color: "red", label: "PDF" };
  if (ext === "doc" || ext === "docx")
    return { icon: <FileTextOutlined />, color: "blue", label: "WORD" };
  if (ext === "md" || ext === "markdown")
    return { icon: <FileMarkdownOutlined />, color: "cyan", label: "MD" };
  if (ext === "html" || ext === "htm")
    return { icon: <FileTextOutlined />, color: "orange", label: "HTML" };
  if (ext === "txt")
    return { icon: <FileTextOutlined />, color: "default", label: "TXT" };
  return { icon: <FileTextOutlined />, color: "default", label: ext.toUpperCase() };
}

/**
 * RedactionPanel — C 端风格单页面脱敏
 *
 * 设计理念（参照 legalwork 前端）：
 *   - 一个页面解决所有问题，不切 Tab
 *   - 用户上传文件 → 自动判断是文本还是文件
 *   - 也可以直接粘贴文本
 *   - 多文件自动进入批量模式
 *   - 设置项折叠收起，不占主视觉
 */
export default function RedactionPanel() {
  const { t } = useTranslation();

  // --- 统一输入区 ---
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  // --- 设置项 ---
  const [policy, setPolicy] = useState("external_client");
  const [strengthLevel, setStrengthLevel] = useState<string | undefined>(
    undefined,
  );
  const [redactionMode, setRedactionMode] = useState<RedactionMode>("standard");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("md");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // --- 处理状态 ---
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<RedactTextResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchRedactResult | null>(null);
  const [batchResults, setBatchResults] = useState<BatchFileResult[]>([]);
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "success" | "warning";
    text: string;
  } | null>(null);

  // --- Agent 模型选择 ---
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [agentModel, setAgentModel] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  // --- 元数据 ---
  const [entities, setEntities] = useState<EntityTypeEntry[]>([]);
  const [policies, setPolicies] = useState<PolicyEntry[]>([]);
  const [strengthLevels, setStrengthLevels] = useState<
    StrengthLevelEntry[]
  >([]);

  // --- History ---
  const [history, setHistory] = useState<RedactionHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);

  // -- 数据加载 --
  useEffect(() => {
    documentToolsApi.listEntities().then((r) => setEntities(r.entity_types));
    documentToolsApi.listPolicies().then((r) => setPolicies(r.policies));
    documentToolsApi
      .listStrengthLevels()
      .then((r) => setStrengthLevels(r.strength_levels));

    setLoadingModels(true);
    providerApi
      .listProviders()
      .then((data) => setProviders(data))
      .catch(() => {})
      .finally(() => setLoadingModels(false));

    setHistory(loadHistory());
  }, []);

  // -- Model options: ONLY show providers that are actually configured (same logic as DesignLayout ModelPicker) --
  const agentModelOptions = useMemo(() => {
    if (!providers || providers.length === 0) return [];

    // Filter to only eligible providers (with API key or base URL configured)
    const eligibleProviders = providers
      .filter((p) => {
        const hasModels =
          (p.models?.length ?? 0) + (p.extra_models?.length ?? 0) > 0;
        if (!hasModels) return false;
        if (p.require_api_key === false) return !!p.base_url;
        if (p.is_custom) return !!p.base_url;
        if (p.require_api_key ?? true) return !!p.api_key;
        return true;
      })
      .map((p) => ({
        id: p.id,
        name: p.name,
        models: [...(p.models ?? []), ...(p.extra_models ?? [])],
        is_local: p.is_local,
      }));

    const localOptions: Array<{ label: string; value: string }> = [];
    const cloudOptions: Array<{ label: string; value: string }> = [];

    for (const p of eligibleProviders) {
      for (const m of p.models) {
        const label = `${m.name || m.id} (${p.name})`;
        const value = `${p.id}:${m.id}`;
        if (p.is_local || p.id === "ollama" || p.id === "aiarb-local") {
          localOptions.push({ label, value });
        } else {
          cloudOptions.push({ label, value });
        }
      }
    }

    const groups = [];
    if (localOptions.length > 0) {
      groups.push({
        label: (
          <span>
            <DesktopOutlined style={{ marginRight: 6 }} />
            {t("documentTools.redaction.localModels", "本地模型")} ({localOptions.length})
          </span>
        ),
        options: localOptions,
      });
    }
    if (cloudOptions.length > 0) {
      groups.push({
        label: (
          <span>
            <CloudServerOutlined style={{ marginRight: 6 }} />
            {t("documentTools.redaction.cloudModels", "云端模型")} ({cloudOptions.length})
          </span>
        ),
        options: cloudOptions,
      });
    }
    return groups;
  }, [providers, t]);

  // -- Smart mode detection --
  const mode = useMemo(() => {
    if (files.length > 0) return files.length === 1 ? "file" : "batch";
    return "text";
  }, [files]);

  // -- Save to history --
  const addToHistory = useCallback(
    (
      inputType: "text" | "file" | "batch",
      inputName: string,
      entityCount: number,
      rMode: RedactionMode,
    ) => {
      const entry: RedactionHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        mode,
        inputType,
        inputName,
        entityCount,
        policy,
        redactionMode: rMode,
        preview: text.slice(0, 100) || inputName,
      };
      const updated = [entry, ...loadHistory()].slice(0, 50);
      saveHistory(updated);
      setHistory(updated);
    },
    [mode, policy, text],
  );

  // -- 统一执行脱敏 --
  const handleRedact = useCallback(async () => {
    if (files.length === 0 && !text.trim()) {
      message.warning(t("documentTools.redaction.pasteOrUpload", "请粘贴文本或上传文件"));
      return;
    }

    setProcessing(true);
    setResult(null);
    setBatchResult(null);
    setBatchResults([]);
    setNotice(null);

    try {
      if (mode === "text") {
        // 文本脱敏
        let res: any;
        if (redactionMode === "agent_enhanced") {
          let selectedProvider: string | undefined;
          let selectedModel: string | undefined;
          if (agentModel && agentModel.includes(":")) {
            const parts = agentModel.split(":");
            selectedProvider = parts[0];
            selectedModel = parts.slice(1).join(":");
          }
          res = await documentToolsApi.agentEnhancedRedact({
            text,
            policy,
            strengthLevel,
            provider_id: selectedProvider,
            model_id: selectedModel,
          });
          const agentMode = res.agent_mode || "unknown";
          const suggestionCount = res.agent_suggestions?.length || 0;
          if (agentMode === "model_unavailable") {
            setNotice({
              tone: "error",
              text: t("documentTools.redaction.agentModelUnavailable", "Agent 模型不可用，已降级为标准模式。请在设置中配置 LLM 模型。"),
            });
          } else if (suggestionCount > 0) {
            setNotice({
              tone: "info",
              text: t("documentTools.redaction.agentReviewComplete", "Agent 复核完成！发现 {count} 条建议").replace("{count}", String(suggestionCount)),
            });
          } else {
            setNotice({ tone: "success", text: `${t("documentTools.redaction.redactSuccess", "脱敏完成，发现")}${res.entity_count}${t("documentTools.redaction.entities", "个实体")} (✨ Agent 已复核)` });
          }
        } else {
          res = await documentToolsApi.redactText({ text, policy, strength_level: strengthLevel });
          setNotice({ tone: "success", text: `${t("documentTools.redaction.redactSuccess", "脱敏完成，发现")}${res.entity_count}${t("documentTools.redaction.entities", "个实体")}` });
        }
        setResult(res);
        addToHistory("text", t("documentTools.redaction.textInput", "文本输入"), res.entity_count || 0, redactionMode);
      } else if (mode === "file") {
        // 单文件
        const res = await documentToolsApi.redactUpload(files[0], {
          policy,
          strengthLevel,
          outputFormat,
        });
        setResult(res);
        setNotice({ tone: "success", text: `${t("documentTools.redaction.fileRedactSuccess", "文件脱敏完成，发现")}${res.entity_count}${t("documentTools.redaction.entities", "个实体")}` });
        addToHistory("file", files[0].name, res.entity_count || 0, redactionMode);
      } else {
        // 批量
        await documentToolsApi.batchRedact(
          files,
          { policy, strengthLevel },
          (event: any) => {
            if (event.type === "result") {
              setBatchResults((prev) => {
                const existing = prev.findIndex((r: any) => r.file === event.file);
                const entry: BatchFileResult = {
                  file: event.file || "",
                  success: event.success,
                  entity_count: event.entity_count,
                  output_file: event.output_file,
                  mapping_file: event.mapping_file,
                  error: event.error,
                };
                if (existing >= 0) {
                  const updated = [...prev];
                  updated[existing] = entry;
                  return updated;
                }
                return [...prev, entry];
              });
            }
          },
          (summary: any) => {
            setBatchResult(summary);
            if (summary.results) {
              setBatchResults(summary.results.map((r: any) => ({
                file: r.file || "",
                success: r.success,
                entity_count: r.entity_count,
                output_file: r.output_file,
                mapping_file: r.mapping_file,
                error: r.error,
              })));
            }
            setNotice({
              tone: summary.fail_count > 0 ? "warning" : "success",
              text: t("documentTools.redaction.batchComplete", "批量脱敏完成：成功 {success}/{total} 个文件，共发现 {count} 个实体")
                .replace("{success}", String(summary.success_count))
                .replace("{total}", String(summary.total_files))
                .replace("{count}", String(summary.total_entity_count)),
            });
          },
          (summary: any) => {
            setBatchResult(summary);
            if (summary.results) {
              setBatchResults(summary.results.map((r: any) => ({
                file: r.file || "",
                success: r.success,
                entity_count: r.entity_count,
                output_file: r.output_file,
                mapping_file: r.mapping_file,
                error: r.error,
              })));
            }
            setNotice({
              tone: summary.fail_count > 0 ? "warning" : "success",
              text: t("documentTools.redaction.batchComplete", "批量脱敏完成：成功 {success}/{total} 个文件，共发现 {count} 个实体")
                .replace("{success}", String(summary.success_count))
                .replace("{total}", String(summary.total_files))
                .replace("{count}", String(summary.total_entity_count)),
            });
            addToHistory("batch", `${files.length} files`, summary.total_entity_count || 0, redactionMode);
          },
          (err: string) => setNotice({ tone: "error", text: err }),
        );
      }
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("documentTools.redaction.failed", "脱敏失败") });
    } finally {
      setProcessing(false);
    }
  }, [files, text, mode, policy, strengthLevel, redactionMode, outputFormat, agentModel, t, addToHistory]);

  // -- 文件处理 --
  const handleFileSelect = useCallback((file: File) => {
    setFiles((prev) => [...prev, file]);
    setText(""); // 清空文本，切换到文件模式
  }, []);

  const handleAddFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(fileList as unknown as File[])]);
      setText("");
    }
    e.target.value = "";
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setBatchResult(null);
    setBatchResults([]);
  }, []);

  const handleCopyResult = useCallback((txt: string) => {
    navigator.clipboard.writeText(txt);
    message.success(t("common.copied", "已复制到剪贴板"));
  }, [t]);

  const deleteHistoryEntry = useCallback((id: string) => {
    const updated = history.filter((h) => h.id !== id);
    saveHistory(updated);
    setHistory(updated);
  }, [history]);

  const clearHistory = useCallback(() => {
    saveHistory([]);
    setHistory([]);
  }, []);

  const hasInput = text.trim() || files.length > 0;
  const showTextResult = mode === "text" && result;
  const showFileResult = mode === "file" && result;
  const showBatchResult = mode === "batch" && (batchResult || batchResults.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 通知 */}
      {notice && (
        <Alert
          type={notice.tone === "error" ? "error" : notice.tone === "success" ? "success" : notice.tone === "warning" ? "warning" : "info"}
          showIcon
          closable
          onClose={() => setNotice(null)}
          message={notice.text}
        />
      )}

      {/* 主操作区：上传 + 文本输入二合一 */}
      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ position: "relative" }}>
          {/* 拖拽上传区 */}
          <Dragger
            accept=".txt,.md,.markdown,.html,.htm,.pdf,.doc,.docx,.csv,.tsv,.xlsx,.xls,.json,.jsonl,.pptx,.rtf,.log,.yaml,.yml,.xml"
            beforeUpload={(file) => { handleFileSelect(file as unknown as File); return false; }}
            showUploadList={false}
            disabled={processing}
            style={{ border: "none", background: "transparent" }}
            multiple
          >
            <p className="ant-upload-drag-icon" style={{ marginBottom: 8 }}>
              <InboxOutlined />
            </p>
            <p className="ant-upload-text" style={{ fontSize: 15, fontWeight: 500 }}>
              {t("documentTools.redaction.dragOrPaste", "拖拽文件到此处，或粘贴文本直接脱敏")}
            </p>
            <p className="ant-upload-hint" style={{ fontSize: 13, color: "#999" }}>
              {t("documentTools.redaction.supportedFormats", "支持 PDF/DOCX/TXT/MD/HTML/CSV/XLSX/JSON/PPTX · 多文件自动批量处理")}
            </p>
          </Dragger>

          {/* 文本输入区（无文件时显示） */}
          {files.length === 0 && (
            <TextArea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("documentTools.redaction.textPlaceholder", "粘贴需要脱敏的法律文书、合同、裁决书等文本...")}
              rows={6}
              showCount
              maxLength={100000}
              style={{
                borderTop: "1px solid #f0f0f0",
                borderRadius: 0,
                resize: "vertical",
              }}
            />
          )}
        </div>

        {/* 已选文件列表 */}
        {files.length > 0 && (
          <div style={{ padding: "8px 16px", borderTop: "1px solid #f0f0f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text strong>
                {mode === "batch"
                  ? `${t("documentTools.redaction.batchMode", "批量模式")} (${files.length} ${t("documentTools.redaction.files", "个文件")})`
                  : t("documentTools.redaction.fileMode", "文件模式")}
              </Text>
              <Space>
                <Button size="small" icon={<FolderOpenOutlined />} onClick={() => folderInputRef.current?.click()}>
                  {t("documentTools.redaction.addMore", "继续添加")}
                </Button>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={clearFiles}>
                  {t("common.clear", "清空")}
                </Button>
              </Space>
            </div>
            <div style={{ maxHeight: 180, overflowY: "auto" }}>
              {files.map((f, idx) => (
                <div
                  key={`${f.name}-${idx}-${f.size}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    borderBottom: idx < files.length - 1 ? "1px solid #f5f5f5" : "none",
                  }}
                >
                  <Space>
                    <Tag color={fileTypeMeta(f.name).color} style={{ marginRight: 0 }}>
                      {fileTypeMeta(f.name).icon} {fileTypeMeta(f.name).label}
                    </Tag>
                    <Text ellipsis style={{ maxWidth: 300, fontSize: 13 }}>{f.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{(f.size / 1024).toFixed(1)} KB</Text>
                  </Space>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeFile(idx)} />
                </div>
              ))}
            </div>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              hidden
              accept=".txt,.md,.markdown,.html,.htm,.pdf,.doc,.docx,.csv,.tsv,.xlsx,.xls,.json,.jsonl,.pptx,.rtf,.log,.yaml,.yml,.xml"
              onChange={handleAddFiles}
            />
          </div>
        )}
      </Card>

      {/* 操作栏 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Space wrap>
          {/* 脱敏模式快速切换 */}
          <div style={{ display: "flex", gap: 8 }}>
            <div
              onClick={() => setRedactionMode("standard")}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: redactionMode === "standard" ? "2px solid #1677ff" : "1px solid #d9d9d9",
                background: redactionMode === "standard" ? "rgba(22,119,255,0.04)" : "transparent",
                padding: "8px 12px",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <SafetyOutlined style={{ color: redactionMode === "standard" ? "#1677ff" : "#999" }} />
              <Text strong style={{ fontSize: 13 }}>{t("documentTools.redaction.standardMode", "标准脱敏")}</Text>
            </div>
            <div
              onClick={() => setRedactionMode("agent_enhanced")}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: redactionMode === "agent_enhanced" ? "2px solid #1677ff" : "1px solid #d9d9d9",
                background: redactionMode === "agent_enhanced" ? "rgba(22,119,255,0.04)" : "transparent",
                padding: "8px 12px",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ScanOutlined style={{ color: redactionMode === "agent_enhanced" ? "#1677ff" : "#999" }} />
              <Text strong style={{ fontSize: 13 }}>{t("documentTools.redaction.agentEnhanced", "Agent 增强")}</Text>
            </div>
            <div
              onClick={() => { setRedactionMode("standard"); setPolicy("public_release"); setStrengthLevel("L1"); }}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: redactionMode === "standard" && policy === "public_release" ? "2px solid #ff4d4f" : "1px solid #d9d9d9",
                background: redactionMode === "standard" && policy === "public_release" ? "rgba(255,77,79,0.04)" : "transparent",
                padding: "8px 12px",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div style={{ width: 14, height: 14, borderRadius: 2, background: "#333", border: "1px solid #555" }} />
              <Text strong style={{ fontSize: 13 }}>{t("documentTools.redaction.blackoutMode", "涂黑")}</Text>
            </div>
          </div>

          {/* Agent 模型选择（仅 Agent 模式） */}
          {redactionMode === "agent_enhanced" && (
            <Select
              value={agentModel}
              onChange={setAgentModel}
              style={{ width: 280 }}
              loading={loadingModels}
              allowClear
              placeholder={t("documentTools.redaction.useGlobalDefault", "使用全局默认模型")}
              options={agentModelOptions}
              notFoundContent={
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("documentTools.redaction.noModelsAvailable", "暂无可用模型")} style={{ padding: "8px 0" }} />
              }
            />
          )}
        </Space>

        <Space>
          {/* History toggle */}
          <Button
            type="text"
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => setShowHistory(!showHistory)}
          >
            {t("documentTools.redaction.history", "脱敏记录")}
            {history.length > 0 && <Tag style={{ marginLeft: 4 }} color="blue">{history.length}</Tag>}
          </Button>

          {/* Advanced settings toggle */}
          <Button type="text" size="small" onClick={() => setShowAdvanced(!showAdvanced)}>
            {t("documentTools.redaction.advancedSettings", "高级设置")}
            {showAdvanced ? " ▲" : " ▼"}
          </Button>

          {/* 执行按钮 */}
          <Button
            type="primary"
            size="large"
            icon={processing ? <LoadingOutlined /> : <SafetyCertificateOutlined />}
            onClick={handleRedact}
            loading={processing}
            disabled={!hasInput}
          >
            {processing
              ? t("documentTools.redaction.processing", "正在脱敏...")
              : t("documentTools.redaction.execute", "执行脱敏")}
          </Button>
        </Space>
      </div>

      {/* Redaction history (collapsible) */}
      {showHistory && (
        <Card
          size="small"
          title={
            <Space>
              <HistoryOutlined />
              {t("documentTools.redaction.historyTitle", "脱敏记录")}
              {history.length > 0 && <Tag color="blue">{history.length}</Tag>}
            </Space>
          }
          extra={
            history.length > 0 ? (
              <Button size="small" danger onClick={clearHistory}>
                {t("common.clear", "清空")}
              </Button>
            ) : null
          }
        >
          {history.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("documentTools.redaction.noHistory", "暂无脱敏记录")}
              style={{ padding: "16px 0" }}
            />
          ) : (
            <Table
              size="small"
              pagination={{ pageSize: 5 }}
              dataSource={history}
              rowKey="id"
              columns={[
                {
                  title: t("documentTools.redaction.time", "时间"),
                  dataIndex: "timestamp",
                  width: 160,
                  render: (v: string) => new Date(v).toLocaleString(),
                },
                {
                  title: t("documentTools.redaction.inputType", "输入类型"),
                  dataIndex: "inputType",
                  width: 80,
                  render: (v: string) => {
                    const colors: Record<string, string> = { text: "blue", file: "green", batch: "orange" };
                    return <Tag color={colors[v] || "default"}>{v}</Tag>;
                  },
                },
                {
                  title: t("documentTools.redaction.inputName", "输入名称"),
                  dataIndex: "inputName",
                  ellipsis: true,
                  width: 200,
                },
                {
                  title: t("documentTools.redaction.mode", "模式"),
                  dataIndex: "redactionMode",
                  width: 100,
                  render: (v: string) => v === "agent_enhanced" ? <Tag color="purple">Agent</Tag> : <Tag>标准</Tag>,
                },
                {
                  title: t("documentTools.redaction.entityCount", "实体数"),
                  dataIndex: "entityCount",
                  width: 80,
                  render: (v: number) => v,
                },
                {
                  title: "",
                  width: 50,
                  render: (_: any, record: RedactionHistoryEntry) => (
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => deleteHistoryEntry(record.id)}
                    />
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* 高级设置（折叠） */}
      {showAdvanced && (
        <Card size="small" style={{ background: "#fafafa" }}>
          <Row gutter={[16, 12]}>
            <Col span={8}>
              <div>
                <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  {t("documentTools.redaction.selectPolicy", "脱敏策略")}
                </Text>
                <Select
                  value={policy}
                  onChange={setPolicy}
                  style={{ width: "100%" }}
                  options={policies.map((p) => ({ label: `${p.name} (${p.id})`, value: p.id }))}
                />
              </div>
            </Col>
            <Col span={8}>
              <div>
                <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  {t("documentTools.redaction.strengthLevel", "强度级别")}
                </Text>
                <Select
                  value={strengthLevel}
                  onChange={setStrengthLevel}
                  style={{ width: "100%" }}
                  allowClear
                  options={[
                    { label: "L1 - 高度", value: "L1" },
                    { label: "L2 - 中度", value: "L2" },
                    { label: "L3 - 轻度", value: "L3" },
                    { label: "L4 - 名义", value: "L4" },
                  ]}
                />
              </div>
            </Col>
            {mode !== "text" && (
              <Col span={8}>
                <div>
                  <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                    {t("documentTools.redaction.outputFormat", "输出格式")}
                  </Text>
                  <Select
                    value={outputFormat}
                    onChange={setOutputFormat}
                    style={{ width: "100%" }}
                    options={[
                      { label: "Markdown", value: "md" },
                      { label: "TXT", value: "txt" },
                      { label: "PDF", value: "pdf" },
                    ]}
                  />
                </div>
              </Col>
            )}
          </Row>
          {strengthLevel && strengthLevels.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {strengthLevels.find((s) => s.id === strengthLevel)?.description || ""}
            </Text>
          )}
        </Card>
      )}

      {/* 结果区 */}
      {showTextResult && (
        <div>
          <Row gutter={16}>
            <Col span={12}>
              <Text strong>{t("documentTools.redaction.originalText", "原始文本")}</Text>
              <TextArea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                style={{ marginTop: 4 }}
              />
            </Col>
            <Col span={12}>
              <Space style={{ marginBottom: 4, width: "100%", justifyContent: "space-between" }}>
                <Text strong>{t("documentTools.redaction.redactedText", "脱敏结果")}</Text>
                {result?.redacted_text && (
                  <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopyResult(result!.redacted_text)}>
                    {t("common.copy", "复制")}
                  </Button>
                )}
              </Space>
              <TextArea
                value={result?.redacted_text || ""}
                readOnly
                rows={10}
                style={{ marginTop: 4, background: "#fafafa", fontFamily: "monospace" }}
                placeholder={t("documentTools.redaction.redactedPlaceholder", "脱敏后的文本将显示在此处...")}
              />
            </Col>
          </Row>
          <RedactionResult result={result} t={t} />
        </div>
      )}

      {showFileResult && (
        <div>
          <RedactionResult result={result!} t={t} />
        </div>
      )}

      {showBatchResult && (
        <Card size="small" title={batchResult ? t("documentTools.redaction.batchResults", "批量脱敏结果") : t("documentTools.redaction.batchProgress", "正在处理...")}>
          <Progress
            percent={batchResult
              ? Math.round((batchResult.success_count / Math.max(1, batchResult.total_files)) * 100)
              : Math.round((batchResults.length / Math.max(1, files.length)) * 100)
            }
            status={processing ? "active" : batchResult?.fail_count && batchResult.fail_count > 0 ? "exception" : "success"}
          />
          {batchResult && (
            <Row gutter={16} style={{ marginTop: 12 }}>
              <Col span={6}><Statistic title={t("documentTools.redaction.totalFiles", "总文件数")} value={batchResult.total_files} valueStyle={{ fontSize: 14 }} /></Col>
              <Col span={6}><Statistic title={t("documentTools.redaction.successCount", "成功")} value={batchResult.success_count} valueStyle={{ color: "#3f8600", fontSize: 14 }} /></Col>
              <Col span={6}><Statistic title={t("documentTools.redaction.failCount", "失败")} value={batchResult.fail_count} valueStyle={{ fontSize: 14, color: batchResult.fail_count > 0 ? "#cf1322" : "#3f8600" }} /></Col>
              <Col span={6}><Statistic title={t("documentTools.redaction.totalEntities", "总实体数")} value={batchResult.total_entity_count} valueStyle={{ fontSize: 14 }} /></Col>
            </Row>
          )}
          {(batchResult || batchResults.length > 0) && (
            <Table
              size="small"
              pagination={{ pageSize: 10 }}
              dataSource={batchResult?.results ?? batchResults}
              rowKey={(r: any, idx?: number) => r?.file ?? `pending-${idx}`}
              columns={[
                {
                  title: t("documentTools.redaction.fileName", "文件名"),
                  dataIndex: "file",
                  width: 250,
                  ellipsis: true,
                  render: (v: string) => (
                    <Space>
                      {v && <Tag color={fileTypeMeta(v).color}>{fileTypeMeta(v).label}</Tag>}
                      <Text ellipsis style={{ maxWidth: 180 }}>{v}</Text>
                    </Space>
                  ),
                },
                {
                  title: t("documentTools.redaction.status", "状态"),
                  dataIndex: "success",
                  width: 90,
                  render: (v: boolean | undefined) =>
                    v === true ? <Tag color="green" icon={<CheckCircleFilled />}>OK</Tag>
                    : v === false ? <Tag color="red">FAIL</Tag>
                    : <Tag color="blue" icon={<LoadingOutlined />}>{t("documentTools.redaction.processing", "处理中")}</Tag>,
                },
                {
                  title: t("documentTools.redaction.entityCount", "实体数"),
                  dataIndex: "entity_count",
                  width: 80,
                  render: (v: number) => v != null ? v : "-",
                },
                {
                  title: t("documentTools.redaction.outputFile", "输出文件"),
                  dataIndex: "output_file",
                  ellipsis: true,
                  width: 280,
                  render: (v: string | undefined) => v ? (
                    <Space>
                      <Tooltip title={v}><Text copyable={{ text: v }} ellipsis style={{ maxWidth: 120 }}>{v.split(/[\\/]/).pop()}</Text></Tooltip>
                      <Button
                        type="text"
                        size="small"
                        icon={<FolderOpenOutlined />}
                        onClick={async () => {
                          try {
                            const parts = v.split(/[\\/]/);
                            const folder = parts.slice(0, -1).join("/");
                            await documentToolsApi.revealInFolder(folder, v);
                          } catch (e: any) {
                            message.error(e?.message || "打开文件夹失败");
                          }
                        }}
                      />
                    </Space>
                  ) : "-",
                },
                {
                  title: t("documentTools.redaction.errorMsg", "错误信息"),
                  dataIndex: "error",
                  ellipsis: true,
                  render: (v: string) => v ? <Text type="danger">{v}</Text> : "-",
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* Bottom reference info — collapsed by default to keep page clean */}
      <Collapse
        size="small"
        items={[
          {
            key: "strength-levels",
            label: t("documentTools.redaction.strengthLevelsTitle", "脱敏强度级别说明"),
            children: strengthLevels.length > 0 ? (
              <Space wrap>
                {strengthLevels.map((s) => (
                  <Tooltip key={s.id} title={s.description}>
                    <Tag color={s.id === "L1" ? "red" : s.id === "L2" ? "orange" : s.id === "L3" ? "blue" : "green"} style={{ padding: "4px 12px", fontSize: 13 }}>
                      <Text strong>{s.id}</Text> - {s.name}
                    </Tag>
                  </Tooltip>
                ))}
              </Space>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("documentTools.redaction.noData", "暂无数据")} />
            ),
          },
          {
            key: "entity-types",
            label: t("documentTools.redaction.entityTypes", "支持的实体类型"),
            children: entities.length > 0 ? (
              <Space wrap>
                {entities.map((e) => (
                  <Tooltip key={e.id} title={e.description}>
                    <Tag color={entityColor(e.id)}>{e.name} ({e.id})</Tag>
                  </Tooltip>
                ))}
              </Space>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("documentTools.redaction.noData", "暂无数据")} />
            ),
          },
        ]}
      />
    </div>
  );
}

// -- Sub-component: RedactionResult (unchanged) ---

function RedactionResult({
  result,
  t,
}: {
  result: RedactTextResult;
  t: (key: string, defaultValue?: string) => string;
}) {
  return (
    <Card size="small" style={{ marginTop: 16 }}>
      <Row gutter={16}>
        <Col span={6}>
          <Statistic title={t("documentTools.redaction.entityCount", "实体总数")} value={result.entity_count} />
        </Col>
        <Col span={6}>
          <Statistic title={t("documentTools.redaction.reviewItems", "需复核")} value={result.review_items.length} valueStyle={{ color: result.review_items.length > 0 ? "#fa8c16" : "#3f8600" }} />
        </Col>
        <Col span={6}>
          <Statistic title={t("documentTools.redaction.clusters", "实体聚类")} value={result.cluster_table.length} />
        </Col>
        <Col span={6}>
          <Statistic title={t("documentTools.redaction.policy", "策略")} valueRender={() => <Tag color="blue">{result.policy_name}</Tag>} value={result.policy_name} />
        </Col>
      </Row>

      {result.review_items.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          style={{ marginTop: 12 }}
          message={t("documentTools.redaction.reviewNeeded", "以下实体类型被标记为「可配置」，请根据具体场景决定脱敏方式：")}
          description={
            <Space wrap>
              {result.review_items.map((item, i) => (
                <Tag key={i} color="volcano">{item.entity_type}: {item.original}</Tag>
              ))}
            </Space>
          }
        />
      )}

      {result.cluster_table.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong>{t("documentTools.redaction.clusterTable", "实体聚类表（同一主体多称谓统一映射）")}</Text>
          <Table
            size="small"
            style={{ marginTop: 8 }}
            pagination={false}
            dataSource={result.cluster_table}
            rowKey="cluster_id"
            columns={[
              { title: "Cluster ID", dataIndex: "cluster_id", width: 200 },
              { title: t("documentTools.redaction.canonicalName", "规范名称"), dataIndex: "canonical", width: 200 },
              { title: t("documentTools.redaction.redactedForm", "脱敏形式"), dataIndex: "redacted", width: 200 },
              {
                title: t("documentTools.redaction.mentions", "所有称谓"),
                dataIndex: "mentions",
                render: (mentions: string[]) => (
                  <Space wrap>{mentions.map((m, i) => <Tag key={i}>{m}</Tag>)}</Space>
                ),
              },
            ]}
          />
        </div>
      )}

      {result.mappings.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Divider><Text strong>{t("documentTools.redaction.mappingDetails", "脱敏映射详情")}</Text></Divider>
          <Table
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 800 }}
            dataSource={result.mappings}
            rowKey={(r) => r.entity_id}
            columns={[
              { title: "ID", dataIndex: "entity_id", width: 120, ellipsis: true },
              { title: t("documentTools.redaction.type", "类型"), dataIndex: "entity_type", width: 120, render: (v: string) => <Tag color={entityColor(v)}>{v}</Tag> },
              { title: t("documentTools.redaction.original", "原文"), dataIndex: "original", width: 200, ellipsis: true },
              { title: t("documentTools.redaction.redacted", "脱敏后"), dataIndex: "redacted", width: 200, ellipsis: true, render: (v: string) => <Text code>{v}</Text> },
              { title: t("documentTools.redaction.mode", "模式"), dataIndex: "mode", width: 120, render: (v: string) => <Tag color={modeColor(v)}>{formatMode(v)}</Tag> },
              { title: t("documentTools.redaction.confidence", "置信度"), dataIndex: "confidence", width: 80, render: (v: number) => v.toFixed(2) },
            ]}
          />
        </div>
      )}

      {result.mappings.length === 0 && (
        <Empty description={t("documentTools.redaction.noEntitiesFound", "未检测到敏感实体")} style={{ marginTop: 16 }} />
      )}

      {(result.output_file || result.mapping_file) && (
        <div style={{ marginTop: 12 }}>
          <Divider><Text strong>{t("documentTools.redaction.outputInfo", "输出文件")}</Text></Divider>
          <Space style={{ marginBottom: 12 }}>
            {result.output_file && (
              <>
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={async () => {
                    try {
                      const preview = await documentToolsApi.previewFile(result.output_file!);
                      if (preview.is_binary) {
                        // For binary files, open with system app
                        await documentToolsApi.openFile(result.output_file!);
                      } else if (preview.content) {
                        // For text files, show in new window
                        const w = window.open("", "_blank");
                        if (w) {
                          w.document.write(`<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:14px;padding:16px;">${preview.content.replace(/</g, "&lt;")}</pre>`);
                          w.document.title = preview.file_name;
                        }
                      }
                    } catch (e: any) {
                      message.error(e?.message || "预览失败");
                    }
                  }}
                >
                  {t("documentTools.redaction.preview", "预览")}
                </Button>
                <Button
                  size="small"
                  icon={<FileDoneOutlined />}
                  onClick={async () => {
                    try {
                      await documentToolsApi.openFile(result.output_file!);
                    } catch (e: any) {
                      message.error(e?.message || "打开文件失败");
                    }
                  }}
                >
                  {t("documentTools.redaction.openFile", "打开")}
                </Button>
                <Button
                  size="small"
                  icon={<FolderOpenOutlined />}
                  onClick={async () => {
                    try {
                      const parts = result.output_file!.split(/[\\/]/);
                      const folder = parts.slice(0, -1).join("/");
                      await documentToolsApi.revealInFolder(folder, result.output_file!);
                    } catch (e: any) {
                      message.error(e?.message || "打开文件夹失败");
                    }
                  }}
                >
                  {t("documentTools.redaction.openFolder", "所在文件夹")}
                </Button>
              </>
            )}
          </Space>
          <Descriptions size="small" column={1} bordered>
            {result.output_file && (
              <Descriptions.Item label={t("documentTools.redaction.outputFile", "脱敏后文件")}>
                <Space>
                  <Tooltip title={result.output_file}>
                    <Text copyable={{ text: result.output_file }} ellipsis style={{ maxWidth: 350 }}>{result.output_file.split(/[\\/]/).pop()}</Text>
                  </Tooltip>
                  <Tag color="green">{result.output_format || "md"}</Tag>
                </Space>
              </Descriptions.Item>
            )}
            {result.mapping_file && (
              <Descriptions.Item label={t("documentTools.redaction.mappingFile", "映射还原文件")}>
                <Space>
                  <Tooltip title={result.mapping_file}>
                    <Text copyable={{ text: result.mapping_file }} ellipsis style={{ maxWidth: 350 }}>{result.mapping_file.split(/[\\/]/).pop()}</Text>
                  </Tooltip>
                  <Tag color="blue">.mapping.enc</Tag>
                </Space>
              </Descriptions.Item>
            )}
            {result.document_name && (
              <Descriptions.Item label={t("documentTools.redaction.documentName", "文档名称")}>{result.document_name}</Descriptions.Item>
            )}
          </Descriptions>
        </div>
      )}

      {/* Agent 增强建议 */}
      {(result as any)?.agent_review && (
        <div style={{ marginTop: 12 }}>
          <Divider>
            <Space>
              <ThunderboltOutlined />
              <Text strong>{t("documentTools.redaction.agentReview", "Agent 复核结果")}</Text>
              <Tag color="blue">{(result as any).agent_mode || "enhanced"}</Tag>
            </Space>
          </Divider>

          {(result as any).agent_suggestions?.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={t("documentTools.redaction.agentFoundSuggestions", "Agent 发现 {count} 条可能遗漏的敏感实体建议：").replace("{count}", String((result as any).agent_suggestions.length))}
              description={
                <Table
                  size="small"
                  pagination={false}
                  dataSource={(result as any).agent_suggestions}
                  rowKey={(_: any, i: number) => `suggestion-${i}`}
                  columns={[
                    { title: t("documentTools.redaction.original", "原文"), dataIndex: "original", width: 180, ellipsis: true },
                    { title: t("documentTools.redaction.type", "类型"), dataIndex: "entity_type", width: 120, render: (v: string) => <Tag color="orange">{v}</Tag> },
                    { title: t("documentTools.redaction.suggestedReplacement", "建议替换为"), dataIndex: "suggested_replacement", width: 180, render: (v: string) => <Text code>{v}</Text> },
                    { title: t("documentTools.redaction.reason", "原因"), dataIndex: "reason", ellipsis: true },
                  ]}
                />
              }
            />
          )}

          {(result as any).agent_review?.summary && (
            <Alert
              type="info"
              showIcon
              message={t("documentTools.redaction.agentSummary", "Agent 评价")}
              description={<Text>{(result as any).agent_review.summary}</Text>}
            />
          )}

          {(result as any).agent_review?.consistency_issues?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text strong type="warning">
                {t("documentTools.redaction.consistencyIssues", "一致性问题 ({count})").replace("{count}", String((result as any).agent_review.consistency_issues.length))}
              </Text>
              <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
                {(result as any).agent_review.consistency_issues.map((issue: any, idx: number) => (
                  <li key={idx}>
                    <Text>{issue.issue}</Text>
                    {issue.suggestion && <Text type="secondary"> → {issue.suggestion}</Text>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}