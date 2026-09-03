# 多实例工作台：消息面板串扰修复（隐藏标签卸载）

## Context（背景与目标）

`/experiments/chat-workspace`（`src/pages/Experimental/ChatMultiInstance.tsx`）同时常驻挂载多个 `<ChatPage>`（各包在 `<ChatScopeProvider>`），非激活 tab 仅 `display:none`。实测发现消息面板串扰：切换标签后 A 面板混入 B 的消息/回复；API 请求层 session\_id 已隔离正确。

**根因（已实锤）**：SDK `@agentscope-ai/chat` 对外发送/重连/重生成/审批一律经 **document 级 CustomEvent 全局事件总线**（`useChatAnywhereEventEmitter.tsx` 的 `emit`/`CustomEvent`，不带 target 区分）。每个常驻 `<AgentScopeRuntimeWebUI>` 都在其上注册 `handleSubmit/handleReconnect/handleReplace/handleApproval`（`useChatController.tsx:295-331`）。聚焦标签发送经 `chatRef.current.input.submit()` → `emit('handleSubmit')` 全局广播 → 所有幽灵实例同步把自己 context 写入该消息并对各自后端会话发起幽灵请求。`isStillActive` 守卫只在单实例内有效，无法约束跨实例重入。

Context 本身（messages/sessions/input）是 per-instance 的，不串；串的唯一通道是这条全局事件总线。

**不良于改商用/单聊**：`/chat/*` 单聊不经 ChatMultiInstance，零影响。

## 方案：隐藏标签卸载（同一时刻仅一个 SDK 实例存活）

让同一时刻只有一个 `<AgentScopeRuntimeWebUI>` 存活，全局事件总线上的并发监听者就消失，串扰从根上消除。不改 node\_modules、不改 SDK、不重写商用路径。

### 改动：仅 `src/pages/Experimental/ChatMultiInstance.tsx`

`panels` 渲染（line 184-206）改为：**仅激活 tab 渲染** **`<ChatScopeProvider>+<ChatPage>`，非激活 tab 不挂载**。

```tsx
<div className={styles.panels}>
  {tabs.map((tab) => {
    const isActive = tab.key === activeKey;
    const scope = scopeByKey.get(tab.key) ?? null;
    return (
      <div key={tab.key} className={styles.panel} aria-hidden={!isActive}>
        {isActive && (
          <ChatScopeProvider value={scope}>
            <ChatPage chatId={tab.chatId} agentId={tab.agentId} />
          </ChatScopeProvider>
        )}
      </div>
    );
  })}
</div>
```

**必须保留**（勿误删）：

- `instanceRef: Map<key, scopedSessionApi>`（line 60-78）：ref 不随 React 卸载，切换后 scoped sessionApi 与 agent 绑定仍在，关闭时按原逻辑 prune。

- 聚焦 tab 的 `window.currentSessionId` 同步 effect（line 125-132）。

**消息恢复自动成立**：重挂载 `<ChatPage>` 时 SDK `useMount` → `getSessionList()`（scoped sessionApi 尊重 `preferredChatId`，ChatPage 在 `index.tsx:2364` 已设 `effectiveChatId`）→ `getSession(tab.chatId)` → `setMessages(后端历史)`。切回即恢复，无需额外逻辑。

**后台待发恢复自动成立**：`messageQueueStore`（zustand，按 session 键）+ `backgroundQueueRegistry` 不经 React，切换后仍在；重挂载后 ChatPage 的 resume-flush effect（`index.tsx:1550-1574`）对 `chatRef.current.input.submit()` 排空队列续发。

## 改动补充：ChatPage 三处真实路由导航加 `hasScopeRef` 守卫

复现时发现：多实例工作台内发送消息/切换 SDK 会话/新开会话会触发 ChatPage 里 `onSessionIdResolved`(可再搜索 `navigateRef.current`) 的**真实路由** `navigateRef.current(buildChatPath(...))`，把整个 SPA 从 `/experiments/chat-workspace` 踢回传统 `/chat/*`。已对 `src/pages/Chat/index.tsx` 的 `onSessionIdResolved`、`onSessionSelected`、`onSessionCreated` 三处导航出口加 `if (!hasScopeRef.current)` 守卫（多实例 scope 下不驱动全局路由）；scoped sessionApi 保留 temp→real 映射，重挂载经 preferredChatId 正确绑定。传统 `/chat`（无 scope，`hasScopeRef=false`）行为不变。

- `window.currentSessionId` 同步：工作台宿主 `ChatMultiInstance` 已有 `useEffect` 在 `activeKey/tabs` 变化时把该全局指向聚焦标签的 `chatId`；堵住跳船后此同步真正生效，面板帧归属跟随激活标签。

## 不改

- `src/pages/Experimental/chatWorkspaceStore.ts`（可选加 draft 快照，本期不做，依赖后端 getSession 恢复）

- 建标签入口在 `DesignLayout` 侧栏（`isWorkspaceActive` 时走 `openWorkspaceTab` 灌入工作台 store），不在 ChatMultiInstance 页面内

- `node_modules`（只读根因依据，不改）

## 已知行为变更（预期收敛）

- 隐藏 tab 不再并发跑 SDK SSE；未发消息由会话键队列在切回时补发——这正是修复目标。

- 纯内存瞬时态（未提交输入草稿）切换会丢；已完成往来在后端，由 getSession 恢复。

## 验证

1. 多标签并行（核心）：建 2+ tab（不同 chat）。在 A 发消息 → 切到 B：B 只显示 B 的历史，不含 A 文本/回复；网络面板只有被操作 tab 的 `session_id` 出现请求，其余 tab 无幽灵 POST。
2. 重生成/审批：A 中重生成 → 切 B：B 无空 assistant 占位、无重放。
3. 切走再切回：消息从后端恢复；切走前排队未发的消息切回后补发成功。
4. 关闭某 tab → instanceRef prune，不影响其余 tab。
5. 单聊回退：`/chat/*` 不经此组件；跑 `src/pages/Chat` 相关单测（书面确认无回归）。

