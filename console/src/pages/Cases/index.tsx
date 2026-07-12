import { useState, useEffect, useCallback } from "react";
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
} from "antd";
import { PageHeader } from "@/components/PageHeader";
import FolderPicker from "@/components/FolderPicker";
import { casesApi } from "@/api/modules/cases";
import { knowledgeApi } from "@/api/modules/knowledge";
import { wikiApi } from "@/api/modules/wiki";
import type { CaseRef, CaseDetailResponse, CaseFile } from "@/api/modules/cases";
import type { WikiPage } from "@/api/modules/wiki";
import EntityRegistry from "../Documents/components/EntityRegistry";
import MaterialSelector, {
  type SelectedMaterial,
} from "../Documents/components/MaterialSelector";
import PipelineStatus from "../Documents/components/PipelineStatus";
import styles from "./index.module.less";

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

  const fileColumns = [
    {
      title: t("cases.fileName", "文件名"),
      dataIndex: "file_name",
      key: "file_name",
      ellipsis: true,
    },
    {
      title: t("cases.fileType", "类型"),
      dataIndex: "file_type",
      key: "file_type",
      width: 80,
      render: (v: string) => v.toUpperCase(),
    },
    {
      title: t("cases.fileSize", "大小"),
      dataIndex: "size",
      key: "size",
      width: 100,
      render: (v: number) => formatFileSize(v),
    },
    {
      title: t("cases.fileStatus", "状态"),
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (v: string) => {
        const badge = statusToBadge(v);
        return <Badge color={badge.color} text={badge.text} />;
      },
    },
    {
      title: t("cases.fileActions", "操作"),
      key: "actions",
      width: 80,
      render: (_: unknown, record: CaseFile) => (
        <Tooltip title={t("cases.viewFile", "查看文件")}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewFile(record)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <div className={styles.pageContainer}>
      <PageHeader
        current="案件中心"
        subRow={<span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>管理仲裁案件文件，AI智能分析与检索</span>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
            新建案件
          </Button>
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
        <Empty description="暂无案件档案，点击「新建案件」开始管理" />
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
                    {c.enabled && <Badge status="processing" style={{ marginLeft: 6 }} />}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                    {c.tags?.map(t => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}
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

      <Drawer
        title={selectedCase?.case_name || t("cases.caseDetail", "案件详情")}
        open={detailDrawerOpen}
        onClose={() => {
          setDetailDrawerOpen(false);
          setSelectedCase(null);
          setCaseDetail(null);
        }}
        width={640}
        extra={
          selectedCase && (
            <Button
              icon={<ExportOutlined />}
              size="small"
              onClick={handleOpenExport}
            >
              {t("cases.export", "导出")}
            </Button>
          )
        }
      >
        {caseDetail && (
          <>
            {/* Quick actions bar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <Button
                icon={<SafetyOutlined />}
                onClick={() => setMaterialSelectorOpen(true)}
              >
                {t("documents.dashboard.batchDesensitize", "批量脱敏")}
              </Button>
              <Button
                type="primary"
                icon={<RobotOutlined />}
                onClick={() => {
                  window.open("/chat", "_blank");
                }}
              >
                {t("documents.dashboard.aiChat", "AI对话")}
              </Button>
              <Button
                icon={<FileDoneOutlined />}
                onClick={() => {
                  window.open("/moot", "_blank");
                }}
              >
                {t("documents.dashboard.generateDoc", "生成文书")}
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
                              title={t("documents.dashboard.desensProgress", "脱敏进度")}
                              value={
                                caseDetail.files.filter(
                                  (f) => f.status === "ready",
                                ).length
                              }
                              suffix={`/ ${caseDetail.case.file_count}`}
                              prefix={<SafetyOutlined />}
                            />
                          </Card>
                        </Col>
                        <Col span={6}>
                          <Card size="small">
                            <Statistic
                              title={t("documents.dashboard.aiConversations", "AI对话数")}
                              value={0}
                              prefix={<RobotOutlined />}
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
                    <Table
                      dataSource={caseDetail.files}
                      columns={fileColumns}
                      rowKey="file_path"
                      size="small"
                      pagination={false}
                      scroll={{ y: 400 }}
                    />
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