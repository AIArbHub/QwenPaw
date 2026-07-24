/**
 * AwardReview — 裁决核阅工作台（三栏布局）
 * 左栏：核阅清单（按 category 折叠 + 进度 + 上/下一项导航）
 * 中栏：对照区（当前项详情 + 状态按钮 + 批注 + 文档对照）
 * 右栏：知识库侧栏（法条/规则搜索 + 关联案例 + 临时备注）
 * 点击知识条目通过 kbApi.getFile(path) 在 Drawer 中展开原文。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Button, Input, Select, Tag, Tabs, Spin, Empty, Tooltip, Modal, Form,
  message as antMessage, Space, Card, Badge, Collapse, Divider, Progress,
  Popconfirm, Drawer, Statistic, Row, Col,
} from "antd";
import {
  CheckCircleOutlined, WarningOutlined, CloseCircleOutlined, PlusOutlined,
  ExportOutlined, ArrowLeftOutlined, ArrowRightOutlined, EditOutlined,
  SearchOutlined, FileTextOutlined, BookOutlined, ReloadOutlined,
  DeleteOutlined, LinkOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/PageHeader";
import {
  reviewApi,
  type ReviewItem, type ReviewItemStatus, type ReviewSession,
  type ReviewListItem, type ReviewTemplate, type ReviewKnowledge,
  type ReviewDocument,
} from "@/api/modules/review";
import { kbApi, type KBFileContent } from "@/api/modules/kb";
import styles from "./index.module.less";

const { TextArea } = Input;

const STATUS_ICON: Record<ReviewItemStatus, string> = {
  pass: "✅", need_fix: "⚠️", fail: "❌", pending: "⬜",
};
const STATUS_TAG_COLOR: Record<ReviewItemStatus, string> = {
  pass: "green", need_fix: "orange", fail: "red", pending: "default",
};
const STATUS_LABEL: Record<ReviewItemStatus, string> = {
  pass: "通过", need_fix: "需修改", fail: "不通过", pending: "待核验",
};
const REVIEW_STATUS_COLOR: Record<string, string> = {
  in_progress: "processing", completed: "success", archived: "default",
};
const REVIEW_STATUS_LABEL: Record<string, string> = {
  in_progress: "进行中", completed: "已完成", archived: "已归档",
};

/** 状态按钮的强调样式（仅在当前状态匹配时应用） */
function statusBtnStyle(status: ReviewItemStatus): React.CSSProperties | undefined {
  if (status === "pass") return {
    borderColor: "var(--ant-color-success)",
    color: "var(--ant-color-success)",
    background: "var(--ant-color-success-bg)",
  };
  if (status === "need_fix") return {
    borderColor: "var(--ant-color-warning)",
    color: "var(--ant-color-warning)",
    background: "var(--ant-color-warning-bg)",
  };
  return undefined;
}

export default function AwardReview() {
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [currentReview, setCurrentReview] = useState<ReviewSession | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportData, setExportData] = useState<{ markdown: string; filename: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [knowledge, setKnowledge] = useState<ReviewKnowledge | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const knowledgeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [kbDrawerOpen, setKbDrawerOpen] = useState(false);
  const [kbDrawerPath, setKbDrawerPath] = useState<string | null>(null);
  const [kbFileContent, setKbFileContent] = useState<KBFileContent | null>(null);
  const [kbFileLoading, setKbFileLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [activeDocTab, setActiveDocTab] = useState("0");

  const loadReviews = useCallback(async () => {
    setListLoading(true);
    try {
      setReviews((await reviewApi.list()).reviews || []);
    } catch { antMessage.error("加载核阅列表失败"); } finally { setListLoading(false); }
  }, []);

  const loadTemplates = useCallback(async () => {
    try { setTemplates((await reviewApi.listTemplates()).templates || []); }
    catch { /* 模板加载失败不阻塞主流程 */ }
  }, []);

  useEffect(() => {
    void loadReviews();
    void loadTemplates();
  }, [loadReviews, loadTemplates]);

  const loadReview = useCallback(async (id: string) => {
    setReviewLoading(true);
    try {
      const data = await reviewApi.get(id);
      setCurrentReview(data.review);
      setSelectedItemId(data.review.items?.[0]?.id ?? null);
      setActiveDocTab("0");
    } catch { antMessage.error("加载核阅详情失败"); } finally { setReviewLoading(false); }
  }, []);

  const loadKnowledge = useCallback(async (reviewId: string, q = "") => {
    setKnowledgeLoading(true);
    try { setKnowledge(await reviewApi.getKnowledge(reviewId, q)); }
    catch { /* 静默处理 */ } finally { setKnowledgeLoading(false); }
  }, []);

  useEffect(() => {
    if (!currentReview) { setKnowledge(null); setNotes(""); return; }
    void loadKnowledge(currentReview.id, "");
    try { setNotes(localStorage.getItem(`review-notes-${currentReview.id}`) || ""); }
    catch { setNotes(""); }
  }, [currentReview, loadKnowledge]);

  useEffect(() => {
    if (!currentReview) return;
    if (knowledgeDebounceRef.current) clearTimeout(knowledgeDebounceRef.current);
    knowledgeDebounceRef.current = setTimeout(() => {
      void loadKnowledge(currentReview.id, knowledgeQuery);
    }, 400);
    return () => {
      if (knowledgeDebounceRef.current) clearTimeout(knowledgeDebounceRef.current);
    };
  }, [knowledgeQuery, currentReview, loadKnowledge]);

  useEffect(() => {
    if (currentReview && selectedItemId) {
      const item = currentReview.items.find((i) => i.id === selectedItemId);
      setAnnotationDraft(item?.annotation || "");
    } else { setAnnotationDraft(""); }
  }, [selectedItemId, currentReview]);

  useEffect(() => {
    if (!currentReview) return;
    try { localStorage.setItem(`review-notes-${currentReview.id}`, notes); }
    catch { /* 忽略隐私模式或配额错误 */ }
  }, [notes, currentReview]);

  const groupedItems = useMemo(() => {
    if (!currentReview) return [];
    const map = new Map<string, { categoryId: string; categoryName: string; items: ReviewItem[] }>();
    for (const item of currentReview.items) {
      if (!map.has(item.category_id)) {
        map.set(item.category_id, {
          categoryId: item.category_id,
          categoryName: item.category_name,
          items: [],
        });
      }
      map.get(item.category_id)!.items.push(item);
    }
    return Array.from(map.values());
  }, [currentReview]);

  const flatItems = useMemo(() => groupedItems.flatMap((g) => g.items), [groupedItems]);
  const currentItem = useMemo(() => {
    if (!currentReview || !selectedItemId) return null;
    return currentReview.items.find((i) => i.id === selectedItemId) || null;
  }, [currentReview, selectedItemId]);
  const currentIndex = useMemo(() => {
    if (!currentItem) return -1;
    return flatItems.findIndex((i) => i.id === currentItem.id);
  }, [flatItems, currentItem]);
  const defaultActiveKeys = useMemo(
    () => groupedItems.map((g) => g.categoryId),
    [groupedItems],
  );

  const summary = currentReview?.summary;
  const passedCount = summary?.passed ?? 0;
  const totalCount = summary?.total ?? 0;
  const failedCount = summary?.failed ?? 0;
  const pendingCount = summary?.pending ?? 0;
  const progressPercent = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
  const progressStatus =
    failedCount > 0 ? "exception" : progressPercent === 100 ? "success" : "active";

  const handleOpenCreate = () => {
    createForm.resetFields();
    createForm.setFieldsValue({ template_id: templates[0]?.id, documents: [] });
    setCreateModalOpen(true);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      const documents: ReviewDocument[] = (values.documents || []).map(
        (d: { name?: string; path?: string }, idx: number) => ({
          name: d.name || `文档 ${idx + 1}`,
          path: d.path || "",
          type: idx === 0 ? "裁决书" : "申请书",
        }),
      );
      const data = await reviewApi.create({
        case_name: values.case_name,
        case_id: values.case_id || undefined,
        template_id: values.template_id || undefined,
        documents,
      });
      antMessage.success("核阅创建成功");
      setCreateModalOpen(false);
      await loadReviews();
      setCurrentReview(data.review);
      setSelectedItemId(data.review.items[0]?.id ?? null);
      setActiveDocTab("0");
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      antMessage.error("创建失败");
    } finally { setCreating(false); }
  };

  const handleSelectReview = (id: string) => void loadReview(id);
  const handleBackToList = () => {
    setCurrentReview(null);
    setSelectedItemId(null);
    void loadReviews();
  };

  const handleDeleteReview = async (id: string) => {
    try {
      await reviewApi.delete(id);
      antMessage.success("已删除");
      void loadReviews();
    } catch { antMessage.error("删除失败"); }
  };

  const handleUpdateStatus = async (status: ReviewItemStatus) => {
    if (!currentReview || !currentItem) return;
    setUpdatingStatus(true);
    try {
      const data = await reviewApi.updateItem(currentReview.id, {
        item_id: currentItem.id,
        status,
        annotation: annotationDraft || undefined,
      });
      setCurrentReview(data.review);
      antMessage.success("状态已更新");
    } catch { antMessage.error("更新失败"); } finally { setUpdatingStatus(false); }
  };

  const handleSaveAnnotation = async () => {
    if (!currentReview || !currentItem) return;
    if (!annotationDraft.trim()) { antMessage.warning("请输入批注内容"); return; }
    setSavingAnnotation(true);
    try {
      await reviewApi.addAnnotation(currentReview.id, {
        item_id: currentItem.id,
        annotation: annotationDraft,
      });
      const data = await reviewApi.get(currentReview.id);
      setCurrentReview(data.review);
      antMessage.success("批注已保存");
    } catch { antMessage.error("保存批注失败"); } finally { setSavingAnnotation(false); }
  };

  const handlePrevItem = () => {
    if (currentIndex > 0) setSelectedItemId(flatItems[currentIndex - 1].id);
  };
  const handleNextItem = () => {
    if (currentIndex >= 0 && currentIndex < flatItems.length - 1) {
      setSelectedItemId(flatItems[currentIndex + 1].id);
    }
  };

  const handleExport = async () => {
    if (!currentReview) return;
    setExporting(true);
    try {
      const data = await reviewApi.export(currentReview.id);
      setExportData({ markdown: data.markdown, filename: data.filename });
      setExportModalOpen(true);
    } catch { antMessage.error("导出失败"); } finally { setExporting(false); }
  };

  const handleDownloadMarkdown = () => {
    if (!exportData) return;
    const blob = new Blob([exportData.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportData.filename || "裁决核阅报告.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    antMessage.success("下载已开始");
  };

  const handleOpenKbEntry = async (path: string) => {
    if (!path) return;
    setKbDrawerOpen(true);
    setKbDrawerPath(path);
    setKbFileContent(null);
    setKbFileLoading(true);
    try { setKbFileContent((await kbApi.getFile(path)).file); }
    catch { antMessage.error("加载知识条目失败"); } finally { setKbFileLoading(false); }
  };

  const headerExtra = (
    <Space>
      <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新建核阅</Button>
      {currentReview && (
        <Button icon={<ExportOutlined />} onClick={handleExport} loading={exporting}>
          导出报告
        </Button>
      )}
    </Space>
  );

  const renderListView = () => (
    <div className={styles.listView}>
      <div className={styles.listHeader}>
        <div className={styles.listTitle}>
          <FileTextOutlined /> 核阅记录
          <Badge count={reviews.length} style={{ backgroundColor: "var(--ant-color-primary)" }} />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadReviews()} loading={listLoading}>
          刷新
        </Button>
      </div>
      {listLoading ? (
        <Spin style={{ display: "block", margin: "15vh auto" }} />
      ) : reviews.length === 0 ? (
        <Empty style={{ marginTop: "15vh" }} description="暂无核阅记录，点击「新建核阅」开始">
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新建核阅</Button>
        </Empty>
      ) : (
        <div className={styles.listGrid}>
          {reviews.map((r) => {
            const total = r.summary?.total ?? 0;
            const passed = r.summary?.passed ?? 0;
            const failed = r.summary?.failed ?? 0;
            const pending = r.summary?.pending ?? 0;
            const needFix = total - passed - failed - pending;
            const percent = total > 0 ? Math.round((passed / total) * 100) : 0;
            return (
              <Card
                key={r.id} className={styles.reviewCard} size="small"
                styles={{ body: { padding: 16 } }}
                onClick={() => handleSelectReview(r.id)} hoverable
              >
                <div className={styles.reviewCardHeader}>
                  <span className={styles.reviewCardName}>{r.case_name}</span>
                  <Tag color={REVIEW_STATUS_COLOR[r.status] || "default"}>
                    {REVIEW_STATUS_LABEL[r.status] || r.status}
                  </Tag>
                </div>
                {r.case_id && (
                  <div className={styles.reviewCardMeta}><span>案件编号：{r.case_id}</span></div>
                )}
                <div className={styles.reviewCardMeta}>
                  <span>创建于 {formatTime(r.created_at)}</span>
                  <span>更新于 {formatTime(r.updated_at)}</span>
                </div>
                <div className={styles.reviewCardProgress}>
                  <Progress
                    percent={percent} size="small"
                    status={failed > 0 ? "exception" : percent === 100 ? "success" : "active"}
                    format={() => `${passed}/${total}`}
                  />
                </div>
                <div className={styles.reviewCardFooter}>
                  <div className={styles.reviewCardStats}>
                    <span>✅ {passed}</span>
                    <span>⚠️ {needFix}</span>
                    <span>❌ {failed}</span>
                    <span>⬜ {pending}</span>
                  </div>
                  <Popconfirm
                    title="确定删除此核阅记录？"
                    onConfirm={(e) => { e?.stopPropagation(); void handleDeleteReview(r.id); }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderChecklistPanel = () => (
    <div className={styles.checklistPanel}>
      <div className={styles.checklistHeader}>
        <div className={styles.checklistHeaderTop}>
          <Tooltip title="返回列表">
            <span className={styles.checklistBack} onClick={handleBackToList}>
              <ArrowLeftOutlined />
            </span>
          </Tooltip>
          <span className={styles.checklistHeaderTitle}>{currentReview?.case_name}</span>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressText}>
            <span>进度 <span className={styles.progressPassed}>{passedCount}/{totalCount}项</span> ✅</span>
            <span>{progressPercent}%</span>
          </div>
          <Progress percent={progressPercent} size="small" showInfo={false} status={progressStatus} />
        </div>
      </div>
      <div className={styles.checklistBody}>
        {reviewLoading ? (
          <Spin style={{ display: "block", margin: "20vh auto" }} />
        ) : groupedItems.length === 0 ? (
          <Empty style={{ marginTop: "10vh" }} description="暂无核阅项" />
        ) : (
          <Collapse
            defaultActiveKey={defaultActiveKeys} ghost expandIconPosition="end"
            items={groupedItems.map((g) => ({
              key: g.categoryId,
              label: (
                <div className={styles.categoryHeader}>
                  <span>{g.categoryName}</span>
                  <span className={styles.categoryCount}>
                    {g.items.filter((i) => i.status === "pass").length}/{g.items.length}
                  </span>
                </div>
              ),
              children: g.items.map((item, idx) => {
                const active = item.id === selectedItemId;
                return (
                  <div
                    key={item.id}
                    className={active ? styles.checklistItemActive : styles.checklistItem}
                    onClick={() => setSelectedItemId(item.id)}
                  >
                    <span className={styles.checklistItemIndex}>{idx + 1}.</span>
                    <span className={styles.checklistItemIcon}>{STATUS_ICON[item.status]}</span>
                    <span className={styles.checklistItemTitle}>{item.title}</span>
                  </div>
                );
              }),
            }))}
          />
        )}
      </div>
      <div className={styles.checklistFooter}>
        <Button className={styles.navBtn} icon={<ArrowLeftOutlined />}
          onClick={handlePrevItem} disabled={currentIndex <= 0}>
          上一项
        </Button>
        <Button className={styles.navBtn} onClick={handleNextItem}
          disabled={currentIndex >= flatItems.length - 1}>
          下一项 <ArrowRightOutlined />
        </Button>
      </div>
    </div>
  );

  const renderComparisonArea = () => {
    if (reviewLoading) {
      return (
        <div className={styles.comparisonArea}>
          <Spin style={{ display: "block", margin: "20vh auto" }} />
        </div>
      );
    }
    if (!currentItem) {
      return (
        <div className={styles.comparisonArea}>
          <div className={styles.comparisonEmpty}>
            <FileTextOutlined style={{ fontSize: 48, color: "var(--ant-color-text-quaternary)" }} />
            <div style={{ marginTop: 12, color: "var(--ant-color-text-secondary)" }}>
              请从左侧核阅清单中选择一项进行核验
            </div>
          </div>
        </div>
      );
    }
    const documents = currentReview?.documents || [];
    const docTabItems = documents.length > 0
      ? documents.map((doc, idx) => ({
          key: String(idx),
          label: <span><FileTextOutlined /> {doc.name}</span>,
          children: (
            <div className={styles.docContent}>
              <ReactMarkdown remarkGfm>{buildDocumentMarkdown(doc)}</ReactMarkdown>
            </div>
          ),
        }))
      : [{
          key: "0",
          label: <span><FileTextOutlined /> 暂无文档</span>,
          children: (
            <div className={styles.docPlaceholder}>
              <FileTextOutlined className={styles.docPlaceholderIcon} />
              <div>该核阅暂未关联文档，可在新建核阅时附加裁决书、申请书等</div>
            </div>
          ),
        }];

    return (
      <div className={styles.comparisonArea}>
        <div className={styles.comparisonHeader}>
          <div className={styles.comparisonHeaderTop}>
            <div className={styles.comparisonItemTitle}>
              {STATUS_ICON[currentItem.status]} {currentItem.title}
            </div>
            <Tag color={STATUS_TAG_COLOR[currentItem.status]}>
              {STATUS_LABEL[currentItem.status]}
            </Tag>
          </div>
          <div className={styles.comparisonItemCategory}>
            <BookOutlined /> {currentItem.category_name}
            {currentItem.updated_at && (
              <span style={{ marginLeft: 12 }}>· 最近更新 {formatTime(currentItem.updated_at)}</span>
            )}
          </div>
          {currentItem.desc && (
            <div className={styles.comparisonItemDesc}>
              <strong>核验要点：</strong>{currentItem.desc}
            </div>
          )}
        </div>
        <div className={styles.comparisonBody}>
          <div className={styles.sectionTitle}><CheckCircleOutlined /> 核验结论</div>
          <div className={styles.statusBar}>
            <Button className={styles.statusBtn}
              type={currentItem.status === "pass" ? "primary" : "default"}
              icon={<CheckCircleOutlined />} loading={updatingStatus}
              onClick={() => void handleUpdateStatus("pass")} style={statusBtnStyle("pass")}>
              通过
            </Button>
            <Button className={styles.statusBtn}
              type={currentItem.status === "need_fix" ? "primary" : "default"}
              icon={<WarningOutlined />} loading={updatingStatus}
              onClick={() => void handleUpdateStatus("need_fix")} style={statusBtnStyle("need_fix")}>
              需修改
            </Button>
            <Button className={styles.statusBtn}
              type={currentItem.status === "fail" ? "primary" : "default"}
              danger={currentItem.status === "fail"}
              icon={<CloseCircleOutlined />} loading={updatingStatus}
              onClick={() => void handleUpdateStatus("fail")}>
              不通过
            </Button>
          </div>
          <Divider style={{ margin: "12px 0" }} />
          <div className={styles.annotationArea}>
            <div className={styles.annotationToolbar}>
              <div className={styles.sectionTitle} style={{ marginBottom: 0 }}>
                <EditOutlined /> 批注
              </div>
              <Button type="primary" size="small" icon={<EditOutlined />}
                loading={savingAnnotation} onClick={() => void handleSaveAnnotation()}>
                保存批注
              </Button>
            </div>
            <div className={styles.annotationHint}>记录该项的核验意见、修改建议或风险提示</div>
            <TextArea
              value={annotationDraft}
              onChange={(e) => setAnnotationDraft(e.target.value)}
              rows={4}
              placeholder="请输入批注内容…"
              style={{
                marginTop: 8,
                background: "var(--ant-color-bg-container)",
                borderColor: "var(--ant-color-border)",
              }}
            />
            {currentItem.annotation && (
              <div className={styles.annotationExisting}>
                <div className={styles.annotationMeta}>已记录的批注：</div>
                {currentItem.annotation}
              </div>
            )}
          </div>
          <Divider style={{ margin: "12px 0" }} />
          <div className={styles.sectionTitle}><FileTextOutlined /> 文档对照</div>
          <Tabs className={styles.docTabs} activeKey={activeDocTab} onChange={setActiveDocTab}
            items={docTabItems} size="small" destroyOnHidden={false} />
        </div>
      </div>
    );
  };

  const renderKnowledgeSidebar = () => {
    const results = knowledge?.results || [];
    const related = knowledge?.related || [];
    const tags = knowledge?.tags || [];
    return (
      <div className={styles.knowledgeSidebar}>
        <div className={styles.knowledgeHeader}>
          <div className={styles.knowledgeHeaderTitle}><BookOutlined /> 知识库</div>
          <Input
            className={styles.knowledgeSearch}
            placeholder="搜索法条 / 规则…"
            value={knowledgeQuery}
            onChange={(e) => setKnowledgeQuery(e.target.value)}
            allowClear
            prefix={<SearchOutlined style={{ color: "var(--ant-color-text-quaternary)" }} />}
          />
        </div>
        <div className={styles.knowledgeBody}>
          {knowledgeLoading ? (
            <Spin style={{ display: "block", margin: "8vh auto" }} />
          ) : (
            <>
              <div className={styles.knowledgeSection}>
                <div className={styles.knowledgeSectionTitle}>
                  <BookOutlined /> 相关法条 / 规则
                  <span style={{ marginLeft: "auto" }}>{results.length}</span>
                </div>
                {results.length === 0 ? (
                  <div className={styles.knowledgeEmpty}>暂无匹配结果，可尝试其他关键词</div>
                ) : (
                  results.map((r, idx) => (
                    <div key={`${r.path}-${idx}`} className={styles.knowledgeResult}
                      title={r.path} onClick={() => void handleOpenKbEntry(r.path)}>
                      <div className={styles.knowledgeResultTitle}>
                        <FileTextOutlined /> {r.title}
                      </div>
                      <div className={styles.knowledgeResultSnippet}>{r.snippet}</div>
                      {r.tags && r.tags.length > 0 && (
                        <div className={styles.knowledgeResultTags}>
                          {r.tags.slice(0, 4).map((tg) => (
                            <span key={tg} className={styles.knowledgeTag}>{tg}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className={styles.knowledgeSection}>
                <div className={styles.knowledgeSectionTitle}>
                  <LinkOutlined /> 关联案例
                  <span style={{ marginLeft: "auto" }}>{related.length}</span>
                </div>
                {related.length === 0 ? (
                  <div className={styles.knowledgeEmpty}>暂无关联案例</div>
                ) : (
                  related.map((r, idx) => (
                    <div key={`related-${r.path}-${idx}`} className={styles.knowledgeResult}
                      title={r.path} onClick={() => void handleOpenKbEntry(r.path)}>
                      <div className={styles.knowledgeResultTitle}>
                        <LinkOutlined /> {r.title}
                      </div>
                      <div className={styles.knowledgeResultSnippet}>{r.snippet}</div>
                    </div>
                  ))
                )}
              </div>
              {tags.length > 0 && (
                <div className={styles.knowledgeSection}>
                  <div className={styles.knowledgeSectionTitle}><BookOutlined /> 标签云</div>
                  <div className={styles.knowledgeTagsCloud}>
                    {tags.map((tg) => (
                      <span key={tg.tag} className={styles.knowledgeTagCloud}
                        onClick={() => setKnowledgeQuery(tg.tag)}>
                        {tg.tag}
                        <span className={styles.knowledgeTagCount}>({tg.count})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className={styles.notesArea}>
          <div className={styles.notesTitle}><EditOutlined /> 核阅备注</div>
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="随手记录临时笔记，自动保存…"
            style={{
              background: "var(--ant-color-bg-container)",
              borderColor: "var(--ant-color-border)",
            }}
          />
          <div className={styles.notesHint}>备注按当前核阅自动保存到本地，不会上传服务器</div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <PageHeader
        current="裁决核阅"
        subRow={
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
            裁决书核阅 · 项级批注 · 知识库对照
          </span>
        }
        extra={headerExtra}
      />
      {currentReview ? (
        <div className={styles.workbench}>
          {renderChecklistPanel()}
          {renderComparisonArea()}
          {renderKnowledgeSidebar()}
        </div>
      ) : renderListView()}

      <Modal title="新建核阅" open={createModalOpen}
        onOk={() => void handleCreate()} onCancel={() => setCreateModalOpen(false)}
        confirmLoading={creating} width={560} destroyOnHidden okText="开始核阅" cancelText="取消">
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item name="case_name" label="案件名称"
            rules={[{ required: true, message: "请输入案件名称" }]}>
            <Input placeholder="如：甲公司与乙公司买卖合同争议案" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="case_id" label="案件编号">
                <Input placeholder="如：(2024)京仲字第001号" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="template_id" label="核阅模板">
                <Select placeholder="选择核阅模板"
                  options={templates.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
                  notFoundContent="暂无模板，将使用默认清单" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="附加文档" tooltip="可附加裁决书、申请书、答辩书等，用于核阅时对照">
            <Form.List name="documents">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name }) => (
                    <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                      <Col span={11}>
                        <Form.Item name={[name, "name"]} noStyle
                          rules={[{ required: true, message: "请输入文档名称" }]}>
                          <Input placeholder="文档名称（如：裁决书）" />
                        </Form.Item>
                      </Col>
                      <Col span={11}>
                        <Form.Item name={[name, "path"]} noStyle>
                          <Input placeholder="文件路径或摘要" />
                        </Form.Item>
                      </Col>
                      <Col span={2}>
                        <Button type="text" danger icon={<DeleteOutlined />}
                          onClick={() => remove(name)} />
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" onClick={() => add({ name: "", path: "" })}
                    icon={<PlusOutlined />} block>添加文档</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="导出核阅报告" open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)} width={720}
        footer={
          <div className={styles.exportActions}>
            <Button onClick={() => setExportModalOpen(false)}>关闭</Button>
            <Button type="primary" icon={<ExportOutlined />}
              onClick={handleDownloadMarkdown}>下载 .md 文件</Button>
          </div>
        }>
        <div className={styles.exportModalBody}>
          <Row gutter={12}>
            <Col span={6}><Statistic title="总项数" value={totalCount} /></Col>
            <Col span={6}><Statistic title="通过" value={passedCount}
              valueStyle={{ color: "var(--ant-color-success)" }} /></Col>
            <Col span={6}><Statistic title="不通过" value={failedCount}
              valueStyle={{ color: "var(--ant-color-error)" }} /></Col>
            <Col span={6}><Statistic title="待核验" value={pendingCount}
              valueStyle={{ color: "var(--ant-color-text-secondary)" }} /></Col>
          </Row>
          {exportData && (
            <div className={styles.exportPreview}>{exportData.markdown}</div>
          )}
        </div>
      </Modal>

      <Drawer title={
          <div className={styles.kbDrawerTitle}>
            <BookOutlined />
            <span>{kbFileContent?.title || "知识条目"}</span>
          </div>
        }
        placement="right" width={620} open={kbDrawerOpen}
        onClose={() => setKbDrawerOpen(false)} destroyOnHidden>
        {kbFileLoading ? (
          <Spin style={{ display: "block", margin: "20vh auto" }} />
        ) : kbFileContent ? (
          <div className={styles.kbDrawerBody}>
            {kbFileContent.tags && kbFileContent.tags.length > 0 && (
              <div className={styles.kbDrawerTags}>
                {kbFileContent.tags.map((tg) => (
                  <Tag key={tg} color="blue">{tg}</Tag>
                ))}
              </div>
            )}
            {kbFileContent.status && (
              <div className={styles.kbDrawerMeta}>状态：<Tag>{kbFileContent.status}</Tag></div>
            )}
            {kbDrawerPath && (
              <div className={styles.kbDrawerMeta}>路径：<code>{kbDrawerPath}</code></div>
            )}
            <Divider style={{ margin: "12px 0" }} />
            <div className={styles.kbDrawerMarkdown}>
              <ReactMarkdown remarkGfm>
                {kbFileContent.body || kbFileContent.raw || ""}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <Empty description="未找到知识条目内容" />
        )}
      </Drawer>
    </div>
  );
}

/** 格式化时间字符串（兼容 ISO 字符串与 unix 秒/毫秒） */
function formatTime(raw: string | number | undefined): string {
  if (raw == null || raw === "") return "-";
  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    return new Date(ms).toLocaleString("zh-CN");
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed.toLocaleString("zh-CN");
  return String(raw);
}

/** 根据文档元信息构造 Markdown 占位内容（reviewApi 暂未提供文档原文接口） */
function buildDocumentMarkdown(doc: ReviewDocument): string {
  const lines: string[] = [];
  lines.push(`# ${doc.name || "未命名文档"}`);
  lines.push("");
  if (doc.type) lines.push(`> **文档类型**：${doc.type}`);
  if (doc.path) lines.push(`> **文件路径**：\`${doc.path}\``);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "*此处将渲染文档原文。当前后端尚未提供文档内容接口，可后续接入后直接替换为真实 Markdown 内容。*",
  );
  return lines.join("\n");
}
