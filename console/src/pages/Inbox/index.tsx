import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Tabs,
  Empty,
  Button,
  Badge,
  Collapse,
  Pagination,
  Checkbox,
  Popconfirm,
  message,
  Modal,
  Descriptions,
  Tag,
  Spin,
  Select,
  Switch,
  Tooltip,
} from "antd";
import {
  BulbOutlined,
  CopyOutlined,
  DownOutlined,
  SettingOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { PackageOpen, Bell, BellRing, Filter } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { externalLinkMarkdownComponents } from "@/components/Markdown/externalLinkComponents";
import { ApprovalCard as GlobalApprovalCard } from "../../components/ApprovalCard/ApprovalCard";
import { useApprovalContext } from "../../contexts/ApprovalContext";
import { useInboxWobble } from "../../hooks/useInboxWobble";
import { commandsApi } from "../../api/modules/commands";
import { chatApi } from "../../api/modules/chat";
import sessionApi from "../Chat/sessionApi";
import {
  PushMessageCard,
  ApprovalHistoryCard,
} from "./components";
import { useInboxData } from "./hooks/useInboxData";
import type { InboxFilters } from "./hooks/useInboxData";
import { useTraceViewer } from "./hooks/useTraceViewer";
import { useAgentStore } from "../../stores/agentStore";
import {
  DEFAULT_AGENT_ID,
  getAgentDisplayName,
} from "../../utils/agentDisplayName";
import type { ApprovalStatus } from "../../contexts/ApprovalContext";
import {
  getDetailModalTitle,
  formatToolInput,
  formatToolBlockContent,
} from "./utils/traceUtils";
import styles from "./index.module.less";

type TabKey = "approvals" | "messages";
type ApprovalSubTab = "pending" | "history";
const INBOX_TAB_STORAGE_KEY = "qwenpaw.inbox.activeTab";
const APPROVAL_SUB_TAB_KEY = "qwenpaw.inbox.approvalSubTab";
const APPROVAL_HISTORY_PAGE_SIZE = 5;
const NOTIFICATION_SETTINGS_KEY = "qwenpaw.inbox.notificationSettings";

const SOURCE_TYPES = ["heartbeat", "cron", "memory", "skill_autoupdate"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

const SOURCE_TYPE_LABEL_KEYS: Record<string, string> = {
  heartbeat: "inbox.sourceType.heartbeat",
  cron: "inbox.sourceType.cron",
  memory: "inbox.sourceType.memory",
  skill_autoupdate: "inbox.sourceType.skillAutoupdate",
};

interface NotificationSettings {
  mutedSources: Record<SourceType, boolean>;
  blockedSources: Record<SourceType, boolean>;
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  mutedSources: {
    heartbeat: false,
    cron: false,
    memory: false,
    skill_autoupdate: false,
  },
  blockedSources: {
    heartbeat: false,
    cron: false,
    memory: false,
    skill_autoupdate: false,
  },
};

const loadNotificationSettings = (): NotificationSettings => {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATION_SETTINGS;
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      mutedSources: {
        ...DEFAULT_NOTIFICATION_SETTINGS.mutedSources,
        ...(parsed.mutedSources || {}),
      },
      blockedSources: {
        ...DEFAULT_NOTIFICATION_SETTINGS.blockedSources,
        ...(parsed.blockedSources || {}),
      },
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
};

const saveNotificationSettings = (settings: NotificationSettings) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
};
const PUSH_MESSAGES_PAGE_SIZE = 5;

const resolveInitialTab = (): TabKey => {
  if (typeof window === "undefined") {
    return "messages";
  }
  const stored = window.localStorage.getItem(INBOX_TAB_STORAGE_KEY);
  if (stored === "approvals" || stored === "messages") {
    return stored;
  }
  return "messages";
};

const renderMarkdownText = (text: string, className: string) => (
  <div className={className}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={externalLinkMarkdownComponents}
    >
      {text}
    </ReactMarkdown>
  </div>
);

export default function InboxPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>(resolveInitialTab);
  const [markAllReading, setMarkAllReading] = useState(false);
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<
    string | undefined
  >(undefined);
  const [selectedSourceType, setSelectedSourceType] = useState<
    string | undefined
  >(undefined);
  const [selectedPriority, setSelectedPriority] = useState<
    string | undefined
  >(undefined);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(
    loadNotificationSettings,
  );
  const [messagesPage, setMessagesPage] = useState(1);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [approvalSubTab, setApprovalSubTab] = useState<ApprovalSubTab>(() => {
    if (typeof window === "undefined") return "pending";
    const stored = window.localStorage.getItem(APPROVAL_SUB_TAB_KEY);
    if (stored === "pending" || stored === "history") return stored;
    return "pending";
  });
  const [approvalAgentFilter, setApprovalAgentFilter] = useState<
    string | undefined
  >(undefined);
  const [approvalSeverityFilter, setApprovalSeverityFilter] = useState<
    string | undefined
  >(undefined);
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<
    string | undefined
  >(undefined);
  const [historyPage, setHistoryPage] = useState(1);
  const agents = useAgentStore((state) => state.agents);
  const [wobbleEnabled, toggleWobble] = useInboxWobble();
  const {
    approvals: pendingApprovals,
    setApprovals,
    approvalHistory,
    moveToHistory,
    clearHistory,
  } = useApprovalContext();

  const blockedSourceTypes = useMemo(() => {
    const blocked: string[] = [];
    for (const st of SOURCE_TYPES) {
      if (notificationSettings.blockedSources[st]) {
        blocked.push(st);
      }
    }
    return blocked;
  }, [notificationSettings.blockedSources]);

  const apiFilters: InboxFilters = useMemo(
    () => ({
      sourceType: selectedSourceType,
      agentId: selectedAgentFilter,
      unreadOnly,
      excludedSourceTypes: blockedSourceTypes,
    }),
    [selectedSourceType, selectedAgentFilter, unreadOnly, blockedSourceTypes],
  );
  const {
    summary,
    pushMessages,
    markMessageAsRead,
    markAllMessagesAsRead,
    deleteMessage,
    deleteMessages,
  } = useInboxData(apiFilters);
  const agentDisplayNameById = useMemo(
    () =>
      new Map(agents.map((agent) => [agent.id, getAgentDisplayName(agent, t)])),
    [agents, t],
  );
  const filteredPushMessages = useMemo(() => {
    let result = pushMessages;
    if (selectedAgentFilter) {
      result = result.filter(
        (message) =>
          (message.metadata?.agentId || DEFAULT_AGENT_ID) ===
          selectedAgentFilter,
      );
    }
    if (selectedPriority) {
      result = result.filter(
        (message) => message.metadata?.priority === selectedPriority,
      );
    }
    result = result.filter((message) => {
      const st = message.metadata?.sourceType as SourceType | undefined;
      if (!st) return true;
      return !notificationSettings.mutedSources[st];
    });
    return result;
  }, [pushMessages, selectedAgentFilter, selectedPriority, notificationSettings]);
  const pushMessageAgentOptions = useMemo(() => {
    const ids = new Set<string>(
      filteredPushMessages.map(
        (message) => message.metadata?.agentId || DEFAULT_AGENT_ID,
      ),
    );
    pushMessages.forEach((message) => {
      ids.add(message.metadata?.agentId || DEFAULT_AGENT_ID);
    });
    const options = Array.from(ids)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({
        value: id,
        label:
          agentDisplayNameById.get(id) ||
          (id === DEFAULT_AGENT_ID ? t("agent.defaultDisplayName") : id),
      }));
    return options;
  }, [agentDisplayNameById, filteredPushMessages, pushMessages, t]);
const sourceTypeOptions = useMemo(() => {
    const types = new Set<string>(
      pushMessages
        .map((m) => m.metadata?.sourceType)
        .filter((v): v is string => Boolean(v)),
    );
    return Array.from(types)
      .sort((a, b) => a.localeCompare(b))
      .map((type) => ({
        value: type,
        label: t(SOURCE_TYPE_LABEL_KEYS[type] || type),
      }));
  }, [pushMessages, t]);

  const priorityOptions = useMemo(
    () =>
      (["low", "normal", "high", "urgent"] as const).map((p) => ({
        value: p,
        label: t(`inbox.priority.${p}`),
      })),
    [t],
  );

  const approvalAgentOptions = useMemo(() => {
    const ids = new Set<string>();
    pendingApprovals.forEach((a) => ids.add(a.agent_id));
    approvalHistory.forEach((a) => ids.add(a.agent_id));
    return Array.from(ids)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({
        value: id,
        label:
          agentDisplayNameById.get(id) ||
          (id === DEFAULT_AGENT_ID ? t("agent.defaultDisplayName") : id),
      }));
  }, [agentDisplayNameById, pendingApprovals, approvalHistory, t]);

  const approvalSeverityOptions = useMemo(
    () =>
      (["low", "medium", "high", "critical"] as const).map((s) => ({
        value: s,
        label: t(`inbox.approvalSeverity.${s}`, s.toUpperCase()),
      })),
    [t],
  );

  const approvalStatusOptions = useMemo(
    () =>
      (
        ["approved", "denied", "timeout", "cancelled", "superseded"] as ApprovalStatus[]
      ).map((s) => ({
        value: s,
        label: t(`approval.status${s.charAt(0).toUpperCase() + s.slice(1)}`, s),
      })),
    [t],
  );

  const filteredApprovalHistory = useMemo(() => {
    let result = [...approvalHistory].reverse();
    if (approvalAgentFilter) {
      result = result.filter((item) => item.agent_id === approvalAgentFilter);
    }
    if (approvalSeverityFilter) {
      result = result.filter(
        (item) => item.severity.toLowerCase() === approvalSeverityFilter.toLowerCase(),
      );
    }
    if (approvalStatusFilter) {
      result = result.filter(
        (item) => item.resolvedStatus === approvalStatusFilter,
      );
    }
    return result;
  }, [approvalHistory, approvalAgentFilter, approvalSeverityFilter, approvalStatusFilter]);

  const totalHistoryPages = Math.max(
    1,
    Math.ceil(filteredApprovalHistory.length / APPROVAL_HISTORY_PAGE_SIZE),
  );

  const pagedApprovalHistory = useMemo(() => {
    const start = (historyPage - 1) * APPROVAL_HISTORY_PAGE_SIZE;
    return filteredApprovalHistory.slice(start, start + APPROVAL_HISTORY_PAGE_SIZE);
  }, [filteredApprovalHistory, historyPage]);

  const handleToggleMute = useCallback(
    (source: SourceType, checked: boolean) => {
      const next: NotificationSettings = {
        ...notificationSettings,
        mutedSources: {
          ...notificationSettings.mutedSources,
          [source]: checked,
        },
      };
      setNotificationSettings(next);
      saveNotificationSettings(next);
    },
    [notificationSettings],
  );

  const handleToggleBlock = useCallback(
    (source: SourceType, checked: boolean) => {
      const next: NotificationSettings = {
        ...notificationSettings,
        blockedSources: {
          ...notificationSettings.blockedSources,
          [source]: checked,
        },
      };
      setNotificationSettings(next);
      saveNotificationSettings(next);
    },
    [notificationSettings],
  );
  const urgentApprovalCount = useMemo(
    () =>
      pendingApprovals.filter((item) =>
        ["high", "critical"].includes(item.severity?.toLowerCase?.() || ""),
      ).length,
    [pendingApprovals],
  );
  const approvalCount = pendingApprovals.length;
  const pagedPushMessages = useMemo(() => {
    const start = (messagesPage - 1) * PUSH_MESSAGES_PAGE_SIZE;
    return filteredPushMessages.slice(start, start + PUSH_MESSAGES_PAGE_SIZE);
  }, [filteredPushMessages, messagesPage]);
  const currentPageMessageIds = useMemo(
    () => pagedPushMessages.map((item) => item.id),
    [pagedPushMessages],
  );
  const allCurrentPageSelected = useMemo(
    () =>
      currentPageMessageIds.length > 0 &&
      currentPageMessageIds.every((id) => selectedMessageIds.includes(id)),
    [currentPageMessageIds, selectedMessageIds],
  );
  const totalMessagePages = Math.max(
    1,
    Math.ceil(filteredPushMessages.length / PUSH_MESSAGES_PAGE_SIZE),
  );

  const handleApproveRequest = async (
    requestId: string,
    rootSessionId: string,
    scope?: "exact" | "similar",
  ) => {
    await commandsApi.sendApprovalCommand(
      "approve",
      requestId,
      rootSessionId,
      undefined,
      scope,
    );
    moveToHistory(requestId, "approved", scope);
    message.success(t("approval.approved"));
  };

  const handleRejectRequest = async (
    requestId: string,
    rootSessionId: string,
  ) => {
    await commandsApi.sendApprovalCommand("deny", requestId, rootSessionId);
    moveToHistory(requestId, "denied");
    message.success(t("approval.denied"));
  };

  const handleCancelTask = async (rootSessionId: string) => {
    const resolvedChatId =
      sessionApi.getRealIdForSession(rootSessionId) ?? rootSessionId;
    await chatApi.stopChat(resolvedChatId);
    const cancelledIds = pendingApprovals
      .filter((item) => item.root_session_id === rootSessionId)
      .map((item) => item.request_id);
    for (const rid of cancelledIds) {
      moveToHistory(rid, "cancelled");
    }
  };
  const {
    detailOpen,
    selectedMessage,
    traceLoading,
    traceEvents,
    expandedTraceMap,
    traceContainerRef,
    openMessageDetail,
    closeDetail,
    toggleTracePanel,
    copyTraceBlock,
    handleTraceScroll,
  } = useTraceViewer(markMessageAsRead);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(INBOX_TAB_STORAGE_KEY, activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(APPROVAL_SUB_TAB_KEY, approvalSubTab);
    }
  }, [approvalSubTab]);

  useEffect(() => {
    if (messagesPage > totalMessagePages) {
      setMessagesPage(totalMessagePages);
    }
  }, [messagesPage, totalMessagePages]);

  useEffect(() => {
    const validIdSet = new Set(pushMessages.map((item) => item.id));
    setSelectedMessageIds((prev) => prev.filter((id) => validIdSet.has(id)));
  }, [pushMessages]);

  useEffect(() => {
    setMessagesPage(1);
  }, [selectedAgentFilter, selectedSourceType, selectedPriority, unreadOnly]);

  useEffect(() => {
    setHistoryPage(1);
  }, [approvalAgentFilter, approvalSeverityFilter, approvalStatusFilter]);

  useEffect(() => {
    if (historyPage > totalHistoryPages) {
      setHistoryPage(totalHistoryPages);
    }
  }, [historyPage, totalHistoryPages]);

  const handleViewMessage = (messageId: string) => {
    const found = pushMessages.find((item) => item.id === messageId);
    if (!found) {
      message.warning(t("inbox.messageNotFound"));
      return;
    }
    openMessageDetail(found);
  };

  const handleMarkAllRead = async () => {
    if (summary.pushMessages.unread <= 0) {
      message.info(t("inbox.markAllReadNoUnread"));
      return;
    }
    setMarkAllReading(true);
    try {
      const updated = await markAllMessagesAsRead();
      message.success(t("inbox.markAllReadSuccess", { count: updated }));
    } catch {
      message.error(t("common.operationFailed"));
    } finally {
      setMarkAllReading(false);
    }
  };

  const handleToggleMessageSelection = (
    messageId: string,
    checked: boolean,
  ) => {
    setSelectedMessageIds((prev) => {
      if (checked) {
        if (prev.includes(messageId)) return prev;
        return [...prev, messageId];
      }
      return prev.filter((id) => id !== messageId);
    });
  };

  const handleToggleSelectCurrentPage = (checked: boolean) => {
    setSelectedMessageIds((prev) => {
      const pageSet = new Set(currentPageMessageIds);
      if (checked) {
        const merged = new Set(prev);
        currentPageMessageIds.forEach((id) => merged.add(id));
        return Array.from(merged);
      }
      return prev.filter((id) => !pageSet.has(id));
    });
  };

  const handleBatchDeleteMessages = async () => {
    if (!selectedMessageIds.length) return;
    const deletedCount = await deleteMessages(selectedMessageIds);
    setSelectedMessageIds([]);
    if (deletedCount > 0) {
      message.success(t("inbox.batchDeleteSuccess", { count: deletedCount }));
    }
  };

  const tabItems = [
    {
      key: "messages",
      label: (
        <span className={styles.tabLabel}>
          <Bell size={16} />
          {t("inbox.tabPushMessages")}
          {summary.pushMessages.unread > 0 && (
            <Badge count={summary.pushMessages.unread} color="#4B3FE3" />
          )}
        </span>
      ),
      children: (
        <div className={styles.tabContent}>
          <div className={styles.messagesToolbar}>
            <div className={styles.filterRow}>
              <Filter size={14} className={styles.filterIcon} />
              <Select
                size="small"
                value={selectedSourceType}
                onChange={(value) => setSelectedSourceType(value)}
                allowClear
                options={sourceTypeOptions}
                style={{ width: 140 }}
                placeholder={t("inbox.filterBySource")}
              />
              <Select
                size="small"
                value={selectedAgentFilter}
                onChange={(value) => setSelectedAgentFilter(value)}
                allowClear
                options={pushMessageAgentOptions}
                style={{ width: 160 }}
                placeholder={t("inbox.filterByAgent")}
              />
              <Select
                size="small"
                value={selectedPriority}
                onChange={(value) => setSelectedPriority(value)}
                allowClear
                options={priorityOptions}
                style={{ width: 120 }}
                placeholder={t("inbox.filterByPriority")}
              />
              <Tooltip title={t("inbox.unreadOnly")}>
                <Switch
                  size="small"
                  checked={unreadOnly}
                  onChange={setUnreadOnly}
                />
              </Tooltip>
              <Tooltip title={t("inbox.notificationSettings")}>
                <Button
                  size="small"
                  type={settingsOpen ? "primary" : "default"}
                  icon={<SettingOutlined />}
                  onClick={() => setSettingsOpen((prev) => !prev)}
                />
              </Tooltip>
            </div>
            <div className={styles.messagesSelectionTools}>
              {batchMode ? (
                <>
                  <Checkbox
                    checked={allCurrentPageSelected}
                    onChange={(event) =>
                      handleToggleSelectCurrentPage(event.target.checked)
                    }
                    disabled={currentPageMessageIds.length <= 0}
                  >
                    {t("inbox.selectAllCurrentPage")}
                  </Checkbox>
                  <span className={styles.selectedCountText}>
                    {t("inbox.selectedItems", {
                      count: selectedMessageIds.length,
                    })}
                  </span>
                  <Popconfirm
                    title={t("inbox.batchDeleteConfirm", {
                      count: selectedMessageIds.length,
                    })}
                    onConfirm={() => void handleBatchDeleteMessages()}
                    okText={t("common.confirm")}
                    cancelText={t("common.cancel")}
                    disabled={selectedMessageIds.length <= 0}
                  >
                    <Button danger disabled={selectedMessageIds.length <= 0}>
                      {t("inbox.batchDeleteButton")}
                    </Button>
                  </Popconfirm>
                  <Button
                    onClick={() => {
                      setBatchMode(false);
                      setSelectedMessageIds([]);
                    }}
                  >
                    {t("inbox.exitBatch")}
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => setBatchMode(true)}>
                    {t("inbox.batchOperation")}
                  </Button>
                  <Button
                    onClick={() => void handleMarkAllRead()}
                    loading={markAllReading}
                    disabled={summary.pushMessages.unread <= 0}
                  >
                    {t("inbox.markAllRead")}
                  </Button>
                </>
              )}
            </div>
          </div>
          {settingsOpen && (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsTitle}>
                {t("inbox.notificationSettings")}
              </div>
              <div className={styles.settingsSection}>
                <div className={styles.settingsSectionTitle}>
                  {t("inbox.muteSettings")}
                </div>
                <div className={styles.settingsSectionDesc}>
                  {t("inbox.muteSettingsDesc")}
                </div>
                <div className={styles.settingsGrid}>
                  {SOURCE_TYPES.map((source) => (
                    <div key={source} className={styles.settingsItem}>
                      <Switch
                        size="small"
                        checked={notificationSettings.mutedSources[source]}
                        onChange={(checked) =>
                          handleToggleMute(source, checked)
                        }
                      />
                      <span className={styles.settingsItemLabel}>
                        {t(`inbox.sourceType.${source}`)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.settingsSection}>
                <div className={styles.settingsSectionTitle}>
                  {t("inbox.blockSettings")}
                </div>
                <div className={styles.settingsSectionDesc}>
                  {t("inbox.blockSettingsDesc")}
                </div>
                <div className={styles.settingsGrid}>
                  {SOURCE_TYPES.map((source) => (
                    <div key={source} className={styles.settingsItem}>
                      <Switch
                        size="small"
                        checked={notificationSettings.blockedSources[source]}
                        onChange={(checked) =>
                          handleToggleBlock(source, checked)
                        }
                      />
                      <span className={styles.settingsItemLabel}>
                        {t(`inbox.sourceType.${source}`)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {filteredPushMessages.length > 0 ? (
            <div className={styles.cardList}>
              {pagedPushMessages.map((item) => (
                <PushMessageCard
                  key={item.id}
                  message={item}
                  onMarkAsRead={markMessageAsRead}
                  onDelete={deleteMessage}
                  onView={handleViewMessage}
                  selected={selectedMessageIds.includes(item.id)}
                  onSelectChange={
                    batchMode ? handleToggleMessageSelection : undefined
                  }
                />
              ))}
              <div className={styles.paginationWrap}>
                <Pagination
                  current={messagesPage}
                  total={filteredPushMessages.length}
                  pageSize={PUSH_MESSAGES_PAGE_SIZE}
                  onChange={setMessagesPage}
                  showSizeChanger={false}
                />
              </div>
            </div>
          ) : (
            <Empty description={t("inbox.emptyPush")} />
          )}
        </div>
      ),
    },
    {
      key: "approvals",
      label: (
        <span className={styles.tabLabel}>
          <PackageOpen size={16} />
          {t("inbox.tabApprovals")}
{urgentApprovalCount > 0 && (
            <Badge count={urgentApprovalCount} color="#4B3FE3" />
          )}
          {approvalCount > 0 && <Badge count={approvalCount} color="#ff7f16" />}
        </span>
      ),
      children: (
        <div className={styles.tabContent}>
          <div className={styles.approvalSubTabs}>
            <Button
              size="small"
              type={approvalSubTab === "pending" ? "primary" : "default"}
              onClick={() => setApprovalSubTab("pending")}
            >
              {t("inbox.approvalPending")}
              {pendingApprovals.length > 0 && (
                <Badge
                  count={pendingApprovals.length}
                  size="small"
                  color="#4B3FE3"
                  style={{ marginLeft: 6 }}
                />
              )}
            </Button>
            <Button
              size="small"
              type={approvalSubTab === "history" ? "primary" : "default"}
              onClick={() => setApprovalSubTab("history")}
            >
              {t("inbox.approvalHistory")}
              {approvalHistory.length > 0 && (
                <Badge
                  count={approvalHistory.length}
                  size="small"
                  style={{ marginLeft: 6 }}
                />
              )}
            </Button>
          </div>

          {approvalSubTab === "pending" ? (
            pendingApprovals.length > 0 ? (
              <div className={styles.cardList}>
                {pendingApprovals.map((approval) => (
                  <GlobalApprovalCard
                    key={approval.request_id}
                    requestId={approval.request_id}
                    agentId={approval.agent_id}
                    ownerAgentId={approval.owner_agent_id}
                    showInboxAgentContext
                    toolName={approval.tool_display_name || approval.tool_name}
                    toolSource={approval.tool_source}
                    severity={approval.severity}
                    findingsCount={approval.findings_count}
                    findingsSummary={approval.findings_summary}
                    toolParams={approval.tool_params}
                    createdAt={approval.created_at}
                    timeoutSeconds={approval.timeout_seconds}
                    sessionId={approval.session_id}
                    rootSessionId={approval.root_session_id}
                    isGeneralized={approval.is_generalized}
                    exactTarget={approval.exact_target}
                    similarTarget={approval.similar_target}
                    onApprove={(_reqId, scope) =>
                      handleApproveRequest(
                        approval.request_id,
                        approval.root_session_id,
                        scope,
                      )
                    }
                    onDeny={() =>
                      handleRejectRequest(
                        approval.request_id,
                        approval.root_session_id,
                      )
                    }
                    onCancel={() => {
                      void handleCancelTask(approval.root_session_id);
                    }}
                    onAcknowledge={(requestId) => {
                      return commandsApi
                        .sendApprovalCommand(
                          "deny",
                          requestId,
                          approval.root_session_id,
                        )
                        .catch(() => undefined)
                        .then(() => {
                          moveToHistory(requestId, "denied");
                        });
                    }}
                  />
                ))}
              </div>
            ) : (
              <Empty description={t("inbox.emptyApprovals")} />
            )
          ) : (
            <>
              <div className={styles.messagesToolbar}>
                <div className={styles.filterRow}>
                  <Filter size={14} className={styles.filterIcon} />
                  <Select
                    size="small"
                    value={approvalAgentFilter}
                    onChange={(value) => setApprovalAgentFilter(value)}
                    allowClear
                    options={approvalAgentOptions}
                    style={{ width: 160 }}
                    placeholder={t("inbox.filterByAgent")}
                  />
                  <Select
                    size="small"
                    value={approvalSeverityFilter}
                    onChange={(value) => setApprovalSeverityFilter(value)}
                    allowClear
                    options={approvalSeverityOptions}
                    style={{ width: 130 }}
                    placeholder={t("inbox.filterBySeverity")}
                  />
                  <Select
                    size="small"
                    value={approvalStatusFilter}
                    onChange={(value) => setApprovalStatusFilter(value)}
                    allowClear
                    options={approvalStatusOptions}
                    style={{ width: 120 }}
                    placeholder={t("inbox.filterByStatus")}
                  />
                  {approvalHistory.length > 0 && (
                    <Popconfirm
                      title={t("inbox.clearHistoryConfirm")}
                      onConfirm={() => clearHistory()}
                      okText={t("common.confirm")}
                      cancelText={t("common.cancel")}
                    >
                      <Button size="small" danger>
                        {t("inbox.clearHistory")}
                      </Button>
                    </Popconfirm>
                  )}
                </div>
              </div>
              {filteredApprovalHistory.length > 0 ? (
                <div className={styles.cardList}>
                  {pagedApprovalHistory.map((item) => (
                    <ApprovalHistoryCard key={item.request_id} item={item} />
                  ))}
                  <div className={styles.paginationWrap}>
                    <Pagination
                      current={historyPage}
                      total={filteredApprovalHistory.length}
                      pageSize={APPROVAL_HISTORY_PAGE_SIZE}
                      onChange={setHistoryPage}
                      showSizeChanger={false}
                    />
                  </div>
                </div>
              ) : (
                <Empty description={t("inbox.emptyApprovalHistory")} />
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.inboxPage}>
      <PageHeader items={[{ title: t("inbox.title") }]} extra={null} />

      <div className={styles.pageContent}>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
          items={tabItems}
          className={styles.inboxTabs}
          tabBarExtraContent={
            <Tooltip
              title={t(
                wobbleEnabled ? "inbox.wobbleDisable" : "inbox.wobbleEnable",
              )}
            >
              <Button
                type="text"
                size="small"
                icon={<BellRing size={16} />}
                onClick={toggleWobble}
                className={
                  wobbleEnabled ? styles.wobbleToggleActive : undefined
                }
              />
            </Tooltip>
          }
        />
      </div>
      <Modal
        open={detailOpen}
        onCancel={closeDetail}
        footer={null}
        width={820}
        title={getDetailModalTitle(selectedMessage, t)}
      >
        {selectedMessage ? (
          <div className={styles.messageDetail}>
            <Descriptions
              size="small"
              column={2}
              bordered
              className={styles.messageDetailMeta}
            >
              <Descriptions.Item label={t("inbox.detailStatus")}>
                <Tag
                  color={
                    selectedMessage.metadata?.status === "error"
                      ? "error"
                      : "success"
                  }
                >
                  {selectedMessage.metadata?.status || "success"}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("inbox.detailAgent")}>
                {(() => {
                  const agentId =
                    selectedMessage.metadata?.agentId || DEFAULT_AGENT_ID;
                  return (
                    agentDisplayNameById.get(agentId) ||
                    (agentId === DEFAULT_AGENT_ID
                      ? t("agent.defaultDisplayName")
                      : agentId)
                  );
                })()}
              </Descriptions.Item>
              <Descriptions.Item label={t("inbox.detailReceivedAt")}>
                {selectedMessage.createdAt.toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label={t("inbox.detailTaskId")}>
                {selectedMessage.id || "-"}
              </Descriptions.Item>
            </Descriptions>

            <div className={styles.messageDetailBlock}>
              <div className={styles.messageDetailLabel}>
                {t("inbox.detailExecutionTrace")}
              </div>
              {traceLoading ? (
                <div className={styles.traceLoading}>
                  <Spin size="small" />
                </div>
              ) : traceEvents.length > 0 ? (
                <div
                  ref={traceContainerRef as React.RefObject<HTMLDivElement>}
                  className={styles.traceContainer}
                  onScroll={(event) => {
                    handleTraceScroll(event.currentTarget.scrollTop);
                  }}
                >
                  <div className={styles.traceTimeline}>
                    {traceEvents.map((item, index) => {
                      const {
                        eventRecord,
                        eventType,
                        traceText,
                        collapsible,
                        collapseTitle,
                      } = item;
                      const kind = eventType;
                      const foldIcon = kind
                        .toLowerCase()
                        .includes("thinking") ? (
                        <BulbOutlined />
                      ) : kind.toLowerCase().includes("tool") ? (
                        <ToolOutlined />
                      ) : null;
                      const collapseKey = `trace-${item.at}-${index}`;
                      const isPanelActive = !!expandedTraceMap[collapseKey];
                      return (
                        <div
                          key={`${item.at}-${index}`}
                          className={styles.traceEntry}
                        >
                          {eventRecord.role === "user" && traceText ? (
                            <div className={styles.traceUserRow}>
                              <div className={styles.traceUserMessage}>
                                {traceText}
                              </div>
                            </div>
                          ) : kind === "push_preview" && traceText ? (
                            renderMarkdownText(
                              traceText,
                              `${styles.traceAssistantMessage} ${styles.traceStandaloneAligned}`,
                            )
                          ) : collapsible ? (
                            <Collapse
                              bordered={false}
                              ghost
                              activeKey={isPanelActive ? [collapseKey] : []}
                              onChange={(keys) => {
                                const nextActive = Array.isArray(keys)
                                  ? keys.length > 0
                                  : Boolean(keys);
                                toggleTracePanel(collapseKey, nextActive);
                              }}
                              className={`${styles.traceCollapse} ${
                                isPanelActive ? styles.traceCollapseActive : ""
                              }`}
                              expandIcon={() => null}
                              items={[
                                {
                                  key: collapseKey,
                                  label: (
                                    <div className={styles.traceFoldHeader}>
                                      {foldIcon ? (
                                        <span className={styles.traceFoldIcon}>
                                          {foldIcon}
                                        </span>
                                      ) : null}
                                      <span className={styles.traceFoldTitle}>
                                        {collapseTitle}
                                      </span>
                                      <span
                                        className={`${
                                          styles.traceInlineChevron
                                        } ${
                                          isPanelActive
                                            ? styles.traceInlineChevronActive
                                            : ""
                                        }`}
                                      >
                                        <DownOutlined />
                                      </span>
                                    </div>
                                  ),
                                  children:
                                    item.renderKind === "tool_pair" ? (
                                      <div className={styles.toolDetailWrap}>
                                        {item.toolInput ? (
                                          <div className={styles.toolSection}>
                                            <div
                                              className={styles.traceCodeHeader}
                                            >
                                              <div
                                                className={
                                                  styles.traceCodeTitle
                                                }
                                              >
                                                Input
                                              </div>
                                              <button
                                                type="button"
                                                className={
                                                  styles.traceCodeCopyBtn
                                                }
                                                onClick={() =>
                                                  void copyTraceBlock(
                                                    formatToolBlockContent(
                                                      formatToolInput(
                                                        item.toolInput || "",
                                                      ),
                                                    ),
                                                  )
                                                }
                                                title={t("common.copy")}
                                              >
                                                <CopyOutlined />
                                              </button>
                                            </div>
                                            <pre
                                              className={styles.toolCodeBlock}
                                            >
                                              {formatToolBlockContent(
                                                formatToolInput(item.toolInput),
                                              )}
                                            </pre>
                                          </div>
                                        ) : null}
                                        {item.toolOutput ? (
                                          <div className={styles.toolSection}>
                                            <div
                                              className={styles.traceCodeHeader}
                                            >
                                              <div
                                                className={
                                                  styles.traceCodeTitle
                                                }
                                              >
                                                Output
                                              </div>
                                              <button
                                                type="button"
                                                className={
                                                  styles.traceCodeCopyBtn
                                                }
                                                onClick={() =>
                                                  void copyTraceBlock(
                                                    formatToolBlockContent(
                                                      item.toolOutput || "",
                                                    ),
                                                  )
                                                }
                                                title={t("common.copy")}
                                              >
                                                <CopyOutlined />
                                              </button>
                                            </div>
                                            <pre
                                              className={styles.toolCodeBlock}
                                            >
                                              {formatToolBlockContent(
                                                item.toolOutput,
                                              )}
                                            </pre>
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : traceText ? (
                                      renderMarkdownText(
                                        traceText,
                                        styles.traceMarkdownBlock,
                                      )
                                    ) : (
                                      <pre className={styles.traceJsonBlock}>
                                        {JSON.stringify(eventRecord, null, 2)}
                                      </pre>
                                    ),
                                },
                              ]}
                            />
                          ) : traceText ? (
                            renderMarkdownText(
                              traceText,
                              `${styles.traceMarkdownBlock} ${styles.traceStandaloneAligned}`,
                            )
                          ) : (
                            <pre
                              className={`${styles.traceJsonBlock} ${styles.traceStandaloneAligned}`}
                            >
                              {JSON.stringify(eventRecord, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className={styles.traceEmpty}>
                  {t("inbox.detailTraceEmpty")}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}