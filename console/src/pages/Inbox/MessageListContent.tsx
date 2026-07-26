import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Empty,
  Button,
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
import { Filter } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { externalLinkMarkdownComponents } from "@/components/Markdown/externalLinkComponents";
import { PushMessageCard } from "./components";
import { useInboxData } from "./hooks/useInboxData";
import type { InboxFilters } from "./hooks/useInboxData";
import { useTraceViewer } from "./hooks/useTraceViewer";
import { useAgentStore } from "../../stores/agentStore";
import {
  DEFAULT_AGENT_ID,
  getAgentDisplayName,
} from "../../utils/agentDisplayName";
import {
  getDetailModalTitle,
  formatToolInput,
  formatToolBlockContent,
} from "./utils/traceUtils";
import styles from "./index.module.less";

const SOURCE_TYPES = ["heartbeat", "cron", "memory", "skill_autoupdate"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

const SOURCE_TYPE_LABEL_KEYS: Record<string, string> = {
  heartbeat: "inbox.sourceType.heartbeat",
  cron: "inbox.sourceType.cron",
  memory: "inbox.sourceType.memory",
  skill_autoupdate: "inbox.sourceType.skill_autoupdate",
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

const NOTIFICATION_SETTINGS_KEY = "aiarb.inbox.notificationSettings";
const PUSH_MESSAGES_PAGE_SIZE = 5;

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

interface MessageListContentProps {
  /** Agent ID — fixed by the Workbench. */
  agentId: string;
}

/**
 * MessageListContent — extracted from InboxPage (messages tab only).
 *
 * Contains: filter bar, notification settings panel, batch operations,
 * PushMessageCard list with pagination, and message detail Modal with
 * execution trace viewer.
 *
 * Does NOT include: PageHeader, Tabs (approvals/harvests), agent filter
 * (agent is fixed by the Workbench).
 *
 * Used by:
 *  - WorkbenchPage "事件" tab
 */
const MessageListContent: React.FC<MessageListContentProps> = ({ agentId }) => {
  const { t } = useTranslation();
  const [markAllReading, setMarkAllReading] = useState(false);
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

  const agents = useAgentStore((state) => state.agents);

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
      agentId,
      unreadOnly,
      excludedSourceTypes: blockedSourceTypes,
    }),
    [selectedSourceType, agentId, unreadOnly, blockedSourceTypes],
  );

  const {
    summary,
    pushMessages,
    markMessageAsRead,
    markAllMessagesAsRead,
    deleteMessage,
    deleteMessages,
  } = useInboxData(apiFilters);

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

  const agentDisplayNameById = useMemo(
    () =>
      new Map(agents.map((agent) => [agent.id, getAgentDisplayName(agent, t)])),
    [agents, t],
  );

  const filteredPushMessages = useMemo(() => {
    let result = pushMessages;
    // Filter by the Workbench's fixed agentId
    result = result.filter(
      (msg) =>
        (msg.metadata?.agentId || DEFAULT_AGENT_ID) === agentId,
    );
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
  }, [pushMessages, agentId, selectedPriority, notificationSettings]);

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
  }, [selectedSourceType, selectedPriority, unreadOnly]);

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

  return (
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

      {/* Message Detail Modal */}
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
                  const msgAgentId =
                    selectedMessage.metadata?.agentId || DEFAULT_AGENT_ID;
                  return (
                    agentDisplayNameById.get(msgAgentId) ||
                    (msgAgentId === DEFAULT_AGENT_ID
                      ? t("agent.defaultDisplayName")
                      : msgAgentId)
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
};

export default MessageListContent;
