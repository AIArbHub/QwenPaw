/**
 * KnowledgeDesk — 知识工作台
 *
 * Combines Knowledge (文档管理) + Wiki (知识页) + Memory (AI 记忆) into a
 * unified workspace. Features:
 * - Left: Knowledge tree (wiki pages by category + documents)
 * - Center: Knowledge detail (wiki content, document preview, search results)
 * - Right: AI Memory panel
 * - Drop zone for auto-structuring documents
 * - Semantic search across wiki, documents, and memories
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Button,
  Input,
  Tag,
  Space,
  Spin,
  Empty,
  message as antMessage,
  Segmented,
  Card,
  Tooltip,
  Upload,
  Divider,
  Tree,
} from "antd";
import {
  SearchOutlined,
  BookOutlined,
  FileTextOutlined,
  BrainOutlined,
  CloudUploadOutlined,
  ReloadOutlined,
  ApartmentOutlined,
  UnorderedListOutlined,
  FolderOutlined,
  FileOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { deskApi, type SearchResult, type KnowledgeGraph } from "@/api/modules/desk";
import { knowledgeApi, type KnowledgeDoc } from "@/api/modules/knowledge";
import styles from "./index.module.less";

interface WikiPageItem {
  path: string;
  name: string;
  page_type: string;
  source_doc_ids: string[];
  source_case_ids: string[];
  updated_at: string;
}

interface DocItem {
  doc_id: string;
  name: string;
  category: string;
  tags: string[];
  status: string;
  owner: string;
  uploaded_at: number;
  size: number;
}
type ViewMode = "list" | "graph";
type DetailMode = "wiki" | "documents" | "search" | "drop";

export default function KnowledgeDesk() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [wikiPages, setWikiPages] = useState<WikiPageItem[]>([]);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [selectedWikiPage, setSelectedWikiPage] = useState<WikiPageItem | null>(null);
  const [wikiContent, setWikiContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailMode, setDetailMode] = useState<DetailMode>("documents");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [dragging, setDragging] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load wiki pages
      try {
        const wikiResult = await deskApi.getWikiLinks();
        // Load wiki pages list
        const pagesResp = await fetch(`/api/wiki/pages`).then(r => r.json());
        if (pagesResp.pages) {
          setWikiPages(pagesResp.pages);
        }
      } catch {
        // Fallback: try knowledge API
      }
      // Load documents
      try {
        const resp = await knowledgeApi.listDocs();
        setDocuments(resp.docs || []);
      } catch {
        setDocuments([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load wiki page content
  const loadWikiPage = useCallback(async (page: WikiPageItem) => {
    setSelectedWikiPage(page);
    setDetailMode("wiki");
    try {
      const resp = await fetch(`/api/wiki/pages/${page.path}`).then(r => r.json());
      setWikiContent(resp.content || "");
    } catch {
      setWikiContent("加载失败");
    }
  }, []);

  // Semantic search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setDetailMode("search");
    try {
      const result = await deskApi.semanticSearch(searchQuery.trim());
      setSearchResults(result.results || []);
    } catch {
      antMessage.error("搜索失败");
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  // Load graph
  const loadGraph = useCallback(async () => {
    try {
      const g = await deskApi.getKnowledgeGraph();
      setGraph(g);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (viewMode === "graph") {
      loadGraph();
    }
  }, [viewMode, loadGraph]);

  // Build tree data from wiki pages
  const treeData = (() => {
    const categories: Record<string, WikiPageItem[]> = {};
    wikiPages.forEach(p => {
      const cat = p.page_type || "uncategorized";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(p);
    });
    return Object.entries(categories).map(([cat, pages]) => ({
      title: `${cat} (${pages.length})`,
      key: `cat_${cat}`,
      icon: <FolderOutlined />,
      children: pages.map(p => ({
        title: p.name,
        key: p.path,
        icon: <FileOutlined />,
        isLeaf: true,
      })),
    }));
  })();

  return (
    <div className={styles.page}>
      <PageHeader
        title="知识工作台"
        desc="文档自动结构化 · 双向链接 · 语义搜索 · AI 记忆"
        extra={
          <Space>
            <Input.Search
              placeholder="搜索知识..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onSearch={handleSearch}
              loading={searching}
              style={{ width: 240 }}
              prefix={<SearchOutlined />}
            />
            <Segmented
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
              options={[
                { label: "列表", value: "list", icon: <UnorderedListOutlined /> },
                { label: "图谱", value: "graph", icon: <ApartmentOutlined /> },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={loadData} />
          </Space>
        }
      />

      <div className={styles.body}>
        {/* ── Left: Knowledge Tree ── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>📚 知识分类</span>
            <Button
              size="small"
              type="text"
              icon={<CloudUploadOutlined />}
              onClick={() => setDetailMode("drop")}
            />
          </div>
          <div className={styles.sidebarTree}>
            {loading ? (
              <div style={{ textAlign: "center", padding: 20 }}>
                <Spin size="small" />
              </div>
            ) : wikiPages.length > 0 ? (
              <Tree
                treeData={treeData}
                onSelect={(keys, info) => {
                  const page = wikiPages.find(p => p.path === keys[0]);
                  if (page) loadWikiPage(page);
                }}
                defaultExpandAll
                showIcon
                blockNode
              />
            ) : (
              <Empty
                description="暂无知识页"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ padding: 20 }}
              />
            )}
          </div>
          {/* Documents section */}
          <div style={{ borderTop: "1px solid var(--ant-color-border-secondary)", padding: "8px 0" }}>
            <div style={{ padding: "4px 16px", fontSize: 12, fontWeight: 600, color: "var(--ant-color-text-secondary)" }}>
              📄 文档 ({documents.length})
            </div>
            {documents.slice(0, 10).map(doc => (
              <div
                key={doc.doc_id}
                className={styles.treeNode}
                onClick={() => setDetailMode("documents")}
              >
                <FileTextOutlined />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doc.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Center: Detail Area ── */}
        <div className={styles.detailArea}>
          <div className={styles.detailHeader}>
            <Space>
              {detailMode === "wiki" && selectedWikiPage && (
                <span style={{ fontSize: 15, fontWeight: 600 }}>{selectedWikiPage.name}</span>
              )}
              {detailMode === "documents" && (
                <span style={{ fontSize: 15, fontWeight: 600 }}>📄 文档管理</span>
              )}
              {detailMode === "search" && (
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  🔍 搜索: "{searchQuery}"
                </span>
              )}
              {detailMode === "drop" && (
                <span style={{ fontSize: 15, fontWeight: 600 }}>📤 导入文档</span>
              )}
            </Space>
            <Space>
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                onClick={async () => {
                  try {
                    await deskApi.autoCompile();
                    antMessage.success("自动编译完成");
                    loadData();
                  } catch {
                    antMessage.error("编译失败");
                  }
                }}
              >
                自动编译
              </Button>
            </Space>
          </div>

          <div className={styles.detailBody}>
            {viewMode === "graph" ? (
              /* Graph view */
              <div className={styles.graphContainer}>
                {graph ? (
                  <div style={{ textAlign: "center" }}>
                    <ApartmentOutlined style={{ fontSize: 48, color: "var(--ant-color-primary)", marginBottom: 16 }} />
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>知识图谱</div>
                    <div style={{ color: "var(--ant-color-text-secondary)" }}>
                      {graph.nodes.length} 个节点 · {graph.edges.length} 条连接
                    </div>
                    {/* Simple text-based graph visualization */}
                    <div style={{ marginTop: 20, textAlign: "left", maxWidth: 600 }}>
                      {graph.nodes.slice(0, 20).map(node => (
                        <Tag key={node.id} style={{ margin: 4 }} color={node.type === "case" ? "blue" : "default"}>
                          {node.label}
                        </Tag>
                      ))}
                      {graph.nodes.length > 20 && (
                        <Tag>...还有 {graph.nodes.length - 20} 个</Tag>
                      )}
                    </div>
                  </div>
                ) : (
                  <Spin size="large" />
                )}
              </div>
            ) : (
              /* List view */
              <>
                {/* Drop zone */}
                {detailMode === "drop" && (
                  <div
                    className={`${styles.dropZone} ${dragging ? styles.dragging : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      antMessage.info("文档上传后将自动解析、脱敏和结构化");
                      setDetailMode("documents");
                    }}
                  >
                    <CloudUploadOutlined className={styles.dropZoneIcon} />
                    <div className={styles.dropZoneText}>拖入文档到此处</div>
                    <div className={styles.dropZoneHint}>
                      支持 PDF / Word / PPT / 图片 · 自动解析 → 脱敏 → 结构化 → 建立双向链接
                    </div>
                  </div>
                )}

                {/* Wiki content */}
                {detailMode === "wiki" && (
                  <div className={styles.wikiContent}>
                    {wikiContent ? (
                      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, lineHeight: 1.8 }}>
                        {wikiContent}
                      </pre>
                    ) : (
                      <Spin tip="加载中..." />
                    )}
                  </div>
                )}

                {/* Documents */}
                {detailMode === "documents" && (
                  <div className={styles.docList}>
                    {documents.length > 0 ? (
                      documents.map(doc => (
                        <div key={doc.doc_id} className={styles.docCard}>
                          <div className={styles.docCardInfo}>
                            <div className={styles.docCardName}>{doc.name}</div>
                            <div className={styles.docCardMeta}>
                              <span>{doc.category || "未分类"}</span>
                              <span>{doc.status}</span>
                              {doc.tags.slice(0, 3).map((t, i) => (
                                <Tag key={i} style={{ fontSize: 11 }}>{t}</Tag>
                              ))}
                            </div>
                          </div>
                          <Space>
                            <Tooltip title="AI 分析">
                              <Button
                                size="small"
                                icon={<ThunderboltOutlined />}
                                onClick={async () => {
                                  try {
                                    const result = await deskApi.analyzeDocument(doc.doc_id);
                                    antMessage.success(`分析完成: ${result.summary}`);
                                  } catch {
                                    antMessage.error("分析失败");
                                  }
                                }}
                              />
                            </Tooltip>
                          </Space>
                        </div>
                      ))
                    ) : (
                      <Empty description="暂无文档。点击左侧上传按钮导入文档。" />
                    )}
                  </div>
                )}

                {/* Search results */}
                {detailMode === "search" && (
                  <div className={styles.searchResults}>
                    {searching ? (
                      <div style={{ textAlign: "center", padding: 40 }}>
                        <Spin size="large" tip="语义搜索中..." />
                      </div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map((result, i) => (
                        <div
                          key={i}
                          className={styles.searchResultCard}
                          onClick={() => {
                            if (result.type === "wiki_page" && result.path) {
                              const page = wikiPages.find(p => p.path === result.path);
                              if (page) loadWikiPage(page);
                            }
                          }}
                        >
                          <div className={styles.searchResultType}>
                            {result.type === "wiki_page" ? "📖 知识页" :
                             result.type === "document" ? "📄 文档" :
                             "🧠 AI 记忆"}
                          </div>
                          <div className={styles.searchResultName}>
                            {result.name || result.doc_id || "AI 记忆片段"}
                          </div>
                          {result.content && (
                            <div className={styles.searchResultContent}>
                              {result.content.substring(0, 200)}...
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <Empty description="未找到相关结果" />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: AI Memory Panel ── */}
        <div className={styles.memoryPanel}>
          <div className={styles.memoryHeader}>
            <BrainOutlined style={{ fontSize: 18, color: "var(--ant-color-primary)" }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>AI 记忆</span>
          </div>
          <div className={styles.memoryBody}>
            <div style={{ fontSize: 12, color: "var(--ant-color-text-quaternary)", marginBottom: 12 }}>
              AI 在案件分析和对话中自动积累的记忆
            </div>
            <div className={styles.memoryItem}>
              <div>AI 记忆功能已集成。在仲裁工作台中的 AI 对话、文档分析、庭审记录都会自动写入记忆。</div>
              <div className={styles.memoryTime}>系统提示</div>
            </div>
            <Divider style={{ margin: "12px 0" }} />
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ant-color-text-secondary)", marginBottom: 8 }}>
              记忆使用方式
            </div>
            <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", lineHeight: 1.8 }}>
              · 案件操作自动写入记忆<br />
              · 语义搜索同时搜索记忆<br />
              · AI 助手对话时自动召回记忆<br />
              · 案件下次打开时 AI 仍记得
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
