/**
 * ChatMultiInstance — 实验性多实例聊天工作区。
 *
 * 已冻结 / 实验性 — A1 架构已采纳。
 *
 * 本模块作为实验资产保留。A1 路由（单运行时 + URL 驱动标签页，
 * 挂载在 `/chat`）已被采纳为产品入口（见
 * `chat-architecture-a1-and-group-chat-hitl.md` D3）。
 * 此处不再添加新功能。代码保留供参考，并作为未来 SDK 支持
 * 实例隔离时的恢复基础。
 *
 * 风险受控 / 实验性。这是一个独立入口（可通过
 * `/experiments/chat-workspace` 访问），因此遗留的单聊天 `/chat/*`
 * 工作流完全不受影响。此处同时挂载多个 `<ChatPage>` 实例并
 * 保持在内存中存活，每个标签页一个；切换标签页仅切换
 * `visibility`/`display`，不会卸载被切走的实例。
 *
 * 隔离模型：
 * - 每个标签页渲染 `<ChatScopeProvider>`，拥有自己的 `agentId`、
 *   `chatId` 和 `currentSessionId`，使挂载的 ChatPage 绑定到自己的
 *   会话/agent，而不是页面全局的 selectedAgent / currentSessionId。
 * - 焦点实例的 `currentSessionId` 由本组件驱动；被切走的实例
 *   通过现有的 session-keyed 消息队列 + backgroundQueueRegistry
 *   在后台继续运行（它们的 SSE/queue key 是 per-session 的，
 *   不是 per-window 的）。
 *
 * 已知实验边界（如实说明）：每个标签页的 SessionApi 实例各自
 * 拥有独立的会话列表、所有权 epoch 和 agent-scoped 后端认证。
 * `window.currentSessionId` 仍然共享，但 host 仅将其指向
 * 焦点标签页；隐藏标签页通过 per-session queue key 继续运行。
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import ChatPage from "../Chat";
import { useAgentStore } from "../../stores/agentStore";
import { createSessionApi } from "../Chat/sessionApi";
import {
  ChatScopeProvider,
  type ChatScope,
} from "../Chat/sessionScope";
import {
  useChatWorkspaceStore,
  type WorkspaceTab,
} from "./chatWorkspaceStore";
import CrossAgentSessionPicker from "../../components/CrossAgentSessionPicker";
import styles from "./ChatMultiInstance.module.less";

export default function ChatMultiInstance() {
  const agents = useAgentStore((s) => s.agents);

  const tabs = useChatWorkspaceStore((s) => s.tabs);
  const activeKey = useChatWorkspaceStore((s) => s.activeKey);
  const closeTab = useChatWorkspaceStore((s) => s.closeTab);
  const activate = useChatWorkspaceStore((s) => s.activate);

  // Per-tab SessionApi 实例。每个标签页拥有一个新克隆的、agent 绑定的
  // SessionApi，使其会话列表 / 所有权 epoch / agent-scoped 后端认证
  // 不会泄漏到其他标签页。map 以 tab.key 为键，每次渲染时裁剪到
  // 当前标签页集合，使已关闭标签页被释放。
  const instanceRef = useRef<Map<string, ChatScope["sessionApi"]>>(new Map());
  const scopeByKey = new Map<string, ChatScope | null>();
  for (const tab of tabs) {
    const existing = instanceRef.current.get(tab.key);
    const instance = existing ?? createSessionApi(tab.agentId);
    // 绑定该标签页的 agent。createSessionApi 以 agent id 初始化所有权，
    // 此处的 setActiveAgent 保持其与标签页同步。
    instance.setActiveAgent(tab.agentId);
    instanceRef.current.set(tab.key, instance);
    scopeByKey.set(tab.key, {
      sessionApi: instance,
      currentSessionId: tab.chatId,
      agentId: tab.agentId,
    });
  }
  // 释放已关闭标签页的实例。
  for (const key of instanceRef.current.keys()) {
    if (!scopeByKey.has(key)) instanceRef.current.delete(key);
  }

  // 跨 agent 聚合会话列表现在由共享的 CrossAgentSessionPicker 组件处理
  // （M-A1-2 提取）。此实验界面复用同一选择器作为“打开已有会话”入口。

  // 保持 `window.currentSessionId` 仅指向焦点标签页。聊天运行时 +
  // sessionApi 读取此全局变量来决定交互式会话；隐藏标签页通过
  // per-session queue key 继续运行。
  useEffect(() => {
    const active = tabs.find((t) => t.key === activeKey);
    (window as unknown as { currentSessionId?: string }).currentSessionId =
      active?.chatId ?? "";
  }, [activeKey, tabs]);

  const renderTabTitle = (tab: WorkspaceTab): string => {
    const stored = tab.title.trim();
    if (stored && stored !== "新对话") return stored;
    return stored || "新对话";
  };

  const empty = tabs.length === 0;

  return (
    <div className={styles.workspaceRoot}>
      <div className={styles.tabStrip}>
        {empty ? (
          <span className={styles.emptyHint}>暂无可用的会话标签。</span>
        ) : (
          tabs.map((tab) => {
            const key = tab.key;
            const isActive = key === activeKey;
            const agentName =
              tab.agentId === "default"
                ? "默认"
                : (agents.find((a) => a.id === tab.agentId)?.name ?? tab.agentId);
            return (
              <div
                key={key}
                className={`${styles.tabItem}${
                  isActive ? ` ${styles.tabItemActive}` : ""
                }`}
                onClick={() => activate(key)}
              >
                <span className={styles.tabAgent}>{agentName}</span>
                <span className={styles.tabTitle}>{renderTabTitle(tab)}</span>
                <button
                  type="button"
                  className={styles.tabClose}
                  aria-label="关闭"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(key);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className={styles.panels}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          const scope = scopeByKey.get(tab.key) ?? null;
          // 仅活跃标签页挂载 <ChatPage>。SDK 通过 document 级别的
          // CustomEvent 总线处理所有发送 / 重新生成 / 审批；如果多个
          // 运行时同时存活，它们会对彼此的事件做出反应并交叉污染
          // 消息面板。保持单个挂载的 SDK 实例可消除这种耦合。
          // 作用域 sessionApi（在 instanceRef 中保持存活）和
          // session-keyed 后台队列在卸载后仍然存活，因此切回时
          // 通过 getSession 恢复消息，并在重新挂载时刷新队列中的发送。
          return (
            <div
              key={tab.key}
              className={styles.panel}
              aria-hidden={!isActive}
            >
              {isActive && (
                <div className={styles.panelInner}>
                  <ChatScopeProvider value={scope}>
                    <ChatPage chatId={tab.chatId} agentId={tab.agentId} />
                  </ChatScopeProvider>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}