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
  Spin,
  Tree,
  Select,
} from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
  CloudSyncOutlined,
  FileTextOutlined,
  BulbOutlined,
  CalendarOutlined,
  HomeOutlined,
  InboxOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../../stores/agentStore";
import { agentsApi } from "../../api/modules/agents";
import { workspaceApi } from "../../api/modules/workspace";
import type { MdFileInfo } from "../../api/types/workspace";
import type { MemorySection } from "../../api/types";
import FilesWorkspace from "../../features/files-workspace/FilesWorkspace";
import type { FileTarget } from "../../features/files-workspace/types";
import workspaceStyles from "../../features/files-workspace/FilesWorkspace.module.less";
import styles from "./index.module.less";

interface MemoryTreeNode {
  key: string;
  title: string;
  isLeaf?: boolean;
  filename?: string;
  fileType?: "memory" | "working";
  agentId?: string;
  section?: "daily" | "digest";
  children?: MemoryTreeNode[];
}

function shortName(filename: string): string {
  const name = filename.split("/").pop() || filename;
  if (name.length > 32) return `${name.slice(0, 28)}…`;
  return name;
}

const ALL_AGENTS = "__all__" as const;

function getDateParts(isoTime: string) {
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

interface TaggedMdFileInfo extends MdFileInfo {
  _agentId?: string;
  _agentName?: string;
}

export default function MemoryPage() {
  const { t, i18n } = useTranslation();
  const { agents, selectedAgent, refreshAgents } = useAgentStore();

  const [files, setFiles] = useState<TaggedMdFileInfo[]>([]);
  const [workingFiles, setWorkingFiles] = useState<TaggedMdFileInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // The agent that the right-side FilesWorkspace is bound to.
  // In "all agents" mode, clicking a file in the tree sets this
  // to the file's owning agent so the editor loads the right content.
  const [editorAgentId, setEditorAgentId] = useState<string>(
    selectedAgent || "default",
  );
  const [initialTarget, setInitialTarget] = useState<FileTarget | undefined>();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<string | null>(null);

  const [reindexing, setReindexing] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    selectedAgent || ALL_AGENTS,
  );

  const isZh = i18n.language?.startsWith("zh");

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    if (selectedAgent) {
      setSelectedAgentId(selectedAgent);
      setEditorAgentId(selectedAgent);
    }
  }, [selectedAgent]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedAgentId === ALL_AGENTS && agents.length > 0) {
        const allFiles: TaggedMdFileInfo[] = [];
        const allWorking: TaggedMdFileInfo[] = [];
        const results = await Promise.allSettled(
          agents.map((a) =>
            Promise.all([
              workspaceApi.listMemoryFiles("daily" as MemorySection, a.id).catch(() => [] as MdFileInfo[]),
              workspaceApi.listMemoryFiles("digest" as MemorySection, a.id).catch(() => [] as MdFileInfo[]),
              workspaceApi.listFiles(a.id).catch(() => [] as MdFileInfo[]),
            ]).then(([daily, digest, working]) => {
              const tag = (arr: MdFileInfo[]): TaggedMdFileInfo[] =>
                arr.map((f) => ({ ...f, _agentId: a.id, _agentName: a.name || a.id }));
              return {
                files: [...tag(daily), ...tag(digest)],
                working: tag(working).filter((f) => f.filename.toUpperCase() === "MEMORY.MD"),
              };
            }),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            allFiles.push(...r.value.files);
            allWorking.push(...r.value.working);
          }
        }
        setFiles(allFiles);
        setWorkingFiles(allWorking);
      } else {
        const agentId = selectedAgentId === ALL_AGENTS ? undefined : selectedAgentId;
        const [daily, digest, workingList] = await Promise.all([
          workspaceApi.listMemoryFiles("daily" as MemorySection, agentId),
          workspaceApi.listMemoryFiles("digest" as MemorySection, agentId),
          workspaceApi.listFiles(agentId).catch(() => [] as MdFileInfo[]),
        ]);
        setFiles([...daily, ...digest]);
        setWorkingFiles(workingList.filter((f) => f.filename.toUpperCase() === "MEMORY.MD"));
      }
    } catch (err: any) {
      message.error(err?.message || t("memoryCenter.loadFilesError", "加载记忆文件列表失败"));
    } finally {
      setLoading(false);
    }
  }, [t, selectedAgentId, agents]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const treeData = useMemo<MemoryTreeNode[]>(() => {
    const overviewNodes: MemoryTreeNode[] = workingFiles.map((f) => ({
      key: `working:${f._agentId || ""}:${f.filename}`,
      title: f.filename,
      isLeaf: true,
      filename: f.filename,
      fileType: "working" as const,
      agentId: f._agentId,
    }));

    const dailyFiles: TaggedMdFileInfo[] = [];
    const digestFiles: TaggedMdFileInfo[] = [];
    for (const f of files) {
      if (f.filename.startsWith("digest/")) digestFiles.push(f);
      else dailyFiles.push(f);
    }

    const buildLeaf = (f: TaggedMdFileInfo): MemoryTreeNode => ({
      key: `${f._agentId || ""}::${f.filename}`,
      title: f.filename,
      isLeaf: true,
      filename: f.filename,
      fileType: "memory" as const,
      agentId: f._agentId,
      section: f.filename.startsWith("digest/") ? "digest" as const : "daily" as const,
    });

    const yearMap = new Map<string, Map<string, Map<string, TaggedMdFileInfo[]>>>();
    for (const f of dailyFiles) {
      const parts = getDateParts(f.modified_time);
      if (!parts) {
        const uk = "unknown";
        if (!yearMap.has(uk)) yearMap.set(uk, new Map());
        const mm = yearMap.get(uk)!;
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
            ? t("memoryCenter.noFiles", "暂无")
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
        title: t("memoryCenter.overview", "概览"),
        isLeaf: false,
        children: overviewNodes,
      });
    }
    result.push({
      key: "daily",
      title: t("memoryCenter.dailyMemory", "每日记忆"),
      isLeaf: false,
      children: yearNodes,
    });
    result.push({
      key: "digest",
      title: t("memoryCenter.digestMemory", "长期知识"),
      isLeaf: false,
      children: digestFiles
        .sort((a, b) => b.modified_time.localeCompare(a.modified_time))
        .map(buildLeaf),
    });
    return result;
  }, [files, workingFiles, t, isZh]);

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

  const handleSelectFile = useCallback(
    (node: MemoryTreeNode) => {
      if (!node.filename || !node.fileType) return;

      // Determine the agent for the right-side editor
      const agentId = node.agentId || (selectedAgentId !== ALL_AGENTS ? selectedAgentId : "default");
      setEditorAgentId(agentId);

      // Build the FileTarget for FilesWorkspace's initialTarget
      if (node.fileType === "working") {
        setInitialTarget({ source: "profile", path: node.filename });
      } else {
        const section = node.section || (node.filename.startsWith("digest/") ? "digest" : "daily") as "daily" | "digest";
        setInitialTarget({ source: section, path: node.filename });
      }
    },
    [selectedAgentId],
  );

  const handleReindex = async () => {
    setReindexing(true);
    try {
      if (selectedAgentId === ALL_AGENTS && agents.length > 0) {
        await Promise.allSettled(
          agents.map((a) => agentsApi.rebuildMemoryIndex(a.id).catch(() => null)),
        );
        message.success(t("memoryCenter.reindexSuccess", "记忆索引重建成功"));
      } else {
        const agentId = selectedAgentId === ALL_AGENTS ? undefined : selectedAgentId;
        await agentsApi.rebuildMemoryIndex(agentId || "default");
        message.success(t("memoryCenter.reindexSuccess", "记忆索引重建成功"));
      }
    } catch (err: any) {
      message.error(err?.message || t("memoryCenter.reindexFailed", "重建索引失败"));
    } finally {
      setReindexing(false);
    }
  };

  const agentOptions = useMemo(() => {
    const opts = agents.map((a) => ({ label: a.name || a.id, value: a.id }));
    return [{ label: t("memoryCenter.allAgents", "全部智能体"), value: ALL_AGENTS as string }, ...opts];
  }, [agents, t]);

  const dailyCount = useMemo(
    () => files.filter((f) => !f.filename.startsWith("digest/")).length,
    [files],
  );
  const digestCount = useMemo(
    () => files.filter((f) => f.filename.startsWith("digest/")).length,
    [files],
  );

  const isGroupKey = (key: string): boolean =>
    key === "daily" || key === "digest" || key === "overview" || key.startsWith("daily-");

  const isWorkingKey = (key: string): boolean => key.startsWith("working:");

  return (
    <section className={styles.page} aria-label={t("nav.memory", "记忆中心")}>
      <header className={workspaceStyles.drawerHeader}>
        <div className={workspaceStyles.fileMark} aria-hidden="true">
          <Brain size={17} />
        </div>
        <div className={workspaceStyles.drawerTitle}>
          <strong>{t("nav.memory", "记忆中心")}</strong>
        </div>
        <div className={styles.headerActions}>
          <Select
            value={selectedAgentId}
            onChange={(val) => {
              setSelectedAgentId(val);
              if (val !== ALL_AGENTS) setEditorAgentId(val);
              setInitialTarget(undefined);
            }}
            options={agentOptions}
            style={{ width: 180 }}
            placeholder={t("memoryCenter.agentFilter", "选择智能体")}
            suffixIcon={<RobotOutlined />}
            showSearch
            optionFilterProp="label"
          />
          <Tooltip title={t("common.refresh", "刷新")}>
            <Button icon={<ReloadOutlined />} onClick={fetchAll} loading={loading} />
          </Tooltip>
          <Tooltip title={t("memoryCenter.reindex", "重建索引")}>
            <Button icon={<CloudSyncOutlined />} onClick={handleReindex} loading={reindexing} />
          </Tooltip>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.searchSection}>
          <Input
            prefix={<SearchOutlined />}
            placeholder={t("memoryCenter.searchPlaceholder", "搜索记忆…")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={() => {
              const q = searchQuery.trim();
              if (!q) return;
              const matched = files.filter((f) =>
                f.filename.toLowerCase().includes(q.toLowerCase()),
              );
              if (matched.length === 0) {
                setSearchResults(t("memoryCenter.searchNoResults", "未找到相关结果"));
              } else {
                setSearchResults(
                  matched.map((f) => {
                    const agentLabel = f._agentName ? `[${f._agentName}] ` : "";
                    return `${agentLabel}${f.filename}`;
                  }).join("\n"),
                );
              }
            }}
            allowClear
          />
        </div>

        {searchResults !== null && (
          <div className={styles.searchResults}>{searchResults}</div>
        )}

        <div className={styles.mainLayout}>
          {/* Left: File Tree */}
          <div className={styles.treePanel}>
            <div className={styles.treeHeader}>
              <span className={styles.treeHeaderTitle}>
                {t("memoryCenter.fileList", "文件列表")}
              </span>
              <Tag>{files.length + workingFiles.length}</Tag>
            </div>
            {loading ? (
              <div className={styles.loadingCenter}><Spin /></div>
            ) : files.length === 0 && workingFiles.length === 0 ? (
              <div className={styles.emptyEditor}>
                <InboxOutlined className={styles.emptyEditorIcon} />
                <span className={styles.emptyEditorText}>
                  {t("memoryCenter.noFiles", "暂无记忆文件")}
                </span>
              </div>
            ) : (
              <div className={styles.treeBody}>
                <Tree
                  treeData={treeData}
                  expandedKeys={expandedKeys}
                  onExpand={(keys: React.Key[]) => setExpandedKeys(keys as string[])}
                  onSelect={(keys, info) => {
                    const key = keys[0] as string;
                    if (!key || isGroupKey(key)) return;
                    // Find the node from treeData
                    const findNode = (nodes: MemoryTreeNode[]): MemoryTreeNode | undefined => {
                      for (const n of nodes) {
                        if (n.key === key) return n;
                        if (n.children) {
                          const found = findNode(n.children);
                          if (found) return found;
                        }
                      }
                      return undefined;
                    };
                    const node = findNode(treeData);
                    if (node) handleSelectFile(node);
                  }}
                  showLine={{ showLeafIcon: false }}
                  blockNode
                  titleRender={(node) => {
                    if (node.key === "overview") {
                      return (
                        <span className={styles.groupNodeTitle}>
                          <HomeOutlined className={styles.groupNodeIcon} />
                          {t("memoryCenter.overview", "概览")}
                          <span className={styles.groupNodeCount}>({workingFiles.length})</span>
                        </span>
                      );
                    }
                    if (node.key === "daily") {
                      return (
                        <span className={styles.groupNodeTitle}>
                          <CalendarOutlined className={styles.groupNodeIcon} />
                          {t("memoryCenter.dailyMemory", "每日记忆")}
                          <span className={styles.groupNodeCount}>({dailyCount})</span>
                        </span>
                      );
                    }
                    if (node.key === "digest") {
                      return (
                        <span className={styles.groupNodeTitle}>
                          <BulbOutlined className={styles.groupNodeIcon} />
                          {t("memoryCenter.digestMemory", "长期知识")}
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
                        ? workingFiles.find((f) => f.filename === node.filename && f._agentId === node.agentId)
                        : files.find((f) => f.filename === node.filename && f._agentId === node.agentId);
                      const agentLabel = fileInfo?._agentName;
                      const isCrossAgent = selectedAgentId === ALL_AGENTS;
                      return (
                        <div className={styles.fileNode}>
                          <div className={styles.fileInfo}>
                            <FileTextOutlined className={styles.fileIcon} />
                            <Tooltip title={node.filename} placement="topLeft">
                              <span className={styles.fileName}>{shortName(node.filename)}</span>
                            </Tooltip>
                            {isCrossAgent && agentLabel && (
                              <Tag color="blue" className={styles.agentTag}>{agentLabel}</Tag>
                            )}
                            {fileInfo && (
                              <span className={styles.fileSize}>
                                {fileInfo.size >= 1024
                                  ? `${(fileInfo.size / 1024).toFixed(0)} KB`
                                  : `${fileInfo.size} B`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return node.title;
                  }}
                />
              </div>
            )}
          </div>

          {/* Right: FilesWorkspace (diary layout) */}
          <div className={styles.editorPanel}>
            <FilesWorkspace
              key={`memory:${editorAgentId}`}
              scope={{ kind: "agent", agentId: editorAgentId }}
              initialSource="daily"
              hideSourceTabs
              initialTarget={initialTarget}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
