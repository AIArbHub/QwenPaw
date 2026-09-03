import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getSessionIdFromPath,
  CHAT_BASE_PATH,
  buildChatPath,
} from "../../utils/sessionRoute";
import {
  useSessionTabsStore,
  isPlaceholderTitle,
  DEFAULT_TITLE,
  type SessionTab,
} from "../../stores/sessionTabsStore";
import { useSessionListStore } from "../../stores/sessionListStore";
import { useAgentStore } from "../../stores/agentStore";
import CrossAgentSessionPicker from "../CrossAgentSessionPicker";
import styles from "./index.module.less";

/**
 * Resolve the effective library session id for a given chatId (matches
 * displayId ↔ realId ↔ backend sessionId), so titles stay consistent.
 */
function resolveSessionId(session: {
  id?: string;
  realId?: string;
  sessionId?: string;
}): string | undefined {
  return session.id || session.realId || session.sessionId;
}

/**
 * ChatTabsBar — 右侧内容列的浏览器风格标签栏。
 *
 * URL 驱动：活跃标签页由路由器所在的 `/chat/:chatId` 决定。
 * 打开聊天（从中层面板或其他位置）通过 URL 注册标签页；
 * 点击标签页导航；关闭活跃标签页导航到邻居。由于聊天运行时
 * 在导航时卸载，被切走会话的后台工作通过现有的后台队列继续。
 *
 * 在非 chat 路由下不渲染任何内容。
 */
export default function ChatTabsBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const tabs = useSessionTabsStore((s) => s.tabs);
  const openTab = useSessionTabsStore((s) => s.openTab);
  const updateTitle = useSessionTabsStore((s) => s.updateTitle);
  const closeTab = useSessionTabsStore((s) => s.closeTab);
  const neighborAfterClose = useSessionTabsStore((s) => s.neighborAfterClose);

  const sessions = useSessionListStore((s) => s.sessions);

  const isChatPath = location.pathname.startsWith("/chat");
  const currentChatId = getSessionIdFromPath(location.pathname);

  // A stable map: chatId → display title from the global session list.
  const titleByChatId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      const id = resolveSessionId(s);
      if (id && s.name) map.set(id, s.name);
    }
    return map;
  }, [sessions]);

  // Register a tab whenever the URL points at a real chat session.
  useEffect(() => {
    if (!currentChatId) return;
    openTab(currentChatId, titleByChatId.get(currentChatId));
  }, [currentChatId, openTab, titleByChatId]);

  // Keep titles in sync with the session list (e.g. after a rename).
  //
  // Rule: only *upgrade* an unnamed placeholder to a real session name, and
  // never overwrite a stored real title. The session list is bound to the
  // currently selected agent, so once you switch agents, tabs belonging to
  // other agents must keep their persisted title instead of being clobbered.
  useEffect(() => {
    if (sessions.length === 0 || tabs.length === 0) return;
    for (const s of sessions) {
      const id = resolveSessionId(s);
      if (!id || !s.name) continue;
      const tab = tabs.find((tb) => tb.chatId === id);
      if (tab && isPlaceholderTitle(tab.title) && tab.title !== s.name) {
        updateTitle(id, s.name);
      }
    }
  }, [sessions, tabs, updateTitle]);

  if (!isChatPath) return null;

  const handleSelect = (chatId: string) => {
    if (chatId === currentChatId) return;
    navigate(buildChatPath(chatId));
  };

  const handleClose = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    const neighbor = neighborAfterClose(chatId);
    closeTab(chatId);
    if (chatId === currentChatId) {
      navigate(neighbor ? buildChatPath(neighbor) : CHAT_BASE_PATH);
    }
  };

  const handleNewChat = () => {
    // ChatSessionInitializer (already mounted on the chat page) listens for
    // this event and creates a new blank session.
    window.dispatchEvent(new CustomEvent("aiarb:sidebar-new-chat"));
  };

  // M-A1-2: Cross-agent session picker — open an existing session from any
  // agent directly in the /chat tab bar. Selecting a session switches the
  // agent and navigates to the chat.
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const handlePickSession = (chatId: string, agentId: string) => {
    setSelectedAgent(agentId);
    navigate(buildChatPath(chatId));
  };

  const renderTitle = (tab: SessionTab) => {
    // The stored title is authoritative (persisted per chatId). Only fall
    // back to the live per-agent session list for unnamed placeholders, so a
    // real title survives switching agents.
    const stored = tab.title?.trim();
    if (!isPlaceholderTitle(stored)) return stored ?? DEFAULT_TITLE;
    const live = titleByChatId.get(tab.chatId);
    return live ?? stored ?? DEFAULT_TITLE;
  };

  return (
    <div className={styles.chatTabsBar} data-testid="chat-tabs-bar">
      {tabs.map((tab) => (
        <button
          key={tab.chatId}
          type="button"
          className={`${styles.tabItem}${
            tab.chatId === currentChatId ? ` ${styles.tabItemActive}` : ""
          }`}
          onClick={() => handleSelect(tab.chatId)}
          title={renderTitle(tab)}
        >
          <span className={styles.tabTitle}>{renderTitle(tab)}</span>
          <span
            role="button"
            tabIndex={-1}
            className={styles.tabClose}
            onClick={(e) => handleClose(e, tab.chatId)}
            aria-label={t("chat.closeTab", "关闭标签页")}
          >
            ×
          </span>
        </button>
      ))}
      <button
        type="button"
        className={styles.newTabBtn}
        onClick={handleNewChat}
        title={t("chat.newTab", "新开对话")}
        aria-label={t("chat.newTab", "新开对话")}
      >
        <Plus size={14} />
      </button>
      <CrossAgentSessionPicker onPick={handlePickSession}>
        <button
          type="button"
          className={styles.newTabBtn}
          title={t("chat.openExisting", "打开已有会话")}
          aria-label={t("chat.openExisting", "打开已有会话")}
        >
          <Search size={14} />
        </button>
      </CrossAgentSessionPicker>
      {/* 已隐藏：实验性工作台入口 — A1 架构已采纳，入口冻结。
           如需恢复，取消下方代码块的注释。
      <a
        className={styles.workspaceLink}
        onClick={() => navigate("/experiments/chat-workspace")}
        title="多实例工作台（实验）"
      >
        <LayoutGrid size={14} />
      </a>
      */}
    </div>
  );
}