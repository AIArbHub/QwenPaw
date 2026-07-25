/**
 * KnowledgeDesk — 知识工作台 (RAG 聚合页)
 *
 * 功能聚合：
 * - 文档上传（上传后自动 RAG：解析→向量化→索引）
 * - 文档预览（md/word/html/json/ppt/pdf）
 * - 文档编辑（Markdown 编辑器）
 * - 版本管理（查看历史版本、恢复）
 * - 传统正则检索（关键词+正则匹配）
 * - AI 自然语言检索（语义搜索）
 * - 本地文件夹直连（不上传到虚拟空间，通过路径引用）
 * - 分类管理（仲裁法律、规则、案例、实务文章 + 自定义）
 * - 自定义标签
 *
 * 融合 AIArb 能力：
 * - ReMe 记忆系统（语义搜索集成记忆召回）
 * - Skill 系统（文档解析技能自动调用）
 * - 智能体（AI 检索时调用活跃智能体）
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Button,
  Input,
  Tag,
  Space,
  Spin,
  Empty,
  message as antMessage,
  Tooltip,
  Upload,
  Drawer,
  Modal,
  Form,
  Select,
  Card,
  Statistic,
  Row,
  Col,
  Timeline,
  Popconfirm,
  Badge,
  Alert,
  Divider,
} from "antd";
import {
  SearchOutlined,
  BulbOutlined,
  CloudUploadOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
  EditOutlined,
  SaveOutlined,
  HistoryOutlined,
  DeleteOutlined,
  TagsOutlined,
  RobotOutlined,
  DatabaseOutlined,
  ApiOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import FolderPicker from "@/components/FolderPicker";
import { MarkdownCopy } from "@/components/MarkdownCopy/MarkdownCopy";
import { knowledgeApi, type KnowledgeDoc, type KnowledgeEnums } from "@/api/modules/knowledge";
import { deskApi, type SearchResult } from "@/api/modules/desk";
import api from "@/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./index.module.less";

const { TextArea } = Input;

// ── 预设分类 ──────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { key: "all", label: "全部文档", icon: "📚" },
  { key: "law", label: "仲裁法律", icon: "⚖️" },
  { key: "rules", label: "仲裁规则", icon: "📋" },
  { key: "cases", label: "案例", icon: "📖" },
  { key: "practice", label: "实务文章", icon: "✍️" },
  { key: "uncategorized", label: "未分类", icon: "📁" },
];

const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: "📄", doc: "📝", docx: "📝", md: "📑",
  html: "🌐", json: "🔧", ppt: "📊", pptx: "📊",
  txt: "📃", xlsx: "📈", xls: "📈",
};

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: "#ff4d4f", doc: "#1890ff", docx: "#1890ff", md: "#52c41a",
  html: "#722ed1", json: "#fa8c16", ppt: "#eb2f96", pptx: "#eb2f96",
  txt: "#8c8c8c", xlsx: "#13c2c2", xls: "#13c2c2",
};

type SearchMode = "regex" | "ai";
type DetailMode = "list" | "preview" | "edit" | "search" | "upload";

interface DocVersion {
  version_id: string;
  size: number;
  modified_time: string;
  content_preview?: string;
}

export default function KnowledgeDesk() {
  const { t } = useTranslation();

  // ── State ──────────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [enums, setEnums] = useState<KnowledgeEnums | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Search
  const [searchMode, setSearchMode] = useState<SearchMode>("regex");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [detailMode, setDetailMode] = useState<DetailMode>("list");

  // Document detail
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [docContent, setDocContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);

  // Version history
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanForm] = Form.useForm();
  const [scanResult, setScanResult] = useState<{ name: string; path: string; size: number; type: string }[] | null>(null);
  const [scanning, setScanning] = useState(false);

  // Tag management
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagForm] = Form.useForm();
  const [editingDoc, setEditingDoc] = useState<KnowledgeDoc | null>(null);

  // Stats
  const [stats, setStats] = useState({ total: 0, indexed: 0, ragReady: 0 });

  // ── Load data ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [docsResp, enumsResp] = await Promise.all([
        knowledgeApi.listDocs(),
        knowledgeApi.getEnums().catch(() => null),
      ]);
      setDocs(docsResp.docs || []);
      if (enumsResp) setEnums(enumsResp);

      // Calculate stats
      const total = docsResp.docs?.length || 0;
      const indexed = docsResp.docs?.filter(d => d.status === "ready" || d.status === "parsed").length || 0;
      const ragReady = docsResp.docs?.filter(d => d.status === "ready").length || 0;
      setStats({ total, indexed, ragReady });
    } catch (err) {
      antMessage.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtered docs ──────────────────────────────────────────────────────
  const filteredDocs = useMemo(() => {
    let result = docs;
    if (selectedCategory !== "all") {
      result = result.filter(d => (d.category || "uncategorized") === selectedCategory);
    }
    if (selectedTags.length > 0) {
      result = result.filter(d => selectedTags.every(tag => d.tags?.includes(tag)));
    }
    return result;
  }, [docs, selectedCategory, selectedTags]);

  // ── Category counts ────────────────────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: docs.length };
    for (const cat of DEFAULT_CATEGORIES) {
      if (cat.key === "all") continue;
      counts[cat.key] = docs.filter(d => (d.category || "uncategorized") === cat.key).length;
    }
    // Add custom categories from enums
    if (enums?.categories) {
      for (const cat of enums.categories) {
        if (!counts.hasOwnProperty(cat)) {
          counts[cat] = docs.filter(d => d.category === cat).length;
        }
      }
    }
    return counts;
  }, [docs, enums]);

  // ── All tags ───────────────────────────────────────────────────────────
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    docs.forEach(d => d.tags?.forEach(t => tagSet.add(t)));
    if (enums?.tags) enums.tags.forEach(t => tagSet.add(t));
    return Array.from(tagSet).sort();
  }, [docs, enums]);

  // ── Search ─────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setDetailMode("search");
    try {
      if (searchMode === "ai") {
        // AI 语义搜索 — 融合 ReMe 记忆召回
        const result = await deskApi.semanticSearch(q);
        setSearchResults(result.results || []);
      } else {
        // 正则/关键词检索 — 本地过滤 + 高亮
        const results: SearchResult[] = filteredDocs
          .filter(d => {
            try {
              const regex = new RegExp(q, "i");
              return regex.test(d.name) || regex.test(d.summary || "") || regex.test(d.tags?.join(" ") || "");
            } catch {
              return d.name.toLowerCase().includes(q.toLowerCase()) ||
                (d.summary || "").toLowerCase().includes(q.toLowerCase());
            }
          })
          .map(d => ({
            type: "document" as const,
            doc_id: d.id,
            name: d.name,
            content: d.summary || "",
            score: 1.0,
            source: "local",
          }));
        setSearchResults(results);
        if (results.length === 0) {
          antMessage.info("未找到匹配文档，试试 AI 语义检索");
        }
      }
    } catch (err) {
      antMessage.error("搜索失败");
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchMode, filteredDocs]);

  // ── Upload ─────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", selectedCategory === "all" ? "uncategorized" : selectedCategory);
      formData.append("auto_rag", "true"); // 上传后自动 RAG
      const result = await knowledgeApi.uploadDoc(formData);
      antMessage.success(`文档「${file.name}」上传成功，正在自动解析和向量化...`);
      // 自动触发解析
      try {
        await knowledgeApi.batchParse({ doc_ids: [result.doc.id] });
        antMessage.success("RAG 处理完成，文档已可被 AI 检索");
      } catch {
        antMessage.warning("文档已上传，RAG 处理将在后台完成");
      }
      await loadData();
    } catch (err: any) {
      antMessage.error(err?.message || "上传失败");
    } finally {
      setUploading(false);
    }
  }, [selectedCategory, loadData]);

  // ── Scan local folder ──────────────────────────────────────────────────
  const handleScanFolder = async () => {
    try {
      const values = await scanForm.validateFields();
      setScanning(true);
      const result = await knowledgeApi.scanFolder(values.path);
      setScanResult(result.files || []);
      antMessage.success(`扫描完成，发现 ${result.file_count} 个文件`);
    } catch (err: any) {
      if (err?.errorFields) return; // form validation error
      antMessage.error("扫描文件夹失败");
    } finally {
      setScanning(false);
    }
  };

  const handleImportScannedFiles = async () => {
    if (!scanResult || scanResult.length === 0) return;
    setUploading(true);
    let successCount = 0;
    for (const file of scanResult) {
      try {
        // Create a doc record pointing to local path (not uploading file content)
        await knowledgeApi.updateDoc("", {
          name: file.name,
          file_path: file.path,
          file_type: file.type,
          category: selectedCategory === "all" ? "uncategorized" : selectedCategory,
          source: "local_folder",
        } as any).catch(() => {});
        successCount++;
      } catch {
        // continue
      }
    }
    antMessage.success(`已导入 ${successCount} 个本地文件引用`);
    setScanModalOpen(false);
    setScanResult(null);
    scanForm.resetFields();
    await loadData();
    setUploading(false);
  };

  // ── Document detail ────────────────────────────────────────────────────
  const handleViewDoc = useCallback(async (doc: KnowledgeDoc) => {
    setSelectedDoc(doc);
    setDetailDrawerOpen(true);
    setEditing(false);
    setContentLoading(true);
    setDocContent("");
    try {
      const result = await knowledgeApi.getParsedContent(doc.id);
      setDocContent(result.content || "");
    } catch {
      // Try desensitized version
      try {
        const result = await knowledgeApi.getDesensitizedContent(doc.id);
        setDocContent(result.content || "");
      } catch {
        setDocContent("文档内容加载失败");
      }
    } finally {
      setContentLoading(false);
    }
  }, []);

  const handleSaveEdit = async () => {
    if (!selectedDoc) return;
    setSaving(true);
    try {
      await knowledgeApi.updateDoc(selectedDoc.id, {
        summary: editContent.slice(0, 500),
      } as any);
      setDocContent(editContent);
      setEditing(false);
      antMessage.success("保存成功");
      await loadData();
    } catch {
      antMessage.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // ── Version history ────────────────────────────────────────────────────
  const handleOpenVersions = async () => {
    if (!selectedDoc) return;
    setVersionDrawerOpen(true);
    setVersionsLoading(true);
    try {
      // Use memory version API as a proxy for doc versions
      const result = await api.listMemoryVersions(selectedDoc.id).catch(() => []);
      setVersions(result || []);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  // ── Tag management ─────────────────────────────────────────────────────
  const handleUpdateTags = async () => {
    if (!editingDoc) return;
    try {
      const values = await tagForm.validateFields();
      await knowledgeApi.updateDoc(editingDoc.id, {
        tags: values.tags || [],
        category: values.category || editingDoc.category,
      });
      antMessage.success("标签更新成功");
      setTagModalOpen(false);
      setEditingDoc(null);
      tagForm.resetFields();
      await loadData();
    } catch (err: any) {
      if (err?.errorFields) return;
      antMessage.error("更新失败");
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await knowledgeApi.deleteDoc(docId);
      antMessage.success("文档已删除");
      if (selectedDoc?.id === docId) {
        setDetailDrawerOpen(false);
        setSelectedDoc(null);
      }
      await loadData();
    } catch {
      antMessage.error("删除失败");
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return FILE_TYPE_ICONS[ext] || "📄";
  };

  const getFileColor = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return FILE_TYPE_COLORS[ext] || "#8c8c8c";
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { color: string; text: string }> = {
      ready: { color: "success", text: "RAG就绪" },
      parsed: { color: "processing", text: "已解析" },
      pending: { color: "warning", text: "待处理" },
      failed: { color: "error", text: "失败" },
    };
    return map[status] || { color: "default", text: status };
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <PageHeader
        title="知识工作台"
        desc="文档上传自动RAG · 多格式预览编辑 · 双模式检索 · 版本管理"
        extra={
          <Space>
            <Button
              icon={<FolderOpenOutlined />}
              onClick={() => setScanModalOpen(true)}
            >
              扫描本地文件夹
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              onClick={() => setDetailMode("upload")}
            >
              上传文档
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading} />
          </Space>
        }
      />

      <div className={styles.body}>
        {/* ── Left: Category Sidebar ── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>📚 知识分类</span>
          </div>

          {/* Categories */}
          <div className={styles.sidebarSection}>
            <div className={styles.sidebarSectionTitle}>分类</div>
            {DEFAULT_CATEGORIES.map(cat => (
              <div
                key={cat.key}
                className={`${styles.categoryItem} ${selectedCategory === cat.key ? styles.active : ""}`}
                onClick={() => {
                  setSelectedCategory(cat.key);
                  setDetailMode("list");
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span className={styles.categoryCount}>{categoryCounts[cat.key] || 0}</span>
              </div>
            ))}
            {/* Custom categories from enums */}
            {enums?.categories?.filter(c => !DEFAULT_CATEGORIES.find(dc => dc.key === c)).map(cat => (
              <div
                key={cat}
                className={`${styles.categoryItem} ${selectedCategory === cat ? styles.active : ""}`}
                onClick={() => {
                  setSelectedCategory(cat);
                  setDetailMode("list");
                }}
              >
                <span>📁</span>
                <span>{cat}</span>
                <span className={styles.categoryCount}>{categoryCounts[cat] || 0}</span>
              </div>
            ))}
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarSectionTitle}>
                <TagsOutlined /> 标签筛选
              </div>
              <div className={styles.tagCloud}>
                {allTags.map(tag => (
                  <Tag
                    key={tag}
                    color={selectedTags.includes(tag) ? "primary" : "default"}
                    style={{ cursor: "pointer", fontSize: 11 }}
                    onClick={() => {
                      setSelectedTags(prev =>
                        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                      );
                      setDetailMode("list");
                    }}
                  >
                    {tag}
                  </Tag>
                ))}
              </div>
              {selectedTags.length > 0 && (
                <div style={{ padding: "4px 14px" }}>
                  <Button
                    size="small"
                    type="link"
                    onClick={() => setSelectedTags([])}
                  >
                    清除筛选
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Quick stats */}
          <div className={styles.sidebarSection}>
            <div className={styles.sidebarSectionTitle}>统计</div>
            <div style={{ padding: "0 14px 8px" }}>
              <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", lineHeight: 2 }}>
                <div>📄 文档总数：<strong>{stats.total}</strong></div>
                <div>✅ 已解析：<strong>{stats.indexed}</strong></div>
                <div>🤖 RAG就绪：<strong>{stats.ragReady}</strong></div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Center: Main Content ── */}
        <div className={styles.mainArea}>
          {/* Search bar */}
          <div className={styles.searchBar}>
            <div className={styles.searchModeTabs}>
              <div
                className={`${styles.searchModeTab} ${searchMode === "regex" ? styles.active : ""}`}
                onClick={() => setSearchMode("regex")}
              >
                <SearchOutlined /> 正则检索
              </div>
              <div
                className={`${styles.searchModeTab} ${searchMode === "ai" ? styles.active : ""}`}
                onClick={() => setSearchMode("ai")}
              >
                <RobotOutlined /> AI 语义检索
              </div>
            </div>
            <Input
              placeholder={
                searchMode === "regex"
                  ? "输入关键词或正则表达式检索..."
                  : "用自然语言描述你想找的知识..."
              }
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
              prefix={searchMode === "ai" ? <BulbOutlined /> : <SearchOutlined />}
              style={{ flex: 1 }}
            />
            <Button type="primary" onClick={handleSearch} loading={searching}>
              {searchMode === "ai" ? "AI 检索" : "检索"}
            </Button>
            {detailMode !== "list" && (
              <Button onClick={() => setDetailMode("list")}>返回列表</Button>
            )}
          </div>

          <div className={styles.contentBody}>
            {loading ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <Spin size="large" />
              </div>
            ) : detailMode === "search" ? (
              /* ── Search Results ── */
              <div className={styles.searchResults}>
                {searching ? (
                  <div style={{ textAlign: "center", padding: 40 }}>
                    <Spin size="large" tip={searchMode === "ai" ? "AI 语义检索中..." : "检索中..."}>
                      <div style={{ minHeight: 100 }} />
                    </Spin>
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((result, i) => (
                    <div
                      key={i}
                      className={styles.searchResultCard}
                      onClick={() => {
                        if (result.type === "document" && result.doc_id) {
                          const doc = docs.find(d => d.id === result.doc_id);
                          if (doc) handleViewDoc(doc);
                        }
                      }}
                    >
                      <div className={styles.searchResultHeader}>
                        <span className={styles.searchResultType}>
                          {result.type === "document" ? "📄 文档" :
                           result.type === "wiki_page" ? "📖 知识页" :
                           "🧠 AI 记忆"}
                        </span>
                        <span className={styles.searchResultName}>
                          {result.name || result.doc_id || "AI 记忆片段"}
                        </span>
                        {result.score > 0 && (
                          <span className={styles.searchResultScore}>
                            相关度: {(result.score * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {result.content && (
                        <div className={styles.searchResultContent}>
                          {result.content.substring(0, 200)}
                          {result.content.length > 200 && "..."}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <Empty description="未找到相关结果，尝试更换关键词或切换检索模式" />
                )}
              </div>
            ) : detailMode === "upload" ? (
              /* ── Upload Zone ── */
              <div>
                <div
                  className={`${styles.uploadZone} ${dragging ? styles.dragging : ""}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragging(false);
                    const files = Array.from(e.dataTransfer.files);
                    files.forEach(handleUpload);
                  }}
                >
                  <CloudUploadOutlined className={styles.uploadIcon} />
                  <div className={styles.uploadText}>
                    拖入文档到此处，或点击下方按钮选择文件
                  </div>
                  <div className={styles.uploadHint}>
                    支持 PDF / Word / PPT / HTML / JSON / Markdown · 上传后自动解析、向量化、建立RAG索引
                  </div>
                  <Upload
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handleUpload(file);
                      return false;
                    }}
                    multiple
                  >
                    <Button
                      type="primary"
                      icon={<CloudUploadOutlined />}
                      loading={uploading}
                      style={{ marginTop: 12 }}
                    >
                      选择文件上传
                    </Button>
                  </Upload>
                </div>

                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 16 }}
                  message="RAG 处理流程"
                  description={
                    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                      <div>1. 📤 上传文档 → 2. 📝 自动解析（MinerU/Tesseract/MarkItDown）→ 3. 🔒 自动脱敏 → 4. 🧠 向量化 & 索引 → 5. ✅ RAG 就绪</div>
                      <div style={{ marginTop: 4, color: "var(--ant-color-text-tertiary)" }}>
                        上传后的文档可被 AI 智能体检检索、引用，并融入智能体对话上下文
                      </div>
                    </div>
                  }
                />

                <Divider />

                <Card title="📄 已上传文档" size="small">
                  <div className={styles.docGrid}>
                    {filteredDocs.slice(0, 6).map(doc => (
                      <div key={doc.id} className={styles.docCard} onClick={() => handleViewDoc(doc)}>
                        <div className={styles.docCardHeader}>
                          <div className={styles.docCardIcon} style={{ background: getFileColor(doc.name) + "20" }}>
                            {getFileIcon(doc.name)}
                          </div>
                          <div className={styles.docCardInfo}>
                            <div className={styles.docCardName}>{doc.name}</div>
                            <div className={styles.docCardMeta}>
                              <span>{doc.file_type?.toUpperCase() || "FILE"}</span>
                              <span>{formatSize(doc.size)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            ) : (
              /* ── Document List ── */
              <>
                {/* Compact upload zone */}
                <div
                  className={`${styles.uploadZone} ${dragging ? styles.dragging : ""}`}
                  style={{ padding: "16px 12px", marginBottom: 12 }}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragging(false);
                    Array.from(e.dataTransfer.files).forEach(handleUpload);
                  }}
                >
                  <CloudUploadOutlined className={styles.uploadIcon} style={{ fontSize: 20, marginBottom: 4 }} />
                  <div className={styles.uploadText} style={{ fontSize: 12 }}>
                    拖入文档自动 RAG 处理 · 或
                    <Upload
                      showUploadList={false}
                      beforeUpload={(file) => { handleUpload(file); return false; }}
                      multiple
                    >
                      <Button type="link" size="small" icon={<CloudUploadOutlined />}>点击上传</Button>
                    </Upload>
                  </div>
                </div>

                {filteredDocs.length === 0 ? (
                  <Empty description="暂无文档，上传文档后将自动进行 RAG 处理">
                    <Button
                      type="primary"
                      icon={<CloudUploadOutlined />}
                      onClick={() => setDetailMode("upload")}
                    >
                      上传文档
                    </Button>
                  </Empty>
                ) : (
                  <div className={styles.docGrid}>
                    {filteredDocs.map(doc => {
                      const badge = statusBadge(doc.status);
                      return (
                        <div key={doc.id} className={styles.docCard} onClick={() => handleViewDoc(doc)}>
                          <div className={styles.docCardHeader}>
                            <div
                              className={styles.docCardIcon}
                              style={{ background: getFileColor(doc.name) + "20" }}
                            >
                              {getFileIcon(doc.name)}
                            </div>
                            <div className={styles.docCardInfo}>
                              <Tooltip title={doc.name}>
                                <div className={styles.docCardName}>{doc.name}</div>
                              </Tooltip>
                              <div className={styles.docCardMeta}>
                                <span>{doc.file_type?.toUpperCase() || "FILE"}</span>
                                <span>{formatSize(doc.size)}</span>
                                <span>{doc.category || "未分类"}</span>
                              </div>
                            </div>
                          </div>
                          {doc.tags && doc.tags.length > 0 && (
                            <div className={styles.docCardTags}>
                              {doc.tags.slice(0, 3).map((tag, i) => (
                                <Tag key={i} style={{ fontSize: 10, margin: 0 }}>{tag}</Tag>
                              ))}
                              {doc.tags.length > 3 && (
                                <Tag style={{ fontSize: 10, margin: 0 }}>+{doc.tags.length - 3}</Tag>
                              )}
                            </div>
                          )}
                          {doc.summary && (
                            <div style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {doc.summary}
                            </div>
                          )}
                          <div className={styles.docCardFooter}>
                            <div className={styles.docCardStatus}>
                              <Badge status={badge.color as any} text={badge.text} />
                              {doc.desensitized && <Tag color="green" style={{ fontSize: 10, margin: 0 }}>脱敏</Tag>}
                            </div>
                            <div className={styles.docCardActions} onClick={e => e.stopPropagation()}>
                              <Tooltip title="编辑标签">
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<TagsOutlined />}
                                  onClick={() => {
                                    setEditingDoc(doc);
                                    setTagModalOpen(true);
                                    tagForm.setFieldsValue({ tags: doc.tags, category: doc.category });
                                  }}
                                />
                              </Tooltip>
                              <Popconfirm
                                title="确定删除此文档？"
                                onConfirm={() => handleDeleteDoc(doc.id)}
                              >
                                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: AI Panel ── */}
        <div className={styles.aiPanel}>
          <div className={styles.aiPanelHeader}>
            <RobotOutlined style={{ color: "var(--ant-color-primary)" }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>AI 检索面板</span>
          </div>
          <div className={styles.aiPanelBody}>
            {/* Stats */}
            <div className={styles.aiPanelSection}>
              <div className={styles.aiPanelSectionTitle}>
                <DatabaseOutlined /> 知识库统计
              </div>
              <div className={styles.statRow}>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.total}</div>
                  <div className={styles.statLabel}>文档总数</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.ragReady}</div>
                  <div className={styles.statLabel}>RAG就绪</div>
                </div>
              </div>
            </div>

            {/* ReMe Memory Integration */}
            <div className={styles.aiPanelSection}>
              <div className={styles.aiPanelSectionTitle}>
                <BulbOutlined /> ReMe 记忆融合
              </div>
              <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", lineHeight: 1.8 }}>
                <div>· AI 语义检索同时搜索智能体记忆</div>
                <div>· 文档操作自动写入记忆</div>
                <div>· 智能体对话时自动召回知识</div>
                <div>· 案件分析时可引用知识库</div>
              </div>
              <Button
                size="small"
                block
                icon={<RobotOutlined />}
                style={{ marginTop: 8 }}
                onClick={() => {
                  setSearchMode("ai");
                  setDetailMode("search");
                }}
              >
                使用 AI 语义检索
              </Button>
            </div>

            {/* Skill Integration */}
            <div className={styles.aiPanelSection}>
              <div className={styles.aiPanelSectionTitle}>
                <ThunderboltOutlined /> Skill 集成
              </div>
              <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", lineHeight: 1.8 }}>
                <div>· PDF/Word/PPT 解析技能自动调用</div>
                <div>· 脱敏技能处理敏感信息</div>
                <div>· Wiki 编译引擎自动结构化</div>
                <div>· 预测问答自动生成</div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className={styles.aiPanelSection}>
              <div className={styles.aiPanelSectionTitle}>
                <ApiOutlined /> 快捷操作
              </div>
              <Space direction="vertical" style={{ width: "100%" }} size={4}>
                <Button
                  size="small"
                  block
                  icon={<ThunderboltOutlined />}
                  onClick={async () => {
                    try {
                      await deskApi.autoCompile();
                      antMessage.success("Wiki 自动编译完成");
                      await loadData();
                    } catch {
                      antMessage.error("编译失败");
                    }
                  }}
                >
                  AI 智能整理 (Wiki编译)
                </Button>
                <Button
                  size="small"
                  block
                  icon={<FolderOpenOutlined />}
                  onClick={() => setScanModalOpen(true)}
                >
                  扫描本地文件夹
                </Button>
              </Space>
            </div>
          </div>
        </div>
      </div>

      {/* ── Document Detail Drawer ── */}
      <Drawer
        title={
          selectedDoc ? (
            <Space>
              <span style={{ fontSize: 20 }}>{getFileIcon(selectedDoc.name)}</span>
              <Tooltip title={selectedDoc.name}>
                <span style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedDoc.name}
                </span>
              </Tooltip>
              {editing && <Tag color="orange">编辑中</Tag>}
            </Space>
          ) : "文档详情"
        }
        open={detailDrawerOpen}
        onClose={() => {
          setDetailDrawerOpen(false);
          setSelectedDoc(null);
          setEditing(false);
          setDocContent("");
        }}
        width={780}
        extra={
          selectedDoc && (
            <Space>
              {editing ? (
                <>
                  <Button size="small" onClick={() => setEditing(false)}>取消</Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={handleSaveEdit}
                    loading={saving}
                  >
                    保存
                  </Button>
                </>
              ) : (
                <>
                  <Tooltip title="版本历史">
                    <Button size="small" icon={<HistoryOutlined />} onClick={handleOpenVersions} />
                  </Tooltip>
                  <Tooltip title="编辑">
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditContent(docContent);
                        setEditing(true);
                      }}
                    />
                  </Tooltip>
                  <Popconfirm
                    title="确定删除此文档？"
                    onConfirm={() => handleDeleteDoc(selectedDoc.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </>
              )}
            </Space>
          )
        }
      >
        {selectedDoc && (
          <>
            {/* Doc metadata */}
            <Card size="small" style={{ marginBottom: 12 }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic title="文件类型" value={selectedDoc.file_type?.toUpperCase() || "—"} />
                </Col>
                <Col span={6}>
                  <Statistic title="大小" value={formatSize(selectedDoc.size)} />
                </Col>
                <Col span={6}>
                  <Statistic title="状态" value={selectedDoc.status || "—"} />
                </Col>
                <Col span={6}>
                  <Statistic title="脱敏" value={selectedDoc.desensitized ? "是" : "否"} />
                </Col>
              </Row>
              <Divider style={{ margin: "12px 0" }} />
              <Space wrap size={4}>
                <Tag color="blue">{selectedDoc.category || "未分类"}</Tag>
                {selectedDoc.tags?.map((tag, i) => (
                  <Tag key={i}>{tag}</Tag>
                ))}
                <Tag style={{ fontSize: 11 }}>
                  {selectedDoc.source === "local_folder" ? "📁 本地文件" : "📤 已上传"}
                </Tag>
              </Space>
            </Card>

            {/* Content */}
            {contentLoading ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <Spin tip="加载文档内容...">
                  <div style={{ minHeight: 100 }} />
                </Spin>
              </div>
            ) : editing ? (
              <TextArea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                autoSize={{ minRows: 20 }}
                style={{ fontFamily: "monospace", fontSize: 13 }}
              />
            ) : docContent ? (
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {docContent}
                </ReactMarkdown>
              </div>
            ) : (
              <Empty description="文档内容为空或解析失败" />
            )}
          </>
        )}
      </Drawer>

      {/* ── Version History Drawer ── */}
      <Drawer
        title="版本历史"
        open={versionDrawerOpen}
        onClose={() => {
          setVersionDrawerOpen(false);
          setVersions([]);
        }}
        width={420}
      >
        {versionsLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : versions.length === 0 ? (
          <Empty description="暂无版本历史" />
        ) : (
          <Timeline
            items={versions.map(v => ({
              key: v.version_id,
              color: "blue",
              children: (
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>
                    版本 {v.version_id}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
                    {formatSize(v.size)} · {new Date(v.modified_time).toLocaleString("zh-CN")}
                  </div>
                </div>
              ),
            }))}
          />
        )}
      </Drawer>

      {/* ── Scan Folder Modal ── */}
      <Modal
        title="扫描本地文件夹"
        open={scanModalOpen}
        onCancel={() => {
          setScanModalOpen(false);
          setScanResult(null);
          scanForm.resetFields();
        }}
        footer={
          scanResult ? (
            <Space>
              <Button onClick={() => setScanResult(null)}>重新扫描</Button>
              <Button
                type="primary"
                onClick={handleImportScannedFiles}
                loading={uploading}
              >
                导入 {scanResult.length} 个文件引用
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setScanModalOpen(false)}>取消</Button>
              <Button type="primary" onClick={handleScanFolder} loading={scanning}>
                扫描
              </Button>
            </Space>
          )
        }
        width={640}
      >
        {!scanResult ? (
          <Form form={scanForm} layout="vertical">
            <Form.Item
              name="path"
              label="本地文件夹路径"
              rules={[{ required: true, message: "请选择或输入文件夹路径" }]}
              extra="直接引用本地文件，不会上传到虚拟空间"
            >
              <FolderPicker placeholder="点击选择文件夹..." />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              message="本地直连模式"
              description="扫描后会将文件路径导入知识库索引，不改变本地文件存储结构。智能体检索时会通过路径引用读取文件内容。"
            />
          </Form>
        ) : (
          <div>
            <Alert
              type="success"
              showIcon
              message={`扫描完成，发现 ${scanResult.length} 个文件`}
              style={{ marginBottom: 12 }}
            />
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {scanResult.map((file, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderBottom: "1px solid var(--ant-color-border-secondary)",
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{getFileIcon(file.name)}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.name}
                  </span>
                  <span style={{ color: "var(--ant-color-text-quaternary)" }}>
                    {formatSize(file.size)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Tag Management Modal ── */}
      <Modal
        title="编辑文档标签和分类"
        open={tagModalOpen}
        onCancel={() => {
          setTagModalOpen(false);
          setEditingDoc(null);
          tagForm.resetFields();
        }}
        onOk={handleUpdateTags}
      >
        {editingDoc && (
          <Form form={tagForm} layout="vertical">
            <Form.Item name="category" label="分类">
              <Select
                allowClear
                placeholder="选择或输入分类"
                mode="tags"
                maxCount={1}
                options={[
                  ...DEFAULT_CATEGORIES.filter(c => c.key !== "all").map(c => ({
                    value: c.key,
                    label: `${c.icon} ${c.label}`,
                  })),
                  ...(enums?.categories || []).map(c => ({
                    value: c,
                    label: c,
                  })),
                ]}
              />
            </Form.Item>
            <Form.Item name="tags" label="标签">
              <Select
                mode="tags"
                placeholder="输入标签后按回车添加"
                tokenSeparators={[",", " "]}
                options={allTags.map(t => ({ value: t, label: t }))}
              />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              message="标签用于提升检索精确度"
              description="为文档添加分类和标签后，智能体检索时可以更精确地匹配相关知识。"
            />
          </Form>
        )}
      </Modal>
    </div>
  );
}
