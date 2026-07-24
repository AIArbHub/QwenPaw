import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FolderOutlined,
  FileTextOutlined,
  EyeOutlined,
  SafetyOutlined,
  UndoOutlined,
  ExportOutlined,
  LinkOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  TeamOutlined,
  RobotOutlined,
  FileDoneOutlined,
  BarChartOutlined,
  TagOutlined,
  ScanOutlined,
  SendOutlined,
  EditOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Badge,
  Empty,
  Popconfirm,
  Descriptions,
  Table,
  message,
  Drawer,
  Tooltip,
  Tabs,
  Spin,
  Typography,
  Checkbox,
  Alert,
  Statistic,
  Row,
  Col,
  Timeline,
  Switch,
  Divider,
  InputNumber,
  Avatar,
} from "antd";
import { PageHeader } from "@/components/PageHeader";
import FolderPicker from "@/components/FolderPicker";
import { casesApi } from "@/api/modules/cases";
import { knowledgeApi } from "@/api/modules/knowledge";
import { wikiApi } from "@/api/modules/wiki";
import type {
  CaseRef,
  CaseDetailResponse,
  CaseFile,
  CaseStructuredInfo,
  CaseParty,
  FileTag,
  MaterialZone,
  UpdateFileTagParams,
  AIOrganizeResult,
  CaseAIChatMessage,
} from "@/api/modules/cases";
import {
  MATERIAL_ZONE_LABELS,
  MATERIAL_ZONE_COLORS,
} from "@/api/modules/cases";
import type { WikiPage } from "@/api/modules/wiki";
import EntityRegistry from "../Documents/components/EntityRegistry";
import MaterialSelector, {
  type SelectedMaterial,
} from "../Documents/components/MaterialSelector";
import PipelineStatus from "../Documents/components/PipelineStatus";
import styles from "./index.module.less";

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusToBadge(status: string): { color: string; text: string } {
  const map: Record<string, { color: string; text: string }> = {
    ready: { color: "green", text: "就绪" },
    pending: { color: "gold", text: "待处理" },
    scanning: { color: "processing", text: "扫描中" },
    failed: { color: "red", text: "失败" },
  };
  return map[status] || { color: "default", text: status };
}

const ZONE_OPTIONS: { value: MaterialZone; label: string; color: string }[] = (
  Object.keys(MATERIAL_ZONE_LABELS) as MaterialZone[]
).map((z) => ({
  value: z,
  label: MATERIAL_ZONE_LABELS[z],
  color: MATERIAL_ZONE_COLORS[z],
}));

const FILE_CATEGORIES = [
  "仲裁申请书",
  "答辩书",
  "反请求申请书",
  "证据材料",
  "代理词",
  "庭审笔录",
  "裁决书",
  "鉴定报告",
  "程序文件",
  "其他",
];

export default function CasesPage() {
  const { t } = useTranslation();
  const [cases, setCases] = useState<CaseRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseRef | null>(null);
  const [caseDetail, setCaseDetail] = useState<CaseDetailResponse | null>(null);
  const [addForm] = Form.useForm();
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<CaseFile | null>(null);
  const [fileTab, setFileTab] = useState("info");
  const [parsedContent, setParsedContent] = useState("");
  const [parsedLoading, setParsedLoading] = useState(false);
  const [desensitizedContent, setDesensitizedContent] = useState("");
  const [desensitizedLoading, setDesensitizedLoading] = useState(false);
  const [restoredContent, setRestoredContent] = useState("");
  const [restoredLoading, setRestoredLoading] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportRestore, setExportRestore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedExportFiles, setSelectedExportFiles] = useState<string[]>([]);
  const [wikiRefs, setWikiRefs] = useState<WikiPage[]>([]);
  const [wikiRefsLoading, setWikiRefsLoading] = useState(false);
  const [ingestingCase, setIngestingCase] = useState(false);
  const [caseAiPreference, setCaseAiPreference] = useState<"original" | "desensitized" | "ask">("desensitized");
  const [materialSelectorOpen, setMaterialSelectorOpen] = useState(false);
  const [caseTab, setCaseTab] = useState("overview");

  // ── Material zone filter ──
  const [zoneFilter, setZoneFilter] = useState<MaterialZone | "all">("all");

  // ── File tag editor ──
  const [tagEditModalOpen, setTagEditModalOpen] = useState(false);
  const [tagEditingFile, setTagEditingFile] = useState<CaseFile | null>(null);
  const [tagForm] = Form.useForm();

  // ── Structured info editing ──
  const [structuredInfoModalOpen, setStructuredInfoModalOpen] = useState(false);
  const [structuredForm] = Form.useForm();
  const [structuredSaving, setStructuredSaving] = useState(false);

  // ── AI Organize ──
  const [organizeModalOpen, setOrganizeModalOpen] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [organizeResult, setOrganizeResult] = useState<AIOrganizeResult | null>(null);
  const [organizeDryRun, setOrganizeDryRun] = useState(true);

  // ── AI Chat ──
  const [aiMessages, setAiMessages] = useState<CaseAIChatMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiGenerateDoc, setAiGenerateDoc] = useState(false);
  const aiMessagesRef = useRef<HTMLDivElement>(null);

  // ── Scan folder ──
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanPath, setScanPath] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<
    { folder_path: string; suggested_name: string; file_count: number; selected: boolean }[]
  >([]);

  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await casesApi.listCases();
      setCases(res.cases);
    } catch (err) {
      console.error("Failed to fetch cases:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // Auto scroll AI chat
  useEffect(() => {
    if (aiMessagesRef.current) {
      aiMessagesRef.current.scrollTop = aiMessagesRef.current.scrollHeight;
    }
  }, [aiMessages]);

  const handleAddCase = async () => {
    try {
      const values = await addForm.validateFields();
      await casesApi.addCase({
        case_name: values.case_name,
        source_path: values.source_path,
        scan_mode: values.scan_mode || "auto",
        tags: values.tags || [],
      });
      message.success(t("cases.addSuccess", "案件添加成功"));
      setAddModalOpen(false);
      addForm.resetFields();
      fetchCases();
    } catch (err) {
      // validation or API error
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    try {
      await casesApi.deleteCase(caseId);
      message.success(t("cases.deleteSuccess", "案件删除成功"));
      if (selectedCase?.case_id === caseId) {
        setSelectedCase(null);
        setCaseDetail(null);
        setDetailDrawerOpen(false);
      }
      fetchCases();
    } catch (err) {
      message.error(t("cases.deleteFailed", "案件删除失败"));
    }
  };

  const handleViewCase = async (caseRef: CaseRef) => {
    setSelectedCase(caseRef);
    setDetailDrawerOpen(true);
    setCaseTab("overview");
    setZoneFilter("all");
    setAiMessages([]);
    try {
      const detail = await casesApi.getCase(caseRef.case_id);
      setCaseDetail(detail);
    } catch (err) {
      console.error("Failed to fetch case detail:", err);
    }
  };

  const handleRescan = async (caseId: string) => {
    try {
      await casesApi.rescanCase(caseId);
      message.success(t("cases.rescanSuccess", "重新扫描成功"));
      fetchCases();
      if (selectedCase?.case_id === caseId) {
        const detail = await casesApi.getCase(caseId);
        setCaseDetail(detail);
        setSelectedCase(detail.case);
      }
    } catch (err) {
      message.error(t("cases.rescanFailed", "重新扫描失败"));
    }
  };

  const getFileId = (file: CaseFile): string => {
    return file.file_path.replace(/[/.\\]/g, "_");
  };

  const handleViewFile = (file: CaseFile) => {
    setSelectedFile(file);
    setFileDrawerOpen(true);
    setFileTab("info");
    setParsedContent("");
    setDesensitizedContent("");
    setRestoredContent("");
    setWikiRefs([]);
  };

  const handleFileTabChange = (key: string) => {
    setFileTab(key);
    if (!selectedCase || !selectedFile) return;
    const fileId = getFileId(selectedFile);
    if (key === "parsed" && !parsedContent && !parsedLoading) {
      setParsedLoading(true);
      casesApi
        .getCaseParsedFile(selectedCase.case_id, fileId)
        .then((res) => setParsedContent(res.content || ""))
        .catch(() => setParsedContent(""))
        .finally(() => setParsedLoading(false));
    } else if (key === "desensitized" && !desensitizedContent && !desensitizedLoading) {
      setDesensitizedLoading(true);
      casesApi
        .getCaseDesensitizedFile(selectedCase.case_id, fileId)
        .then((res) => setDesensitizedContent(res.content || ""))
        .catch(() => setDesensitizedContent(""))
        .finally(() => setDesensitizedLoading(false));
    } else if (key === "restored" && !restoredContent && !restoredLoading) {
      setRestoredLoading(true);
      casesApi
        .restoreCaseFile(selectedCase.case_id, fileId)
        .then((res) => setRestoredContent(res.content || ""))
        .catch(() => {
          setRestoredContent("");
          message.error(t("cases.restoreFailed", "还原失败，可能缺少回填映射"));
        })
        .finally(() => setRestoredLoading(false));
    } else if (key === "wiki" && wikiRefs.length === 0 && !wikiRefsLoading) {
      loadCaseWikiRefs(selectedCase.case_id);
    }
  };

  const loadCaseWikiRefs = async (caseId: string) => {
    setWikiRefsLoading(true);
    try {
      const res = await wikiApi.listPages({ source_case_id: caseId });
      setWikiRefs(res.pages || []);
    } catch {
      setWikiRefs([]);
    } finally {
      setWikiRefsLoading(false);
    }
  };

  const handleIngestCaseFile = async () => {
    if (!selectedCase) return;
    setIngestingCase(true);
    try {
      const result = await wikiApi.ingest({ case_ids: [selectedCase.case_id] });
      if (result.ingested.length > 0) {
        message.success(
          t("cases.ingestSuccess", "编译完成，新增 {{count}} 个知识页面", {
            count: result.ingested.length,
          }),
        );
      } else if (result.skipped.length > 0) {
        message.info(t("cases.ingestSkipped", "该案件已编译，无新增页面"));
      }
      if (result.errors.length > 0) {
        message.warning(
          t("cases.ingestErrors", "编译过程中 {{count}} 个页面失败", {
            count: result.errors.length,
          }),
        );
      }
      loadCaseWikiRefs(selectedCase.case_id);
    } catch {
      message.error(t("cases.ingestFailed", "编译失败"));
    } finally {
      setIngestingCase(false);
    }
  };

  const handleOpenExport = () => {
    if (!caseDetail) return;
    setSelectedExportFiles(caseDetail.files.map((f) => getFileId(f)));
    setExportRestore(false);
    setExportModalOpen(true);
  };

  const handleExport = async () => {
    if (!selectedCase) return;
    setExporting(true);
    try {
      const res = await casesApi.exportCaseFiles(selectedCase.case_id, {
        file_ids: selectedExportFiles,
        restore: exportRestore,
        authorize: exportRestore,
      });
      const okResults = res.results.filter((r) => r.status === "ok" && r.content);
      if (okResults.length === 0) {
        message.warning(t("cases.exportEmpty", "没有可导出的文件"));
        return;
      }
      const combined = okResults
        .map((r) => `# ${r.file_id}\n\n${r.content}`)
        .join("\n\n---\n\n");
      const blob = new Blob([combined], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedCase.case_name || selectedCase.case_id}${res.restored ? "_restored" : "_desensitized"}.md`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(
        t("cases.exportSuccess", "导出成功，共 {{count}} 个文件", {
          count: okResults.length,
        }),
      );
      setExportModalOpen(false);
    } catch {
      message.error(t("cases.exportFailed", "导出失败"));
    } finally {
      setExporting(false);
    }
  };

  // ── File Tag Management ──
  const handleOpenTagEditor = (file: CaseFile) => {
    setTagEditingFile(file);
    tagForm.setFieldsValue({
      zone: file.zone || "shared",
      category: file.category || "",
      custom_tags: file.custom_tags || [],
      description: "",
    });
    setTagEditModalOpen(true);
  };

  const handleSaveFileTag = async () => {
    if (!selectedCase || !tagEditingFile) return;
    try {
      const values = await tagForm.validateFields();
      await casesApi.updateFileTag(selectedCase.case_id, tagEditingFile.file_path, {
        zone: values.zone,
        category: values.category,
        custom_tags: values.custom_tags || [],
        description: values.description,
      });
      message.success("文件标签已更新");
      setTagEditModalOpen(false);
      // Refresh case detail
      const detail = await casesApi.getCase(selectedCase.case_id);
      setCaseDetail(detail);
    } catch (err) {
      message.error("标签更新失败");
    }
  };

  // ── Structured Info ──
  const handleOpenStructuredInfo = () => {
    if (!caseDetail) return;
    const info = caseDetail.case.structured_info || {
      parties: [],
    };
    structuredForm.setFieldsValue({
      case_number: info.case_number || "",
      arbitration_institution: info.arbitration_institution || "",
      dispute_type: info.dispute_type || "",
      claim_amount: info.claim_amount,
      arbitration_procedure: info.arbitration_procedure || "普通程序",
      arbitration_rules: info.arbitration_rules || "",
      filing_date: info.filing_date || "",
      hearing_date: info.hearing_date || "",
      case_summary: info.case_summary || "",
      parties: info.parties?.length > 0 ? info.parties : [],
    });
    setStructuredInfoModalOpen(true);
  };

  const handleSaveStructuredInfo = async () => {
    if (!selectedCase) return;
    setStructuredSaving(true);
    try {
      const values = await structuredForm.validateFields();
      await casesApi.updateStructuredInfo(selectedCase.case_id, values);
      message.success("案件结构化信息已保存");
      setStructuredInfoModalOpen(false);
      const detail = await casesApi.getCase(selectedCase.case_id);
      setCaseDetail(detail);
      setSelectedCase(detail.case);
    } catch (err) {
      message.error("保存失败");
    } finally {
      setStructuredSaving(false);
    }
  };

  // ── AI Organize ──
  const handleAIOrganize = async () => {
    if (!selectedCase) return;
    setOrganizing(true);
    setOrganizeResult(null);
    try {
      const result = await casesApi.aiOrganize(selectedCase.case_id, {
        dry_run: organizeDryRun,
      });
      setOrganizeResult(result);
      if (!organizeDryRun) {
        message.success("AI整理完成，已备份原文件");
        const detail = await casesApi.getCase(selectedCase.case_id);
        setCaseDetail(detail);
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      message.error(e.message || "AI整理失败");
    } finally {
      setOrganizing(false);
    }
  };

  // ── AI Chat ──
  const handleAISend = async () => {
    if (!selectedCase || !aiInput.trim()) return;
    const userMsg: CaseAIChatMessage = {
      role: "user",
      content: aiInput.trim(),
      timestamp: Date.now() / 1000,
    };
    const newMessages = [...aiMessages, userMsg];
    setAiMessages(newMessages);
    setAiInput("");
    setAiLoading(true);
    try {
      const resp = await casesApi.caseAIChat(selectedCase.case_id, newMessages, {
        generate_doc: aiGenerateDoc,
        doc_format: "docx",
      });
      const assistantMsg: CaseAIChatMessage = {
        role: "assistant",
        content: resp.response,
        timestamp: Date.now() / 1000,
        documents: resp.documents_generated,
      };
      setAiMessages([...newMessages, assistantMsg]);
    } catch (err: unknown) {
      const e = err as { message?: string };
      message.error(e.message || "AI对话失败");
      setAiMessages([
        ...newMessages,
        { role: "assistant", content: "抱歉，处理请求时出错，请稍后重试。", timestamp: Date.now() / 1000 },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  // ── Scan Folder ──
  const handleScanFolder = async () => {
    if (!scanPath.trim()) return;
    setScanLoading(true);
    setScanResults([]);
    try {
      const resp = await casesApi.scanFolder(scanPath.trim(), {
        auto_create_cases: false,
      });
      setScanResults(
        (resp.suggested_cases || []).map((c) => ({
          folder_path: c.folder_path,
          suggested_name: c.suggested_name,
          file_count: c.file_count,
          selected: true,
        })),
      );
    } catch (err: unknown) {
      const e = err as { message?: string };
      message.error(e.message || "扫描文件夹失败");
    } finally {
      setScanLoading(false);
    }
  };

  const handleBatchCreateFromScan = async () => {
    const selected = scanResults.filter((r) => r.selected);
    if (selected.length === 0) {
      message.warning("请至少选择一个案件文件夹");
      return;
    }
    setScanLoading(true);
    let success = 0;
    for (const item of selected) {
      try {
        await casesApi.addCase({
          case_name: item.suggested_name,
          source_path: item.folder_path,
          scan_mode: "auto",
        });
        success++;
      } catch {
        // continue
      }
    }
    message.success(`成功创建 ${success} 个案件`);
    setScanModalOpen(false);
    setScanPath("");
    setScanResults([]);
    fetchCases();
  };

  // ── Filtered files by zone ──
  const filteredFiles = useCallback(() => {
    if (!caseDetail) return [];
    if (zoneFilter === "all") return caseDetail.files;
    return caseDetail.files.filter((f) => (f.zone || "shared") === zoneFilter);
  }, [caseDetail, zoneFilter]);

  const fileColumns = [
    {
      title: t("cases.fileName", "文件名"),
      dataIndex: "file_name",
      key: "file_name",
      ellipsis: true,
    },
    {
      title: "分区",
      key: "zone",
      width: 100,
      render: (_: unknown, record: CaseFile) => {
        const zone = record.zone || "shared";
        return (
          <Tag color={MATERIAL_ZONE_COLORS[zone]} style={{ fontSize: 11 }}>
            {MATERIAL_ZONE_LABELS[zone]}
          </Tag>
        );
      },
    },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      width: 100,
      render: (v: string) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : <Text type="secondary" style={{ fontSize: 11 }}>未分类</Text>,
    },
    {
      title: t("cases.fileType", "类型"),
      dataIndex: "file_type",
      key: "file_type",
      width: 60,
      render: (v: string) => v.toUpperCase(),
    },
    {
      title: t("cases.fileSize", "大小"),
      dataIndex: "size",
      key: "size",
      width: 80,
      render: (v: number) => formatFileSize(v),
    },
    {
      title: t("cases.fileStatus", "状态"),
      dataIndex: "status",
      key: "status",
      width: 70,
      render: (v: string) => {
        const badge = statusToBadge(v);
        return <Badge color={badge.color} text={badge.text} />;
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_: unknown, record: CaseFile) => (
        <Space size={0}>
          <Tooltip title={t("cases.viewFile", "查看文件")}>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handleViewFile(record)}
            />
          </Tooltip>
          <Tooltip title="编辑标签">
            <Button
              type="link"
              size="small"
              icon={<TagOutlined />}
              onClick={() => handleOpenTagEditor(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.pageContainer}>
      <PageHeader
        current="案件中心"
        subRow={
          <Space>
            <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
              管理仲裁案件文件，支持材料分区权限控制与AI智能分析
            </span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ScanOutlined />} onClick={() => setScanModalOpen(true)}>
              扫描本地文件夹
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
              新建案件
            </Button>
          </Space>
        }
      />

      {cases.length > 0 && (
        <Row gutter={16} style={{ margin: "0 24px 16px" }}>
          <Col flex={1}>
            <Card size="small">
              <Statistic
                title={t("documents.dashboard.caseCount", "案件总数")}
                value={cases.length}
                prefix={<FolderOutlined style={{ color: "#1890ff" }} />}
              />
            </Card>
          </Col>
          <Col flex={1}>
            <Card size="small">
              <Statistic
                title={t("documents.dashboard.fileCount", "文件总数")}
                value={cases.reduce((sum, c) => sum + c.file_count, 0)}
                prefix={<FileTextOutlined style={{ color: "#52c41a" }} />}
              />
            </Card>
          </Col>
          <Col flex={1}>
            <Card size="small">
              <Statistic
                title={t("documents.dashboard.indexed", "已索引")}
                value={cases.filter(c => c.index_status === "completed").length}
                prefix={<BarChartOutlined style={{ color: "#722ed1" }} />}
              />
            </Card>
          </Col>
          <Col flex={1}>
            <Card size="small">
              <Statistic
                title={t("documents.dashboard.desensProgress", "脱敏进度")}
                value={
                  cases.length > 0
                    ? Math.round(
                        (cases.filter(c => c.index_status === "completed").length /
                          cases.length) *
                          100,
                      )
                    : 0
                }
                suffix="%"
                prefix={<SafetyOutlined style={{ color: "#faad14" }} />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {cases.length === 0 && !loading ? (
        <Empty description="暂无案件档案，点击「新建案件」或「扫描本地文件夹」开始管理" />
      ) : (
        <div style={{ padding: "0 24px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
          {cases.map(c => (
            <Card key={c.case_id} size="small" hoverable
              onClick={() => handleViewCase(c)}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: c.enabled ? "#e6f7ff" : "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                  ⚖️
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                    {c.case_name}
                    {c.structured_info?.case_number && (
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                        ({c.structured_info.case_number})
                      </Text>
                    )}
                    {c.enabled && <Badge status="processing" style={{ marginLeft: 6 }} />}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                    {c.tags?.map(t => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}
                    {c.structured_info?.dispute_type && (
                      <Tag color="purple" style={{ fontSize: 11 }}>
                        {c.structured_info.dispute_type}
                      </Tag>
                    )}
                    <Tag color={c.index_status === "completed" ? "green" : c.index_status === "processing" ? "blue" : "default"} style={{ fontSize: 11 }}>
                      {c.index_status === "completed" ? "已索引" : c.index_status === "processing" ? "索引中" : "待索引"}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>
                    <FolderOutlined style={{ marginRight: 4 }} />{c.source_path}
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#8c8c8c" }}>
                    <span>📄 {c.file_count} 个文件</span>
                    <span>💾 {formatFileSize(c.total_size)}</span>
                    <span>🕐 {c.last_scanned ? new Date(c.last_scanned).toLocaleDateString("zh-CN") : "未扫描"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <Tooltip title="AI智能分析">
                    <Button size="small" type="text" icon={<ThunderboltOutlined />} style={{ color: "#722ed1" }}
                      onClick={() => { handleViewCase(c); }}>
                      AI分析
                    </Button>
                  </Tooltip>
                  <Popconfirm title="确定删除该案件？" onConfirm={() => handleDeleteCase(c.case_id)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Case Detail Drawer ── */}
      <Drawer
        title={selectedCase?.case_name || t("cases.caseDetail", "案件详情")}
        open={detailDrawerOpen}
        onClose={() => {
          setDetailDrawerOpen(false);
          setSelectedCase(null);
          setCaseDetail(null);
          setAiMessages([]);
        }}
        width={720}
        extra={
          selectedCase && (
            <Space>
              <Button
                icon={<EditOutlined />}
                size="small"
                onClick={handleOpenStructuredInfo}
              >
                结构化信息
              </Button>
              <Button
                icon={<ExportOutlined />}
                size="small"
                onClick={handleOpenExport}
              >
                {t("cases.export", "导出")}
              </Button>
            </Space>
          )
        }
      >
        {caseDetail && (
          <>
            {/* Quick actions bar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <Button
                icon={<RobotOutlined />}
                type="primary"
                onClick={() => setCaseTab("ai")}
              >
                AI对话（全能视角）
              </Button>
              <Button
                icon={<ThunderboltOutlined />}
                onClick={() => {
                  setOrganizeModalOpen(true);
                  setOrganizeResult(null);
                }}
              >
                AI整理文件
              </Button>
              <Button
                icon={<SafetyOutlined />}
                onClick={() => setMaterialSelectorOpen(true)}
              >
                {t("documents.dashboard.batchDesensitize", "批量脱敏")}
              </Button>
              <Button
                icon={<FileDoneOutlined />}
                onClick={() => {
                  window.open("/moot", "_blank");
                }}
              >
                {t("documents.dashboard.mootArbitration", "模拟仲裁")}
              </Button>
            </div>

            <Tabs
              activeKey={caseTab}
              onChange={setCaseTab}
              items={[
                {
                  key: "overview",
                  label: (
                    <span>
                      <BarChartOutlined /> 概览
                    </span>
                  ),
                  children: (
                    <>
                      <Row gutter={12} style={{ marginBottom: 16 }}>
                        <Col span={6}>
                          <Card size="small">
                            <Statistic
                              title={t("documents.dashboard.materials", "材料数")}
                              value={caseDetail.case.file_count}
                              prefix={<FileTextOutlined />}
                            />
                          </Card>
                        </Col>
                        <Col span={6}>
                          <Card size="small">
                            <Statistic
                              title="脱敏就绪"
                              value={caseDetail.files.filter((f) => f.status === "ready").length}
                              suffix={`/ ${caseDetail.case.file_count}`}
                              prefix={<SafetyOutlined />}
                            />
                          </Card>
                        </Col>
                        <Col span={6}>
                          <Card size="small">
                            <Statistic
                              title="分区数"
                              value={new Set(caseDetail.files.map((f) => f.zone || "shared")).size}
                              suffix="/ 5"
                              prefix={<TagOutlined />}
                            />
                          </Card>
                        </Col>
                        <Col span={6}>
                          <Card size="small">
                            <Statistic
                              title={t("documents.dashboard.drafts", "文书草稿数")}
                              value={0}
                              prefix={<FileDoneOutlined />}
                            />
                          </Card>
                        </Col>
                      </Row>

                      {/* Structured info display */}
                      {caseDetail.case.structured_info && (
                        <Card size="small" style={{ marginBottom: 12 }} title={
                          <Space>
                            <FileTextOutlined />
                            <span>案件结构化信息</span>
                            <Button type="link" size="small" icon={<EditOutlined />} onClick={handleOpenStructuredInfo}>
                              编辑
                            </Button>
                          </Space>
                        }>
                          <Descriptions column={2} size="small">
                            {caseDetail.case.structured_info.case_number && (
                              <Descriptions.Item label="案号">
                                {caseDetail.case.structured_info.case_number}
                              </Descriptions.Item>
                            )}
                            {caseDetail.case.structured_info.arbitration_institution && (
                              <Descriptions.Item label="仲裁机构">
                                {caseDetail.case.structured_info.arbitration_institution}
                              </Descriptions.Item>
                            )}
                            {caseDetail.case.structured_info.dispute_type && (
                              <Descriptions.Item label="争议类型">
                                {caseDetail.case.structured_info.dispute_type}
                              </Descriptions.Item>
                            )}
                            {caseDetail.case.structured_info.claim_amount != null && (
                              <Descriptions.Item label="争议金额">
                                ¥ {caseDetail.case.structured_info.claim_amount.toLocaleString()}
                              </Descriptions.Item>
                            )}
                            {caseDetail.case.structured_info.arbitration_procedure && (
                              <Descriptions.Item label="仲裁程序">
                                {caseDetail.case.structured_info.arbitration_procedure}
                              </Descriptions.Item>
                            )}
                            {caseDetail.case.structured_info.arbitration_rules && (
                              <Descriptions.Item label="适用规则">
                                {caseDetail.case.structured_info.arbitration_rules}
                              </Descriptions.Item>
                            )}
                            {caseDetail.case.structured_info.filing_date && (
                              <Descriptions.Item label="立案日期">
                                {caseDetail.case.structured_info.filing_date}
                              </Descriptions.Item>
                            )}
                            {caseDetail.case.structured_info.hearing_date && (
                              <Descriptions.Item label="开庭日期">
                                {caseDetail.case.structured_info.hearing_date}
                              </Descriptions.Item>
                            )}
                          </Descriptions>
                          {caseDetail.case.structured_info.parties?.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>当事人：</Text>
                              {caseDetail.case.structured_info.parties.map((p) => (
                                <Tag
                                  key={p.party_id}
                                  color={p.party_type === "claimant" ? "blue" : "red"}
                                  style={{ margin: 2, fontSize: 11 }}
                                >
                                  {p.party_type === "claimant" ? "申请人" : "被申请人"}：{p.name}
                                  {p.counsel && ` (代理人：${p.counsel})`}
                                </Tag>
                              ))}
                            </div>
                          )}
                          {caseDetail.case.structured_info.case_summary && (
                            <div style={{ marginTop: 8 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>案情摘要：</Text>
                              <Paragraph style={{ fontSize: 12, margin: "4px 0 0" }}>
                                {caseDetail.case.structured_info.case_summary}
                              </Paragraph>
                            </div>
                          )}
                        </Card>
                      )}

                      <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label={t("cases.caseName", "案件名称")}>
                          {caseDetail.case.case_name}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("cases.sourcePath", "源路径")}>
                          {caseDetail.case.source_path}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("cases.scanMode", "扫描模式")}>
                          <Tag>{caseDetail.case.scan_mode}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label={t("cases.totalSize", "总大小")}>
                          {formatFileSize(caseDetail.case.total_size)}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("cases.indexStatus", "索引状态")}>
                          <Badge {...statusToBadge(caseDetail.case.index_status)} />
                        </Descriptions.Item>
                        <Descriptions.Item label={t("cases.lastScanned", "最后扫描")}>
                          {caseDetail.case.last_scanned
                            ? new Date(caseDetail.case.last_scanned).toLocaleString()
                            : "-"}
                        </Descriptions.Item>
                        <Descriptions.Item label="AI使用偏好">
                          <Space>
                            <SafetyOutlined style={{ color: "var(--ant-color-primary)" }} />
                            <Select
                              size="small"
                              value={caseAiPreference}
                              onChange={async (v) => {
                                setCaseAiPreference(v);
                                try {
                                  await knowledgeApi.setAIUsePreference({
                                    scope: "case",
                                    scope_id: selectedCase?.case_id,
                                    preference: v,
                                  });
                                  message.success(
                                    v === "desensitized"
                                      ? "AI默认使用脱敏版材料"
                                      : v === "original"
                                        ? "AI默认使用原版材料"
                                        : "AI使用前将询问您选择",
                                  );
                                } catch {
                                  message.error("设置失败");
                                }
                              }}
                              style={{ width: 140 }}
                              options={[
                                { value: "desensitized", label: "🟢 脱敏版优先" },
                                { value: "original", label: "🔴 原版优先" },
                                { value: "ask", label: "❓ 每次询问" },
                              ]}
                            />
                          </Space>
                        </Descriptions.Item>
                      </Descriptions>

                      {/* Pipeline status summary */}
                      <div style={{ marginTop: 16 }}>
                        <PipelineStatus
                          status={caseDetail.case.index_status}
                          desensitized={caseDetail.files.some((f) => f.status === "ready")}
                        />
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={() => handleRescan(selectedCase!.case_id)}
                        >
                          重新扫描
                        </Button>
                        <Button
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          onClick={() => handleIngestCaseFile()}
                          loading={ingestingCase}
                        >
                          AI智能整理
                        </Button>
                      </div>
                    </>
                  ),
                },
                {
                  key: "files",
                  label: (
                    <span>
                      <FileTextOutlined /> {t("cases.fileList", "文件列表")}
                    </span>
                  ),
                  children: (
                    <div>
                      {/* Zone filter */}
                      <div className={styles.zoneFilter}>
                        <div
                          className={`${styles.zoneTag} ${zoneFilter === "all" ? styles.zoneTagActive : ""}`}
                          style={zoneFilter === "all" ? { background: "var(--ant-color-primary)" } : {}}
                          onClick={() => setZoneFilter("all")}
                        >
                          全部 ({caseDetail?.files.length || 0})
                        </div>
                        {ZONE_OPTIONS.map((opt) => {
                          const count = caseDetail?.files.filter((f) => (f.zone || "shared") === opt.value).length || 0;
                          return (
                            <div
                              key={opt.value}
                              className={`${styles.zoneTag} ${zoneFilter === opt.value ? styles.zoneTagActive : ""}`}
                              style={zoneFilter === opt.value ? { background: opt.color, borderColor: opt.color } : {}}
                              onClick={() => setZoneFilter(opt.value)}
                            >
                              {opt.label} ({count})
                            </div>
                          );
                        })}
                      </div>
                      <Table
                        dataSource={filteredFiles()}
                        columns={fileColumns}
                        rowKey="file_path"
                        size="small"
                        pagination={false}
                        scroll={{ y: 360 }}
                      />
                    </div>
                  ),
                },
                {
                  key: "ai",
                  label: (
                    <span>
                      <RobotOutlined /> AI对话（全能视角）
                    </span>
                  ),
                  children: (
                    <div className={styles.aiChatPanel}>
                      <Alert
                        type="info"
                        showIcon
                        message="全能视角AI助手"
                        description="此AI助手以全能视角运行，可查看案件全部材料，用于问答和文书写作任务。生成的文档默认为 docx 格式。"
                        style={{ marginBottom: 12 }}
                      />
                      <div className={styles.aiChatMessages} ref={aiMessagesRef}>
                        {aiMessages.length === 0 ? (
                          <div className={styles.aiChatEmpty}>
                            <RobotOutlined style={{ fontSize: 40 }} />
                            <span>向AI助手提问，或要求生成法律文书</span>
                            <span style={{ fontSize: 11 }}>
                              例如：「总结本案的关键争议点」「起草仲裁申请书」
                            </span>
                          </div>
                        ) : (
                          aiMessages.map((msg, i) => (
                            <div
                              key={i}
                              className={`${styles.aiChatMessage} ${
                                msg.role === "user"
                                  ? styles.aiChatMessageUser
                                  : styles.aiChatMessageAssistant
                              }`}
                            >
                              {msg.content}
                              {msg.documents && msg.documents.length > 0 && (
                                <div style={{ marginTop: 8 }}>
                                  {msg.documents.map((doc, j) => (
                                    <div key={j} className={styles.aiChatDocResult}>
                                      <div className={styles.aiChatDocHeader}>
                                        <Text strong style={{ fontSize: 12 }}>
                                          <FileDoneOutlined /> {doc.name}
                                        </Text>
                                        <Tag style={{ fontSize: 10 }}>{doc.format}</Tag>
                                      </div>
                                      <pre className={styles.preContent} style={{ maxHeight: 200, fontSize: 11 }}>
                                        {doc.content}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                        {aiLoading && (
                          <div style={{ textAlign: "center", padding: 12 }}>
                            <Spin tip="AI正在思考...">
                              <div style={{ minHeight: 60 }} />
                            </Spin>
                          </div>
                        )}
                      </div>
                      <div className={styles.aiChatInput}>
                        <Switch
                          checkedChildren="文书"
                          unCheckedChildren="问答"
                          checked={aiGenerateDoc}
                          onChange={setAiGenerateDoc}
                          size="small"
                        />
                        <TextArea
                          value={aiInput}
                          onChange={(e) => setAiInput(e.target.value)}
                          placeholder={aiGenerateDoc ? "描述要生成的文书，如：起草一份仲裁申请书..." : "向AI提问关于本案的任何问题..."}
                          autoSize={{ minRows: 1, maxRows: 3 }}
                          onPressEnter={(e) => {
                            if (!e.shiftKey) {
                              e.preventDefault();
                              handleAISend();
                            }
                          }}
                          style={{ flex: 1 }}
                        />
                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          onClick={handleAISend}
                          loading={aiLoading}
                          disabled={!aiInput.trim()}
                        />
                      </div>
                    </div>
                  ),
                },
                {
                  key: "entities",
                  label: (
                    <span>
                      <TeamOutlined /> {t("documents.entityRegistry.title", "实体注册表")}
                    </span>
                  ),
                  children: (
                    <EntityRegistry caseId={selectedCase?.case_id} />
                  ),
                },
                {
                  key: "timeline",
                  label: (
                    <span>
                      <ClockCircleOutlined /> {t("documents.dashboard.timeline", "时间线")}
                    </span>
                  ),
                  children: (
                    <Timeline
                      items={[
                        {
                          color: "green",
                          children: (
                            <div>
                              <div style={{ fontWeight: 500 }}>案件创建</div>
                              <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                                {caseDetail.case.last_scanned
                                  ? new Date(caseDetail.case.last_scanned).toLocaleString()
                                  : "—"}
                              </div>
                            </div>
                          ),
                        },
                        {
                          color: caseDetail.case.index_status === "completed" ? "green" : "blue",
                          children: (
                            <div>
                              <div style={{ fontWeight: 500 }}>文件扫描完成</div>
                              <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                                {caseDetail.case.file_count} 个文件 · {formatFileSize(caseDetail.case.total_size)}
                              </div>
                            </div>
                          ),
                        },
                        {
                          color: caseDetail.files.some((f) => f.status === "ready") ? "green" : "gray",
                          children: (
                            <div>
                              <div style={{ fontWeight: 500 }}>脱敏处理</div>
                              <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                                {caseDetail.files.filter((f) => f.status === "ready").length} / {caseDetail.case.file_count} 已就绪
                              </div>
                            </div>
                          ),
                        },
                        {
                          color: "gray",
                          children: (
                            <div>
                              <div style={{ fontWeight: 500 }}>{t("documents.dashboard.nextStep", "下一步")}</div>
                              <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                                AI分析、文书草拟、模拟仲裁
                              </div>
                            </div>
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>

      {/* ── File Detail Drawer ── */}
      <Drawer
        title={selectedFile?.file_name || t("cases.fileDetail", "文件详情")}
        open={fileDrawerOpen}
        onClose={() => {
          setFileDrawerOpen(false);
          setSelectedFile(null);
          setParsedContent("");
          setDesensitizedContent("");
          setRestoredContent("");
        }}
        width={620}
      >
        {selectedFile && (
          <Tabs
            activeKey={fileTab}
            onChange={handleFileTabChange}
            items={[
              {
                key: "ai",
                label: "AI总结",
                children: (
                  <div>
                    <Button type="primary" icon={<ThunderboltOutlined />}
                      onClick={() => handleIngestCaseFile()}
                      loading={ingestingCase}>
                      生成AI智能摘要
                    </Button>
                    <div style={{ marginTop: 16 }}>
                      <Input.Search
                        placeholder="向AI提问，如：这份证据材料的关键信息是什么？"
                        enterButton="提问"
                        onSearch={() => message.info("AI问答功能开发中")}
                      />
                    </div>
                  </div>
                ),
              },
              {
                key: "info",
                label: (
                  <span>
                    <FileTextOutlined /> {t("cases.tabInfo", "基本信息")}
                  </span>
                ),
                children: (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label={t("cases.fileName", "文件名")}>
                      {selectedFile.file_name}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("cases.filePath", "路径")}>
                      {selectedFile.file_path}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("cases.fileType", "类型")}>
                      {selectedFile.file_type.toUpperCase()}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("cases.fileSize", "大小")}>
                      {formatFileSize(selectedFile.size)}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("cases.fileStatus", "状态")}>
                      <Badge {...statusToBadge(selectedFile.status)} />
                    </Descriptions.Item>
                    {selectedFile.zone && (
                      <Descriptions.Item label="材料分区">
                        <Tag color={MATERIAL_ZONE_COLORS[selectedFile.zone]}>
                          {MATERIAL_ZONE_LABELS[selectedFile.zone]}
                        </Tag>
                      </Descriptions.Item>
                    )}
                    {selectedFile.category && (
                      <Descriptions.Item label="文件分类">
                        <Tag>{selectedFile.category}</Tag>
                      </Descriptions.Item>
                    )}
                    {selectedFile.custom_tags && selectedFile.custom_tags.length > 0 && (
                      <Descriptions.Item label="自定义标签">
                        {selectedFile.custom_tags.map((t) => (
                          <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>
                        ))}
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                ),
              },
              {
                key: "parsed",
                label: (
                  <span>
                    <FileTextOutlined /> {t("cases.tabParsed", "原始解析")}
                  </span>
                ),
                children: parsedLoading ? (
                  <div className={styles.tabLoading}>
                    <Spin />
                  </div>
                ) : parsedContent ? (
                  <pre className={styles.preContent}>{parsedContent}</pre>
                ) : (
                  <Empty
                    description={t("cases.noParsedContent", "暂无解析内容，请先执行解析")}
                  />
                ),
              },
              {
                key: "desensitized",
                label: (
                  <span>
                    <SafetyOutlined /> {t("cases.tabDesensitized", "脱敏文本")}
                  </span>
                ),
                children: desensitizedLoading ? (
                  <div className={styles.tabLoading}>
                    <Spin />
                  </div>
                ) : desensitizedContent ? (
                  <pre className={styles.preContent}>{desensitizedContent}</pre>
                ) : (
                  <Empty
                    description={t("cases.noDesensitizedContent", "暂无脱敏内容，请先执行解析")}
                  />
                ),
              },
              {
                key: "restored",
                label: (
                  <span>
                    <UndoOutlined /> {t("cases.tabRestored", "还原文本")}
                  </span>
                ),
                children: restoredLoading ? (
                  <div className={styles.tabLoading}>
                    <Spin />
                  </div>
                ) : restoredContent ? (
                  <>
                    <Alert
                      type="warning"
                      showIcon
                      message={t(
                        "cases.restoreWarning",
                        "还原内容包含敏感信息，请妥善保管",
                      )}
                      style={{ marginBottom: 12 }}
                    />
                    <pre className={styles.preContent}>{restoredContent}</pre>
                  </>
                ) : (
                  <Empty
                    description={t("cases.noRestoredContent", "暂无还原内容，需要回填映射支持")}
                  />
                ),
              },
              {
                key: "wiki",
                label: (
                  <span>
                    <LinkOutlined /> {t("cases.tabWiki", "知识页面")}
                  </span>
                ),
                children: wikiRefsLoading ? (
                  <div className={styles.tabLoading}>
                    <Spin />
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
                        {wikiRefs.length > 0
                          ? t("cases.wikiRefCount", "已编译 {{count}} 个知识页面", { count: wikiRefs.length })
                          : t("cases.noWikiRefsYet", "该文件尚未编译为知识页面")}
                      </span>
                      <Tooltip title={t("cases.ingestCaseTip", "将此案件文件编译为结构化知识页面")}>
                        <Button
                          type="primary"
                          size="small"
                          icon={<ThunderboltOutlined />}
                          onClick={handleIngestCaseFile}
                          loading={ingestingCase}
                        >
                          {t("cases.ingestCase", "编译为知识页面")}
                        </Button>
                      </Tooltip>
                    </div>
                    {wikiRefs.length > 0 ? (
                      <div className={styles.wikiRefList}>
                        {wikiRefs.map((page) => (
                          <Card key={page.path} size="small" style={{ marginBottom: 8 }}>
                            <Card.Meta
                              title={page.name}
                              description={
                                <Space direction="vertical" size={4}>
                                  <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                                    {page.path}
                                  </span>
                                  <Space size={4}>
                                    <Tag color="purple">{page.page_type}</Tag>
                                    <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                                      {page.updated_at ? new Date(page.updated_at).toLocaleString() : ""}
                                    </span>
                                  </Space>
                                </Space>
                              }
                            />
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={t("cases.noWikiRefsHint", "点击「编译为知识页面」将案件文件转化为结构化知识")}
                      />
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* ── Add Case Modal ── */}
      <Modal
        title={t("cases.addCaseTitle", "添加案件卷宗")}
        open={addModalOpen}
        onCancel={() => {
          setAddModalOpen(false);
          addForm.resetFields();
        }}
        onOk={handleAddCase}
      >
        <Form form={addForm} layout="vertical" className={styles.addForm}>
          <Form.Item
            name="case_name"
            label={t("cases.caseName", "案件名称")}
          >
            <Input
              placeholder={t("cases.caseNamePlaceholder", "留空将使用文件夹名称")}
            />
          </Form.Item>
          <Form.Item
            name="source_path"
            label={t("cases.sourcePath", "案件文件夹路径")}
            rules={[
              { required: true, message: t("cases.sourcePathRequired", "请选择文件夹路径") },
            ]}
          >
            <FolderPicker
              placeholder={t("cases.sourcePathPlaceholder", "点击选择案件文件夹...")}
            />
          </Form.Item>
          <Form.Item
            name="scan_mode"
            label={t("cases.scanMode", "扫描模式")}
            initialValue="auto"
          >
            <Select
              options={[
                { label: t("cases.scanAuto", "自动检测"), value: "auto" },
                {
                  label: t("cases.scanCloudOcr", "云端OCR优先"),
                  value: "cloud_ocr",
                },
                {
                  label: t("cases.scanLocalOnly", "仅本地解析"),
                  value: "local_only",
                },
              ]}
            />
          </Form.Item>
          <Form.Item name="tags" label={t("cases.tags", "标签")}>
            <Select mode="tags" placeholder={t("cases.tagsPlaceholder", "输入标签")} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Export Modal ── */}
      <Modal
        title={t("cases.exportTitle", "导出案件文件")}
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleExport}
        okText={t("cases.confirmExport", "确认导出")}
        confirmLoading={exporting}
        width={520}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Typography.Text type="secondary">
              {t("cases.exportFileCount", "已选择 {{count}} 个文件", {
                count: selectedExportFiles.length,
              })}
            </Typography.Text>
          </div>
          <div>
            <Checkbox
              checked={exportRestore}
              onChange={(e) => setExportRestore(e.target.checked)}
            >
              {t("cases.exportWithRestore", "导出时还原脱敏内容")}
            </Checkbox>
          </div>
          {exportRestore && (
            <Alert
              type="warning"
              showIcon
              message={t(
                "cases.exportRestoreWarning",
                "还原导出将包含敏感信息，请确认您有权限查看原始数据",
              )}
            />
          )}
        </Space>
      </Modal>

      {/* ── File Tag Editor Modal ── */}
      <Modal
        title="编辑文件标签"
        open={tagEditModalOpen}
        onCancel={() => setTagEditModalOpen(false)}
        onOk={handleSaveFileTag}
        okText="保存"
        cancelText="取消"
        width={480}
      >
        {tagEditingFile && (
          <Form form={tagForm} layout="vertical" className={styles.fileTagEditor}>
            <div style={{ marginBottom: 12, padding: 8, background: "var(--ant-color-bg-layout)", borderRadius: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>文件：</Text>
              <Text style={{ fontSize: 12 }}>{tagEditingFile.file_name}</Text>
            </div>
            <Form.Item
              name="zone"
              label="材料分区"
              tooltip="设置文件的材料访问权限分区，智能体调取时将根据分区划分权限"
            >
              <Select
                options={ZONE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: (
                    <Space>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: o.color, display: "inline-block" }} />
                      {o.label}
                    </Space>
                  ),
                }))}
              />
            </Form.Item>
            <Form.Item name="category" label="文件分类">
              <Select
                allowClear
                placeholder="选择或输入分类"
                mode="tags"
                maxCount={1}
                options={FILE_CATEGORIES.map((c) => ({ value: c, label: c }))}
              />
            </Form.Item>
            <Form.Item name="custom_tags" label="自定义标签">
              <Select
                mode="tags"
                placeholder="输入自定义标签，回车确认"
              />
            </Form.Item>
            <Form.Item name="description" label="备注说明">
              <TextArea rows={2} placeholder="对该文件的补充说明..." />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* ── Structured Info Modal ── */}
      <Modal
        title="案件结构化信息"
        open={structuredInfoModalOpen}
        onCancel={() => setStructuredInfoModalOpen(false)}
        onOk={handleSaveStructuredInfo}
        okText="保存"
        cancelText="取消"
        confirmLoading={structuredSaving}
        width={680}
      >
        <Form form={structuredForm} layout="vertical" className={styles.structuredInfoForm}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="case_number" label="案号">
                <Input placeholder="如：(2024)京仲裁字第001号" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="arbitration_institution" label="仲裁机构">
                <Input placeholder="如：北京仲裁委员会" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="dispute_type" label="争议类型">
                <Select
                  allowClear
                  showSearch
                  placeholder="选择争议类型"
                  options={[
                    "买卖合同纠纷",
                    "建设工程纠纷",
                    "借款合同纠纷",
                    "租赁合同纠纷",
                    "股权转让纠纷",
                    "知识产权纠纷",
                    "劳动争议",
                    "其他",
                  ].map((v) => ({ value: v, label: v }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="claim_amount" label="争议金额（元）">
                <InputNumber
                  style={{ width: "100%" }}
                  placeholder="如：1000000"
                  formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                  parser={(value) => value!.replace(/\$\s?|(,*)/g, "") as unknown as number}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="arbitration_procedure" label="仲裁程序" initialValue="普通程序">
                <Select
                  options={[
                    "普通程序",
                    "简易程序",
                    "特别程序",
                    "国际商事仲裁程序",
                  ].map((v) => ({ value: v, label: v }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="arbitration_rules" label="适用仲裁规则">
                <Input placeholder="如：北仲仲裁规则" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="filing_date" label="立案日期">
                <Input placeholder="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="hearing_date" label="开庭日期">
                <Input placeholder="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="case_summary" label="案情摘要">
            <TextArea rows={3} placeholder="简要描述案件背景和争议焦点..." />
          </Form.Item>

          <Divider>当事人信息</Divider>
          <Form.List name="parties">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <div key={key} className={styles.partyFormItem}>
                    <Row gutter={8}>
                      <Col span={6}>
                        <Form.Item
                          {...restField}
                          name={[name, "party_type"]}
                          rules={[{ required: true, message: "必填" }]}
                          label="角色"
                        >
                          <Select
                            options={[
                              { value: "claimant", label: "申请人" },
                              { value: "respondent", label: "被申请人" },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...restField}
                          name={[name, "name"]}
                          rules={[{ required: true, message: "必填" }]}
                          label="名称"
                        >
                          <Input placeholder="当事人名称" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item {...restField} name={[name, "legal_representative"]} label="法定代表人">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col span={4} style={{ display: "flex", alignItems: "flex-end", paddingBottom: 24 }}>
                        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                      </Col>
                    </Row>
                    <Row gutter={8}>
                      <Col span={8}>
                        <Form.Item {...restField} name={[name, "contact"]} label="联系方式">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item {...restField} name={[name, "address"]} label="地址">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item {...restField} name={[name, "counsel"]} label="代理人">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() => add({ party_type: "claimant" })}
                >
                  添加当事人
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* ── AI Organize Modal ── */}
      <Modal
        title="AI智能整理文件"
        open={organizeModalOpen}
        onCancel={() => setOrganizeModalOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOrganizeModalOpen(false)}>关闭</Button>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={organizing}
              onClick={handleAIOrganize}
              danger={!organizeDryRun}
            >
              {organizeDryRun ? "预览整理方案" : "执行整理（已备份）"}
            </Button>
          </Space>
        }
        width={620}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Alert
            type="info"
            showIcon
            message="AI将自动分析案件文件并分配材料分区"
            description="AI会根据文件内容自动为每个文件分配合适的材料分区（共有/申请人独享/被申请人独享/仲裁员独享/仲裁秘书独享）和文件分类标签。"
          />
          <div>
            <Checkbox
              checked={organizeDryRun}
              onChange={(e) => setOrganizeDryRun(e.target.checked)}
            >
              预览模式（不实际修改文件标签，仅查看建议）
            </Checkbox>
          </div>
          {!organizeDryRun && (
            <Alert
              type="warning"
              showIcon
              message="执行整理前将自动备份"
              description="系统会在执行整理前自动备份当前所有文件标签信息，可在需要时恢复。"
            />
          )}
          {organizeResult && (
            <div className={styles.organizeResult}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <CheckCircleOutlined style={{ color: "#52c41a" }} />
                <Text strong>{organizeDryRun ? "预览完成" : "整理完成"}</Text>
                {!organizeDryRun && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    备份路径：{organizeResult.backup_path}
                  </Text>
                )}
              </div>
              <Paragraph style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                {organizeResult.summary}
              </Paragraph>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {organizeResult.organized_files.map((f, i) => (
                  <div key={i} className={styles.organizeResultItem}>
                    <Tag
                      color={MATERIAL_ZONE_COLORS[f.new_zone as MaterialZone]}
                      style={{ fontSize: 10, flexShrink: 0 }}
                    >
                      {MATERIAL_ZONE_LABELS[f.new_zone as MaterialZone]}
                    </Tag>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.organizeResultPath}>{f.file_path}</div>
                      <div className={styles.organizeResultReason}>
                        分类：{f.new_category} | {f.reason}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Space>
      </Modal>

      {/* ── Scan Folder Modal ── */}
      <Modal
        title="扫描本地文件夹创建案件"
        open={scanModalOpen}
        onCancel={() => {
          setScanModalOpen(false);
          setScanPath("");
          setScanResults([]);
        }}
        footer={
          <Space>
            <Button onClick={() => {
              setScanModalOpen(false);
              setScanPath("");
              setScanResults([]);
            }}>取消</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleBatchCreateFromScan}
              disabled={scanResults.filter((r) => r.selected).length === 0}
              loading={scanLoading}
            >
              创建 {scanResults.filter((r) => r.selected).length} 个案件
            </Button>
          </Space>
        }
        width={620}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Alert
            type="info"
            showIcon
            message="扫描本地文件夹"
            description="选择一个根文件夹，系统将扫描其子文件夹并智能识别可创建为案件的文件夹。不改变本地文件存储结构，仅创建案件引用。"
          />
          <Form.Item label="文件夹路径" required>
            <Space.Compact style={{ width: "100%" }}>
              <FolderPicker
                value={scanPath}
                onChange={(v: string) => setScanPath(v)}
                placeholder="选择要扫描的根文件夹..."
              />
              <Button
                type="primary"
                icon={<ScanOutlined />}
                onClick={handleScanFolder}
                loading={scanLoading}
                disabled={!scanPath.trim()}
              >
                扫描
              </Button>
            </Space.Compact>
          </Form.Item>
          {scanResults.length > 0 && (
            <div className={styles.scanResult}>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
                发现 {scanResults.length} 个可创建为案件的文件夹，点击勾选要创建的：
              </Text>
              {scanResults.map((item, i) => (
                <div
                  key={i}
                  className={`${styles.scanResultItem} ${item.selected ? styles.scanResultItemSelected : ""}`}
                  onClick={() => {
                    setScanResults((prev) =>
                      prev.map((r, j) =>
                        j === i ? { ...r, selected: !r.selected } : r,
                      ),
                    );
                  }}
                >
                  <Checkbox checked={item.selected} />
                  <FolderOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{item.suggested_name}</div>
                    <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.folder_path}
                    </div>
                  </div>
                  <Tag style={{ fontSize: 11 }}>{item.file_count} 文件</Tag>
                </div>
              ))}
            </div>
          )}
        </Space>
      </Modal>

      {/* Material Selector for batch operations */}
      <MaterialSelector
        open={materialSelectorOpen}
        onClose={() => setMaterialSelectorOpen(false)}
        onConfirm={(selected: SelectedMaterial[]) => {
          message.info(
            `已选 ${selected.length} 份材料，批量脱敏功能即将上线`,
          );
        }}
        defaultCaseId={selectedCase?.case_id}
      />
    </div>
  );
}
