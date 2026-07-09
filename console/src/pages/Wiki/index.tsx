import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SearchOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  EditOutlined,
  SaveOutlined,
  FileTextOutlined,
  FolderOutlined,
  QuestionCircleOutlined,
  BugOutlined,
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
import styles from "./index.module.less";

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

export default function WikiPage() {
  const { t } = useTranslation("wiki");
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-ignore - kept for potential future use
  const treeData = useMemo(() => {
    const root: { title: string; key: string; icon: React.ReactNode; children?: typeof root }[] = [];
    const typeGroups: Record<string, typeof root> = {};
    for (const page of pages) {
      const group = page.page_type || "other";
      if (!typeGroups[group]) {
        typeGroups[group] = [];
      }
      typeGroups[group].push({
        title: page.name,
        key: page.path,
        icon: <FileTextOutlined />,
      });
    }
    const typeOrder = ["concept", "case", "comparison", "comprehensive", "other"];
    for (const type of typeOrder) {
      const children = typeGroups[type];
      if (!children || children.length === 0) continue;
      root.push({
        title: pageTypeLabel(type),
        key: `__type__${type}`,
        icon: <FolderOutlined />,
        children,
      });
    }
    return root;
  }, [pages]);

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
      console.error("Failed to fetch wiki pages:", err);
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
          t("ingestSuccess", "编译完成，新增 {{count}} 个页面", {
            count: result.ingested.length,
          }),
        );
      } else if (result.skipped.length > 0) {
        message.info(t("ingestSkipped", "所有页面均已是最新"));
      }
      fetchPages();
    } catch (err) {
      message.error(t("ingestFailed", "编译失败"));
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
        message.success(t("lintClean", "所有页面检查通过"));
      } else if (fix && result.fixed.length > 0) {
        message.success(
          t("lintFixed", "已修复 {{count}} 个问题", {
            count: result.fixed.length,
          }),
        );
      }
      fetchPages();
    } catch (err) {
      message.error(t("lintFailed", "检查失败"));
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
          t("futureSuccess", "生成 {{count}} 个预测问答", {
            count: result.total_qa,
          }),
        );
      } else {
        message.info(t("futureEmpty", "未生成任何预测问答"));
      }
    } catch (err) {
      message.error(t("futureFailed", "预测问答生成失败"));
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
      setCurrentContent(t("loadFailed", "加载页面内容失败"));
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
    message.success(t("saveSuccess", "内容已保存（本地暂存）"));
  };

  return (
    <div className={styles.wikiPage}>
      <PageHeader
        current="AI裁判智库"
        subRow={<div style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>AI自动整理的法律知识卡片，支持智能检索与问答</div>}
        extra={
          <Space wrap>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={() => handleIngest(false)}
              loading={ingesting}
            >
              AI智能整理
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => handleIngest(true)}
              loading={ingesting}
            >
              全部重新整理
            </Button>
            <Button
              icon={<QuestionCircleOutlined />}
              onClick={handleFuture}
              loading={futuring}
            >
              预测问答
            </Button>
            <Button
              icon={<BugOutlined />}
              onClick={() => handleLint(false)}
              loading={linting}
            >
              质量检查
            </Button>
          </Space>
        }
      />

      <div style={{ padding: "0 24px" }}>
        {/* 统计概览 */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
          <Card size="small" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#1890ff" }}>{pages.length}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>知识卡片总数</div>
          </Card>
          <Card size="small" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#52c41a" }}>{pages.filter(p => p.page_type === "case").length}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>案例页</div>
          </Card>
          <Card size="small" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#722ed1" }}>{pages.filter(p => p.page_type === "concept").length}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>概念页</div>
          </Card>
          <Card size="small" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#fa8c16" }}>{pages.filter(p => p.page_type === "comprehensive").length}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>综合页</div>
          </Card>
        </div>

        {/* 筛选栏 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <Input prefix={<SearchOutlined />} placeholder="搜索知识卡片..."
            value={keyword} onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 260 }} allowClear />
          <Select style={{ width: 130 }} placeholder="页面类型" allowClear
            value={pageType} onChange={setPageType}
            options={[
              { label: "全部", value: "" },
              { label: "概念页", value: "concept" },
              { label: "案例页", value: "case" },
              { label: "对比页", value: "comparison" },
              { label: "综合页", value: "comprehensive" },
            ]} />
          <Select style={{ width: 130 }} placeholder="来源" allowClear
            value={sourceFilter} onChange={setSourceFilter}
            options={[
              { label: "全部", value: "" },
              { label: "知识库", value: "knowledge" },
              { label: "案件卷宗", value: "cases" },
            ]} />
          {keyword && (
            <Tag closable onClose={() => setKeyword("")}>搜索：{keyword.slice(0, 20)}</Tag>
          )}
        </div>

        {/* 知识卡片网格 */}
        {pages.length === 0 && !loading ? (
          <Empty description="暂无知识卡片，点击「AI智能整理」从资料中自动生成" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
            {pages.map(page => (
              <Card key={page.path} size="small" hoverable
                onClick={() => handleReadPage(page.path)}
                style={{ cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ fontSize: 24, flexShrink: 0 }}>
                    {page.page_type === "concept" ? "\uD83D\uDCCB" : page.page_type === "case" ? "\u2696\uFE0F" : page.page_type === "comparison" ? "\uD83D\uDD04" : "\uD83D\uDCCA"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                      {page.name}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                      <Tag color={pageTypeColor(page.page_type)} style={{ fontSize: 11 }}>
                        {page.page_type === "concept" ? "概念" : page.page_type === "case" ? "案例" : page.page_type === "comparison" ? "对比" : "综合"}
                      </Tag>
                      {page.source_doc_ids?.length > 0 && <Tag style={{ fontSize: 11 }}>来自知识库</Tag>}
                      {page.source_case_ids?.length > 0 && <Tag style={{ fontSize: 11 }}>来自卷宗</Tag>}
                    </div>
                    <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                      更新于 {page.updated_at ? new Date(page.updated_at).toLocaleString("zh-CN") : "未知"}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Drawer
        title={
          <Space>
            <span>{currentPath || t("pageContent", "页面内容")}</span>
            {editing ? (
              <Tag color="orange">{t("editing", "编辑中")}</Tag>
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
                  {t("cancel", "取消")}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSaveEdit}
                >
                  {t("save", "保存")}
                </Button>
              </>
            ) : (
              <Tooltip title="打开AI辅助编辑模式">
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={handleStartEdit}
                >
                  AI辅助编辑
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
          <textarea
            className={styles.editArea}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
          />
        ) : (
          <div className={styles.markdownBody}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {currentContent}
            </ReactMarkdown>
          </div>
        )}
      </Drawer>

      <Modal
        title={t("ingestResultTitle", "AI整理结果")}
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
                "ingestSummary",
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
                <strong>{t("ingestedPages", "新增页面：")}</strong>
                {ingestResult.ingested.map((id) => (
                  <div key={id} className={styles.resultItem}>
                    ✓ {id}
                  </div>
                ))}
              </div>
            )}
            {ingestResult.skipped.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>{t("skippedPages", "跳过页面：")}</strong>
                {ingestResult.skipped.slice(0, 10).map((id) => (
                  <div key={id} className={styles.resultItem}>
                    - {id}
                  </div>
                ))}
                {ingestResult.skipped.length > 10 && (
                  <div className={styles.resultItem}>
                    ...{t("moreItems", "还有 {{count}} 项", { count: ingestResult.skipped.length - 10 })}
                  </div>
                )}
              </div>
            )}
            {ingestResult.errors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>{t("errorPages", "失败页面：")}</strong>
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

      <Modal
        title={t("lintResultTitle", "质量检查结果")}
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
                  ? t(
                      "lintIssuesFound",
                      "发现 {{count}} 个问题",
                      { count: lintResult.issues.length },
                    )
                  : t("lintNoIssues", "所有页面检查通过")
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
                <strong>{t("fixedItems", "已修复：")}</strong>
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

      <Modal
        title={t("futureResultTitle", "AI预测问答")}
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
                  ? t(
                      "futureSummary",
                      "共生成 {{count}} 个预测问答",
                      { count: futureResult.total_qa },
                    )
                  : t("futureEmpty", "未生成任何预测问答")
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