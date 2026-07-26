import {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  Input,
  Button,
  Tooltip,
  message,
  Tag,
  Badge,
  Alert,
  Drawer,
  Empty,
} from "@agentscope-ai/design";
import {
  Space,
  Spin,
  Tree,
  Popconfirm,
  Timeline,
} from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
  DeleteOutlined,
  CloudSyncOutlined,
  FileTextOutlined,
  BulbOutlined,
  InboxOutlined,
  CalendarOutlined,
  HistoryOutlined,
  HomeOutlined,
  CloudUploadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { MarkdownCopy } from "@/components/MarkdownCopy/MarkdownCopy";
import api from "@/api";
import type {
  DailyMemoryFile,
  MemoryStats,
  MemoryStatus,
  MemoryVersionInfo,
  MdFileInfo,
} from "@/api/types/workspace";
import styles from "./index.module.less";

interface MemoryTreeNode {
  key: string;
  title: string;
  isLeaf?: boolean;
  filename?: string;
  fileType?: "memory" | "working";
  children?: MemoryTreeNode[];
}

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatTimeAgo(isoTime: string): string {
  if (!isoTime) return "—";
  const now = Date.now();
  const time = new Date(isoTime).getTime();
  if (isNaN(time)) return "—";
  const diff = now - time;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

function formatVersionTime(versionId: string): string {
  if (!versionId || versionId.length < 15) return versionId;
  const y = versionId.slice(0, 4);
  const mo = versionId.slice(4, 6);
  const d = versionId.slice(6, 8);
  const h = versionId.slice(9, 11);
  const mi = versionId.slice(11, 13);
  const s = versionId.slice(13, 15);
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function shortName(filename: string): string {
  const name = filename.split("/").pop() || filename;
  if (/^[a-f0-9]{28,}$/i.test(name.replace(/\.md$/, ""))) {
    const stem = name.replace(/\.md$/, "");
    return `${stem.slice(0, 8)}…${stem.slice(-4)}.md`;
  }
  if (name.length > 32) {
    return `${name.slice(0, 28)}…`;
  }
  return name;
}

function getDateParts(isoTime: string): { year: string; month: string; day: string } | null {
  if (!isoTime) return null;
  const d = new Date(isoTime);
  if (isNaN(d.getTime())) return null;
  return {
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, "0"),
    day: String(d.getDate()).padStart(2, "0"),
  };
}

const MONTH_NAMES_ZH = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
];

interface MemoryExplorerProps {
  /** Agent ID — fixed by the Workbench. No agent select needed. */
  agentId: string;
}

/**
 * MemoryExplorer — extracted from MemoryPage.
 *
 * Contains: stats cards, search, file tree, Markdown editor, version history drawer.
 * The PageHeader and Agent Select are removed — the agent is fixed by the Workbench.
 * No ALL_AGENTS cross-agent mode.
 *
 * Used by:
 *  - WorkbenchPage "记忆" tab
 */
const MemoryExplorer: React.FC<MemoryExplorerProps> = ({ agentId }) => {
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState<DailyMemoryFile[]>([]);
  const [workingFiles, setWorkingFiles] = useState<MdFileInfo[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<"memory" | "working">("memory");
  const [fileContent, setFileContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<string | null>(null);

  // Reindex
  const [reindexing, setReindexing] = useState(false);

  // Expanded tree keys
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // Version history drawer
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  const [versions, setVersions] = useState<MemoryVersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  const [versionContent, setVersionContent] = useState<string | null>(null);

  const isZh = i18n.language?.startsWith("zh");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fileList, workingList, statsData, statusData] = await Promise.all([
        api.listDailyMemory(agentId),
        api.listFiles(agentId).catch(() => [] as MdFileInfo[]),
        api.getMemoryStats(agentId).catch(() => null),
        api.getMemoryStatus(agentId).catch(() => null),
      ]);
      setFiles(fileList);
      setWorkingFiles(
        workingList.filter((f) => f.filename.toUpperCase() === "MEMORY.MD"),
      );
      setStats(statsData);
      setStatus(statusData);
    } catch (err: any) {
      message.error(err?.message || t("memory.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, agentId]);

  useEffect(() => {
    fetchAll();
    // Reset selection when agent changes
    setSelectedFile(null);
    setFileContent("");
  }, [fetchAll]);

  // Build tree
  const treeData = useMemo<MemoryTreeNode[]>(() => {
    const overviewNodes: MemoryTreeNode[] = workingFiles.map((f) => ({
      key: `working:${f.filename}`,
      title: f.filename,
      isLeaf: true,
      filename: f.filename,
      fileType: "working" as const,
    }));

    const dailyFiles: DailyMemoryFile[] = [];
    const digestFiles: DailyMemoryFile[] = [];
    for (const f of files) {
      if (f.filename.startsWith("digest/")) {
        digestFiles.push(f);
      } else {
        dailyFiles.push(f);
      }
    }

    const buildLeaf = (f: DailyMemoryFile): MemoryTreeNode => ({
      key: f.filename,
      title: f.filename,
      isLeaf: true,
      filename: f.filename,
      fileType: "memory" as const,
    });

    const yearMap = new Map<string, Map<string, Map<string, DailyMemoryFile[]>>>();
    for (const f of dailyFiles) {
      const parts = getDateParts(f.modified_time);
      if (!parts) {
        const unknownKey = "unknown";
        if (!yearMap.has(unknownKey)) yearMap.set(unknownKey, new Map());
        const mm = yearMap.get(unknownKey)!;
        if (!mm.has("--")) mm.set("--", new Map());
        const dm = mm.get("--")!;
        if (!dm.has("--")) dm.set("--", []);
        dm.get("--")!.push(f);
        continue;
      }
      const { year, month, day } = parts;
      if (!yearMap.has(year)) yearMap.set(year, new Map());
      const mm = yearMap.get(year)!;
      if (!mm.has(month)) mm.set(month, new Map());
      const dm = mm.get(month)!;
      if (!dm.has(day)) dm.set(day, []);
      dm.get(day)!.push(f);
    }

    const yearNodes: MemoryTreeNode[] = [];
    for (const [year, monthMap] of [...yearMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      const yearKey = `daily-${year}`;
      const monthNodes: MemoryTreeNode[] = [];
      let yearCount = 0;
      for (const [month, dayMap] of [...monthMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
        const monthKey = `${yearKey}-${month}`;
        const dayNodes: MemoryTreeNode[] = [];
        let monthCount = 0;
        for (const [day, dayFiles] of [...dayMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
          const dayKey = `${monthKey}-${day}`;
          const sorted = dayFiles.sort((a, b) => b.modified_time.localeCompare(a.modified_time));
          monthCount += sorted.length;
          yearCount += sorted.length;
          const dayLabel = year === "unknown"
            ? t("memory.noFiles")
            : isZh ? `${parseInt(day)}日` : `Day ${parseInt(day)}`;
          dayNodes.push({
            key: dayKey,
            title: `${dayLabel} (${sorted.length})`,
            isLeaf: false,
            children: sorted.map(buildLeaf),
          });
        }
        const monthLabel = year === "unknown" ? "—" : isZh
          ? (MONTH_NAMES_ZH[parseInt(month) - 1] || month)
          : new Date(2000, parseInt(month) - 1).toLocaleString("en", { month: "long" });
        monthNodes.push({
          key: monthKey,
          title: `${monthLabel} (${monthCount})`,
          isLeaf: false,
          children: dayNodes,
        });
      }
      yearNodes.push({
        key: yearKey,
        title: `${year} (${yearCount})`,
        isLeaf: false,
        children: monthNodes,
      });
    }

    const result: MemoryTreeNode[] = [];

    if (overviewNodes.length > 0) {
      result.push({
        key: "overview",
        title: t("memory.overviewFiles"),
        isLeaf: false,
        children: overviewNodes,
      });
    }

    result.push({
      key: "daily",
      title: t("memory.dailyMemories"),
      isLeaf: false,
      children: yearNodes,
    });

    result.push({
      key: "digest",
      title: t("memory.digestMemories"),
      isLeaf: false,
      children: digestFiles
        .sort((a, b) => b.modified_time.localeCompare(a.modified_time))
        .map(buildLeaf),
    });

    return result;
  }, [files, workingFiles, t, isZh]);

  // Auto-expand
  useEffect(() => {
    if (treeData.length > 0) {
      setExpandedKeys((prev) => {
        if (prev.length > 0) return prev;
        const keys: string[] = [];
        for (const node of treeData) {
          if (node.children && node.children.length > 0) {
            keys.push(node.key);
            const first = node.children[0];
            if (first.children && first.children.length > 0 && node.key !== "overview") {
              keys.push(first.key);
            }
          }
        }
        return keys;
      });
    }
  }, [treeData]);

  // Load file content
  const handleSelectFile = useCallback(
    async (filename: string, fileType: "memory" | "working") => {
      setSelectedFile(filename);
      setSelectedFileType(fileType);
      setContentLoading(true);
      setHasChanges(false);
      try {
        const result = fileType === "working"
          ? await api.loadFile(filename, agentId)
          : await api.loadDailyMemory(filename, agentId);
        setFileContent(result.content);
      } catch (err: any) {
        message.error(err?.message || t("memory.loadContentError"));
        setFileContent("");
      } finally {
        setContentLoading(false);
      }
    },
    [t, agentId],
  );

  // Save file
  const handleSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      if (selectedFileType === "working") {
        await api.saveFile(selectedFile, fileContent, agentId);
      } else {
        await api.saveDailyMemory(selectedFile, fileContent, agentId);
      }
      message.success(t("memory.saveSuccess"));
      setHasChanges(false);
    } catch (err: any) {
      message.error(err?.message || t("memory.saveError"));
    } finally {
      setSaving(false);
    }
  };

  // Delete file
  const handleDelete = async (filename: string) => {
    try {
      await api.deleteDailyMemory(filename, agentId);
      message.success(t("memory.deleteSuccess"));
      if (selectedFile === filename) {
        setSelectedFile(null);
        setFileContent("");
      }
      await fetchAll();
    } catch (err: any) {
      message.error(err?.message || t("memory.deleteError"));
    }
  };

  // Search
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const result = await api.searchMemory(q, 10, 0, agentId);
      if (result.success && result.answer) {
        setSearchResults(result.answer);
      } else {
        setSearchResults(result.error || t("memory.searchNoResults"));
      }
    } catch (err: any) {
      setSearchResults(err?.message || t("memory.searchError"));
    } finally {
      setSearching(false);
    }
  };

  // Reindex
  const handleReindex = async () => {
    setReindexing(true);
    try {
      const result = await api.reindexMemory(agentId);
      if (result.success) {
        message.success(t("memory.reindexSuccess"));
      } else {
        message.error(result.error || t("memory.reindexError"));
      }
    } catch (err: any) {
      message.error(err?.message || t("memory.reindexError"));
    } finally {
      setReindexing(false);
    }
  };

  // Version history
  const handleOpenVersions = async () => {
    if (!selectedFile || selectedFileType !== "memory") return;
    setVersionDrawerOpen(true);
    setVersionsLoading(true);
    setViewingVersion(null);
    setVersionContent(null);
    try {
      const result = await api.listMemoryVersions(selectedFile, agentId);
      setVersions(result);
    } catch (err: any) {
      message.error(err?.message || t("memory.versionLoadError"));
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleViewVersion = async (versionId: string) => {
    if (!selectedFile) return;
    if (viewingVersion === versionId) {
      setViewingVersion(null);
      setVersionContent(null);
      return;
    }
    setViewingVersion(versionId);
    try {
      const result = await api.readMemoryVersion(selectedFile, versionId, agentId);
      setVersionContent(result.content);
    } catch (err: any) {
      message.error(err?.message || t("memory.versionLoadError"));
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!selectedFile) return;
    try {
      const result = await api.restoreMemoryVersion(selectedFile, versionId, agentId);
      setFileContent(result.content);
      setHasChanges(false);
      message.success(t("memory.restoreSuccess"));
      setVersionDrawerOpen(false);
      await fetchAll();
    } catch (err: any) {
      message.error(err?.message || t("memory.restoreError"));
    }
  };

  // Status badge
  const statusBadge = (() => {
    if (!status) return null;
    if (status.error && !status.initialized) {
      return <Badge status="error" text={t("memory.statusError")} />;
    }
    if (status.started) {
      return <Badge status="success" text={t("memory.statusRunning")} />;
    }
    if (status.initialized) {
      return <Badge status="processing" text={t("memory.statusInitialized")} />;
    }
    return <Badge status="warning" text={t("memory.statusNotInitialized")} />;
  })();

  const statCards = useMemo(() => {
    if (!stats) return [];
    return [
      { label: t("memory.totalFiles"), value: String(stats.file_count) },
      { label: t("memory.totalSize"), value: formatSize(stats.total_size) },
      { label: t("memory.lastUpdate"), value: formatTimeAgo(stats.latest_modified) },
    ];
  }, [stats, t]);

  const dailyCount = useMemo(
    () => files.filter((f) => !f.filename.startsWith("digest/")).length,
    [files],
  );
  const digestCount = useMemo(
    () => files.filter((f) => f.filename.startsWith("digest/")).length,
    [files],
  );

  const isGroupKey = (key: string): boolean => {
    return key === "daily" || key === "digest" || key === "overview" || key.startsWith("daily-");
  };

  const isWorkingKey = (key: string): boolean => key.startsWith("working:");

  const canShowVersions = selectedFile && selectedFileType === "memory";

  return (
    <div className={styles.memoryPage}>
      <div className={styles.content}>
        {/* Inline toolbar (replaces PageHeader extra) */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
          <Button icon={<ReloadOutlined />} onClick={fetchAll} loading={loading} size="small">
            {t("memory.refresh")}
          </Button>
          <Button icon={<CloudSyncOutlined />} onClick={handleReindex} loading={reindexing} size="small">
            {t("memory.reindex")}
          </Button>
        </div>

        {statCards.length > 0 && (
          <div className={styles.statsRow}>
            {statCards.map((card) => (
              <div key={card.label} className={styles.statCard}>
                <div className={styles.statLabel}>{card.label}</div>
                <div className={styles.statValue}>{card.value}</div>
              </div>
            ))}
          </div>
        )}

        {status?.error && !status.initialized && (
          <Alert
            type="error"
            showIcon
            message={t("memory.initError")}
            description={status.error}
            style={{ marginBottom: 8, flexShrink: 0 }}
          />
        )}

        <div className={styles.searchSection}>
          <div className={styles.searchBox}>
            <Space.Compact style={{ width: "100%" }}>
              <Input
                prefix={<SearchOutlined />}
                placeholder={t("memory.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onPressEnter={handleSearch}
                allowClear
              />
              <Button type="primary" onClick={handleSearch} loading={searching}>
                {t("memory.searchButton")}
              </Button>
            </Space.Compact>
          </div>
        </div>

        {searchResults !== null && (
          <div className={styles.searchResults}>{searchResults}</div>
        )}

        <div className={styles.mainLayout}>
          {/* Left: File Tree */}
          <div className={styles.treePanel}>
            <div className={styles.treeHeader}>
              <span className={styles.treeHeaderTitle}>{t("memory.fileList")}</span>
              {statusBadge}
            </div>
            {loading ? (
              <div className={styles.loadingCenter}><Spin /></div>
            ) : files.length === 0 && workingFiles.length === 0 ? (
              <div className={styles.emptyEditor}>
                <InboxOutlined className={styles.emptyEditorIcon} />
                <span className={styles.emptyEditorText}>{t("memory.noFiles")}</span>
              </div>
            ) : (
              <div className={styles.treeBody}>
                <Tree
                  treeData={treeData}
                  expandedKeys={expandedKeys}
                  onExpand={(keys) => setExpandedKeys(keys as string[])}
                  onSelect={(keys) => {
                    const key = keys[0] as string;
                    if (!key || isGroupKey(key)) return;
                    if (isWorkingKey(key)) {
                      const filename = key.substring("working:".length);
                      handleSelectFile(filename, "working");
                    } else {
                      handleSelectFile(key, "memory");
                    }
                  }}
                  selectedKeys={selectedFile ? (selectedFileType === "working" ? [`working:${selectedFile}`] : [selectedFile]) : []}
                  showLine={{ showLeafIcon: false }}
                  blockNode
                  titleRender={(node) => {
                    if (node.key === "overview") {
                      return (
                        <span className={styles.groupNodeTitle}>
                          <HomeOutlined className={styles.groupNodeIcon} />
                          {t("memory.overviewFiles")}
                          <span className={styles.groupNodeCount}>({workingFiles.length})</span>
                        </span>
                      );
                    }
                    if (node.key === "daily") {
                      return (
                        <span className={styles.groupNodeTitle}>
                          <CalendarOutlined className={styles.groupNodeIcon} />
                          {t("memory.dailyMemories")}
                          <span className={styles.groupNodeCount}>({dailyCount})</span>
                        </span>
                      );
                    }
                    if (node.key === "digest") {
                      return (
                        <span className={styles.groupNodeTitle}>
                          <BulbOutlined className={styles.groupNodeIcon} />
                          {t("memory.digestMemories")}
                          <span className={styles.groupNodeCount}>({digestCount})</span>
                        </span>
                      );
                    }
                    if (isGroupKey(node.key)) {
                      return <span className={styles.dateNodeTitle}>{node.title}</span>;
                    }
                    if (node.isLeaf && node.filename) {
                      const isWorking = node.fileType === "working";
                      const fileInfo = isWorking
                        ? workingFiles.find((f) => f.filename === node.filename)
                        : files.find((f) => f.filename === node.filename);
                      return (
                        <div className={styles.fileNode}>
                          <div className={styles.fileInfo}>
                            <FileTextOutlined className={styles.fileIcon} />
                            <Tooltip title={node.filename} placement="topLeft">
                              <span className={styles.fileName}>{shortName(node.filename)}</span>
                            </Tooltip>
                            {fileInfo && (
                              <span className={styles.fileSize}>{formatSize(fileInfo.size)}</span>
                            )}
                          </div>
                          {!isWorking && (
                            <Popconfirm
                              title={t("memory.confirmDelete")}
                              onConfirm={() => handleDelete(node.filename!)}
                              okText={t("common.confirm")}
                              cancelText={t("common.cancel")}
                            >
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                className={styles.deleteBtn}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Popconfirm>
                          )}
                        </div>
                      );
                    }
                    return node.title;
                  }}
                />
              </div>
            )}
          </div>

          {/* Right: Editor / Preview */}
          <div className={styles.editorPanel}>
            {!selectedFile ? (
              <div className={styles.emptyEditor}>
                <InboxOutlined className={styles.emptyEditorIcon} />
                <span className={styles.emptyEditorText}>{t("memory.selectFileHint")}</span>
              </div>
            ) : (
              <>
                <div className={styles.editorHeader}>
                  <div className={styles.editorFileTag}>
                    <FileTextOutlined style={{ color: "var(--ant-color-primary)" }} />
                    <Tooltip title={selectedFile}>
                      <span className={styles.editorFileName}>{shortName(selectedFile)}</span>
                    </Tooltip>
                    {hasChanges && (
                      <Tag color="orange" style={{ margin: 0 }}>{t("memory.unsavedChanges")}</Tag>
                    )}
                    {selectedFileType === "working" && (
                      <Tag color="blue" style={{ margin: 0 }}>{t("memory.overviewFiles")}</Tag>
                    )}
                  </div>
                  <div className={styles.editorActions}>
                    {canShowVersions && (
                      <Tooltip title={t("memory.versionHistory")}>
                        <Button
                          type="text"
                          size="small"
                          icon={<HistoryOutlined />}
                          onClick={handleOpenVersions}
                        />
                      </Tooltip>
                    )}
                    <Button
                      type="primary"
                      size="small"
                      icon={<CloudUploadOutlined />}
                      onClick={handleSave}
                      loading={saving}
                      disabled={!hasChanges}
                    >
                      {t("common.save")}
                    </Button>
                  </div>
                </div>
                {contentLoading ? (
                  <div className={styles.loadingCenter}><Spin /></div>
                ) : (
                  <div className={styles.editorBody}>
                    <MarkdownCopy
                      content={fileContent}
                      editable={true}
                      onContentChange={(val) => {
                        setFileContent(val);
                        setHasChanges(true);
                      }}
                      showControls={true}
                      textareaProps={{
                        placeholder: "",
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Version History Drawer */}
      <Drawer
        title={t("memory.versionHistory")}
        open={versionDrawerOpen}
        onClose={() => {
          setVersionDrawerOpen(false);
          setViewingVersion(null);
          setVersionContent(null);
        }}
        width={480}
      >
        {versionsLoading ? (
          <div className={styles.loadingCenter}><Spin /></div>
        ) : versions.length === 0 ? (
          <Empty description={t("memory.noVersions")} />
        ) : (
          <>
            <div style={{ marginBottom: 16, color: "var(--ant-color-text-tertiary)", fontSize: 13 }}>
              {t("memory.versionCount", { count: versions.length })}
            </div>
            <Timeline
              items={versions.map((v) => ({
                key: v.version_id,
                color: viewingVersion === v.version_id ? "blue" : "gray",
                children: (
                  <div className={styles.versionItem}>
                    <div className={styles.versionItemHeader}>
                      <span className={styles.versionTime}>
                        {formatVersionTime(v.version_id)}
                      </span>
                      <span className={styles.versionSize}>{formatSize(v.size)}</span>
                    </div>
                    {viewingVersion === v.version_id && versionContent !== null && (
                      <pre className={styles.versionPreview}>{versionContent}</pre>
                    )}
                    <div className={styles.versionActions}>
                      <Button
                        size="small"
                        type="link"
                        onClick={() => handleViewVersion(v.version_id)}
                      >
                        {viewingVersion === v.version_id
                          ? t("common.collapse")
                          : t("memory.viewVersion")}
                      </Button>
                      <Popconfirm
                        title={t("memory.confirmRestore")}
                        onConfirm={() => handleRestoreVersion(v.version_id)}
                        okText={t("common.confirm")}
                        cancelText={t("common.cancel")}
                      >
                        <Button size="small" type="link" danger>
                          {t("memory.restoreVersion")}
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                ),
              }))}
            />
          </>
        )}
      </Drawer>
    </div>
  );
};

export default MemoryExplorer;
