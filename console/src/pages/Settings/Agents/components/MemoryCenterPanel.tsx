import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Tabs,
  Input,
  Button,
  Tag,
  Spin,
  Empty,
  Modal,
  Tooltip,
  Badge,
  Statistic,
  Card,
  Space,
  Typography,
} from "antd";
import {
  FileTextOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SaveOutlined,
  DatabaseOutlined,
  CloudServerOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { agentsApi } from "@/api/modules/agents";
import { workspaceApi } from "@/api/modules/workspace";
import type { MdFileInfo } from "@/api/types/workspace";
import type { ReMeMemoryRuntimeStatus } from "@/api/modules/agents";
import { useAppMessage } from "@/hooks/useAppMessage";
import styles from "./MemoryCenterPanel.module.less";

const { TextArea } = Input;
const { Text } = Typography;

interface MemoryCenterPanelProps {
  agentId: string;
}

interface FileNode {
  filename: string;
  path: string;
  size: number;
  modified_time: string;
  children?: FileNode[];
}

/** Build a tree from flat file list for nested display. */
function buildFileTree(files: MdFileInfo[]): FileNode[] {
  const root: FileNode[] = [];
  const dirMap = new Map<string, FileNode>();

  for (const file of files) {
    const parts = file.filename.split("/");
    const fileName = parts[parts.length - 1];

    // Create directory nodes if needed
    let currentLevel = root;
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      let dirNode = dirMap.get(currentPath);
      if (!dirNode) {
        dirNode = {
          filename: parts[i],
          path: currentPath,
          size: 0,
          modified_time: "",
          children: [],
        };
        currentLevel.push(dirNode);
        dirMap.set(currentPath, dirNode);
      }
      currentLevel = dirNode.children!;
    }

    // Add file node
    currentLevel.push({
      filename: fileName,
      path: file.filename,
      size: file.size,
      modified_time: file.modified_time,
    });
  }

  return root;
}

/** Format file size to human-readable string. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Memory runtime status badge */
function StatusBadge({ status }: { status: ReMeMemoryRuntimeStatus | null }) {
  const { t } = useTranslation();

  if (!status) {
    return (
      <Badge
        status="default"
        text={t("memoryCenter.statusUnavailable", "不可用")}
      />
    );
  }

  const workerStatus = status.worker.status;
  const isHealthy = workerStatus === "idle" && !status.reindexing;
  const isBusy = workerStatus === "busy" || status.reindexing;
  const isError = workerStatus === "error";

  if (isError) {
    return (
      <Badge
        status="error"
        text={t("memoryCenter.statusError", "需要关注")}
      />
    );
  }
  if (isBusy) {
    return (
      <Badge
        status="processing"
        text={t("memoryCenter.statusBusy", "处理中")}
      />
    );
  }
  if (isHealthy) {
    return (
      <Badge
        status="success"
        text={t("memoryCenter.statusHealthy", "运行中")}
      />
    );
  }
  return (
    <Badge
      status="warning"
      text={t("memoryCenter.statusUnknown", "未知")}
    />
  );
}

/** Memory file tree renderer */
function FileTree({
  nodes,
  depth,
  onSelect,
  selectedPath,
}: {
  nodes: FileNode[];
  depth: number;
  onSelect: (node: FileNode) => void;
  selectedPath: string | null;
}) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    // Auto-expand first level
    const s = new Set<string>();
    for (const n of nodes) {
      if (n.children) s.add(n.path);
    }
    return s;
  });

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <>
      {nodes.map((node) => {
        if (node.children) {
          const isExpanded = expandedDirs.has(node.path);
          return (
            <div key={node.path}>
              <div
                className={styles.treeRow}
                style={{ paddingLeft: depth * 16 + 8 }}
                onClick={() => toggleDir(node.path)}
              >
                {isExpanded ? (
                  <FolderOpenOutlined className={styles.treeIcon} />
                ) : (
                  <FolderOutlined className={styles.treeIcon} />
                )}
                <span className={styles.treeLabel}>{node.filename}</span>
              </div>
              {isExpanded && (
                <FileTree
                  nodes={node.children}
                  depth={depth + 1}
                  onSelect={onSelect}
                  selectedPath={selectedPath}
                />
              )}
            </div>
          );
        }
        return (
          <div
            key={node.path}
            className={`${styles.treeRow} ${
              selectedPath === node.path ? styles.treeRowSelected : ""
            }`}
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => onSelect(node)}
          >
            <FileTextOutlined className={styles.treeIcon} />
            <span className={styles.treeLabel}>{node.filename}</span>
            <span className={styles.treeMeta}>{formatSize(node.size)}</span>
          </div>
        );
      })}
    </>
  );
}

/** Memory file editor */
function MemoryFileEditor({
  agentId,
  filePath,
  section,
  onClose,
}: {
  agentId: string;
  filePath: string | null;
  section: "daily" | "digest";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!filePath || !agentId) return;
    setLoading(true);
    workspaceApi
      .loadMemoryFile(filePath, section)
      .then((data) => {
        setContent(data.content);
        setOriginalContent(data.content);
      })
      .catch((err) => {
        console.error("Failed to load memory file:", err);
        message.error(t("memoryCenter.loadFileError", "加载记忆文件失败"));
      })
      .finally(() => setLoading(false));
  }, [filePath, agentId, section, message, t]);

  const hasChanges = content !== originalContent;

  const handleSave = async () => {
    if (!filePath) return;
    setSaving(true);
    try {
      await workspaceApi.saveMemoryFile(filePath, content, section);
      setOriginalContent(content);
      message.success(t("memoryCenter.saveSuccess", "记忆文件已保存"));
    } catch (err) {
      console.error("Failed to save memory file:", err);
      message.error(t("memoryCenter.saveError", "保存记忆文件失败"));
    } finally {
      setSaving(false);
    }
  };

  if (!filePath) {
    return (
      <div className={styles.editorEmpty}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t(
            "memoryCenter.selectFilePrompt",
            "选择左侧文件查看内容",
          )}
        />
      </div>
    );
  }

  return (
    <div className={styles.editorContainer}>
      <div className={styles.editorHeader}>
        <div className={styles.editorFilePath}>
          <FileTextOutlined />
          <span>{filePath}</span>
        </div>
        <Space>
          <Button
            size="small"
            onClick={onClose}
            disabled={loading || saving}
          >
            {t("common.close", "关闭")}
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
            disabled={!hasChanges || loading}
          >
            {t("common.save", "保存")}
          </Button>
        </Space>
      </div>
      {loading ? (
        <div className={styles.editorLoading}>
          <Spin size="large" />
        </div>
      ) : (
        <TextArea
          className={styles.editorTextarea}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoSize={{ minRows: 20 }}
          spellCheck={false}
        />
      )}
      {hasChanges && (
        <div className={styles.editorUnsavedHint}>
          <WarningOutlined />
          {t("memoryCenter.unsavedChanges", "有未保存的更改")}
        </div>
      )}
    </div>
  );
}

/** Main MemoryCenterPanel component */
export function MemoryCenterPanel({ agentId }: MemoryCenterPanelProps) {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const [activeTab, setActiveTab] = useState("overview");
  const [runtimeStatus, setRuntimeStatus] =
    useState<ReMeMemoryRuntimeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Memory files
  const [dailyFiles, setDailyFiles] = useState<MdFileInfo[]>([]);
  const [digestFiles, setDigestFiles] = useState<MdFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedDailyFile, setSelectedDailyFile] = useState<string | null>(
    null,
  );
  const [selectedDigestFile, setSelectedDigestFile] = useState<
    string | null
  >(null);

  // Memory graph
  const [graphData, setGraphData] = useState<{
    nodes: number;
    edges: number;
  } | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  // Reindex
  const [reindexing, setReindexing] = useState(false);

  const loadRuntimeStatus = useCallback(async () => {
    if (!agentId) return;
    setStatusLoading(true);
    try {
      const status = await agentsApi.getMemoryRuntimeStatus(agentId);
      setRuntimeStatus(status);
    } catch {
      setRuntimeStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [agentId]);

  const loadMemoryFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const [daily, digest] = await Promise.all([
        workspaceApi.listMemoryFiles("daily"),
        workspaceApi.listMemoryFiles("digest"),
      ]);
      setDailyFiles(daily);
      setDigestFiles(digest);
    } catch (err) {
      console.error("Failed to load memory files:", err);
      message.error(
        t("memoryCenter.loadFilesError", "加载记忆文件列表失败"),
      );
    } finally {
      setFilesLoading(false);
    }
  }, [agentId, message, t]);

  const loadGraphSummary = useCallback(async () => {
    if (!agentId) return;
    setGraphLoading(true);
    try {
      const graph = await agentsApi.getMemoryGraph(agentId);
      setGraphData({
        nodes: graph.nodes.length,
        edges: graph.edges.length,
      });
    } catch {
      setGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadRuntimeStatus();
    loadMemoryFiles();
    loadGraphSummary();
  }, [loadRuntimeStatus, loadMemoryFiles, loadGraphSummary]);

  const handleReindex = () => {
    Modal.confirm({
      title: t(
        "memoryCenter.reindexConfirmTitle",
        "重建记忆索引",
      ),
      content: t(
        "memoryCenter.reindexConfirmDesc",
        "这将清除并重建所有记忆搜索索引，可能需要一些时间。确定继续吗？",
      ),
      okText: t("memoryCenter.reindex", "重建索引"),
      cancelText: t("common.cancel", "取消"),
      okButtonProps: { danger: true },
      onOk: async () => {
        setReindexing(true);
        try {
          await agentsApi.rebuildMemoryIndex(agentId);
          message.success(
            t("memoryCenter.reindexSuccess", "记忆索引重建成功"),
          );
          await loadRuntimeStatus();
        } catch (err) {
          const detail =
            err instanceof Error ? err.message : String(err);
          message.error(
            t("memoryCenter.reindexFailed", "重建索引失败: {{error}}", {
              error: detail,
            }),
          );
        } finally {
          setReindexing(false);
        }
      },
    });
  };

  const handleDailyFileSelect = (node: FileNode) => {
    setSelectedDailyFile(node.path);
  };

  const handleDigestFileSelect = (node: FileNode) => {
    setSelectedDigestFile(node.path);
  };

  const dailyTree = useMemo(() => buildFileTree(dailyFiles), [dailyFiles]);
  const digestTree = useMemo(() => buildFileTree(digestFiles), [digestFiles]);

  const tabs = [
    {
      key: "overview",
      label: (
        <span className={styles.tabLabel}>
          <CloudServerOutlined />
          {t("memoryCenter.overview", "概览")}
        </span>
      ),
      children: (
        <div className={styles.overviewTab}>
          <Card
            title={t("memoryCenter.runtimeStatus", "运行状态")}
            size="small"
            className={styles.overviewCard}
            extra={
              <Tooltip title={t("common.refresh", "刷新")}>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={loadRuntimeStatus}
                  loading={statusLoading}
                />
              </Tooltip>
            }
          >
            {statusLoading ? (
              <div className={styles.statusLoading}>
                <Spin size="small" />
              </div>
            ) : (
              <div className={styles.statusGrid}>
                <div className={styles.statusItem}>
                  <Text type="secondary" className={styles.statusLabel}>
                    {t("memoryCenter.workerStatus", "工作器状态")}
                  </Text>
                  <StatusBadge status={runtimeStatus} />
                </div>
                <div className={styles.statusItem}>
                  <Text type="secondary" className={styles.statusLabel}>
                    {t("memoryCenter.autoMemory", "自动记忆")}
                  </Text>
                  <Tag
                    color={
                      runtimeStatus?.auto_memory.enabled
                        ? "green"
                        : "default"
                    }
                  >
                    {runtimeStatus?.auto_memory.enabled
                      ? t("common.enabled", "已启用")
                      : t("common.disabled", "已禁用")}
                  </Tag>
                </div>
                <div className={styles.statusItem}>
                  <Text type="secondary" className={styles.statusLabel}>
                    {t("memoryCenter.autoMemoryInterval", "自动记忆间隔")}
                  </Text>
                  <Text strong>
                    {runtimeStatus?.auto_memory.interval ?? "—"}
                  </Text>
                </div>
                <div className={styles.statusItem}>
                  <Text type="secondary" className={styles.statusLabel}>
                    {t("memoryCenter.queuePending", "待处理任务")}
                  </Text>
                  <Text strong>
                    {runtimeStatus?.worker.queue_pending ?? "—"}
                  </Text>
                </div>
                <div className={styles.statusItem}>
                  <Text type="secondary" className={styles.statusLabel}>
                    {t("memoryCenter.tasksRunning", "进行中任务")}
                  </Text>
                  <Text strong>
                    {runtimeStatus?.worker.tasks_running ?? "—"}
                  </Text>
                </div>
                <div className={styles.statusItem}>
                  <Text type="secondary" className={styles.statusLabel}>
                    {t("memoryCenter.reindexing", "索引重建中")}
                  </Text>
                  {runtimeStatus?.reindexing ? (
                    <Tag color="processing">
                      {t("common.yes", "是")}
                    </Tag>
                  ) : (
                    <Tag>{t("common.no", "否")}</Tag>
                  )}
                </div>
              </div>
            )}
            {runtimeStatus?.recent.last_error && (
              <div className={styles.errorBanner}>
                <WarningOutlined />
                <span>{runtimeStatus.recent.last_error}</span>
              </div>
            )}
          </Card>

          <Card
            title={t("memoryCenter.memoryFiles", "记忆文件")}
            size="small"
            className={styles.overviewCard}
          >
            <div className={styles.fileStatsGrid}>
              <div className={styles.fileStatItem}>
                <Statistic
                  title={t("memoryCenter.dailyMemory", "每日记忆")}
                  value={dailyFiles.length}
                  prefix={<FileTextOutlined />}
                />
              </div>
              <div className={styles.fileStatItem}>
                <Statistic
                  title={t("memoryCenter.digestMemory", "长期知识")}
                  value={digestFiles.length}
                  prefix={<DatabaseOutlined />}
                />
              </div>
            </div>
          </Card>

          <Card
            title={t("memoryCenter.memoryGraph", "记忆图谱")}
            size="small"
            className={styles.overviewCard}
            extra={
              <Tooltip title={t("common.refresh", "刷新")}>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={loadGraphSummary}
                  loading={graphLoading}
                />
              </Tooltip>
            }
          >
            {graphData ? (
              <div className={styles.graphStats}>
                <Tag color="blue">
                  {t("memoryCenter.graphNodes", "{{count}} 个节点", {
                    count: graphData.nodes,
                  })}
                </Tag>
                <Tag color="purple">
                  {t("memoryCenter.graphEdges", "{{count}} 条链接", {
                    count: graphData.edges,
                  })}
                </Tag>
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  "memoryCenter.graphUnavailable",
                  "图谱不可用",
                )}
              />
            )}
          </Card>

          <Card
            title={t("memoryCenter.maintenance", "维护")}
            size="small"
            className={styles.overviewCard}
          >
            <Space>
              <Button
                type="primary"
                danger
                icon={<ReloadOutlined />}
                onClick={handleReindex}
                loading={reindexing}
                disabled={reindexing}
              >
                {t("memoryCenter.reindex", "重建索引")}
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t(
                  "memoryCenter.reindexHint",
                  "清除并重建记忆搜索索引",
                )}
              </Text>
            </Space>
          </Card>
        </div>
      ),
    },
    {
      key: "daily",
      label: (
        <span className={styles.tabLabel}>
          <FileTextOutlined />
          {t("memoryCenter.dailyMemory", "每日记忆")}
        </span>
      ),
      children: (
        <div className={styles.fileManagerTab}>
          <div className={styles.fileSidebar}>
            <div className={styles.fileSidebarHeader}>
              <span>{t("memoryCenter.fileList", "文件列表")}</span>
              <Tooltip title={t("common.refresh", "刷新")}>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={loadMemoryFiles}
                  loading={filesLoading}
                />
              </Tooltip>
            </div>
            {filesLoading ? (
              <div className={styles.fileListLoading}>
                <Spin size="small" />
              </div>
            ) : dailyFiles.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  "memoryCenter.noFiles",
                  "暂无记忆文件",
                )}
              />
            ) : (
              <div className={styles.fileTreeContainer}>
                <FileTree
                  nodes={dailyTree}
                  depth={0}
                  onSelect={handleDailyFileSelect}
                  selectedPath={selectedDailyFile}
                />
              </div>
            )}
          </div>
          <div className={styles.fileEditor}>
            <MemoryFileEditor
              agentId={agentId}
              filePath={selectedDailyFile}
              section="daily"
              onClose={() => setSelectedDailyFile(null)}
            />
          </div>
        </div>
      ),
    },
    {
      key: "digest",
      label: (
        <span className={styles.tabLabel}>
          <DatabaseOutlined />
          {t("memoryCenter.digestMemory", "长期知识")}
        </span>
      ),
      children: (
        <div className={styles.fileManagerTab}>
          <div className={styles.fileSidebar}>
            <div className={styles.fileSidebarHeader}>
              <span>{t("memoryCenter.fileList", "文件列表")}</span>
              <Tooltip title={t("common.refresh", "刷新")}>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={loadMemoryFiles}
                  loading={filesLoading}
                />
              </Tooltip>
            </div>
            {filesLoading ? (
              <div className={styles.fileListLoading}>
                <Spin size="small" />
              </div>
            ) : digestFiles.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  "memoryCenter.noFiles",
                  "暂无记忆文件",
                )}
              />
            ) : (
              <div className={styles.fileTreeContainer}>
                <FileTree
                  nodes={digestTree}
                  depth={0}
                  onSelect={handleDigestFileSelect}
                  selectedPath={selectedDigestFile}
                />
              </div>
            )}
          </div>
          <div className={styles.fileEditor}>
            <MemoryFileEditor
              agentId={agentId}
              filePath={selectedDigestFile}
              section="digest"
              onClose={() => setSelectedDigestFile(null)}
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.memoryCenterPanel}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabs}
        destroyInactiveTabPane={false}
        size="small"
        className={styles.memoryTabs}
      />
    </div>
  );
}
