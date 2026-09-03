import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Checkbox, Spin, Empty } from "antd";
import { useTranslation } from "react-i18next";
import { ChevronLeft, MessageSquareText } from "lucide-react";
import { chatApi } from "../../../api/modules/chat";
import { useAgentStore } from "../../../stores/agentStore";
import { useAppMessage } from "../../../hooks/useAppMessage";
import { formatTime } from "../../Control/Sessions/components/constants";
import { buildChatPath } from "../../../utils/sessionRoute";
import styles from "./index.module.less";

/**
 * 会话历史页：展示某个智能体（或群聊）的全部历史会话。
 * 通过 URL 中的 :agentId 定位目标智能体，切换 selectedAgent 后，
 * 由 X-Agent-Id 请求头拉取该智能体名下的会话列表。
 */
function SessionsHistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();
  const { agents, selectedAgent, setSelectedAgent } = useAgentStore();
  const [sessions, setSessions] = useState<
    Array<{ id: string; name?: string; created_at?: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const { message, modal } = useAppMessage();

  const agent = useMemo(
    () => agents.find((a) => a.id === agentId),
    [agents, agentId],
  );

  useEffect(() => {
    if (agentId) setSelectedAgent(agentId);
  }, [agentId, setSelectedAgent]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await chatApi.listChats({
        archived: false,
        include_app_owned: false,
      });
      setSessions((data ?? []) as Array<{
        id: string;
        name?: string;
        created_at?: string;
      }>);
    } catch (error) {
      console.error("Failed to load session history:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    // selectedAgent 就绪后重新拉取，确保头部已切换为正确的智能体。
  }, [fetchSessions, selectedAgent, agentId]);

  const toggleSelecting = () => {
    setSelecting((prev) => !prev);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    sessions.length > 0 && selectedIds.size === sessions.length;

  const toggleSelectAll = () => {
    setSelectedIds(
      allSelected ? new Set() : new Set(sessions.map((s) => s.id)),
    );
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    modal.confirm({
      title: t("sessions.confirmDelete"),
      content: t("sessions.batchDeleteConfirm", { count: ids.length }),
      okText: t("common.delete"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: async () => {
        setDeleting(true);
        try {
          await chatApi.batchDeleteChats(ids);
          message.success(
            t("sessions.batchDeleteSuccess", { count: ids.length }),
          );
          setSelectedIds(new Set());
          setSelecting(false);
          await fetchSessions();
        } catch (error) {
          console.error("Failed to batch delete sessions:", error);
          message.error(t("sessions.batchDeleteFailed"));
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  const currentAgentName =
    agent?.name ||
    (agentId === selectedAgent
      ? agents.find((a) => a.id === selectedAgent)?.name
      : undefined) ||
    agentId ||
    "";

  return (
    <div className={styles.historyPage}>
      {/* 顶栏：返回 + 智能体名 + 会话数 */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => navigate(buildChatPath())}
          title={t("common.back", "返回")}
        >
          <ChevronLeft size={18} />
        </button>
        <div className={styles.headerText}>
          <span className={styles.title}>{currentAgentName}</span>
          <span className={styles.subtitle}>
            {t("sessions.history.subtitle", "对话历史")}
            {sessions.length > 0 ? ` · ${sessions.length}` : ""}
          </span>
        </div>
        {sessions.length > 0 && (
          <button
            type="button"
            className={styles.selectToggle}
            onClick={toggleSelecting}
          >
            {selecting
              ? t("common.cancel")
              : t("sessions.history.select", "选择")}
          </button>
        )}
      </div>

      {/* 多选工具栏 */}
      {selecting && (
        <div className={styles.selectionBar}>
          <Checkbox
            checked={allSelected}
            indeterminate={selectedIds.size > 0 && !allSelected}
            onChange={toggleSelectAll}
          >
            {t("sessions.history.selectAll", "全选")}
          </Checkbox>
          <span className={styles.selectedCount}>
            {t("sessions.selectedItems", { count: selectedIds.size })}
          </span>
          <Button
            danger
            size="small"
            disabled={selectedIds.size === 0}
            loading={deleting}
            onClick={handleBatchDelete}
          >
            {t("sessions.batchDeleteButton")} ({selectedIds.size})
          </Button>
        </div>
      )}

      {/* 会话列表 */}
      <div className={styles.list}>
        {loading ? (
          <div className={styles.loadingState}>
            <Spin size="small" />
          </div>
        ) : sessions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("sessions.history.empty", "暂无会话记录")}
          />
        ) : (
          sessions.map((session) => {
            const checked = selectedIds.has(session.id);
            return (
              <div
                key={session.id}
                className={`${styles.sessionItemWrap}${
                  selecting && checked ? ` ${styles.sessionItemSelected}` : ""
                }`}
              >
                {selecting && (
                  <Checkbox
                    className={styles.sessionCheckbox}
                    checked={checked}
                    onChange={() => toggleSelect(session.id)}
                  />
                )}
                <button
                  type="button"
                  className={styles.sessionItem}
                  onClick={() => {
                    if (selecting) toggleSelect(session.id);
                    else navigate(`/chat/${encodeURIComponent(session.id)}`);
                  }}
                >
                  <span className={styles.sessionIcon}>
                    <MessageSquareText size={15} />
                  </span>
                  <div className={styles.sessionInfo}>
                    <span className={styles.sessionName}>
                      {session.name || t("chat.newChat", "新对话")}
                    </span>
                    <span className={styles.sessionMeta}>
                      <span className={styles.sessionId}>
                        ID: {session.id}
                      </span>
                      {session.created_at && (
                        <span>{formatTime(session.created_at)}</span>
                      )}
                    </span>
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default SessionsHistoryPage;