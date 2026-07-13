import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  SearchOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  EditOutlined,
  SaveOutlined,
  QuestionCircleOutlined,
  BugOutlined,
  BookOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Button,
  Input,
  Select,
  Tag,
  Space,
  Drawer,
  Empty,
  message,
  Modal,
  Alert,
  Collapse,
  Spin,
  Card,
  Tooltip,
  Form,
} from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/PageHeader";
import { wikiApi } from "@/api/modules/wiki";
import type {
  WikiPage,
  IngestResult,
  LintResult,
  FutureResult,
} from "@/api/modules/wiki";
import styles from "./knowledge.module.less";

const { TextArea } = Input;

function pageTypeColor(type: string): string {
  const map: Record<string, string> = {
    concept: "blue",
    case: "green",
    comparison: "orange",
    comprehensive: "purple",
  };
  return map[type] || "default";
}

function pageTypeLabel(type: string): string {
  const map: Record<string, string> = {
    concept: "概念页",
    case: "案例页",
    comparison: "对比页",
    comprehensive: "综合页",
  };
  return map[type] || type;
}

function pageTypeIcon(type: string): string {
  const map: Record<string, string> = {
    concept: "📋",
    case: "⚖️",
    comparison: "🔄",
    comprehensive: "📊",
  };
  return map[type] || "📄";
}

export default function KnowledgePage() {
  const { t } = useTranslation();
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [pageType, setPageType] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentContent, setCurrentContent] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [linting, setLinting] = useState(false);
  const [futuring, setFuturing] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [ingestModalOpen, setIngestModalOpen] = useState(false);
  const [lintResult, setLintResult] = useState<LintResult | null>(null);
  const [lintModalOpen, setLintModalOpen] = useState(false);
  const [futureResult, setFutureResult] = useState<FutureResult | null>(null);
  const [futureModalOpen, setFutureModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wikiApi.listPages({
        keyword: keyword || undefined,
        page_type: pageType || undefined,
      });
      let filtered = res.pages;
      if (sourceFilter === "knowledge") {
        filtered = filtered.filter((p) => p.source_doc_ids.length > 0);
      } else if (sourceFilter === "case") {
        filtered = filtered.filter((p) => p.source_case_ids.length > 0);
      }
      setPages(filtered);
    } catch (err) {
      console.error("Failed to fetch knowledge pages:", err);
    } finally {
      setLoading(false);
    }
  }, [keyword, pageType, sourceFilter]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const handleIngest = async (force: boolean = false) => {
    setIngesting(true);
    try {
      const result = await wikiApi.ingest({
        page_type: pageType || undefined,
        force,
      });
      setIngestResult(result);
      setIngestModalOpen(true);
      if (result.ingested.length > 0) {
        message.success(
          t("knowledge.ingestSuccess", "编译完成，新增 {{count}} 个页面", {
            count: result.ingested.length,
          }),
        );
      } else if (result.skipped.length > 0) {
        message.info(t("knowledge.ingestSkipped", "所有页面均已是最新"));
      }
      fetchPages();
    } catch (err) {
      message.error(t("knowledge.ingestFailed", "编译失败"));
      console.error("Ingest error:", err);
    } finally {
      setIngesting(false);
    }
  };

  const handleLint = async (fix: boolean = false) => {
    setLinting(true);
    try {
      const result = await wikiApi.lint(fix);
      setLintResult(result);
      setLintModalOpen(true);
      if (result.issues.length === 0) {
        message.success(t("knowledge.lintClean", "所有页面检查通过"));
      } else if (fix && result.fixed.length > 0) {
        message.success(
          t("knowledge.lintFixed", "已修复 {{count}} 个问题", {
            count: result.fixed.length,
          }),
        );
      }
      fetchPages();
    } catch (err) {
      message.error(t("knowledge.lintFailed", "检查失败"));
      console.error("Lint error:", err);
    } finally {
      setLinting(false);
    }
  };

  const handleFuture = async () => {
    setFuturing(true);
    try {
      const result = await wikiApi.future();
      setFutureResult(result);
      setFutureModalOpen(true);
      if (result.total_qa > 0) {
        message.success(
          t("knowledge.futureSuccess", "生成 {{count}} 个预测问答", {
            count: result.total_qa,
          }),
        );
      } else {
        message.info(t("knowledge.futureEmpty", "未生成任何预测问答"));
      }
    } catch (err) {
      message.error(t("knowledge.futureFailed", "预测问答生成失败"));
      console.error("Future error:", err);
    } finally {
      setFuturing(false);
    }
  };

  const handleReadPage = async (path: string) => {
    setCurrentPath(path);
    setDrawerOpen(true);
    setContentLoading(true);
    setEditing(false);
    setEditContent("");
    try {
      const res = await wikiApi.readPage(path);
      setCurrentContent(res.content);
    } catch (err) {
      setCurrentContent(t("knowledge.loadFailed", "加载页面内容失败"));
      console.error("Read page error:", err);
    } finally {
      setContentLoading(false);
    }
  };

  const handleStartEdit = () => {
    setEditContent(currentContent);
    setEditing(true);
  };

  const handleSaveEdit = () => {
    setCurrentContent(editContent);
    setEditing(false);
    message.success(t("knowledge.saveSuccess", "内容已保存（本地暂存）"));
  };

  const handleAddKnowledge = async () => {
    try {
      const values = await addForm.validateFields();
      // Create a new wiki page via API
      const pagePath = `knowledge/${values.name.replace(/\s+/g, "-").toLowerCase()}.md`;
      await wikiApi.writePage(pagePath, values.content || "");
      message.success(t("knowledge.addSuccess", "知识页面创建成功"));
      setAddModalOpen(false);
      addForm.resetFields();
      fetchPages();
    } catch (err) {
      // validation or API error
    }
  };

  return (
    <div className={styles.knowledgePage}>
      <PageHeader
        current={t("nav.knowledge", "知识库")}
        subRow={
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
            {t("knowledge.subtitle", "跨案件参考知识 · 法律法规 · 先例案例 · AI智能整理")}
          </span>
        }
        extra={
          <Space wrap>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddModalOpen(true)}
            >
              {t("knowledge.addPage", "添加知识")}
            </Button>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={() => handleIngest(false)}
              loading={ingesting}
            >
              {t("knowledge.aiOrganize", "AI智能整理")}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => handleIngest(true)}
              loading={ingesting}
            >
              {t("knowledge.rebuildAll", "全部重新整理")}
            </Button>
            <Button
              icon={<QuestionCircleOutlined />}
              onClick={handleFuture}
              loading={futuring}
            >
              {t("knowledge.predictQA", "预测问答")}
            </Button>
            <Button
              icon={<BugOutlined />}
              onClick={() => handleLint(false)}
              loading={linting}
            >
              {t("knowledge.qualityCheck", "质量检查")}
            </Button>
          </Space>
        }
      />

      <div style={{ padding: "0 24px", flex: 1, overflow: "auto" }}>
        {/* 统计概览 */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
          <Card size="small" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#1890ff" }}>{pages.length}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>{t("knowledge.totalPages", "知识页面总数")}</div>
          </Card>
          <Card size="small" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#52c41a" }}>{pages.filter(p => p.page_type === "case").length}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>{t("knowledge.casePages", "案例页")}</div>
          </Card>
          <Card size="small" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#722ed1" }}>{pages.filter(p => p.page_type === "concept").length}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>{t("knowledge.conceptPages", "概念页")}</div>
          </Card>
          <Card size="small" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#fa8c16" }}>{pages.filter(p => p.page_type === "comprehensive").length}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>{t("knowledge.comprehensivePages", "综合页")}</div>
          </Card>
        </div>

        {/* 筛选栏 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder={t("knowledge.searchPlaceholder", "搜索知识...")}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Select
            style={{ width: 130 }}
            placeholder={t("knowledge.pageType", "页面类型")}
            allowClear
            value={pageType}
            onChange={setPageType}
            options={[
              { label: t("knowledge.allTypes", "全部"), value: "" },
              { label: t("knowledge.conceptPage", "概念页"), value: "concept" },
              { label: t("knowledge.casePage", "案例页"), value: "case" },
              { label: t("knowledge.comparisonPage", "对比页"), value: "comparison" },
              { label: t("knowledge.comprehensivePage", "综合页"), value: "comprehensive" },
            ]}
          />
          <Select
            style={{ width: 130 }}
            placeholder={t("knowledge.source", "来源")}
            allowClear
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { label: t("knowledge.allSources", "全部"), value: "" },
              { label: t("knowledge.fromDocs", "来自文档"), value: "knowledge" },
              { label: t("knowledge.fromCases", "来自案件"), value: "case" },
            ]}
          />
          {keyword && (
            <Tag closable onClose={() => setKeyword("")}>
              {t("knowledge.searching", "搜索")}：{keyword.slice(0, 20)}
            </Tag>
          )}
        </div>

        {/* 知识卡片网格 */}
        {pages.length === 0 && !loading ? (
          <Empty
            description={t("knowledge.emptyHint", "暂无知识页面，点击「AI智能整理」从文档中自动生成，或点击「添加知识」手动创建")}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
            {pages.map(page => (
              <Card
                key={page.path}
                size="small"
                hoverable
                onClick={() => handleReadPage(page.path)}
                style={{ cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ fontSize: 24, flexShrink: 0 }}>
                    {pageTypeIcon(page.page_type)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                      {page.name}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                      <Tag color={pageTypeColor(page.page_type)} style={{ fontSize: 11 }}>
                        {pageTypeLabel(page.page_type)}
                      </Tag>
                      {page.source_doc_ids?.length > 0 && (
                        <Tag style={{ fontSize: 11 }}>{t("knowledge.fromDocs", "来自文档")}</Tag>
                      )}
                      {page.source_case_ids?.length > 0 && (
                        <Tag style={{ fontSize: 11 }}>{t("knowledge.fromCases", "来自案件")}</Tag>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                      {t("knowledge.updatedAt", "更新于")} {page.updated_at ? new Date(page.updated_at).toLocaleString("zh-CN") : t("knowledge.unknown", "未知")}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 知识页面内容 Drawer */}
      <Drawer
        title={
          <Space>
            <BookOutlined />
            <span>{currentPath || t("knowledge.pageContent", "页面内容")}</span>
            {editing ? (
              <Tag color="orange">{t("knowledge.editing", "编辑中")}</Tag>
            ) : null}
          </Space>
        }
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setCurrentContent("");
          setCurrentPath("");
          setEditing(false);
          setEditContent("");
        }}
        width={780}
        className={styles.contentDrawer}
        extra={
          <Space>
            {editing ? (
              <>
                <Button size="small" onClick={() => setEditing(false)}>
                  {t("common.cancel", "取消")}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSaveEdit}
                >
                  {t("common.save", "保存")}
                </Button>
              </>
            ) : (
              <Tooltip title={t("knowledge.aiEditTip", "打开AI辅助编辑模式")}>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={handleStartEdit}
                >
                  {t("knowledge.aiEdit", "AI辅助编辑")}
                </Button>
              </Tooltip>
            )}
          </Space>
        }
      >
        {contentLoading ? (
          <div className={styles.drawerLoading}>
            <Spin />
          </div>
        ) : editing ? (
          <TextArea
            className={styles.editArea}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            autoSize={{ minRows: 20 }}
          />
        ) : (
          <div className={styles.markdownBody}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {currentContent}
            </ReactMarkdown>
          </div>
        )}
      </Drawer>

      {/* 添加知识 Modal */}
      <Modal
        title={t("knowledge.addTitle", "添加知识页面")}
        open={addModalOpen}
        onCancel={() => {
          setAddModalOpen(false);
          addForm.resetFields();
        }}
        onOk={handleAddKnowledge}
        width={640}
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("knowledge.pageName", "页面名称")}
            rules={[{ required: true, message: t("knowledge.nameRequired", "请输入页面名称") }]}
          >
            <Input placeholder={t("knowledge.namePlaceholder", "如：违约金计算标准")} />
          </Form.Item>
          <Form.Item name="content" label={t("knowledge.pageContent", "页面内容")}>
            <TextArea
              rows={10}
              placeholder={t("knowledge.contentPlaceholder", "输入知识内容，支持 Markdown 格式...")}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* AI整理结果 Modal */}
      <Modal
        title={t("knowledge.ingestResultTitle", "AI整理结果")}
        open={ingestModalOpen}
        onCancel={() => {
          setIngestModalOpen(false);
          setIngestResult(null);
        }}
        footer={null}
        width={560}
      >
        {ingestResult && (
          <div className={styles.ingestResult}>
            <Alert
              type="info"
              showIcon
              message={t(
                "knowledge.ingestSummary",
                "共 {{total}} 个页面，新增 {{ingested}} 个，跳过 {{skipped}} 个，失败 {{errors}} 个",
                {
                  total: ingestResult.total_pages,
                  ingested: ingestResult.ingested.length,
                  skipped: ingestResult.skipped.length,
                  errors: ingestResult.errors.length,
                },
              )}
            />
            {ingestResult.ingested.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>{t("knowledge.ingestedPages", "新增页面：")}</strong>
                {ingestResult.ingested.map((id) => (
                  <div key={id} className={styles.resultItem}>
                    ✓ {id}
                  </div>
                ))}
              </div>
            )}
            {ingestResult.skipped.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>{t("knowledge.skippedPages", "跳过页面：")}</strong>
                {ingestResult.skipped.slice(0, 10).map((id) => (
                  <div key={id} className={styles.resultItem}>
                    - {id}
                  </div>
                ))}
                {ingestResult.skipped.length > 10 && (
                  <div className={styles.resultItem}>
                    ...{t("knowledge.moreItems", "还有 {{count}} 项", { count: ingestResult.skipped.length - 10 })}
                  </div>
                )}
              </div>
            )}
            {ingestResult.errors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>{t("knowledge.errorPages", "失败页面：")}</strong>
                {ingestResult.errors.map((id) => (
                  <div key={id} className={styles.resultItem} style={{ color: "var(--ant-color-error)" }}>
                    ✗ {id}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 质量检查结果 Modal */}
      <Modal
        title={t("knowledge.lintResultTitle", "质量检查结果")}
        open={lintModalOpen}
        onCancel={() => {
          setLintModalOpen(false);
          setLintResult(null);
        }}
        footer={null}
        width={560}
      >
        {lintResult && (
          <div>
            <Alert
              type={lintResult.issues.length > 0 ? "warning" : "success"}
              showIcon
              message={
                lintResult.issues.length > 0
                  ? t("knowledge.lintIssuesFound", "发现 {{count}} 个问题", { count: lintResult.issues.length })
                  : t("knowledge.lintNoIssues", "所有页面检查通过")
              }
            />
            {lintResult.issues.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {lintResult.issues.map((issue, idx) => (
                  <div key={idx} className={styles.resultItem}>
                    <Tag color="warning">{issue.path}</Tag> {issue.issue}
                  </div>
                ))}
              </div>
            )}
            {lintResult.fixed.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>{t("knowledge.fixedItems", "已修复：")}</strong>
                {lintResult.fixed.map((path) => (
                  <div key={path} className={styles.resultItem} style={{ color: "var(--ant-color-success)" }}>
                    ✓ {path}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* AI预测问答 Modal */}
      <Modal
        title={t("knowledge.futureResultTitle", "AI预测问答")}
        open={futureModalOpen}
        onCancel={() => {
          setFutureModalOpen(false);
          setFutureResult(null);
        }}
        footer={null}
        width={720}
      >
        {futureResult && (
          <div>
            <Alert
              type={futureResult.total_qa > 0 ? "success" : "info"}
              showIcon
              message={
                futureResult.total_qa > 0
                  ? t("knowledge.futureSummary", "共生成 {{count}} 个预测问答", { count: futureResult.total_qa })
                  : t("knowledge.futureEmpty", "未生成任何预测问答")
              }
            />
            {futureResult.errors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {futureResult.errors.map((err, idx) => (
                  <div key={idx} className={styles.resultItem} style={{ color: "var(--ant-color-error)" }}>
                    ✗ {err}
                  </div>
                ))}
              </div>
            )}
            {futureResult.results.length > 0 && (
              <Collapse
                style={{ marginTop: 12 }}
                items={futureResult.results.map((r, idx) => ({
                  key: idx,
                  label: `${r.page_path} (${r.qa_count} QA)`,
                  children: (
                    <div>
                      {r.qa.map((item, qi) => (
                        <div key={qi} style={{ marginBottom: 12, padding: "8px 12px", background: "var(--ant-color-bg-layout)", borderRadius: 6 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>
                            Q: {item.question}
                          </div>
                          <div style={{ color: "var(--ant-color-text-secondary)" }}>
                            A: {item.answer}
                          </div>
                          {item.tags.length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              {item.tags.map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}