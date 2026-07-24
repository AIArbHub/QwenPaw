/**
 * ArbitrationKB — AI Arb 知识库
 *
 * 三栏布局的仲裁知识库页面，面向法学背景用户（商事仲裁员、律师、仲裁秘书）。
 * 基于 QwenPaw 原生能力重建：文件树、标签云、Markdown 渲染、双链图谱、AI 流式问答。
 *
 * 布局：
 * - 顶部：PageHeader + [上传文档] [新建条目] [刷新]
 * - 搜索栏：全文检索 / 标签 / 双链 三种模式 + 过滤器
 * - 左栏（240px）：文件树 + 标签云（带 bar 可视化）
 * - 中栏（flex）：文档内容 + Markdown + 引用图谱
 * - 右栏（320px）：AI 流式问答（SSE）
 */
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  Button,
  Input,
  Tag,
  Space,
  Spin,
  Empty,
  Upload,
  message as antMessage,
  Tooltip,
  Badge,
  Segmented,
  Modal,
  Form,
  Divider,
  Alert,
} from "antd";
import {
  SearchOutlined,
  CloudUploadOutlined,
  ReloadOutlined,
  FileOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  TagsOutlined,
  LinkOutlined,
  RobotOutlined,
  BulbOutlined,
  CopyOutlined,
  ArrowRightOutlined,
  ArrowLeftOutlined,
  SendOutlined,
  StopOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  InboxOutlined,
  PlusOutlined,
  PaperClipOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/PageHeader";
import {
  kbApi,
  type KBFileNode,
  type KBStats,
  type KBTagCount,
  type KBFileContent,
  type KBSearchResult,
  type KBLinkResult,
  type KBImportResult,
} from "@/api/modules/kb";
import styles from "./index.module.less";

const { TextArea } = Input;

// ── Types ────────────────────────────────────────────────────────────────
type SearchMode = "fulltext" | "tag" | "link";

interface FilterChip {
  key: string;
  label: string;
  color?: string;
  onRemove: () => void;
}

interface AIMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  sources?: string[];
  streaming?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────
const TAG_COLORS = [
  "blue", "green", "gold", "purple", "cyan",
  "magenta", "red", "orange", "geekblue", "volcano",
];

function colorForTag(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}

function fileExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function formatDate(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("zh-CN");
  }
  return String(value);
}

const AI_SUGGESTIONS = [
  "仲裁协议的有效要件有哪些？",
  "什么情况下可以申请仲裁员回避？",
  "仲裁裁决的撤销情形有哪些？",
];

// ── FileTree 递归节点 ────────────────────────────────────────────────────
interface FileTreeNodeProps {
  node: KBFileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: KBFileNode) => void;
  expandedSet: Set<string>;
  toggleExpand: (path: string) => void;
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  expandedSet,
  toggleExpand,
}: FileTreeNodeProps) {
  const isDir = node.is_dir;
  const isExpanded = expandedSet.has(node.path);
  const isActive = !isDir && selectedPath === node.path;
  const isMd = ["md", "markdown"].includes(fileExt(node.name));

  return (
    <div>
      <div
        className={`${styles.fileNode} ${isActive ? styles.fileNodeActive : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => (isDir ? toggleExpand(node.path) : onSelect(node))}
      >
        {isDir ? (
          <>
            <span className={styles.fileNodeToggle}>
              {isExpanded ? "▾" : "▸"}
            </span>
            <span className={styles.fileNodeIcon}>
              {isExpanded ? <FolderOpenOutlined /> : <FolderOutlined />}
            </span>
          </>
        ) : (
          <>
            <span className={styles.fileNodeToggle} />
            <span className={styles.fileNodeIcon}>
              {isMd ? <FileTextOutlined /> : <FileOutlined />}
            </span>
          </>
        )}
        <span className={styles.fileNodeName} title={node.name}>
          {node.name}
        </span>
      </div>
      {isDir && isExpanded && node.children && node.children.length > 0 && (
        <div>
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expandedSet={expandedSet}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────
export default function ArbitrationKB() {
  const { t } = useTranslation();

  // 文件树 & 统计
  const [tree, setTree] = useState<KBFileNode[]>([]);
  const [stats, setStats] = useState<KBStats | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());

  // 标签
  const [tags, setTags] = useState<KBTagCount[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  // 选中文件 & 内容
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<KBFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [forwardLinks, setForwardLinks] = useState<string[]>([]);
  const [backlinkResults, setBacklinkResults] = useState<KBLinkResult[]>([]);

  // 搜索
  const [searchMode, setSearchMode] = useState<SearchMode>("fulltext");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<KBSearchResult[] | null>(null);
  const [linkResults, setLinkResults] = useState<KBLinkResult[] | null>(null);
  const [activeFilters, setActiveFilters] = useState<FilterChip[]>([]);

  // AI 问答
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiMessagesRef = useRef<HTMLDivElement>(null);

  // 导入
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<KBImportResult | null>(null);

  // 新建条目
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();

  // i18n helper（i18n keys 暂未添加，先用中文 fallback）
  const tt = useCallback(
    (key: string, fallback: string) => t(`arbitrationKB.${key}`, fallback),
    [t],
  );

  // ── 加载文件树 + 统计 ──
  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const resp = await kbApi.list();
      if (resp.ok) {
        setTree(resp.tree || []);
        setStats(resp.stats || null);
        if (expandedSet.size === 0) {
          const topDirs = (resp.tree || []).filter(n => n.is_dir).map(n => n.path);
          if (topDirs.length > 0) setExpandedSet(new Set(topDirs.slice(0, 3)));
        }
      }
    } catch (err: any) {
      antMessage.error(tt("loadTreeError", "加载文件树失败") + (err?.message ? `：${err.message}` : ""));
    } finally {
      setTreeLoading(false);
    }
  }, [expandedSet.size, tt]);

  // ── 加载标签 ──
  const loadTags = useCallback(async () => {
    setTagsLoading(true);
    try {
      const resp = await kbApi.tags();
      if (resp.ok) setTags(resp.tags || []);
    } catch {
      // 静默
    } finally {
      setTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTree();
    loadTags();
  }, [loadTree, loadTags]);

  // ── 加载文件内容 ──
  const loadFile = useCallback(async (path: string) => {
    setFileLoading(true);
    setFileContent(null);
    setForwardLinks([]);
    setBacklinkResults([]);
    try {
      const [fileResp, fwdResp] = await Promise.all([
        kbApi.getFile(path),
        kbApi.forwardLinks(path).catch(() => ({ ok: false, links: [] })),
      ]);
      if (fileResp.ok && fileResp.file) {
        setFileContent(fileResp.file);
        try {
          const blResp = await kbApi.backlinks(fileResp.file.title);
          if (blResp.ok) setBacklinkResults(blResp.results || []);
        } catch {
          // ignore
        }
      }
      if (fwdResp.ok) setForwardLinks(fwdResp.links || []);
    } catch (err: any) {
      antMessage.error(tt("loadFileError", "加载文件失败") + (err?.message ? `：${err.message}` : ""));
    } finally {
      setFileLoading(false);
    }
  }, [tt]);

  useEffect(() => {
    if (selectedPath) loadFile(selectedPath);
  }, [selectedPath, loadFile]);

  // AI 消息自动滚动
  useEffect(() => {
    if (aiMessagesRef.current) {
      aiMessagesRef.current.scrollTop = aiMessagesRef.current.scrollHeight;
    }
  }, [aiMessages]);

  // ── 选中文件 ──
  const handleSelectFile = useCallback((node: KBFileNode) => {
    setSelectedPath(node.path);
    setSearchResults(null);
    setLinkResults(null);
    setActiveFilters([]);
  }, []);

  const toggleExpand = useCallback((path: string) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // ── 搜索 ──
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      antMessage.warning(tt("searchEmpty", "请输入搜索内容"));
      return;
    }
    setSearching(true);
    setSearchResults(null);
    setLinkResults(null);
    try {
      if (searchMode === "fulltext") {
        const resp = await kbApi.search(q);
        if (resp.ok) {
          setSearchResults(resp.results || []);
          setActiveFilters([{
            key: "q",
            label: `${tt("keyword", "关键词")}：${q}`,
            color: "blue",
            onRemove: () => { setSearchQuery(""); setSearchResults(null); setActiveFilters([]); },
          }]);
        }
      } else if (searchMode === "tag") {
        const tag = q.replace(/^tag:/i, "").trim();
        const resp = await kbApi.byTag(tag);
        if (resp.ok) {
          setSearchResults(resp.results || []);
          setActiveFilters([{
            key: "tag",
            label: `${tt("tag", "标签")}：${tag}`,
            color: "gold",
            onRemove: () => { setSearchQuery(""); setSearchResults(null); setActiveFilters([]); },
          }]);
        }
      } else {
        const resp = await kbApi.backlinks(q);
        if (resp.ok) {
          setLinkResults(resp.results || []);
          setActiveFilters([{
            key: "link",
            label: `${tt("backlinks", "反向链接")}：${q}`,
            color: "purple",
            onRemove: () => { setSearchQuery(""); setLinkResults(null); setActiveFilters([]); },
          }]);
        }
      }
    } catch (err: any) {
      antMessage.error(tt("searchError", "搜索失败") + (err?.message ? `：${err.message}` : ""));
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchMode, tt]);

  // ── 标签云点击 ──
  const handleTagClick = useCallback((tag: string) => {
    setSearchMode("tag");
    setSearchQuery(tag);
    setSearching(true);
    setSearchResults(null);
    setLinkResults(null);
    kbApi.byTag(tag)
      .then(resp => {
        if (resp.ok) {
          setSearchResults(resp.results || []);
          setActiveFilters([{
            key: "tag",
            label: `${tt("tag", "标签")}：${tag}`,
            color: "gold",
            onRemove: () => { setSearchQuery(""); setSearchResults(null); setActiveFilters([]); },
          }]);
        }
      })
      .catch(() => antMessage.error(tt("searchError", "搜索失败")))
      .finally(() => setSearching(false));
  }, [tt]);

  const handleOpenResult = useCallback((path: string) => {
    setSelectedPath(path);
    setSearchResults(null);
    setLinkResults(null);
    setActiveFilters([]);
  }, []);

  // ── 双链跳转 ──
  const handleLinkClick = useCallback((title: string) => {
    const findPath = (nodes: KBFileNode[]): string | null => {
      for (const n of nodes) {
        if (!n.is_dir) {
          const base = n.name.replace(/\.(md|markdown)$/i, "");
          if (base === title || n.name === title) return n.path;
        }
        if (n.children) {
          const found = findPath(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    const path = findPath(tree);
    if (path) {
      setSelectedPath(path);
    } else {
      setSearchMode("link");
      setSearchQuery(title);
      antMessage.info(tt("linkNotFound", "未找到对应文件，已切换到双链检索"));
      handleSearch();
    }
  }, [tree, tt, handleSearch]);

  // ── 刷新 ──
  const handleRefresh = useCallback(() => {
    loadTree();
    loadTags();
    if (selectedPath) loadFile(selectedPath);
  }, [loadTree, loadTags, selectedPath, loadFile]);

  // ── 智能导入 ──
  const handleImport = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const result = await kbApi.importFile(file, true);
      if (result && result.ok) {
        setImportResult(result);
        antMessage.success(tt("importSuccess", "文档导入成功"));
        await Promise.all([loadTree(), loadTags()]);
      } else {
        antMessage.error(tt("importFailed", "文档导入失败"));
      }
    } catch (err: any) {
      antMessage.error(tt("importFailed", "文档导入失败") + (err?.message ? `：${err.message}` : ""));
    } finally {
      setImporting(false);
    }
  }, [loadTree, loadTags, tt]);

  // ── 新建条目 ──
  const handleCreateEntry = useCallback(async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      const resp = await kbApi.importRaw({
        title: values.title,
        content: values.content,
        tags: values.tags ? values.tags.split(/[,，\s]+/).filter(Boolean) : undefined,
        status: values.status,
      });
      if (resp.ok) {
        antMessage.success(tt("createSuccess", "条目创建成功"));
        setCreateModalOpen(false);
        createForm.resetFields();
        await Promise.all([loadTree(), loadTags()]);
        if (resp.file) handleOpenResult(resp.file);
      } else {
        antMessage.error(tt("createFailed", "条目创建失败"));
      }
    } catch (err: any) {
      if (err?.errorFields) return; // 表单校验错误
      antMessage.error(tt("createFailed", "条目创建失败") + (err?.message ? `：${err.message}` : ""));
    } finally {
      setCreating(false);
    }
  }, [createForm, loadTree, loadTags, tt, handleOpenResult]);

  // ── AI 问答 ──
  const handleAiAsk = useCallback(async (question?: string) => {
    const q = (question ?? aiInput).trim();
    if (!q || aiLoading) return;
    if (aiAbortRef.current) aiAbortRef.current.abort();

    const controller = new AbortController();
    aiAbortRef.current = controller;
    const userMsgId = `u_${Date.now()}`;
    const assistantMsgId = `a_${Date.now()}`;
    const contextFiles = selectedPath ? [selectedPath] : [];

    setAiMessages(prev => [
      ...prev,
      { id: userMsgId, role: "user", content: q },
      { id: assistantMsgId, role: "assistant", content: "", streaming: true, sources: contextFiles },
    ]);
    setAiInput("");
    setAiLoading(true);

    try {
      await kbApi.aiAskStream(
        { question: q, context_files: contextFiles },
        event => {
          if (event.type === "token" && event.text) {
            setAiMessages(prev => prev.map(m =>
              m.id === assistantMsgId ? { ...m, content: m.content + event.text } : m,
            ));
          } else if (event.type === "tool" && event.name) {
            setAiMessages(prev => [
              ...prev.slice(0, -1),
              { id: `tool_${Date.now()}`, role: "tool", content: event.name!, toolName: event.name },
              prev[prev.length - 1],
            ]);
          } else if (event.type === "done") {
            setAiMessages(prev => prev.map(m =>
              m.id === assistantMsgId ? { ...m, streaming: false } : m,
            ));
          } else if (event.type === "error") {
            setAiMessages(prev => prev.map(m =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + (m.content ? "\n\n" : "") + `**${tt("aiError", "AI 回答出错")}**：${event.message || ""}`, streaming: false }
                : m,
            ));
          }
        },
        controller.signal,
      );
    } catch (err: any) {
      const aborted = err?.name === "AbortError";
      setAiMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, streaming: false, content: m.content + (aborted ? `\n\n*(${tt("aiStopped", "已停止")})*` : `\n\n**${tt("aiError", "AI 回答出错")}**：${err?.message || ""}`) }
          : m,
      ));
    } finally {
      setAiLoading(false);
      aiAbortRef.current = null;
    }
  }, [aiInput, aiLoading, selectedPath, tt]);

  const handleAiStop = useCallback(() => {
    aiAbortRef.current?.abort();
  }, []);

  const handleAiCopy = useCallback((msg: AIMessage) => {
    navigator.clipboard.writeText(msg.content)
      .then(() => antMessage.success(tt("copied", "已复制到剪贴板")))
      .catch(() => antMessage.error(tt("copyFailed", "复制失败")));
  }, [tt]);

  const handleAiFollowUp = useCallback((msg: AIMessage) => {
    setAiInput(`${tt("followUpPrefix", "关于上文")}「${msg.content.slice(0, 30)}${msg.content.length > 30 ? "..." : ""}」：`);
  }, [tt]);

  const handleAiToReview = useCallback(() => {
    antMessage.info(tt("toReviewHint", "即将跳转到核阅页面（开发中）"));
  }, [tt]);

  // ── 渲染辅助 ──
  const maxTagCount = useMemo(() => tags.reduce((m, t) => Math.max(m, t.count), 0) || 1, [tags]);

  const renderTagList = (items: string[] | undefined, color: string | ((s: string) => string), emptyKey: string, onClick?: (s: string) => void) => (
    <div className={styles.importResultTags}>
      {items && items.length > 0 ? (
        items.map(item => <Tag key={item} color={typeof color === "function" ? color(item) : color} style={{ cursor: onClick ? "pointer" : "default", margin: 0 }} onClick={onClick ? () => onClick(item) : undefined}>{item}</Tag>)
      ) : <span style={{ fontSize: 12, color: "var(--ant-color-text-quaternary)" }}>{tt(emptyKey, "暂无")}</span>}
    </div>
  );

  const renderImportSection = (icon: ReactNode, label: string, count?: number, children: ReactNode) => (
    <div className={styles.importResultSection}>
      <div className={styles.importResultSectionLabel}>
        {icon}{label}
        {typeof count === "number" && <span style={{ color: "var(--ant-color-text-quaternary)", fontWeight: 400 }}>({count})</span>}
      </div>
      {children}
    </div>
  );

  const renderFileTree = (nodes: KBFileNode[]) => {
    if (nodes.length === 0) {
      return <div style={{ padding: "20px 12px", textAlign: "center" }}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tt("emptyTree", "暂无文件")} /></div>;
    }
    return nodes.map(node => (
      <FileTreeNode key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={handleSelectFile} expandedSet={expandedSet} toggleExpand={toggleExpand} />
    ));
  };

  const renderDocHeader = () => {
    if (!fileContent) return null;
    const fm = fileContent.frontmatter || {};
    const dateValue = fm["date"] || fm["updated"] || fm["created"];
    return (
      <div className={styles.docHeader}>
        <h2 className={styles.docTitle}>{fileContent.title || fileContent.path}</h2>
        <div className={styles.docMeta}>
          {fileContent.status && (
            <span className={styles.docMetaItem}>
              <Badge status={fileContent.status === "已核阅" ? "success" : fileContent.status === "待核阅" ? "processing" : "default"} text={fileContent.status} />
            </span>
          )}
          {dateValue && (
            <span className={styles.docMetaItem}><FileTextOutlined />{formatDate(dateValue)}</span>
          )}
          <span className={styles.docMetaItem}>
            <FileOutlined />
            <Tooltip title={fileContent.path}>
              <span style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileContent.path}</span>
            </Tooltip>
          </span>
          {fileContent.tags && fileContent.tags.length > 0 && (
            <span className={styles.docMetaTags}>
              {fileContent.tags.map(tag => (
                <Tag key={tag} color={colorForTag(tag)} style={{ cursor: "pointer", margin: 0 }} onClick={() => handleTagClick(tag)}>{tag}</Tag>
              ))}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderLinkGraph = () => {
    if (!fileContent) return null;
    const renderGraphNode = (label: string, cls: string, key: string, onClick?: () => void, icon?: ReactNode, title?: string) => (
      <span key={key} className={`${styles.graphNode} ${cls}`} onClick={onClick} title={title}>{icon}{label}</span>
    );
    return (
      <div className={styles.linkSection}>
        <div className={styles.linkSectionTitle}><LinkOutlined />{tt("linkRelations", "引用图谱")}</div>
        <div className={styles.graphRow}>
          {backlinkResults.length > 0
            ? backlinkResults.slice(0, 5).map((bl, i) => renderGraphNode(bl.title, styles.graphSource, `bl-${i}`, () => handleOpenResult(bl.path), <ArrowLeftOutlined />, bl.path))
            : <span className={styles.linkEmpty}>{tt("noBacklinks", "暂无来源")}</span>}
          <ArrowRightOutlined className={styles.graphArrow} />
          <span className={`${styles.graphNode} ${styles.graphCurrent}`}>{fileContent.title}</span>
          <ArrowRightOutlined className={styles.graphArrow} />
          {forwardLinks.length > 0
            ? forwardLinks.slice(0, 5).map((link, i) => renderGraphNode(link, styles.graphTarget, `fwd-${i}`, () => handleLinkClick(link), undefined, undefined))
            : <span className={styles.linkEmpty}>{tt("noForwardLinks", "无目标")}</span>}
        </div>
      </div>
    );
  };

  const renderResultCard = (icon: ReactNode, title: string, snippet: string | undefined, tags: string[] | undefined, status: string | undefined, path: string, score?: number, onOpen?: () => void) => (
    <div className={styles.searchResultCard} onClick={onOpen}>
      <div className={styles.searchResultHeader}>
        {icon}
        <span className={styles.searchResultTitle}>{title}</span>
        {typeof score === "number" && score > 0 && <span className={styles.searchResultScore}>{tt("relevance", "相关度")} {(score * 100).toFixed(0)}%</span>}
      </div>
      {snippet && <div className={styles.searchResultSnippet}>{snippet}</div>}
      <div className={styles.searchResultMeta}>
        {tags && tags.slice(0, 3).map(tag => <Tag key={tag} color={colorForTag(tag)} style={{ fontSize: 10, margin: 0 }}>{tag}</Tag>)}
        {status && <Tag style={{ fontSize: 10, margin: 0 }}>{status}</Tag>}
        <span className={styles.searchResultLink}>{path}</span>
      </div>
    </div>
  );

  const renderSearchResults = () => {
    if (searching) return <div style={{ textAlign: "center", padding: 60 }}><Spin size="large" tip={tt("searching", "检索中...")} /></div>;
    if (searchResults && searchResults.length === 0) return <Empty description={tt("noResults", "未找到相关结果，请尝试更换关键词或模式")} />;
    if (searchResults && searchResults.length > 0) {
      return (
        <div className={styles.searchResultList}>
          <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 4 }}>
            {tt("resultCountPrefix", "共找到")} {searchResults.length} {tt("resultCountSuffix", "条结果")}
          </div>
          {searchResults.map((r, i) => renderResultCard(
            <FileTextOutlined style={{ color: "var(--ant-color-primary)" }} />, r.title, r.snippet, r.tags, r.status, r.path, r.score, () => handleOpenResult(r.path),
          ))}
        </div>
      );
    }
    if (linkResults && linkResults.length === 0) return <Empty description={tt("noBacklinksFound", "未找到引用该标题的文档")} />;
    if (linkResults && linkResults.length > 0) {
      return (
        <div className={styles.searchResultList}>
          <Alert type="info" showIcon message={`${tt("backlinksFound", "找到")} ${linkResults.length} ${tt("backlinksUnit", "条反向链接")}`} style={{ marginBottom: 4 }} />
          {linkResults.map((r, i) => renderResultCard(
            <LinkOutlined style={{ color: "var(--ant-color-primary)" }} />, r.title,
            r.link_text ? `${tt("linkText", "链接文本")}：${r.link_text}` : undefined, r.tags, undefined, r.path, undefined, () => handleOpenResult(r.path),
          ))}
        </div>
      );
    }
    return null;
  };

  const renderContent = () => {
    if (searchResults || linkResults || searching) return renderSearchResults();
    if (fileLoading) return <div style={{ textAlign: "center", padding: 60 }}><Spin size="large" tip={tt("loadingFile", "加载文档中...")} /></div>;
    if (fileContent) {
      return (
        <>
          {renderDocHeader()}
          <div className={styles.docBody}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileContent.body || fileContent.raw || ""}</ReactMarkdown>
          </div>
          {renderLinkGraph()}
        </>
      );
    }
    return (
      <div className={styles.contentEmpty}>
        <InboxOutlined className={styles.emptyIcon} />
        <div className={styles.emptyHint}>
          {tt("emptyHint", "从左侧文件树选择文档，或点击顶部 [上传文档] / [新建条目]")}
          <br />
          {tt("emptyHint2", "支持 PDF / Word / Markdown / 图片 等格式，导入后自动生成标签与关联建议")}
        </div>
      </div>
    );
  };

  const renderTagCloud = () => (
    <div className={styles.tagCloudPanel}>
      <div className={styles.panelHeader}>
        <TagsOutlined style={{ color: "var(--ant-color-primary)" }} />
        {tt("tagCloud", "标签云")}
        {tags.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>{tags.length}{tt("tagsUnit", "个")}</span>}
      </div>
      <div className={styles.tagCloud}>
        {tagsLoading ? (
          <Spin size="small" />
        ) : tags.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--ant-color-text-quaternary)" }}>{tt("noTags", "暂无标签")}</span>
        ) : (
          tags.map(tag => (
            <div key={tag.tag} className={styles.tagItem} onClick={() => handleTagClick(tag.tag)}>
              <span className={styles.tagLabel} title={tag.tag}>{tag.tag}</span>
              <div className={styles.tagBar}><span style={{ width: `${(tag.count / maxTagCount) * 100}%` }} /></div>
              <span className={styles.tagCount}>{tag.count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderAiPanel = () => (
    <div className={styles.aiPanel}>
      <div className={styles.aiPanelHeader}>
        <RobotOutlined style={{ color: "var(--ant-color-primary)" }} />
        {tt("aiAssistant", "AI 知识问答")}
      </div>
      <div className={styles.aiContextHint}>
        <BulbOutlined />
        {selectedPath ? (
          <span>{tt("contextPrefix", "当前上下文：")}<strong style={{ marginLeft: 4 }}>{fileContent?.title || selectedPath}</strong></span>
        ) : (
          <span>{tt("noContext", "未选中文档，AI 将基于整个知识库回答")}</span>
        )}
      </div>
      <div className={styles.aiMessages} ref={aiMessagesRef}>
        {aiMessages.length === 0 ? (
          <div className={styles.aiEmpty}>
            <RobotOutlined style={{ fontSize: 28, marginBottom: 8 }} />
            <div>{tt("aiWelcome", "向 AI 提问关于仲裁知识库的问题")}</div>
            <div style={{ marginTop: 12, textAlign: "left" }}>
              {AI_SUGGESTIONS.map(s => (
                <div key={s} className={styles.aiSuggestionChip} style={{ display: "inline-block", margin: 2 }} onClick={() => handleAiAsk(s)}>{s}</div>
              ))}
            </div>
          </div>
        ) : (
          aiMessages.map(msg => (
            <div key={msg.id} className={`${styles.aiMessage} ${msg.role === "user" ? styles.aiMessageUser : msg.role === "tool" ? styles.aiMessageTool : styles.aiMessageAssistant}`}>
              {msg.role === "tool" ? (
                <span><SearchOutlined /> {tt("toolCall", "调用工具")}：{msg.toolName}</span>
              ) : (
                <>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || (msg.streaming ? "..." : "")}</ReactMarkdown>
                  {msg.streaming && <span style={{ display: "inline-block", marginLeft: 2 }}><Spin size="small" /></span>}
                  {msg.sources && msg.sources.length > 0 && !msg.streaming && (
                    <div className={styles.aiSources}>
                      <div className={styles.aiSourcesLabel}><FileTextOutlined />{tt("sources", "来源引用")}</div>
                      {msg.sources.map(src => <div key={src} className={styles.aiSourceItem} onClick={() => handleOpenResult(src)}>{src}</div>)}
                    </div>
                  )}
                  {msg.role === "assistant" && !msg.streaming && msg.content && (
                    <div className={styles.aiActions}>
                      <Button size="small" type="text" icon={<ArrowRightOutlined />} onClick={() => handleAiFollowUp(msg)}>{tt("followUp", "追问")}</Button>
                      <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => handleAiCopy(msg)}>{tt("copy", "复制")}</Button>
                      <Button size="small" type="text" icon={<PaperClipOutlined />} onClick={handleAiToReview}>{tt("toReview", "引用到核阅")}</Button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
      <div className={styles.aiInputBar}>
        <div className={styles.aiInputRow}>
          <TextArea
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            placeholder={tt("aiInputPlaceholder", "提问关于仲裁法律、规则、案例的问题...")}
            autoSize={{ minRows: 1, maxRows: 4 }}
            onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleAiAsk(); } }}
            style={{ flex: 1, resize: "none" }}
          />
          {aiLoading ? (
            <Button danger icon={<StopOutlined />} onClick={handleAiStop} title={tt("stop", "停止")} />
          ) : (
            <Button type="primary" icon={<SendOutlined />} onClick={() => handleAiAsk()} disabled={!aiInput.trim()} />
          )}
        </div>
      </div>
    </div>
  );

  // ── 搜索栏模式选项 ──
  const searchModeOptions = useMemo(() => [
    { label: tt("modeFulltext", "全文检索"), value: "fulltext" as const },
    { label: tt("modeTag", "标签"), value: "tag" as const },
    { label: tt("modeLink", "双链"), value: "link" as const },
  ], [tt]);

  const searchPlaceholder = useMemo(() => {
    if (searchMode === "fulltext") return tt("placeholderFulltext", "输入关键词进行全文检索...");
    if (searchMode === "tag") return tt("placeholderTag", "输入标签名检索（如 仲裁法）...");
    return tt("placeholderLink", "输入文档标题，查找其反向链接...");
  }, [searchMode, tt]);

  // ── Render ──
  return (
    <div className={styles.page}>
      <PageHeader
        current={tt("title", "AI Arb 知识库")}
        extra={
          <Space>
            <Upload
              showUploadList={false}
              beforeUpload={file => { handleImport(file); return false; }}
              multiple
            >
              <Button icon={<CloudUploadOutlined />} loading={importing}>{tt("import", "上传文档")}</Button>
            </Upload>
            <Button icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>{tt("newEntry", "新建条目")}</Button>
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={treeLoading}>{tt("refresh", "刷新")}</Button>
          </Space>
        }
      />

      <div className={styles.body}>
        {/* ── 左栏：文件树 + 标签云 ── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>
              <FolderOpenOutlined style={{ color: "var(--ant-color-primary)" }} />
              {tt("fileTree", "文件树")}
            </span>
            <Tooltip title={tt("refresh", "刷新")}>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={loadTree} loading={treeLoading} />
            </Tooltip>
          </div>
          <div className={styles.fileTree}>
            {treeLoading && tree.length === 0 ? (
              <div style={{ textAlign: "center", padding: 20 }}><Spin size="small" /></div>
            ) : renderFileTree(tree)}
          </div>
          {stats && (
            <div style={{ padding: "6px 14px", fontSize: 11, color: "var(--ant-color-text-tertiary)", display: "flex", justifyContent: "space-between", flexShrink: 0, borderBottom: "1px solid var(--ant-color-border-secondary)" }}>
              <span>{tt("totalFiles", "文件")} {stats.total_files}</span>
              <span>{tt("totalTags", "标签")} {stats.total_tags}</span>
              <span>{tt("totalLinks", "双链")} {stats.total_links}</span>
            </div>
          )}
          {renderTagCloud()}
        </div>

        {/* ── 中栏：搜索栏 + 内容区 ── */}
        <div className={styles.mainArea}>
          <div className={styles.searchBar}>
            <Segmented
              options={searchModeOptions}
              value={searchMode}
              onChange={v => { setSearchMode(v as SearchMode); setSearchResults(null); setLinkResults(null); setActiveFilters([]); }}
            />
            <Input
              className={styles.searchInput}
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
              prefix={searchMode === "tag" ? <TagsOutlined /> : searchMode === "link" ? <LinkOutlined /> : <SearchOutlined />}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={searching}>{tt("search", "搜索")}</Button>
            {activeFilters.length > 0 && (
              <div className={styles.filterRow}>
                <span className={styles.filterLabel}>{tt("activeFilters", "已选条件")}：</span>
                {activeFilters.map(f => (
                  <Tag key={f.key} color={f.color} closable onClose={f.onRemove} style={{ margin: 0 }}>{f.label}</Tag>
                ))}
                <Button size="small" type="link" onClick={() => { setActiveFilters([]); setSearchResults(null); setLinkResults(null); setSearchQuery(""); }}>
                  {tt("clearAll", "全部清除")}
                </Button>
              </div>
            )}
          </div>
          <div className={styles.contentArea}>{renderContent()}</div>
        </div>

        {/* ── 右栏：AI 问答 ── */}
        <div className={styles.sidePanel}>{renderAiPanel()}</div>
      </div>

      {/* 导入结果 Modal */}
      <Modal
        title={<span><CheckCircleOutlined style={{ color: "var(--ant-color-success)", marginRight: 8 }} />{tt("importResultTitle", "文档导入结果")}</span>}
        open={!!importResult}
        onCancel={() => setImportResult(null)}
        footer={[<Button key="close" type="primary" onClick={() => setImportResult(null)}>{tt("ok", "确定")}</Button>]}
      >
        {importResult && (
          <div>
            {renderImportSection(<FileTextOutlined />, tt("generatedTitle", "生成标题"), undefined,
              <div style={{ fontSize: 14, fontWeight: 500 }}>{importResult.title}</div>,
            )}
            {renderImportSection(<TagsOutlined />, tt("generatedTags", "生成标签"), undefined,
              renderTagList(importResult.tags, colorForTag, "noTags"),
            )}
            {importResult.summary && renderImportSection(<BulbOutlined />, tt("aiSummary", "AI 摘要"), undefined,
              <div className={styles.importResultSummary}>{importResult.summary}</div>,
            )}
            <Divider style={{ margin: "12px 0" }} />
            {renderImportSection(<LinkOutlined />, tt("linkedDocs", "已建立的关联"), importResult.suggestions?.linked?.length || 0,
              renderTagList(importResult.suggestions?.linked, "blue", "noLinks", (link) => { setImportResult(null); handleLinkClick(link); }),
            )}
            {renderImportSection(<BulbOutlined />, tt("pendingLinks", "建议创建的双链"), importResult.suggestions?.pending_links?.length || 0,
              renderTagList(importResult.suggestions?.pending_links, "orange", "noPending"),
            )}
            <Alert type="info" showIcon style={{ marginTop: 12 }} message={tt("importTip", "导入的文档已加入知识库文件树，可在左侧查看。")} />
          </div>
        )}
      </Modal>

      {/* 新建条目 Modal */}
      <Modal
        title={<span><PlusOutlined style={{ marginRight: 8 }} />{tt("newEntryTitle", "新建知识库条目")}</span>}
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={handleCreateEntry}
        confirmLoading={creating}
        okText={tt("create", "创建")}
        cancelText={tt("cancel", "取消")}
        width={640}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item name="title" label={tt("formTitle", "标题")} rules={[{ required: true, message: tt("formTitleRequired", "请输入标题") }]}>
            <Input placeholder={tt("formTitlePlaceholder", "例如：仲裁协议效力的认定标准")} />
          </Form.Item>
          <Form.Item name="content" label={tt("formContent", "内容（Markdown）")} rules={[{ required: true, message: tt("formContentRequired", "请输入内容") }]}>
            <TextArea rows={8} placeholder={tt("formContentPlaceholder", "支持 Markdown 语法，例如：\n## 核心规则\n根据《仲裁法》第16条...")} />
          </Form.Item>
          <Form.Item name="tags" label={tt("formTags", "标签")} tooltip={tt("formTagsTip", "多个标签用逗号或空格分隔")}>
            <Input placeholder={tt("formTagsPlaceholder", "例如：仲裁法, 管辖, 司法审查")} />
          </Form.Item>
          <Form.Item name="status" label={tt("formStatus", "状态")}>
            <Segmented options={[{ label: tt("statusPending", "待核阅"), value: "待核阅" }, { label: tt("statusReviewed", "已核阅"), value: "已核阅" }, { label: tt("statusDraft", "草稿"), value: "草稿" }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
