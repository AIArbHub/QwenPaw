import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  BrainCircuit,
  FileText,
  FolderPlus,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Breadcrumb,
  Button,
  Empty,
  Input,
  Modal,
  message,
  Popconfirm,
  Spin,
  Tooltip,
  Upload as AntUpload,
} from "antd";
import { FileOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  knowledgeApi,
  type KnowledgeCategory,
  type KnowledgeFile,
  type KnowledgeOverview,
  type KnowledgeSearchHit,
} from "../../api/modules/knowledge";
import styles from "./index.module.less";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function KnowledgeBasePage() {
  const { t } = useTranslation();

  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [category, setCategory] = useState("");
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchHit[]>([]);
  const [viewMode, setViewMode] = useState<"files" | "search">("files");
  const [preview, setPreview] = useState<{
    path: string;
    content: string;
  } | null>(null);

  const refreshOverview = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await knowledgeApi.overview());
    } catch (e) {
      message.error((e as Error).message || "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFiles = useCallback(
    async (cat: string) => {
      setPreview(null);
      setFiles([]);
      try {
        setFiles((await knowledgeApi.tree(cat || undefined)).files);
      } catch (e) {
        message.error((e as Error).message || "Failed to load files");
      }
    },
    [],
  );

  useEffect(() => {
    refreshOverview();
  }, [refreshOverview]);

  useEffect(() => {
    if (viewMode === "files") loadFiles(category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, viewMode]);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      setViewMode("files");
      return;
    }
    setSearching(true);
    try {
      setSearchResults((await knowledgeApi.search(q)).results);
      setViewMode("search");
    } catch (e) {
      message.error((e as Error).message || "Search failed");
    } finally {
      setSearching(false);
    }
  }, []);

  const handleOpenFile = async (path: string) => {
    try {
      const data = await knowledgeApi.readFile(path);
      setPreview({ path: data.path, content: data.content });
    } catch (e) {
      message.error((e as Error).message || "Failed to read file");
    }
  };

  const refresh = async () => {
    await refreshOverview();
    if (viewMode === "files") await loadFiles(category);
  };

  const handleCreateCategory = () => {
    let name = "";
    Modal.confirm({
      title: t("knowledge.createCategory", "新建分类"),
      content: (
        <Input
          placeholder={t("knowledge.categoryName", "分类名称")}
          onChange={(e) => (name = e.target.value)}
        />
      ),
      onOk: async () => {
        if (!name.trim()) {
          message.warning(t("knowledge.nameRequired", "请输入分类名称"));
          return;
        }
        try {
          await knowledgeApi.createCategory(name.trim());
          message.success(t("knowledge.created", "已创建"));
          setCategory(name.trim());
          await refresh();
        } catch (e) {
          message.error((e as Error).message || "Create failed");
        }
      },
    });
  };

  const handleDeleteFile = async (path: string) => {
    try {
      await knowledgeApi.deleteFile(path);
      message.success(t("knowledge.deleted", "已删除"));
      if (preview?.path === path) setPreview(null);
      await refresh();
    } catch (e) {
      message.error((e as Error).message || "Delete failed");
    }
  };

  const handleRenameFile = (path: string, currentName: string) => {
    let newName = "";
    Modal.confirm({
      title: t("knowledge.rename", "重命名"),
      content: (
        <Input
          defaultValue={currentName}
          onChange={(e) => (newName = e.target.value)}
        />
      ),
      onOk: async () => {
        if (!newName.trim()) return;
        try {
          await knowledgeApi.rename(path, newName.trim());
          await refresh();
        } catch (e) {
          message.error((e as Error).message || "Rename failed");
        }
      },
    });
  };

  const handleUpload = async (file: File) => {
    try {
      await knowledgeApi.upload(file, category);
      message.success(t("knowledge.uploaded", "上传成功"));
      await refresh();
    } catch (e) {
      message.error((e as Error).message || "Upload failed");
    }
    return false;
  };

  const categories = useMemo<KnowledgeCategory[]>(
    () => overview?.categories ?? [],
    [overview],
  );

  const isSearchMode = viewMode === "search";
  const currentBreadcrumb = category || t("knowledge.allFiles", "全部文件");

  return (
    <section className={styles.page} aria-label={t("knowledge.title", "知识库")}>
      <header className={styles.header}>
        <div className={styles.headerIcon} aria-hidden="true">
          <BrainCircuit size={18} />
        </div>
        <div className={styles.headerTitle}>
          <strong>{t("knowledge.title", "共享知识库")}</strong>
          <span className={styles.headerSub}>
            {t(
              "knowledge.subtitle",
              "所有智能体共享的仲裁资料库，智能体回答仲裁类问题时都会在这里查找",
            )}
          </span>
        </div>
        <div className={styles.headerActions}>
          <Tooltip title={t("knowledge.refresh", "刷新")}>
            <Button
              type="text"
              icon={<RefreshCw size={16} />}
              onClick={refresh}
            />
          </Tooltip>
        </div>
      </header>

      <div className={styles.layout}>
        {/* ── 左侧：检索 + 分类 ─────────────────────────── */}
        <aside className={styles.sidebar}>
          <div className={styles.searchBox}>
            <Input
              allowClear
              prefix={<Search size={15} />}
              placeholder={t("knowledge.searchPlaceholder", "搜索名称/关键词")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPressEnter={() => runSearch(searchQuery)}
              suffix={
                <Button
                  type="link"
                  size="small"
                  loading={searching}
                  onClick={() => runSearch(searchQuery)}
                >
                  {t("knowledge.go", "搜索")}
                </Button>
              }
            />
          </div>

          <div className={styles.categoryTitle}>
            <BookOpen size={13} />
            <span>{t("knowledge.categories", "分类")}</span>
            <Button
              type="text"
              size="small"
              icon={<FolderPlus size={14} />}
              onClick={handleCreateCategory}
            />
          </div>

          <nav className={styles.categoryList}>
            <button
              className={`${styles.categoryItem} ${
                !category && !isSearchMode ? styles.categoryItemActive : ""
              }`}
              onClick={() => {
                setCategory("");
                setViewMode("files");
              }}
            >
              <FolderOpen size={14} className={styles.categoryIcon} />
              <span>{t("knowledge.allFiles", "全部文件")}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.path}
                className={`${styles.categoryItem} ${
                  category === c.path && !isSearchMode
                    ? styles.categoryItemActive
                    : ""
                }`}
                onClick={() => {
                  setCategory(c.path);
                  setViewMode("files");
                }}
              >
                <FolderOpen size={14} className={styles.categoryIcon} />
                <span>{c.name}</span>
              </button>
            ))}
          </nav>

          <div className={styles.rootsBox}>
            <div className={styles.rootsTitle}>
              {t("knowledge.roots", "知识来源")}
            </div>
            {overview?.roots.map((r) => (
              <div key={r.path} className={styles.rootItem}>
                <span className={styles.rootPath} title={r.path}>
                  {r.path}
                </span>
                {r.writable ? (
                  <span className={styles.rootBadge}>
                    {t("knowledge.editable", "可编辑")}
                  </span>
                ) : (
                  <span className={`${styles.rootBadge} ${styles.rootBadgeRo}`}>
                    {t("knowledge.readonly", "只读")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* ── 右侧：文件列表 / 搜索 / 预览 ─────────────── */}
        <main className={styles.main}>
          <div className={styles.toolbar}>
            <Breadcrumb
              items={[{ title: t("knowledge.title", "知识库") }]}
            />
            <div className={styles.toolbarTitle}>{currentBreadcrumb}</div>
            <div className={styles.toolbarActions}>
              <AntUpload
                beforeUpload={(f) => handleUpload(f)}
                showUploadList={false}
              >
                <Button type="primary" icon={<Upload size={15} />}>
                  {t("knowledge.upload", "上传文件")}
                </Button>
              </AntUpload>
            </div>
          </div>

          <div className={styles.filePane}>
            <Spin spinning={loading || searching}>
              {preview ? (
                <pre className={styles.previewBody}>{preview.content}</pre>
              ) : isSearchMode ? (
                searchResults.length === 0 ? (
                  <Empty
                    description={t("knowledge.noSearch", "未找到相关结果")}
                  />
                ) : (
                  <ul className={styles.resultList}>
                    {searchResults.map((hit, idx) => (
                      <li
                        key={`${hit.path}-${idx}`}
                        className={styles.resultItem}
                        onClick={() => handleOpenFile(hit.path)}
                      >
                        <div className={styles.resultPath}>
                          <FileText size={14} />
                          <span className={styles.resultFileName}>
                            {hit.path}
                          </span>
                          <span className={styles.resultLine}>:{hit.line}</span>
                        </div>
                        <div className={styles.resultSnippet}>
                          {hit.snippet}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : files.length === 0 ? (
                <Empty
                  description={t(
                    "knowledge.noFiles",
                    "暂无文件，点击“上传文件”或“新建分类”开始",
                  )}
                />
              ) : (
                <ul className={styles.resultList}>
                  {files.map((f) => (
                    <li
                      key={f.path}
                      className={styles.resultItem}
                      onClick={() => handleOpenFile(f.path)}
                    >
                      <div className={styles.resultPath}>
                        <FileOutlined style={{ fontSize: 14 }} />
                        <span className={styles.resultFileName}>{f.name}</span>
                        <span className={styles.resultSize}>
                          {formatSize(f.size)}
                        </span>
                        <span className={styles.resultActions}>
                          <Button
                            type="link"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameFile(f.path, f.name);
                            }}
                          >
                            {t("knowledge.rename", "重命名")}
                          </Button>
                          <Popconfirm
                            title={t("knowledge.deleteConfirm", "确认删除？")}
                            onConfirm={() => handleDeleteFile(f.path)}
                          >
                            <Button
                              type="text"
                              size="small"
                              icon={<Trash2 size={14} />}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Popconfirm>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Spin>
          </div>
        </main>
      </div>
    </section>
  );
}