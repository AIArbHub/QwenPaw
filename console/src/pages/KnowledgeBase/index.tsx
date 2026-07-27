import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Collapse,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Tabs,
  Tag,
  Upload,
  message,
} from "antd";
import {
  SearchOutlined,
  DeleteOutlined,
  EyeOutlined,
  InboxOutlined,
  ReloadOutlined,
  FileTextOutlined,
  ApartmentOutlined,
  BookOutlined,
  LinkOutlined,
  BulbOutlined,
  CheckOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { ResizableTextArea } from "@/components/ResizableTextArea";
import kbApi, {
  type KnowledgeDocumentSummary,
  type SearchResponse,
  type Citation,
  type OKFConcept,
  type DiscoverySuggestion,
} from "@/api/modules/kb";
import SearchDebugPanel from "./components/SearchDebugPanel";
import styles from "./index.module.less";

// ── OKF 概念类型标签颜色映射 ──

const OKF_TYPE_COLORS: Record<string, string> = {
  source_document: "blue",
  source_section: "cyan",
  topic: "green",
  playbook: "orange",
  business_rule: "red",
  query_analysis: "purple",
};

const OKF_TYPE_LABELS: Record<string, string> = {
  source_document: "源文档",
  source_section: "文档章节",
  topic: "主题",
  playbook: "操作手册",
  business_rule: "业务规则",
  query_analysis: "查询分析",
};

// ─── 文档入库弹窗 ───────────────────────────────────────────────────────

interface IngestModalProps {
  open: boolean;
  onClose: () => void;
  onIngested: () => void;
}

const { Dragger } = Upload;

function IngestModal({ open, onClose, onIngested }: IngestModalProps) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [activeTab, setActiveTab] = useState("file");

  const handleIngestText = async () => {
    if (!text.trim()) {
      message.warning("请输入文本内容");
      return;
    }
    setIngesting(true);
    try {
      const tagList = tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await kbApi.ingestText({
        text,
        title: title || undefined,
        tags: tagList.length > 0 ? tagList : undefined,
      });
      const okfCount = res.okf_concept_count ?? 0;
      message.success(
        `入库成功：${res.title}（${res.chunk_count} 个分块，${okfCount} 个概念）`,
      );
      setText("");
      setTitle("");
      setTags("");
      onIngested();
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "入库失败",
      );
    } finally {
      setIngesting(false);
    }
  };

  const uploadProps = {
    name: "file",
    action: undefined, // 使用自定义上传
    multiple: true,
    accept: ".txt,.md,.markdown,.html,.htm,.pdf,.docx",
    showUploadList: true,
    customRequest: async (options: any) => {
      const { file, onSuccess, onError } = options;
      setIngesting(true);
      try {
        const tagList = tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const res = await kbApi.uploadDocument(file as File, {
          title: title || undefined,
          tags: tagList.length > 0 ? tagList.join(",") : undefined,
        });
        const okfCount = res.okf_concept_count ?? 0;
        message.success(
          `上传成功：${res.title}（${res.chunk_count} 个分块，${okfCount} 个概念）`,
        );
        onSuccess?.(res);
        onIngested();
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : "上传失败",
        );
        onError?.(err);
      } finally {
        setIngesting(false);
      }
    },
  };

  return (
    <Modal
      open={open}
      title="文档入库"
      onCancel={onClose}
      width={640}
      footer={
        activeTab === "text"
          ? [
              <Button key="cancel" onClick={onClose}>
                取消
              </Button>,
              <Button
                key="ingest"
                type="primary"
                icon={<InboxOutlined />}
                loading={ingesting}
                onClick={handleIngestText}
              >
                入库
              </Button>,
            ]
          : [
              <Button key="close" onClick={onClose}>
                关闭
              </Button>,
            ]
      }
    >
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
          标题（可选）
        </label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="如：仲裁规则概述"
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
          标签（可选，逗号分隔）
        </label>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="如：仲裁,规则,程序"
        />
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        items={[
          {
            key: "file",
            label: "文件上传",
            children: (
              <Dragger
                {...uploadProps}
                style={{
                  background: "var(--sd-surface-muted)",
                  borderRadius: "var(--sd-radius-md)",
                  border: "1px dashed var(--sd-border)",
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p
                  className="ant-upload-text"
                  style={{ color: "var(--sd-ink)" }}
                >
                  点击或拖拽文件到此区域上传
                </p>
                <p
                  className="ant-upload-hint"
                  style={{ color: "var(--sd-muted)" }}
                >
                  支持 txt / md / html / pdf / docx 格式
                </p>
              </Dragger>
            ),
          },
          {
            key: "text",
            label: "文本入库",
            children: (
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontWeight: 500,
                  }}
                >
                  <span
                    style={{ color: "var(--sd-danger)", marginRight: 4 }}
                  >
                    *
                  </span>
                  文本内容
                </label>
                <ResizableTextArea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  defaultHeight={200}
                  placeholder="粘贴需要入库的文档文本..."
                />
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}

// ─── OKF 概念面板 ────────────────────────────────────────────────────────

function OkfConceptPanel({ concepts }: { concepts: OKFConcept[] }) {
  if (!concepts || concepts.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无 OKF 概念"
      />
    );
  }

  const groupedByType = concepts.reduce<
    Record<string, OKFConcept[]>
  >((acc, concept) => {
    const type = concept.concept_type || "unknown";
    if (!acc[type]) acc[type] = [];
    acc[type].push(concept);
    return acc;
  }, {});

  const collapseItems = Object.entries(groupedByType).map(
    ([type, items]) => ({
      key: type,
      label: (
        <Space>
          <Tag color={OKF_TYPE_COLORS[type] || "default"}>
            {OKF_TYPE_LABELS[type] || type}
          </Tag>
          <span style={{ color: "var(--sd-muted)", fontSize: 12 }}>
            {items.length} 个
          </span>
        </Space>
      ),
      children: (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((concept) => (
            <div
              key={concept.concept_id}
              style={{
                padding: "10px 12px",
                background: "var(--sd-surface-muted)",
                borderRadius: "var(--sd-radius-sm)",
                borderLeft: "3px solid var(--sd-accent)",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: "var(--sd-ink)",
                  marginBottom: 4,
                }}
              >
                {concept.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--sd-muted)",
                  fontFamily: "monospace",
                  marginBottom: 4,
                }}
              >
                {concept.concept_id}
              </div>
              {concept.description && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--sd-ink-soft)",
                    lineHeight: 1.5,
                  }}
                >
                  {concept.description}
                </div>
              )}
              {concept.links && concept.links.length > 0 && (
                <div
                  style={{
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    color: "var(--sd-muted-2)",
                  }}
                >
                  <LinkOutlined />
                  {concept.links.length} 个链接
                </div>
              )}
            </div>
          ))}
        </div>
      ),
    }),
  );

  return (
    <Collapse
      items={collapseItems}
      defaultActiveKey={Object.keys(groupedByType).slice(0, 2)}
      ghost
    />
  );
}

// ─── 引用追溯面板 ────────────────────────────────────────────────────────

function CitationPanel({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: "var(--sd-surface-muted)",
        borderRadius: "var(--sd-radius-sm)",
        border: "1px solid var(--sd-border-light)",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--sd-ink)",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <BookOutlined />
        引用来源（{citations.length} 条）
      </div>
      {citations.map((cite, idx) => (
        <div
          key={idx}
          style={{
            padding: "8px 10px",
            marginBottom: 6,
            background: "var(--sd-surface)",
            borderRadius: "var(--sd-radius-sm)",
            border: "1px solid var(--sd-border-light)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--sd-accent)",
                fontFamily: "monospace",
              }}
            >
              {cite.label}
            </span>
            <Tag
              color={cite.kind === "concept" ? "blue" : "green"}
              style={{ margin: 0 }}
            >
              {cite.kind === "concept" ? "概念" : "证据"}
            </Tag>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--sd-ink)" }}>
              {cite.title}
            </span>
          </div>
          {cite.excerpt && (
            <div
              style={{
                fontSize: 12,
                color: "var(--sd-ink-soft)",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {cite.excerpt}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 文档详情弹窗 ───────────────────────────────────────────────────────

function DocumentDetailModal({
  docId,
  onClose,
}: {
  docId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<{
    title: string;
    chunks: { content: string; index: number }[];
    tags: string[];
    source_path: string;
    okf_concepts?: OKFConcept[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!docId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    kbApi
      .getDocument(docId)
      .then((d) => {
        setDetail({
          title: d.title,
          chunks: d.chunks || [],
          tags: d.tags || [],
          source_path: d.source_path,
          okf_concepts: d.okf_concepts || [],
        });
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [docId]);

  return (
    <Modal
      open={docId !== null}
      title={detail?.title || "文档详情"}
      onCancel={onClose}
      width={760}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      <Spin spinning={loading}>
        {detail && (
          <div>
            <div style={{ marginBottom: 12 }}>
              {detail.tags.length > 0 && (
                <Space size={[4, 4]} wrap>
                  {detail.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              )}
            </div>
            <div
              style={{
                marginBottom: 12,
                fontSize: 12,
                color: "var(--sd-muted)",
              }}
            >
              来源: {detail.source_path}
            </div>

            {/* OKF 概念浏览 */}
            {detail.okf_concepts && detail.okf_concepts.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 8,
                    color: "var(--sd-ink)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <ApartmentOutlined />
                  OKF 概念图（{detail.okf_concepts.length} 个）
                </div>
                <OkfConceptPanel concepts={detail.okf_concepts} />
              </div>
            )}

            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {detail.chunks.map((chunk, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "10px 12px",
                    marginBottom: 8,
                    background: "var(--sd-surface-muted)",
                    borderRadius: "var(--sd-radius-sm)",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--sd-ink-soft)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--sd-muted)",
                      marginBottom: 4,
                    }}
                  >
                    分块 #{chunk.index}
                  </div>
                  {chunk.content}
                </div>
              ))}
            </div>
          </div>
        )}
      </Spin>
    </Modal>
  );
}

// ─── 发现建议面板 ───────────────────────────────────────────────────

const SUGGESTION_TYPE_LABELS: Record<string, string> = {
  sop: "SOP 建议",
  tool: "工具建议",
  knowledge_gap: "知识缺口",
};

const SUGGESTION_TYPE_COLORS: Record<string, string> = {
  sop: "blue",
  tool: "orange",
  knowledge_gap: "red",
};

function DiscoveryPanel() {
  const [suggestions, setSuggestions] = useState<DiscoverySuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await kbApi.listDiscoverySuggestions("pending");
      setSuggestions(data.suggestions || []);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "加载发现建议失败",
      );
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const handleAccept = async (suggestion: DiscoverySuggestion) => {
    try {
      await kbApi.acceptSuggestion(suggestion.suggestion_id);
      message.success(`已接受：${suggestion.title}`);
      fetchSuggestions();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "操作失败",
      );
    }
  };

  const handleReject = async (suggestion: DiscoverySuggestion) => {
    try {
      await kbApi.rejectSuggestion(suggestion.suggestion_id);
      message.success(`已拒绝：${suggestion.title}`);
      fetchSuggestions();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "操作失败",
      );
    }
  };

  if (suggestions.length === 0 && !loading) {
    return null;
  }

  return (
    <div className={styles.discoveryPanel}>
      <div className={styles.discoveryHeader}>
        <span className={styles.discoveryTitle}>
          <BulbOutlined />
          知识自发现
        </span>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={fetchSuggestions}
        >
          刷新
        </Button>
      </div>
      <Spin spinning={loading}>
        <div className={styles.discoveryList}>
          {suggestions.map((suggestion) => (
            <div key={suggestion.suggestion_id} className={styles.discoveryItem}>
              <div className={styles.discoveryItemHeader}>
                <Tag
                  color={
                    SUGGESTION_TYPE_COLORS[suggestion.suggestion_type] ||
                    "default"
                  }
                >
                  {SUGGESTION_TYPE_LABELS[suggestion.suggestion_type] ||
                    suggestion.suggestion_type}
                </Tag>
                <span className={styles.discoveryItemTitle}>
                  {suggestion.title}
                </span>
                <span className={styles.discoveryConfidence}>
                  置信度: {(suggestion.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className={styles.discoveryItemDesc}>
                {suggestion.description}
              </div>
              {suggestion.content && (
                <div className={styles.discoveryItemContent}>
                  {suggestion.content}
                </div>
              )}
              <div className={styles.discoveryItemFooter}>
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => handleAccept(suggestion)}
                >
                  接受
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => handleReject(suggestion)}
                >
                  拒绝
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Spin>
    </div>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await kbApi.listDocuments();
      setDocuments(data.documents || []);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "加载文档列表失败",
      );
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      message.warning("请输入搜索内容");
      return;
    }
    setSearching(true);
    setShowSearchResults(true);
    try {
      const result = await kbApi.search({
        query: searchQuery,
        top_k: 5,
      });
      setSearchResult(result);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "检索失败",
      );
      setSearchResult(null);
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = (doc: KnowledgeDocumentSummary) => {
    Modal.confirm({
      title: "删除文档",
      content: `确定要删除「${doc.title}」吗？此操作不可恢复。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await kbApi.deleteDocument(doc.id);
          message.success("已删除");
          fetchDocuments();
        } catch (err) {
          message.error(
            err instanceof Error ? err.message : "删除失败",
          );
        }
      },
    });
  };

  return (
    <div className={styles.kbPage}>
      <PageHeader
        current="知识库"
        subRow={
          <div style={{ color: "var(--sd-muted)", fontSize: 13 }}>
            管理知识库文档，支持文本入库与检索，OKF 概念图与可追溯引用，与 SOP 流程引擎联动。
          </div>
        }
      />

      {/* 搜索栏 */}
      <div className={styles.searchBar}>
        <Input
          className={styles.searchInput}
          size="large"
          prefix={<SearchOutlined style={{ color: "var(--sd-muted)" }} />}
          placeholder="输入关键词搜索知识库..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onPressEnter={handleSearch}
        />
        <Button
          size="large"
          type="primary"
          icon={<SearchOutlined />}
          loading={searching}
          onClick={handleSearch}
        >
          搜索
        </Button>
        <Button
          size="large"
          icon={<InboxOutlined />}
          onClick={() => setIngestOpen(true)}
        >
          入库
        </Button>
        <Button
          size="large"
          icon={<ReloadOutlined />}
          onClick={fetchDocuments}
        >
          刷新
        </Button>
      </div>

      {/* 搜索结果 */}
      {showSearchResults && (
        <div className={styles.searchResults}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 12,
              color: "var(--sd-ink)",
            }}
          >
            检索结果
            {searchResult && (
              <span style={{ color: "var(--sd-muted)", fontWeight: 400, marginLeft: 8 }}>
                （{searchResult.chunks?.length || 0} 条证据，
                {searchResult.concepts?.length || 0} 个概念，
                {searchResult.citations?.length || 0} 条引用）
              </span>
            )}
          </div>
          <Spin spinning={searching}>
            {!searchResult ||
            (searchResult.chunks?.length === 0 &&
              searchResult.concepts?.length === 0) ? (
              <Empty description="未找到相关内容" />
            ) : (
              <>
                {/* 证据结果 */}
                {searchResult.chunks?.map((result, idx) => (
                  <div key={idx} className={styles.resultItem}>
                    <div className={styles.resultHeader}>
                      <span className={styles.resultTitle}>
                        <FileTextOutlined /> {result.document_title}
                      </span>
                      <span className={styles.resultScore}>
                        score: {result.score.toFixed(2)}
                      </span>
                    </div>
                    <div className={styles.resultContent}>
                      {result.chunk_content}
                    </div>
                  </div>
                ))}

                {/* OKF 概念搜索结果 */}
                {searchResult.concepts && searchResult.concepts.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        marginBottom: 8,
                        color: "var(--sd-ink)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <ApartmentOutlined />
                      相关概念
                    </div>
                    {searchResult.concepts.map((c, idx) => (
                      <div key={idx} className={styles.resultItem}>
                        <div className={styles.resultHeader}>
                          <span className={styles.resultTitle}>
                            <Tag
                              color={
                                OKF_TYPE_COLORS[c.concept.concept_type] ||
                                "default"
                              }
                              style={{ margin: 0 }}
                            >
                              {OKF_TYPE_LABELS[c.concept.concept_type] ||
                                c.concept.concept_type}
                            </Tag>
                            {c.concept.title}
                          </span>
                          <span className={styles.resultScore}>
                            score: {c.score.toFixed(2)}
                          </span>
                        </div>
                        <div className={styles.resultContent}>
                          {c.concept.description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 引用追溯 */}
                {searchResult.citations && searchResult.citations.length > 0 && (
                  <CitationPanel citations={searchResult.citations} />
                )}

                {/* v5.0: 检索调试面板 */}
                <SearchDebugPanel trace={searchResult.trace} />
              </>
            )}
          </Spin>
        </div>
      )}

      {/* 文档列表 */}
      <div style={{ marginTop: 20 }}>
        <Spin spinning={loading}>
          {documents.length === 0 ? (
            <div className={styles.emptyState}>
              <Empty description="暂无知识库文档，点击「入库」添加" />
            </div>
          ) : (
            <div className={styles.docGrid}>
              {documents.map((doc) => (
                <div key={doc.id} className={styles.docCard}>
                  <div className={styles.docCardHeader}>
                    <span className={styles.docTitle}>{doc.title}</span>
                    <span
                      className={
                        doc.status === "ready"
                          ? styles.docStatusReady
                          : doc.status === "failed"
                          ? styles.docStatusFailed
                          : styles.docStatusPending
                      }
                    >
                      {doc.status}
                    </span>
                  </div>
                  <div className={styles.docCardBody}>
                    <div className={styles.docMeta}>
                      <span className={styles.docMetaItem}>
                        <FileTextOutlined />
                        {doc.chunk_count} 分块
                      </span>
                    </div>
                    {doc.tags.length > 0 && (
                      <div className={styles.docTags}>
                        {doc.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={styles.docFooter}>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<EyeOutlined />}
                      onClick={() => setDetailDocId(doc.id)}
                    >
                      详情
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDelete(doc)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Spin>
      </div>

      <IngestModal
        open={ingestOpen}
        onClose={() => setIngestOpen(false)}
        onIngested={fetchDocuments}
      />

      <DocumentDetailModal
        docId={detailDocId}
        onClose={() => setDetailDocId(null)}
      />

      {/* 知识自发现面板 */}
      <DiscoveryPanel />
    </div>
  );
}
