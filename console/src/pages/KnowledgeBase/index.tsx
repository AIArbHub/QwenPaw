import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select, Spin, Tooltip, message } from "antd";
import {
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  FileTextOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { BookOpen, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../../stores/agentStore";
import FilesWorkspace from "../../features/files-workspace/FilesWorkspace";
import type { KnowledgeLibraryGroup } from "../../features/files-workspace/FilesNavigator";
import workspaceStyles from "../../features/files-workspace/FilesWorkspace.module.less";
import { knowledgeApi, type KnowledgeSearchHit } from "../../api/modules/knowledge";
import type { FileTarget } from "../../features/files-workspace/types";
import CuratorPanel from "./CuratorPanel";
import styles from "./index.module.less";

/** The hand-maintained shared knowledge base, shown on its own. */
const GLOBAL_KEY = "__global__" as const;
/** Merge the shared KB with every agent's dedicated KB into one grouped tree. */
const ALL_KEY = "__all__" as const;
/** Non-selectable divider inside the library dropdown. */
const SEPARATOR_KEY = "__separator__" as const;

export default function KnowledgeBasePage() {
  const { t } = useTranslation();
  const { agents, refreshAgents } = useAgentStore();

  const [viewValue, setViewValue] = useState<string>(GLOBAL_KEY);
  const [refreshKey, setRefreshKey] = useState(0);
  const [curatorOpen, setCuratorOpen] = useState(false);
  const [initialTarget, setInitialTarget] = useState<FileTarget | undefined>();

  // Upload new files into the shared (global) knowledge base.
  const [kbUploading, setKbUploading] = useState(false);
  const kbUploadRef = useRef<HTMLInputElement>(null);

  const handleKbUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setKbUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const res = await knowledgeApi.upload(file);
        uploaded.push(res.name || file.name);
      }
      message.success(
        t("knowledge.uploaded", "已上传 {{count}} 个文件到通用知识库", {
          count: uploaded.length,
        }),
      );
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      message.error(err?.message || t("knowledge.uploadFailed", "上传失败"));
    } finally {
      setKbUploading(false);
    }
  };

  // Search over the shared knowledge base.
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchHit[] | null>(null);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  const dedicatedAgents = useMemo(
    () => agents.filter((a) => a.id !== "default"),
    [agents],
  );

  const handleTaskCompleted = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const libraryOptions = useMemo(() => {
    const opts = dedicatedAgents.map((a) => ({
      label: a.name || a.id,
      value: a.id,
    }));
    return [
      { label: t("knowledge.shared", "通用知识库"), value: GLOBAL_KEY as string },
      { label: t("knowledge.allLibraries", "全部知识库"), value: ALL_KEY as string },
      {
        label: t("knowledge.dedicatedGroup", "智能体专属知识库"),
        value: SEPARATOR_KEY as string,
      },
      ...opts,
    ];
  }, [dedicatedAgents, t]);

  // One collapsible group per library, handed to the navigator's merged view.
  const allGroups = useMemo<KnowledgeLibraryGroup[]>(() => {
    const groups: KnowledgeLibraryGroup[] = [
      { key: "global", name: t("knowledge.shared", "通用知识库") },
    ];
    dedicatedAgents.forEach((a) =>
      groups.push({ key: a.id, name: a.name || a.id, agentId: a.id }),
    );
    return groups;
  }, [dedicatedAgents, t]);

  const handleViewChange = (val: string) => {
    if (val === SEPARATOR_KEY) return;
    setViewValue(val);
    setSearchResults(null);
    setSearchQuery("");
    setInitialTarget(undefined);
  };

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearchError("");
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const data = await knowledgeApi.search(q, undefined, 50);
      setSearchResults(data.results);
    } catch (err: any) {
      setSearchError(err?.message || t("knowledge.searchFailed", "搜索失败"));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, t]);

  // What FilesWorkspace shows for the current view. A single agent's dedicated
  // KB is the digest source bound to that agent; the global KB and the merged
  // "all libraries" view both live under the shared knowledge source.
  const workspaceCfg = useMemo(() => {
    const isAggregate = viewValue === ALL_KEY;
    const anchor = dedicatedAgents[0]?.id ?? "default";
    if (viewValue === GLOBAL_KEY || isAggregate) {
      return {
        scope: { kind: "agent" as const, agentId: anchor },
        initialSource: "knowledge" as const,
        knowledgeGroups: isAggregate ? allGroups : undefined,
      };
    }
    return {
      scope: { kind: "agent" as const, agentId: viewValue },
      initialSource: "digest" as const,
      knowledgeGroups: undefined,
    };
  }, [allGroups, dedicatedAgents, viewValue]);

  return (
    <section className={styles.page} aria-label={t("nav.knowledgeBase", "知识库")}>
      <header className={workspaceStyles.drawerHeader}>
        <div className={workspaceStyles.fileMark} aria-hidden="true">
          <BookOpen size={17} />
        </div>
        <div className={workspaceStyles.drawerTitle}>
          <strong>{t("nav.knowledgeBase", "知识库")}</strong>
        </div>
        <div className={styles.headerActions}>
          <Select
            value={viewValue}
            onChange={handleViewChange}
            style={{ width: 220 }}
            placeholder={t("knowledge.pickLibrary", "选择知识库")}
            suffixIcon={<Database size={14} />}
            showSearch
            optionFilterProp="label"
            options={libraryOptions}
          />
          <Tooltip title={t("knowledge.upload", "上传到通用知识库")}>
            <Button
              icon={<UploadOutlined />}
              loading={kbUploading}
              onClick={() => kbUploadRef.current?.click()}
              aria-label={t("knowledge.upload", "上传到通用知识库")}
            />
          </Tooltip>
          <Tooltip title={t("knowledge.curator.title", "AI 知识整理")}>
            <Button
              icon={<RobotOutlined />}
              onClick={() => setCuratorOpen(true)}
            />
          </Tooltip>
          <Tooltip title={t("common.refresh", "刷新")}>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => setRefreshKey((k) => k + 1)}
            />
          </Tooltip>
        </div>
      </header>

      <div className={styles.searchSection}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={t("knowledge.searchPlaceholder", "搜索知识库…")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onPressEnter={handleSearch}
          allowClear
          suffix={searching ? <Spin size="small" /> : null}
        />
      </div>

      {searchError && <div className={styles.searchError}>{searchError}</div>}

      {searchResults !== null && !searchError && (
        <div className={styles.searchResults}>
          {searchResults.length === 0 ? (
            <div className={styles.searchEmpty}>
              {t("knowledge.searchNoResults", "未找到相关结果")}
            </div>
          ) : (
            <>
              <div className={styles.searchResultsHeader}>
                {t("knowledge.searchResultsCount", "{{count}} 条结果", {
                  count: searchResults.length,
                })}
              </div>
              <div className={styles.searchResultsList}>
                {searchResults.map((hit, idx) => (
                  <button
                    type="button"
                    key={`${hit.path}-${idx}`}
                    className={styles.searchResultItem}
                    onClick={() => {
                      setSearchResults(null);
                      setSearchQuery("");
                      setInitialTarget({
                        source: "knowledge",
                        path: hit.path,
                        line: hit.line,
                      });
                    }}
                    title={hit.path}
                  >
                    <div className={styles.searchResultInfo}>
                      <FileTextOutlined className={styles.searchResultIcon} />
                      <span className={styles.searchResultPath}>{hit.path}</span>
                      <span className={styles.searchResultLine}>:{hit.line}</span>
                    </div>
                    <div className={styles.searchResultSnippet}>{hit.snippet}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className={styles.workspace}>
        <FilesWorkspace
          key={`kb:${viewValue}:${workspaceCfg.initialSource}:${refreshKey}`}
          scope={workspaceCfg.scope}
          initialSource={workspaceCfg.initialSource}
          hideSourceTabs
          initialTarget={initialTarget}
          knowledgeGroups={workspaceCfg.knowledgeGroups}
        />
      </div>

      <input
        ref={kbUploadRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void handleKbUpload(files);
        }}
      />

      <CuratorPanel
        open={curatorOpen}
        onClose={() => setCuratorOpen(false)}
        onTaskCompleted={handleTaskCompleted}
      />
    </section>
  );
}
