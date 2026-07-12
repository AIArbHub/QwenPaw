import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  UploadOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  ScanOutlined,
  FileTextOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  SwapOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  EyeOutlined,
  ExportOutlined,
  ReloadOutlined,
  FilterOutlined,
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
  Tree,
  Segmented,
} from "antd";
import { PageHeader } from "@/components/PageHeader";
import FolderPicker from "@/components/FolderPicker";
import { knowledgeApi } from "@/api/modules/knowledge";
import { wikiApi } from "@/api/modules/wiki";
import type { KnowledgeDoc, KnowledgeEnums } from "@/api/modules/knowledge";
import type { WikiPage } from "@/api/modules/wiki";
import PipelineStatus from "./components/PipelineStatus";
import DualVersionViewer from "./components/DualVersionViewer";
import styles from "./documents.module.less";

const { Text } = Typography;

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

function fileTypeIcon(type: string): string {
  const t = (type || "").toLowerCase();
  if (["pdf"].includes(t)) return "📄";
  if (["doc", "docx"].includes(t)) return "📝";
  if (["xls", "xlsx"].includes(t)) return "📊";
  if (["ppt", "pptx"].includes(t)) return "📽️";
  if (["jpg", "jpeg", "png", "tiff", "tif", "bmp"].includes(t)) return "🖼️";
  if (["md", "txt"].includes(t)) return "📃";
  if (["html", "htm"].includes(t)) return "🌐";
  return "📁";
}

type ViewMode = "card" | "list";

export default function MaterialsPage() {
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
  const [filterFileType, setFilterFileType] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanPath, setScanPath] = useState("");
  const [scanResult, setScanResult] = useState<{
    path: string;
    file_count: number;
    files: { name: string; path: string; size: number; type: string }[];
  } | null>(null);
  const [uploadForm] = Form.useForm();
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
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // ── Tree node for left sidebar ──
  const [treeSelectedCategory, setTreeSelectedCategory] = useState<string | undefined>();

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await knowledgeApi.listDocs({
        category: filterCategory || treeSelectedCategory,
        q: searchQuery,
        file_type: filterFileType,
        status: filterStatus,
      });
      setDocs(res.docs);
    } catch (err) {
      console.error("Failed to fetch docs:", err);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, treeSelectedCategory, searchQuery, filterFileType, filterStatus]);

  const fetchEnums = useCallback(async () => {
    try {
      const res = await knowledgeApi.getEnums();
      setEnums(res);
    } catch (err) {
      console.error("Failed to fetch enums:", err);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    fetchEnums();
  }, [fetchEnums]);

  // ── Build category tree ──
  const categoryTreeData = useMemo(() => {
    const buildTree = (items: string[]): any[] => {
      const root: any[] = [];
      const map = new Map<string, any[]>();
      for (const item of items) {
        const parts = item.split("/");
        let current = root;
        let path = "";
        for (let i = 0; i < parts.length; i++) {
          path = path ? `${path}/${parts[i]}` : parts[i];
          if (!map.has(path)) {
            const node: any = {
              title: parts[i],
              key: path,
              children: [],
            };
            map.set(path, node.children);
            current.push(node);
          }
          current = map.get(path)!;
        }
      }
      return root;
    };

    const categoryNodes = buildTree(enums.categories);

    // Add "全部" and "未分类" nodes
    return [
      {
        title: (
          <Space size={4}>
            <FolderOpenOutlined />
            <span>{t("documents.allMaterials", "全部材料")}</span>
            <Tag style={{ fontSize: 10 }}>{docs.length}</Tag>
          </Space>
        ),
        key: "__all__",
        selectable: true,
      },
      {
        title: (
          <Space size={4}>
            <FileTextOutlined />
            <span>{t("documents.uncategorized", "未分类")}</span>
            <Tag style={{ fontSize: 10 }}>
              {docs.filter((d) => !d.category).length}
            </Tag>
          </Space>
        ),
        key: "__uncategorized__",
        selectable: true,
      },
      ...(enums.categories.length > 0
        ? [
            {
              title: (
                <Space size={4}>
                  <FolderOpenOutlined />
                  <span>{t("documents.categories", "分类")}</span>
                </Space>
              ),
              key: "__category_group__",
              selectable: false,
              children: categoryNodes,
            },
          ]
        : []),
      ...(enums.tags.length > 0
        ? [
            {
              title: (
                <Space size={4}>
                  <FilterOutlined />
                  <span>{t("documents.tags", "标签")}</span>
                </Space>
              ),
              key: "__tag_group__",
              selectable: false,
              children: enums.tags.map((tag) => ({
                title: (
                  <Space size={4}>
                    <Tag style={{ fontSize: 11 }}>{tag}</Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {docs.filter((d) => d.tags?.includes(tag)).length}
                    </Text>
                  </Space>
                ),
                key: `tag:${tag}`,
                selectable: true,
                isLeaf: true,
              })),
            },
          ]
        : []),
    ];
  }, [enums, docs, t]);

  // ── Handlers ──
  const handleUpload = async (formData: FormData) => {
    try {
      await knowledgeApi.uploadDoc(formData);
      message.success(t("documents.uploadSuccess", "上传成功"));
      setUploadModalOpen(false);
      uploadForm.resetFields();
      fetchDocs();
      fetchEnums();
    } catch {
      message.error(t("documents.uploadFailed", "上传失败"));
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      await knowledgeApi.deleteDoc(docId);
      message.success(t("documents.deleteSuccess", "删除成功"));
      if (selectedDoc?.id === docId) {
        setSelectedDoc(null);
        setDrawerOpen(false);
      }
      fetchDocs();
      fetchEnums();
    } catch {
      message.error(t("documents.deleteFailed", "删除失败"));
    }
  };

  const handleScanFolder = async () => {
    if (!scanPath.trim()) return;
    try {
      const res = await knowledgeApi.scanFolder(scanPath);
      setScanResult(res);
    } catch {
      message.error(t("documents.scanFailed", "扫描失败"));
    }
  };

  const handleBatchDesensitize = async () => {
    if (selectedKeys.length === 0) {
      message.warning(t("documents.selectFirst", "请先选择文档"));
      return;
    }
    try {
      const res = await knowledgeApi.batchDesensitize({
        doc_ids: selectedKeys,
      });
      const okCount = res.results.filter((r) => r.status === "ok").length;
      message.success(
        t("documents.batchDesensSuccess", "批量脱敏完成，成功 {{count}} 个", {
          count: okCount,
        }),
      );
      setSelectedKeys([]);
      fetchDocs();
    } catch {
      message.error(t("documents.batchDesensFailed", "批量脱敏失败"));
    }
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
          t("documents.ingestSuccess", "编译完成，新增 {{count}} 个知识页面", {
            count: result.ingested.length,
          }),
        );
      } else if (result.skipped.length > 0) {
        message.info(t("documents.ingestSkipped", "该文档已编译，无新增页面"));
      }
      loadWikiRefs(selectedDoc.id);
    } catch {
      message.error(t("documents.ingestFailed", "编译失败"));
    } finally {
      setIngestingDoc(false);
    }
  };

  const handleDetailTabChange = (key: string) => {
    setDetailTab(key);
    if (!selectedDoc) return;
    if (key === "parsed" && !parsedContent && !parsedLoading) {
      loadParsedContent(selectedDoc.id);
    } else if (key === "desensitized" && !desensitizedContent && !desensitizedLoading) {
      loadDesensitizedContent(selectedDoc.id);
    } else if (key === "wiki" && wikiRefs.length === 0 && !wikiRefsLoading) {
      loadWikiRefs(selectedDoc.id);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const docIds = selectedKeys.length > 0 ? selectedKeys : docs.map((d) => d.id);
      const res = await knowledgeApi.exportDocs({
        doc_ids: docIds,
        restore: exportRestore,
        authorize: exportRestore,
      });
      const okResults = res.results.filter((r) => r.status === "ok" && r.content);
      if (okResults.length === 0) {
        message.warning(t("documents.exportEmpty", "没有可导出的文档"));
        return;
      }
      const combined = okResults
        .map((r) => `# ${r.name || r.doc_id}\n\n${r.content}`)
        .join("\n\n---\n\n");
      const blob = new Blob([combined], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `materials_export${res.restored ? "_restored" : "_desensitized"}.md`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(
        t("documents.exportSuccess", "导出成功，共 {{count}} 个文档", {
          count: okResults.length,
        }),
      );
      setExportModalOpen(false);
    } catch {
      message.error(t("documents.exportFailed", "导出失败"));
    } finally {
      setExporting(false);
    }
  };

  const handleUpdateDoc = async (docId: string, data: Partial<KnowledgeDoc>) => {
    try {
      await knowledgeApi.updateDoc(docId, data);
      fetchDocs();
      fetchEnums();
      message.success(t("documents.updateSuccess", "更新成功"));
    } catch {
      message.error(t("documents.updateFailed", "更新失败"));
    }
  };

  const handleTreeSelect = (key: string) => {
    if (key === "__all__") {
      setTreeSelectedCategory(undefined);
      setFilterCategory(undefined);
    } else if (key === "__uncategorized__") {
      setTreeSelectedCategory("__uncategorized__");
      setFilterCategory(undefined);
    } else if (key.startsWith("tag:")) {
      // Tag filter - we'll need to filter client-side
      setTreeSelectedCategory(key);
      setFilterCategory(undefined);
    } else {
      setTreeSelectedCategory(key);
      setFilterCategory(key);
    }
  };

  // ── Filter docs based on tree selection (for tags/uncategorized) ──
  const displayDocs = useMemo(() => {
    let result = docs;
    if (treeSelectedCategory === "__uncategorized__") {
      result = result.filter((d) => !d.category);
    } else if (treeSelectedCategory?.startsWith("tag:")) {
      const tag = treeSelectedCategory.slice(4);
      result = result.filter((d) => d.tags?.includes(tag));
    }
    return result;
  }, [docs, treeSelectedCategory]);

  const buildTreeData = (items: string[]) => {
    const root: any[] = [];
    const map = new Map<string, any[]>();
    for (const item of items) {
      const parts = item.split("/");
      let current = root;
      let path = "";
      for (let i = 0; i < parts.length; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        if (!map.has(path)) {
          const node: any = { title: parts[i], value: path, children: [] };
          map.set(path, node.children);
          current.push(node);
        }
        current = map.get(path)!;
      }
    }
    return root;
  };

  // ── Render document card ──
  const renderDocCard = (doc: KnowledgeDoc) => {
    const isSelected = selectedKeys.includes(doc.id);
    return (
      <div
        key={doc.id}
        className={styles.docCard}
        style={isSelected ? { borderColor: "var(--ant-color-primary)", borderWidth: 2 } : undefined}
        onClick={() => handleDocClick(doc)}
      >
        <div className={styles.docCardHeader}>
          <div style={{ fontSize: 28, flexShrink: 0, lineHeight: 1 }}>
            {fileTypeIcon(doc.file_type)}
          </div>
          <div className={styles.docCardInfo}>
            <div className={styles.docCardName}>{doc.name}</div>
            <div className={styles.docCardMeta}>
              {doc.file_type?.toUpperCase()} · {formatFileSize(doc.size)}
              {doc.category && ` · ${doc.category}`}
            </div>
          </div>
          <div className={styles.docCardActions} onClick={(e) => e.stopPropagation()}>
            <Tooltip title={t("documents.view", "查看")}>
              <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => handleDocClick(doc)} />
            </Tooltip>
            <Popconfirm
              title={t("documents.confirmDelete", "确定删除此文档？")}
              onConfirm={() => handleDelete(doc.id)}
            >
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </div>
        </div>

        {/* Pipeline status */}
        <div className={styles.docCardPipeline}>
          <PipelineStatus
            status={doc.status}
            desensitized={doc.desensitized}
            parseEngine={doc.parse_mode}
            compact
          />
        </div>

        {/* Tags */}
        {(doc.tags?.length > 0 || doc.desensitized) && (
          <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {doc.tags?.slice(0, 3).map((tag) => (
              <Tag key={tag} style={{ fontSize: 10 }}>{tag}</Tag>
            ))}
            {doc.tags?.length > 3 && (
              <Tag style={{ fontSize: 10 }}>+{doc.tags.length - 3}</Tag>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Render document list item (compact) ──
  const renderDocListItem = (doc: KnowledgeDoc) => {
    const isSelected = selectedKeys.includes(doc.id);
    return (
      <div
        key={doc.id}
        className={styles.docListItem}
        style={isSelected ? { background: "var(--ant-color-primary-bg)" } : undefined}
        onClick={() => handleDocClick(doc)}
      >
        <Checkbox
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            setSelectedKeys((prev) =>
              e.target.checked
                ? [...prev, doc.id]
                : prev.filter((id) => id !== doc.id),
            );
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <div style={{ fontSize: 20, flexShrink: 0 }}>{fileTypeIcon(doc.file_type)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {doc.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>
            {doc.file_type?.toUpperCase()} · {formatFileSize(doc.size)}
            {doc.category && ` · ${doc.category}`}
          </div>
        </div>
        <PipelineStatus
          status={doc.status}
          desensitized={doc.desensitized}
          parseEngine={doc.parse_mode}
          compact
        />
        <div onClick={(e) => e.stopPropagation()}>
          <Popconfirm
            title={t("documents.confirmDelete", "确定删除此文档？")}
            onConfirm={() => handleDelete(doc.id)}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.materialsPage}>
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <Button
          type="primary"
          icon={<UploadOutlined />}
          onClick={() => setUploadModalOpen(true)}
        >
          {t("documents.upload", "上传")}
        </Button>
        <Button
          icon={<ScanOutlined />}
          onClick={() => setScanModalOpen(true)}
        >
          {t("documents.scanFolder", "扫描文件夹")}
        </Button>
        <Button
          icon={<SafetyOutlined />}
          disabled={selectedKeys.length === 0}
          onClick={handleBatchDesensitize}
        >
          {t("documents.batchDesensitize", "批量脱敏")}
        </Button>
        <Button
          icon={<ExportOutlined />}
          onClick={() => setExportModalOpen(true)}
        >
          {t("documents.export", "导出")}
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={fetchDocs}
        >
          {t("documents.refresh", "刷新")}
        </Button>
        <div style={{ flex: 1 }} />
        <Segmented
          value={viewMode}
          onChange={(v) => setViewMode(v as ViewMode)}
          options={[
            { label: <AppstoreOutlined />, value: "card" },
            { label: <UnorderedListOutlined />, value: "list" },
          ]}
        />
      </div>

      {/* ── Filter bar ── */}
      <div className={styles.filterBar}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={t("documents.searchPlaceholder", "搜索文档...")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: 240 }}
          allowClear
        />
        <Select
          style={{ width: 120 }}
          placeholder={t("documents.fileType", "文件类型")}
          allowClear
          value={filterFileType}
          onChange={setFilterFileType}
          options={[
            { label: "PDF", value: "pdf" },
            { label: "Word", value: "docx" },
            { label: "Excel", value: "xlsx" },
            { label: "图片", value: "jpg" },
            { label: "Markdown", value: "md" },
          ]}
        />
        <Select
          style={{ width: 120 }}
          placeholder={t("documents.status", "状态")}
          allowClear
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { label: t("documents.statusReady", "就绪"), value: "ready" },
            { label: t("documents.statusPending", "待处理"), value: "pending" },
            { label: t("documents.statusFailed", "失败"), value: "failed" },
          ]}
        />
        {selectedKeys.length > 0 && (
          <Tag color="blue" closable onClose={() => setSelectedKeys([])}>
            {t("documents.selected", "已选 {{count}} 项", { count: selectedKeys.length })}
          </Tag>
        )}
      </div>

      {/* ── Main layout: sidebar + content ── */}
      <div className={styles.materialsLayout}>
        {/* Left sidebar: category tree */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <div className={styles.sidebarTitle}>
              {t("documents.categories", "分类导航")}
            </div>
            <Tree
              treeData={categoryTreeData}
              defaultExpandAll
              selectedKeys={treeSelectedCategory ? [treeSelectedCategory] : ["__all__"]}
              onSelect={(keys) => {
                if (keys.length > 0) {
                  handleTreeSelect(keys[0] as string);
                }
              }}
            />
          </div>
        </div>

        {/* Right: document list */}
        <div className={styles.mainContent}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
              <Spin size="large" />
            </div>
          ) : displayDocs.length === 0 ? (
            <Empty
              style={{ marginTop: 64 }}
              description={t("documents.emptyHint", "暂无文档，点击「上传」或「扫描文件夹」添加")}
            />
          ) : (
            <div className={`${styles.docList} ${viewMode === "card" ? styles.gridView : styles.listView}`}>
              {viewMode === "card"
                ? displayDocs.map(renderDocCard)
                : displayDocs.map(renderDocListItem)}
            </div>
          )}
        </div>
      </div>

      {/* ── Document detail Drawer ── */}
      <Drawer
        title={selectedDoc?.name}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedDoc(null);
        }}
        width={600}
        className={styles.contentDrawer}
        extra={
          selectedDoc && (
            <Space>
              <Tooltip title={t("documents.ingestToKnowledge", "编译为知识页面")}>
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  onClick={handleIngestDoc}
                  loading={ingestingDoc}
                />
              </Tooltip>
              <Popconfirm
                title={t("documents.confirmDelete", "确定删除此文档？")}
                onConfirm={() => handleDelete(selectedDoc.id)}
              >
                <Button danger icon={<DeleteOutlined />} size="small">
                  {t("common.delete", "删除")}
                </Button>
              </Popconfirm>
            </Space>
          )
        }
      >
        {selectedDoc && (
          <Tabs
            activeKey={detailTab}
            onChange={handleDetailTabChange}
            items={[
              {
                key: "info",
                label: (
                  <span>
                    <FileTextOutlined /> {t("documents.tabInfo", "基本信息")}
                  </span>
                ),
                children: (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label={t("documents.docName", "文件名")}>
                      {selectedDoc.name}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("documents.docType", "类型")}>
                      {selectedDoc.file_type?.toUpperCase()}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("documents.docSize", "大小")}>
                      {formatFileSize(selectedDoc.size)}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("documents.docCategory", "分类")}>
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
                    <Descriptions.Item label={t("documents.docTags", "标签")}>
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
                    <Descriptions.Item label={t("documents.docStatus", "状态")}>
                      <Badge {...statusToBadge(selectedDoc.status)} />
                    </Descriptions.Item>
                    <Descriptions.Item label={t("documents.docDesensitized", "脱敏")}>
                      {selectedDoc.desensitized ? "✓ 已脱敏" : "✗ 未脱敏"}
                    </Descriptions.Item>
                    <Descriptions.Item label={t("documents.pipeline.title", "处理流水线")} span={2}>
                      <PipelineStatus
                        status={selectedDoc.status}
                        desensitized={selectedDoc.desensitized}
                        parseEngine={selectedDoc.parse_mode}
                      />
                    </Descriptions.Item>
                    <Descriptions.Item label={t("documents.docCreatedAt", "创建时间")}>
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
                    <FileTextOutlined /> {t("documents.tabParsed", "解析内容")}
                  </span>
                ),
                children: parsedLoading ? (
                  <div className={styles.tabLoading}><Spin /></div>
                ) : parsedContent ? (
                  <pre className={styles.preContent}>{parsedContent}</pre>
                ) : (
                  <Empty description={t("documents.noParsedContent", "暂无解析内容，请先执行解析")} />
                ),
              },
              {
                key: "desensitized",
                label: (
                  <span>
                    <SafetyOutlined /> {t("documents.tabDesensitized", "脱敏文本")}
                  </span>
                ),
                children: desensitizedLoading ? (
                  <div className={styles.tabLoading}><Spin /></div>
                ) : desensitizedContent ? (
                  <pre className={styles.preContent}>{desensitizedContent}</pre>
                ) : (
                  <Empty description={t("documents.noDesensitizedContent", "暂无脱敏内容，请先执行脱敏")} />
                ),
              },
              {
                key: "version",
                label: (
                  <span>
                    <SwapOutlined /> {t("documents.tabVersion", "版本对比")}
                  </span>
                ),
                children: <DualVersionViewer doc={selectedDoc} />,
              },
              {
                key: "wiki",
                label: (
                  <span>
                    <ThunderboltOutlined /> {t("documents.tabKnowledge", "知识页面")}
                  </span>
                ),
                children: wikiRefsLoading ? (
                  <div className={styles.tabLoading}><Spin /></div>
                ) : (
                  <div>
                    <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        {wikiRefs.length > 0
                          ? t("documents.wikiRefCount", "已编译 {{count}} 个知识页面", { count: wikiRefs.length })
                          : t("documents.noWikiRefsYet", "该文档尚未编译为知识页面")}
                      </Text>
                      <Button
                        type="primary"
                        size="small"
                        icon={<ThunderboltOutlined />}
                        onClick={handleIngestDoc}
                        loading={ingestingDoc}
                      >
                        {t("documents.ingestDoc", "编译")}
                      </Button>
                    </div>
                    {wikiRefs.length > 0 ? (
                      wikiRefs.map((page) => (
                        <Card key={page.path} size="small" style={{ marginBottom: 8 }}>
                          <Card.Meta
                            title={page.name}
                            description={
                              <Space direction="vertical" size={4}>
                                <Text type="secondary" style={{ fontSize: 12 }}>{page.path}</Text>
                                <Space size={4}>
                                  <Tag color="purple">{page.page_type}</Tag>
                                  <Text type="secondary" style={{ fontSize: 12 }}>
                                    {page.updated_at ? new Date(page.updated_at).toLocaleString() : ""}
                                  </Text>
                                </Space>
                              </Space>
                            }
                          />
                        </Card>
                      ))
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* ── Upload Modal ── */}
      <Modal
        title={t("documents.uploadTitle", "上传文档")}
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
            label={t("documents.selectFile", "选择文件")}
            valuePropName="fileList"
            getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)}
            rules={[{ required: true, message: t("documents.selectFileRequired", "请选择文件") }]}
          >
            <Upload maxCount={1} beforeUpload={() => false}
              accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.md,.txt,.html,.csv,.jpg,.jpeg,.png,.tiff,.tif">
              <Button icon={<UploadOutlined />}>{t("documents.selectFile", "选择文件")}</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="category" label={t("documents.docCategory", "分类")}>
            <TreeSelect
              treeData={buildTreeData(enums.categories)}
              allowClear
              treeDefaultExpandAll
              placeholder={t("documents.selectCategory", "选择分类")}
            />
          </Form.Item>
          <Form.Item name="tags" label={t("documents.docTags", "标签")}>
            <Select
              mode="tags"
              options={enums.tags.map((t) => ({ label: t, value: t }))}
              placeholder={t("documents.inputTags", "输入标签")}
            />
          </Form.Item>
          <Form.Item name="parse_mode" label={t("documents.parseMode", "解析模式")} initialValue="auto">
            <Select
              options={[
                { label: t("documents.parseAuto", "自动（推荐）"), value: "auto" },
                { label: t("documents.parseCloudOcr", "MinerU 高精度 OCR"), value: "cloud_ocr" },
                { label: t("documents.parseLocalOnly", "仅本地（Tesseract）"), value: "local_only" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Scan Folder Modal ── */}
      <Modal
        title={t("documents.scanFolderTitle", "扫描文件夹")}
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
            placeholder={t("documents.scanPathPlaceholder", "选择本地文件夹...")}
          />
          <Button icon={<ScanOutlined />} onClick={handleScanFolder} disabled={!scanPath}>
            {t("documents.scan", "预览文件")}
          </Button>
          {scanResult && (
            <div>
              <Text type="secondary">
                {t("documents.scanResult", "扫描结果")}：{scanResult.file_count} {t("documents.filesFound", "个文件")}
              </Text>
              {scanResult.files.slice(0, 20).map((f) => (
                <div key={f.path} style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                  {f.name} ({formatFileSize(f.size)})
                </div>
              ))}
              {scanResult.file_count > 20 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ...{t("documents.moreFiles", "还有")} {scanResult.file_count - 20} {t("documents.filesNotShown", "个文件未显示")}
                </Text>
              )}
            </div>
          )}
          {scanResult && (
            <Button
              type="primary"
              icon={<FolderOpenOutlined />}
              onClick={async () => {
                try {
                  for (const f of scanResult.files) {
                    // Upload each file via API
                    const formData = new FormData();
                    formData.append("file_name", f.name);
                    formData.append("file_path", f.path);
                    formData.append("tags", "");
                    formData.append("category", scanPath.split(/[\\/]/).pop() || "");
                    await knowledgeApi.uploadDoc(formData);
                  }
                  message.success(t("documents.batchUploadSuccess", "批量导入成功，共 {{count}} 个文件", { count: scanResult.file_count }));
                  setScanModalOpen(false);
                  setScanResult(null);
                  setScanPath("");
                  fetchDocs();
                  fetchEnums();
                } catch {
                  message.error(t("documents.batchUploadFailed", "批量导入失败"));
                }
              }}
            >
              {t("documents.importAll", "全部导入")}
            </Button>
          )}
        </Space>
      </Modal>

      {/* ── Export Modal ── */}
      <Modal
        title={t("documents.exportTitle", "导出文档")}
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleExport}
        okText={t("documents.confirmExport", "确认导出")}
        confirmLoading={exporting}
        width={480}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Text type="secondary">
            {t("documents.exportDocCount", "将导出 {{count}} 个文档", {
              count: selectedKeys.length > 0 ? selectedKeys.length : docs.length,
            })}
          </Text>
          <Checkbox
            checked={exportRestore}
            onChange={(e) => setExportRestore(e.target.checked)}
          >
            {t("documents.exportWithRestore", "导出时还原脱敏内容")}
          </Checkbox>
          {exportRestore && (
            <Alert
              type="warning"
              showIcon
              message={t("documents.exportRestoreWarning", "还原导出将包含敏感信息，请确认您有权限查看原始数据")}
            />
          )}
        </Space>
      </Modal>
    </div>
  );
}
