import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Spin, Empty } from "antd";
import { useTranslation } from "react-i18next";
import { ChevronLeft, MessageSquareText } from "lucide-react";
import { chatApi } from "../../../api/modules/chat";
import { useAgentStore } from "../../../stores/agentStore";
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
      </div>

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
          sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={styles.sessionItem}
              onClick={() =>
                navigate(`/chat/${encodeURIComponent(session.id)}`)
              }
            >
              <span className={styles.sessionIcon}>
                <MessageSquareText size={15} />
              </span>
              <div className={styles.sessionInfo}>
                <span className={styles.sessionName}>
                  {session.name || t("chat.newChat", "新对话")}
                </span>
                <span className={styles.sessionMeta}>
                  <span className={styles.sessionId}>ID: {session.id}</span>
                  {session.created_at && (
                    <span>{formatTime(session.created_at)}</span>
                  )}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default SessionsHistoryPage;