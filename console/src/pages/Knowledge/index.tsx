import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  UploadOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  PlusOutlined,
  ScanOutlined,
  FileTextOutlined,
  SafetyOutlined,
  LinkOutlined,
  InfoCircleOutlined,
  ExportOutlined,
  ThunderboltOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import {
  Button,
  Input,
  Select,
  Tag,
  Card,
  Space,
  Modal,
  Upload,
  message,
  Empty,
  Popconfirm,
  Form,
  TreeSelect,
  Drawer,
  Descriptions,
  Badge,
  Tabs,
  Spin,
  Typography,
  Checkbox,
  Alert,
  Tooltip,
} from "antd";
import { PageHeader } from "@/components/PageHeader";
import FolderPicker from "@/components/FolderPicker";
import { knowledgeApi } from "@/api/modules/knowledge";
import { wikiApi } from "@/api/modules/wiki";
import type {
  KnowledgeDoc,
  KnowledgeEnums,
} from "@/api/modules/knowledge";
import type { WikiPage } from "@/api/modules/wiki";
import { providerApi } from "@/api/modules/provider";
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
    parsing: { color: "processing", text: "解析中" },
    failed: { color: "red", text: "失败" },
  };
  return map[status] || { color: "default", text: status };
}

export default function KnowledgePage() {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [enums, setEnums] = useState<KnowledgeEnums>({
    categories: [],
    owners: [],
    tags: [],
  });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string | undefined>();
  const [filterOwner, setFilterOwner] = useState<string | undefined>();
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterFileType, setFilterFileType] = useState<string | undefined>(undefined);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [enumModalOpen, setEnumModalOpen] = useState(false);
  const [scanPath, setScanPath] = useState("");
  const [scanResult, setScanResult] = useState<{
    path: string;
    file_count: number;
    files: { name: string; path: string; size: number; type: string }[];
  } | null>(null);
  const [enumField, setEnumField] = useState<"categories" | "owners" | "tags">(
    "categories",
  );
  const [enumValue, setEnumValue] = useState("");
  const [uploadForm] = Form.useForm();
  const [externalPaths, setExternalPaths] = useState<{ path: string; label: string }[]>([]);
  const [addingPath, setAddingPath] = useState(false);
  const [detailTab, setDetailTab] = useState("info");
  const [parsedContent, setParsedContent] = useState("");
  const [parsedLoading, setParsedLoading] = useState(false);
  const [desensitizedContent, setDesensitizedContent] = useState("");
  const [desensitizedLoading, setDesensitizedLoading] = useState(false);
  const [wikiRefs, setWikiRefs] = useState<WikiPage[]>([]);
  const [wikiRefsLoading, setWikiRefsLoading] = useState(false);
  const [ingestingDoc, setIngestingDoc] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportRestore, setExportRestore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<number>(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeModel, setActiveModel] = useState<string>("");
  const [modelOptions, setModelOptions] = useState<{ label: string; value: string; provider: string }[]>([]);
  const [externalFiles, setExternalFiles] = useState<{ name: string; path: string; size: number; type: string }[]>([]);
  const [scanningExternal, setScanningExternal] = useState(false);

  // --- 本地文件夹优先 新 State ---
  const [workFolder, setWorkFolder] = useState<string>("");           // 当前工作文件夹路径
  const [folderFiles, setFolderFiles] = useState<{ name: string; path: string; size: number; type: string; modified?: string }[]>([]);
  const [scanningFolder, setScanningFolder] = useState(false);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);

  const fetchDocs = useCallback(async (isSearch = false) => {
    setLoading(true);
    if (isSearch) setSearching(true);
    try {
      const res = await knowledgeApi.listDocs({
        category: filterCategory,
        owner: filterOwner,
        tags: filterTags.join(","),
        q: searchQuery,
        file_type: filterFileType,
      });
      setDocs(res.docs);
      setSearchResults(res.total || res.docs.length);
    } catch (err) {
      console.error("Failed to fetch knowledge docs:", err);
    } finally {
      setLoading(false);
      if (isSearch) setSearching(false);
    }
  }, [filterCategory, filterOwner, filterTags, searchQuery, filterFileType]);

  const fetchEnums = useCallback(async () => {
    try {
      const res = await knowledgeApi.getEnums();
      setEnums(res);
    } catch (err) {
      console.error("Failed to fetch enums:", err);
    }
  }, []);

  const fetchScope = useCallback(async () => {
    try {
      const res = await knowledgeApi.getScope();
      setExternalPaths(res.external_paths || []);
      // 自动选中第一个文件夹作为工作文件夹
      if (res.external_paths?.length > 0 && !workFolder) {
        setWorkFolder(res.external_paths[0].path);
      }
    } catch (err) {
      console.error("Failed to fetch scope:", err);
    }
  }, []); // 空依赖，只执行一次

  const fetchModels = useCallback(async () => {
    try {
      const res = await providerApi.getActiveModels({ scope: "global" });
      const models = ((res as any).models || (res as any).data || []).map((m: any) => ({
        label: `${m.model_name || m.model} (${m.provider || m.provider_id})`,
        value: m.model_name || m.model,
        provider: m.provider || m.provider_id,
      }));
      setModelOptions(models);
      if (models.length > 0 && !activeModel) {
        setActiveModel(models[0].value);
      }
    } catch { /* silent */ }
  }, []);

  // --- 本地文件夹：监听 workFolder 变化，自动扫描 ---
  const scanWorkFolder = useCallback(async () => {
    if (!workFolder) return;
    setScanningFolder(true);
    try {
      const res = await knowledgeApi.scanFolder(workFolder);
      setFolderFiles(res.files || []);
    } catch {
      message.error("文件夹扫描失败，请检查路径是否可访问");
    } finally {
      setScanningFolder(false);
    }
  }, [workFolder]);

  useEffect(() => {
    if (workFolder) scanWorkFolder();
  }, [workFolder, scanWorkFolder]);

  // 当 externalPaths 变化时同步 workFolder
  useEffect(() => {
    if (externalPaths.length > 0 && !externalPaths.some(p => p.path === workFolder)) {
      setWorkFolder(externalPaths[0].path);
    }
  }, [externalPaths]);

  const handleChangeWorkFolder = async () => {
    setScanModalOpen(true);
  };

  // 筛选后的文件列表（本地文件夹模式）
  const filteredFiles = useMemo(() => {
    let files = folderFiles;
    if (filterFileType) {
      files = files.filter(f => f.type === filterFileType);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      files = files.filter(f => f.name.toLowerCase().includes(q));
    }
    return files;
  }, [folderFiles, filterFileType, searchQuery]);

  const scanExternalFiles = useCallback(async () => {
    if (externalPaths.length === 0) return;
    setScanningExternal(true);
    try {
      const allFiles: { name: string; path: string; size: number; type: string }[] = [];
      for (const p of externalPaths) {
        try {
          const res = await knowledgeApi.scanFolder(p.path);
          allFiles.push(...res.files);
        } catch { /* skip inaccessible folders */ }
      }
      setExternalFiles(allFiles);
    } finally {
      setScanningExternal(false);
    }
  }, [externalPaths]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    fetchEnums();
  }, [fetchEnums]);

  useEffect(() => {
    fetchScope();
  }, [fetchScope]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    scanExternalFiles();
  }, [scanExternalFiles]);

  const filteredExternalFiles = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return externalFiles.filter(f => f.name.toLowerCase().includes(q));
  }, [externalFiles, searchQuery]);

  const handleUpload = async (formData: FormData) => {
    try {
      await knowledgeApi.uploadDoc(formData);
      message.success(t("knowledge.uploadSuccess", "上传成功"));
      setUploadModalOpen(false);
      uploadForm.resetFields();
      fetchDocs();
      fetchEnums();
    } catch (err) {
      message.error(t("knowledge.uploadFailed", "上传失败"));
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      await knowledgeApi.deleteDoc(docId);
      message.success(t("knowledge.deleteSuccess", "删除成功"));
      if (selectedDoc?.id === docId) {
        setSelectedDoc(null);
        setDrawerOpen(false);
      }
      fetchDocs();
      fetchEnums();
    } catch (err) {
      message.error(t("knowledge.deleteFailed", "删除失败"));
    }
  };

  const handleScanFolder = async () => {
    if (!scanPath.trim()) return;
    try {
      const res = await knowledgeApi.scanFolder(scanPath);
      setScanResult(res);
    } catch (err) {
      message.error(t("knowledge.scanFailed", "扫描失败"));
    }
  };

  const handleAddExternalPath = async () => {
    if (!scanPath.trim()) return;
    if (externalPaths.some((p) => p.path === scanPath)) {
      message.warning(t("knowledge.pathAlreadyAdded", "该文件夹已添加"));
      return;
    }
    setAddingPath(true);
    try {
      const newPaths = [...externalPaths, { path: scanPath, label: scanPath.split(/[\\/]/).pop() || scanPath }];
      await knowledgeApi.updateScope({
        include_rules: [],
        exclude_rules: [],
        external_paths: newPaths,
      });
      setExternalPaths(newPaths);
      message.success(t("knowledge.pathAdded", "工作文件夹添加成功，智能体可直接读取"));
      setScanModalOpen(false);
      setScanResult(null);
      setScanPath("");
    } catch (err) {
      message.error(t("knowledge.pathAddFailed", "添加失败"));
    } finally {
      setAddingPath(false);
    }
  };

  const handleRemoveExternalPath = async (path: string) => {
    try {
      const newPaths = externalPaths.filter((p) => p.path !== path);
      await knowledgeApi.updateScope({
        include_rules: [],
        exclude_rules: [],
        external_paths: newPaths,
      });
      setExternalPaths(newPaths);
      message.success(t("knowledge.pathRemoved", "已移除"));
    } catch (err) {
      message.error(t("knowledge.pathRemoveFailed", "移除失败"));
    }
  };

  const handleCreateEnum = async () => {
    if (!enumValue.trim()) return;
    try {
      const res = await knowledgeApi.createEnum(enumField, enumValue);
      setEnums(res.enums);
      setEnumValue("");
      message.success(t("knowledge.enumCreated", "分类创建成功"));
    } catch (err) {
      message.error(t("knowledge.enumCreateFailed", "分类创建失败"));
    }
  };

  const handleDeleteEnum = async (field: string, value: string) => {
    try {
      const res = await knowledgeApi.deleteEnum(field, value);
      setEnums(res.enums);
    } catch (err) {
      message.error(t("knowledge.enumDeleteFailed", "分类删除失败"));
    }
  };

  const buildTreeData = (items: string[]) => {
    const root: { title: string; value: string; children?: typeof root }[] = [];
    const map = new Map<string, typeof root>();
    for (const item of items) {
      const parts = item.split("/");
      let current = root;
      let path = "";
      for (let i = 0; i < parts.length; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        if (!map.has(path)) {
          const node: { title: string; value: string; children?: typeof root } =
            { title: parts[i], value: path, children: [] };
          map.set(path, node.children || []);
          current.push(node);
        }
        current = map.get(path)!;
      }
    }
    return root;
  };

  const handleDocClick = (doc: KnowledgeDoc) => {
    setSelectedDoc(doc);
    setDrawerOpen(true);
    setDetailTab("info");
    setParsedContent("");
    setDesensitizedContent("");
    setWikiRefs([]);
  };

  const loadParsedContent = useCallback(async (docId: string) => {
    setParsedLoading(true);
    try {
      const res = await knowledgeApi.getParsedContent(docId);
      setParsedContent(res.content || "");
    } catch {
      setParsedContent("");
    } finally {
      setParsedLoading(false);
    }
  }, []);

  const loadDesensitizedContent = useCallback(async (docId: string) => {
    setDesensitizedLoading(true);
    try {
      const res = await knowledgeApi.getDesensitizedContent(docId);
      setDesensitizedContent(res.content || "");
    } catch {
      setDesensitizedContent("");
    } finally {
      setDesensitizedLoading(false);
    }
  }, []);

  const loadWikiRefs = useCallback(async (docId: string) => {
    setWikiRefsLoading(true);
    try {
      const res = await wikiApi.listPages({ source_doc_id: docId });
      setWikiRefs(res.pages || []);
    } catch {
      setWikiRefs([]);
    } finally {
      setWikiRefsLoading(false);
    }
  }, []);

  const handleIngestDoc = async () => {
    if (!selectedDoc) return;
    setIngestingDoc(true);
    try {
      const result = await wikiApi.ingest({ doc_ids: [selectedDoc.id] });
      if (result.ingested.length > 0) {
        message.success(
          t("knowledge.ingestSuccess", "编译完成，新增 {{count}} 个Wiki页面", {
            count: result.ingested.length,
          }),
        );
      } else if (result.skipped.length > 0) {
        message.info(t("knowledge.ingestSkipped", "该文档已编译，无新增页面"));
      }
      if (result.errors.length > 0) {
        message.warning(
          t("knowledge.ingestErrors", "编译过程中 {{count}} 个页面失败", {
            count: result.errors.length,
          }),
        );
      }
      loadWikiRefs(selectedDoc.id);
    } catch {
      message.error(t("knowledge.ingestFailed", "编译失败"));
    } finally {
      setIngestingDoc(false);
    }
  };

  const handleDetailTabChange = (key: string) => {
    setDetailTab(key);
    if (!selectedDoc) return;
    if (key === "ai") {
      // AI总结 tab - no lazy loading needed
    } else if (key === "parsed" && !parsedContent && !parsedLoading) {
      loadParsedContent(selectedDoc.id);
    } else if (key === "desensitized" && !desensitizedContent && !desensitizedLoading) {
      loadDesensitizedContent(selectedDoc.id);
    } else if (key === "wiki" && wikiRefs.length === 0 && !wikiRefsLoading) {
      loadWikiRefs(selectedDoc.id);
    }
  };

  const handleOpenExport = () => {
    setExportRestore(false);
    setExportModalOpen(true);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const docIds = docs.map((d) => d.id);
      const res = await knowledgeApi.exportDocs({
        doc_ids: docIds,
        restore: exportRestore,
        authorize: exportRestore,
      });
      const okResults = res.results.filter((r) => r.status === "ok" && r.content);
      if (okResults.length === 0) {
        message.warning(t("knowledge.exportEmpty", "没有可导出的文档"));
        return;
      }
      const combined = okResults
        .map((r) => `# ${r.name || r.doc_id}\n\n${r.content}`)
        .join("\n\n---\n\n");
      const blob = new Blob([combined], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `knowledge_export${res.restored ? "_restored" : "_desensitized"}.md`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(
        t("knowledge.exportSuccess", "导出成功，共 {{count}} 个文档", {
          count: okResults.length,
        }),
      );
      setExportModalOpen(false);
    } catch {
      message.error(t("knowledge.exportFailed", "导出失败"));
    } finally {
      setExporting(false);
    }
  };

  const handleUpdateDoc = async (docId: string, data: Partial<KnowledgeDoc>) => {
    try {
      await knowledgeApi.updateDoc(docId, data);
      fetchDocs();
      fetchEnums();
      message.success(t("knowledge.updateSuccess", "更新成功"));
    } catch (err) {
      message.error(t("knowledge.updateFailed", "更新失败"));
    }
  };

  return (
    <div className={styles.pageContainer}>
      <PageHeader
        current="AI资料中心"
        subRow={
          workFolder
            ? <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>正在使用：{workFolder}</span>
            : "选择一个本地文件夹，AI帮您智能检索、总结、分析"
        }
        extra={
          workFolder ? (
            <Space>
              <Tooltip title="切换到其他本地文件夹">
                <Button
                  icon={<SwapOutlined />}
                  onClick={() => setScanModalOpen(true)}
                >
                  切换文件夹
                </Button>
              </Tooltip>
              <Tooltip title="上传个别文件到工作区（可选）">
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => setUploadModalOpen(true)}
                >
                  上传文件
                </Button>
              </Tooltip>
            </Space>
          ) : null
        }
      />

      {/* ===== 场景 A：没有工作文件夹，引导选择 ===== */}
      {!workFolder && externalPaths.length === 0 && (
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "calc(100vh - 200px)",
          padding: 24,
        }}>
          <Card
            style={{
              maxWidth: 560,
              width: "100%",
              textAlign: "center",
              borderRadius: 16,
              boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 64, marginBottom: 16 }}>📂</div>
            <h2 style={{ fontSize: 22, marginBottom: 8, fontWeight: 600 }}>选择资料文件夹</h2>
            <p style={{ color: "var(--ant-color-text-secondary)", marginBottom: 24, fontSize: 14, lineHeight: 1.8 }}>
              选择您存放仲裁资料、合同、法律法规的本地文件夹<br/>
              AI将直接读取其中的文件，帮您智能检索、总结、分析<br/>
              <strong>文件始终在您的电脑上，无需上传</strong>
            </p>
            <FolderPicker
              value={workFolder}
              onChange={async (path) => {
                if (!path) return;
                setWorkFolder(path);
                try {
                  await knowledgeApi.updateScope({
                    include_rules: [],
                    exclude_rules: [],
                    external_paths: [{ path, label: path.split(/[\\/]/).pop() || path }],
                  });
                  setExternalPaths([{ path, label: path.split(/[\\/]/).pop() || path }]);
                  message.success("文件夹已就绪，正在扫描文件...");
                } catch {
                  message.error("添加失败");
                }
              }}
              placeholder="点击选择本地文件夹..."
              style={{ marginBottom: 16 }}
            />
            <div style={{ color: "var(--ant-color-text-tertiary)", fontSize: 12 }}>
              或将文件夹拖放到此处
            </div>
          </Card>
        </div>
      )}

      {/* ===== 场景 B：有工作文件夹 ===== */}
      {workFolder && (
        <>
          {/* B1. 文件夹信息栏 */}
          <div style={{ margin: "0 24px 12px", padding: "8px 16px", background: "var(--ant-color-fill-tertiary)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FolderOpenOutlined style={{ fontSize: 18, color: "#faad14" }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{workFolder.split(/[\\/]/).pop()}</span>
              <span style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>{workFolder}</span>
            </div>
            <Space>
              {scanningFolder && <Spin size="small" />}
              <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                {scanningFolder ? "扫描中..." : `${folderFiles.length} 个文件`}
              </span>
            </Space>
          </div>

          {/* B2. AI 搜索栏 */}
          <div style={{ margin: "0 24px 16px" }}>
            <Card style={{ background: "linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 100%)" }}>
              <Input.Search
                size="large"
                placeholder={`在「${workFolder.split(/[\\/]/).pop() || "当前文件夹"}」中智能检索...`}
                enterButton={<span><ThunderboltOutlined /> AI问答</span>}
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onSearch={async (q) => {
                  if (!q.trim()) return;
                  setAiAnswer("");
                  setAiLoading(true);
                  try {
                    message.info("AI问答：该功能对接中，将基于您本地文件夹的文件内容进行智能分析");
                  } finally {
                    setAiLoading(false);
                  }
                }}
                loading={aiLoading}
                style={{ fontSize: 15 }}
              />
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#8c8c8c" }}>快捷提问：</span>
                {["这几份合同的共同风险点是什么？", "找出与违约金相关的条款", "案件核心争议点摘要"].map(q => (
                  <Tag key={q} style={{ cursor: "pointer" }} onClick={() => setAiQuestion(q)}>{q}</Tag>
                ))}
              </div>
              {aiLoading && (
                <div style={{ marginTop: 12, padding: 12, background: "#fff", borderRadius: 6 }}>
                  <Spin /> AI正在分析本地文件...
                </div>
              )}
              {aiAnswer && (
                <div style={{ marginTop: 12, padding: 12, background: "#fff", borderRadius: 6 }}>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{aiAnswer}</div>
                </div>
              )}
            </Card>
          </div>

          {/* B3. 文件类型筛选标签 */}
          <div style={{ margin: "0 24px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Tag
              color={!filterFileType ? "blue" : "default"}
              style={{ cursor: "pointer" }}
              onClick={() => setFilterFileType(undefined)}
            >
              全部 ({folderFiles.length})
            </Tag>
            {(() => {
              const types = [...new Set(folderFiles.map(f => f.type || "other"))];
              return types.map(t => {
                const count = folderFiles.filter(f => (f.type || "other") === t).length;
                return (
                  <Tag
                    key={t}
                    color={filterFileType === t ? "blue" : "default"}
                    style={{ cursor: "pointer" }}
                    onClick={() => setFilterFileType(filterFileType === t ? undefined : t)}
                  >
                    {t.toUpperCase()} ({count})
                  </Tag>
                );
              });
            })()}
          </div>

          {/* B4. 本地文件列表 */}
          <div style={{ padding: "0 24px", flex: 1, overflowY: "auto" }}>
            {scanningFolder ? (
              <div style={{ textAlign: "center", padding: 48 }}>
                <Spin size="large" />
                <div style={{ marginTop: 16, color: "var(--ant-color-text-secondary)" }}>正在扫描文件夹...</div>
              </div>
            ) : filteredFiles.length === 0 ? (
              <Empty description={searchQuery ? `未找到匹配"${searchQuery}"的文件` : "文件夹中暂无文件"} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredFiles.map((file: any) => (
                  <div key={file.path}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--ant-color-bg-container)",
                      border: "1px solid var(--ant-color-border-secondary)",
                      cursor: "pointer",
                    }}
                    onClick={() => setSelectedFile(file)}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#1890ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
                  >
                    <div style={{ fontSize: 24, flexShrink: 0, width: 40, textAlign: "center" }}>
                      {file.type === "pdf" ? "📄" : file.type === "docx" || file.type === "doc" ? "📝" : file.type === "xlsx" || file.type === "xls" ? "📊" : "📁"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>
                        {file.type?.toUpperCase()} · {formatFileSize(file.size)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <Button size="small" type="text" icon={<ThunderboltOutlined />} style={{ color: "#722ed1" }}>
                        AI总结
                      </Button>
                      <Button size="small" type="text" icon={<SearchOutlined />}>
                        预览
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 文件详情弹窗 */}
      <Modal
        title={selectedFile?.name || "文件详情"}
        open={!!selectedFile}
        onCancel={() => setSelectedFile(null)}
        width={700}
        footer={null}
      >
        {selectedFile && (
          <div>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="文件名">{selectedFile.name}</Descriptions.Item>
              <Descriptions.Item label="类型">{selectedFile.type?.toUpperCase()}</Descriptions.Item>
              <Descriptions.Item label="大小">{formatFileSize(selectedFile.size)}</Descriptions.Item>
              <Descriptions.Item label="路径" span={2}>
                <span style={{ fontSize: 11, wordBreak: "break-all" }}>{selectedFile.path}</span>
              </Descriptions.Item>
            </Descriptions>
            <Card title="🤖 AI智能分析" size="small" style={{ marginBottom: 12 }}>
              <Input.Search
                placeholder={`问AI关于「${selectedFile.name}」的问题...`}
                enterButton="提问"
                onSearch={(q) => message.info("AI问答：该功能对接中")}
              />
            </Card>
            <Space>
              <Button icon={<ThunderboltOutlined />} type="primary">
                AI生成摘要
              </Button>
              <Button icon={<ExportOutlined />}>
                导出为Markdown
              </Button>
            </Space>
          </div>
        )}
      </Modal>

      {/* 详情 Drawer */}
      <Drawer
        title={selectedDoc?.name}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedDoc(null);
        }}
        width={560}
        extra={
          selectedDoc && (
            <Popconfirm
              title={t("knowledge.confirmDelete", "确定删除此文档？")}
              onConfirm={() => handleDelete(selectedDoc.id)}
            >
              <Button danger icon={<DeleteOutlined />} size="small">
                {t("common.delete", "删除")}
              </Button>
            </Popconfirm>
          )
        }
      >
        {selectedDoc && (
          <Tabs
            activeKey={detailTab}
            onChange={handleDetailTabChange}
            items={[
              {
                key: "ai",
                label: "\uD83E\uDD16 AI总结",
                children: (
                  <div>
                    <Button type="primary" icon={<ThunderboltOutlined />} loading={ingestingDoc}
                      onClick={handleIngestDoc} style={{ marginBottom: 16 }}>
                      生成AI智能摘要{activeModel ? `（使用 ${activeModel}）` : ''}
                    </Button>
                    {selectedDoc.summary && (
                      <Card title="AI摘要" size="small">
                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{selectedDoc.summary}</div>
                      </Card>
                    )}
                    <div style={{ marginTop: 16 }}>
                      <Input.Search
                        placeholder="向AI提问，如：这份文件的核心争议是什么？"
                        enterButton="提问"
                        onSearch={() => { message.info("AI问答功能开发中"); }}
                      />
                    </div>
                  </div>
                )
              },
              {
                key: "info",
                label: (
                  <span>
                    <InfoCircleOutlined /> {t("knowledge.tabInfo", "基本信息")}
                  </span>
                ),
                children: (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label={t("knowledge.docName", "文件名")}>
                      {selectedDoc.name}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("knowledge.docType", "类型")}>
                      {selectedDoc.file_type.toUpperCase()}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("knowledge.docSize", "大小")}>
                      {formatFileSize(selectedDoc.size)}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("knowledge.docCategory", "分类")}>
                      <TreeSelect
                        value={selectedDoc.category || undefined}
                        onChange={(val) =>
                          handleUpdateDoc(selectedDoc.id, { category: val || "" })
                        }
                        treeData={buildTreeData(enums.categories)}
                        allowClear
                        style={{ width: "100%" }}
                        treeDefaultExpandAll
                      />
                    </Descriptions.Item>
                    <Descriptions.Item label={t("knowledge.docOwner", "归属")}>
                      <TreeSelect
                        value={selectedDoc.owner || undefined}
                        onChange={(val) =>
                          handleUpdateDoc(selectedDoc.id, { owner: val || "" })
                        }
                        treeData={buildTreeData(enums.owners)}
                        allowClear
                        style={{ width: "100%" }}
                        treeDefaultExpandAll
                      />
                    </Descriptions.Item>
                    <Descriptions.Item label={t("knowledge.docTags", "标签")}>
                      <Select
                        mode="tags"
                        value={selectedDoc.tags}
                        onChange={(val) =>
                          handleUpdateDoc(selectedDoc.id, { tags: val })
                        }
                        options={enums.tags.map((t) => ({ label: t, value: t }))}
                        style={{ width: "100%" }}
                      />
                    </Descriptions.Item>
                    <Descriptions.Item label={t("knowledge.docStatus", "状态")}>
                      <Badge {...statusToBadge(selectedDoc.status)} />
                    </Descriptions.Item>
                    <Descriptions.Item label={t("knowledge.docDesensitized", "脱敏")}>
                      {selectedDoc.desensitized ? "\u2713" : "\u2717"}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("knowledge.docCreatedAt", "创建时间")}>
                      {selectedDoc.created_at
                        ? new Date(selectedDoc.created_at).toLocaleString()
                        : "-"}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: "parsed",
                label: (
                  <span>
                    <FileTextOutlined /> {t("knowledge.tabParsed", "原始解析")}
                  </span>
                ),
                children: parsedLoading ? (
                  <div className={styles.tabLoading}>
                    <Spin />
                  </div>
                ) : parsedContent ? (
                  <div className={styles.contentPreview}>
                    <Typography.Paragraph>
                      <pre className={styles.preContent}>{parsedContent}</pre>
                    </Typography.Paragraph>
                  </div>
                ) : (
                  <Empty
                    description={t("knowledge.noParsedContent", "暂无解析内容，请先执行解析")}
                  />
                ),
              },
              {
                key: "desensitized",
                label: (
                  <span>
                    <SafetyOutlined /> {t("knowledge.tabDesensitized", "脱敏文本")}
                  </span>
                ),
                children: desensitizedLoading ? (
                  <div className={styles.tabLoading}>
                    <Spin />
                  </div>
                ) : desensitizedContent ? (
                  <div className={styles.contentPreview}>
                    <Typography.Paragraph>
                      <pre className={styles.preContent}>{desensitizedContent}</pre>
                    </Typography.Paragraph>
                  </div>
                ) : (
                  <Empty
                    description={t("knowledge.noDesensitizedContent", "暂无脱敏内容，请先执行脱敏")}
                  />
                ),
              },
              {
                key: "wiki",
                label: (
                  <span>
                    <LinkOutlined /> {t("knowledge.tabWiki", "Wiki引用")}
                  </span>
                ),
                children: wikiRefsLoading ? (
                  <div className={styles.tabLoading}>
                    <Spin />
                  </div>
                ) : (
                  <div className={styles.wikiRefList}>
                    <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
                        {wikiRefs.length > 0
                          ? t("knowledge.wikiRefCount", "已编译 {{count}} 个Wiki页面", { count: wikiRefs.length })
                          : t("knowledge.noWikiRefsYet", "该文档尚未编译为Wiki页面")}
                      </span>
                      <Tooltip title={t("knowledge.ingestDocTip", "将此文档编译为结构化Wiki页面，提升AI检索质量")}>
                        <Button
                          type="primary"
                          size="small"
                          icon={<ThunderboltOutlined />}
                          onClick={handleIngestDoc}
                          loading={ingestingDoc}
                        >
                          {t("knowledge.ingestDoc", "编译为Wiki")}
                        </Button>
                      </Tooltip>
                    </div>
                    {wikiRefs.length > 0 ? (
                      wikiRefs.map((page) => (
                        <Card
                          key={page.path}
                          size="small"
                          className={styles.wikiRefCard}
                        >
                          <Card.Meta
                            title={page.name}
                            description={
                              <Space direction="vertical" size={4}>
                                <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                                  {page.path}
                                </span>
                                <Space size={4}>
                                  <Tag color="purple" className={styles.tag}>
                                    {page.page_type}
                                  </Tag>
                                  <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                                    {page.updated_at
                                      ? new Date(page.updated_at).toLocaleString()
                                      : ""}
                                  </span>
                                </Space>
                              </Space>
                            }
                          />
                        </Card>
                      ))
                    ) : (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={t("knowledge.noWikiRefsHint", "点击「编译为Wiki」将文档转化为结构化知识页面")}
                      />
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* 上传 Modal */}
      <Modal
        title={t("knowledge.uploadTitle", "上传文档")}
        open={uploadModalOpen}
        onCancel={() => {
          setUploadModalOpen(false);
          uploadForm.resetFields();
        }}
        onOk={() => uploadForm.submit()}
      >
        <Form
          form={uploadForm}
          onFinish={(values) => {
            const formData = new FormData();
            if (values.file?.[0]?.originFileObj) {
              formData.append("file", values.file[0].originFileObj);
            }
            formData.append("tags", (values.tags || []).join(","));
            formData.append("category", values.category || "");
            formData.append("owner", values.owner || "");
            formData.append("parse_mode", values.parse_mode || "auto");
            handleUpload(formData);
          }}
          layout="vertical"
        >
          <Form.Item
            name="file"
            label={t("knowledge.selectFile", "选择文件")}
            valuePropName="fileList"
            getValueFromEvent={(e) =>
              Array.isArray(e) ? e : e?.fileList
            }
            rules={[{ required: true, message: "请选择文件" }]}
          >
            <Upload
              maxCount={1}
              beforeUpload={() => false}
              accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.md,.txt,.html,.csv,.jpg,.jpeg,.png,.tiff,.tif"
            >
              <Button icon={<UploadOutlined />}>
                {t("knowledge.selectFile", "选择文件")}
              </Button>
            </Upload>
          </Form.Item>
          <Form.Item name="category" label={t("knowledge.docCategory", "分类")}>
            <TreeSelect
              treeData={buildTreeData(enums.categories)}
              allowClear
              treeDefaultExpandAll
              placeholder={t("knowledge.selectCategory", "选择分类")}
            />
          </Form.Item>
          <Form.Item name="owner" label={t("knowledge.docOwner", "归属")}>
            <TreeSelect
              treeData={buildTreeData(enums.owners)}
              allowClear
              treeDefaultExpandAll
              placeholder={t("knowledge.selectOwner", "选择归属")}
            />
          </Form.Item>
          <Form.Item name="tags" label={t("knowledge.docTags", "标签")}>
            <Select
              mode="tags"
              options={enums.tags.map((t) => ({ label: t, value: t }))}
              placeholder={t("knowledge.inputTags", "输入标签")}
            />
          </Form.Item>
          <Form.Item
            name="parse_mode"
            label={t("knowledge.parseMode", "解析模式")}
            initialValue="auto"
          >
            <Select
              options={[
                { label: t("knowledge.parseAuto", "自动（推荐）"), value: "auto" },
                {
                  label: t("knowledge.parseCloudOcr", "MinerU 高精度 OCR"),
                  value: "cloud_ocr",
                },
                {
                  label: t("knowledge.parseLocalOnly", "仅本地（Tesseract + 原生提取）"),
                  value: "local_only",
                },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 扫描文件夹 Modal */}
      <Modal
        title={t("knowledge.scanFolderTitle", "添加工作文件夹")}
        open={scanModalOpen}
        onCancel={() => {
          setScanModalOpen(false);
          setScanResult(null);
          setScanPath("");
        }}
        footer={null}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <FolderPicker
            value={scanPath}
            onChange={(path) => {
              setScanPath(path);
              setScanResult(null);
            }}
            placeholder={t("knowledge.scanPathPlaceholder", "点击选择本地文件夹...")}
          />
          <Button
            icon={<ScanOutlined />}
            onClick={handleScanFolder}
            disabled={!scanPath}
          >
            {t("knowledge.scan", "预览文件")}
          </Button>
          {scanResult && (
            <div className={styles.scanResult}>
              <p>
                {t("knowledge.scanResult", "扫描结果")}：{scanResult.file_count}{" "}
                {t("knowledge.filesFound", "个文件")}
              </p>
              {scanResult.files.slice(0, 20).map((f) => (
                <div key={f.path} style={{ fontSize: 12, color: "#666" }}>
                  {f.name} ({formatFileSize(f.size)})
                </div>
              ))}
              {scanResult.file_count > 20 && (
                <div style={{ fontSize: 12, color: "#999" }}>
                  ...{t("knowledge.moreFiles", "还有")}{" "}
                  {scanResult.file_count - 20}{" "}
                  {t("knowledge.filesNotShown", "个文件未显示")}
                </div>
              )}
            </div>
          )}
          {scanPath && (
            <Button
              type="primary"
              icon={<FolderOpenOutlined />}
              onClick={handleAddExternalPath}
              loading={addingPath}
              disabled={!scanResult}
            >
              {t("knowledge.addAsWorkFolder", "添加为工作文件夹")}
            </Button>
          )}
          <Alert
            type="info"
            showIcon
            message={t("knowledge.workFolderTip", "添加后，智能体可直接读取该文件夹中的文件，无需导入到知识库")}
          />
        </Space>
      </Modal>

      {/* 管理分类 Modal */}
      <Modal
        title={t("knowledge.manageEnumsTitle", "管理分类/归属/标签")}
        open={enumModalOpen}
        onCancel={() => setEnumModalOpen(false)}
        footer={null}
        width={600}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Space>
              <Select
                value={enumField}
                onChange={setEnumField}
                options={[
                  {
                    label: t("knowledge.categories", "分类"),
                    value: "categories",
                  },
                  { label: t("knowledge.owners", "归属"), value: "owners" },
                  { label: t("knowledge.tags", "标签"), value: "tags" },
                ]}
                style={{ width: 120 }}
              />
              <Input
                placeholder={t("knowledge.enumValuePlaceholder", "输入值，用/表示层级")}
                value={enumValue}
                onChange={(e) => setEnumValue(e.target.value)}
                style={{ width: 200 }}
                onPressEnter={handleCreateEnum}
              />
              <Button type="primary" onClick={handleCreateEnum}>
                {t("common.add", "添加")}
              </Button>
            </Space>
          </div>
          <div>
            <h4>{t("knowledge.categories", "分类")}</h4>
            <Space wrap>
              {enums.categories.map((c) => (
                <Tag
                  key={c}
                  closable
                  onClose={() => handleDeleteEnum("categories", c)}
                  color="blue"
                >
                  {c}
                </Tag>
              ))}
            </Space>
          </div>
          <div>
            <h4>{t("knowledge.owners", "归属")}</h4>
            <Space wrap>
              {enums.owners.map((o) => (
                <Tag
                  key={o}
                  closable
                  onClose={() => handleDeleteEnum("owners", o)}
                  color="green"
                >
                  {o}
                </Tag>
              ))}
            </Space>
          </div>
          <div>
            <h4>{t("knowledge.tags", "标签")}</h4>
            <Space wrap>
              {enums.tags.map((t) => (
                <Tag
                  key={t}
                  closable
                  onClose={() => handleDeleteEnum("tags", t)}
                >
                  {t}
                </Tag>
              ))}
            </Space>
          </div>
        </Space>
      </Modal>

      {/* 导出 Modal */}
      <Modal
        title={t("knowledge.exportTitle", "导出知识库文档")}
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleExport}
        okText={t("knowledge.confirmExport", "确认导出")}
        confirmLoading={exporting}
        width={480}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Typography.Text type="secondary">
              {t("knowledge.exportDocCount", "将导出 {{count}} 个文档", {
                count: docs.length,
              })}
            </Typography.Text>
          </div>
          <div>
            <Checkbox
              checked={exportRestore}
              onChange={(e) => setExportRestore(e.target.checked)}
            >
              {t("knowledge.exportWithRestore", "导出时还原脱敏内容")}
            </Checkbox>
          </div>
          {exportRestore && (
            <Alert
              type="warning"
              showIcon
              message={t(
                "knowledge.exportRestoreWarning",
                "还原导出将包含敏感信息，请确认您有权限查看原始数据",
              )}
            />
          )}
        </Space>
      </Modal>
    </div>
  );
}
