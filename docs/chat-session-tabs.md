# 右栏多标签页方案（Chat Session Tabs）

> 目标：让右栏内容区像浏览器一样支持多标签页，服务于「多智能体 / 多对话同时进行」的场景。
> 本文档描述已完成的首期实现（Phase 1：假标签版），以及后续演进（Phase 2：真多实例 / 弹窗）的完整方案与细化。

***

## 1. 背景与现状

右栏内容区（DesignLayout 第 3 栏）当前是一个 URL 驱动的单会话路由区：

- 内容由 `<Routes>` 渲染，聊天页对应 `core.chat → /chat/* → ChatPage`。

- 会话唯一标识在 URL：`/chat/:chatId`（`utils/sessionRoute.ts` 的 `buildChatPath` / `getSessionIdFromPath`）。

- 聊天运行时是第三方库 `@agentscope-ai/chat` 的 `<AgentScopeRuntimeWebUI>`，在 ChatPage **单实例挂载**，通过 `key={refreshKey}` 在切会话/切智能体时卸载重挂。

- 会话状态存在 Context（`ChatAnywhereSessionsContext`），**一次只有一个** **`currentSessionId`**。

- 智能体是全局单值 `agentStore.selectedAgent`，每个智能体记录 `lastChatIdByAgent`。

- 后端并发已支持：`backgroundQueueRegistry` 按会话做 AbortController、卸载后后台继续发送；`messageQueueStore` 按会话分队列。

### 关键可行性结论（已在依赖源码中确认）

- `ChatAnywhereSessionsContext` 是 React Context，其 Provider 状态用 hooks（`useGetState`）承载，**每挂载一个** **`<AgentScopeRuntimeWebUI>`** **实例就拥有一份独立的会话上下文**。

- `ChatSessionInitializer` 被渲染在 `AgentScopeRuntimeWebUI` 的 `theme.rightHeader`（即 Provider 树内部），它通过 `useChatAnywhereSessionsState` 感知的是**所在实例**的会话上下文。

- 因此：**多实例（真标签 / 弹窗）在会话状态层是可行的**；主要成本在前端同时保活多份运行时（内存、SSE 连接、UI 复杂度）。

***

## 2. 首期实现（Phase 1：假标签版）— 已完成 ✅

### 2.1 设计思路

“假标签版”的定位：**一次仍只渲染一个会话实例**，标签页只是顶层的一个“会话抽屉条”。

- 点标签 = 路由切换 → 聊天运行时卸载重挂当前会话；

- 被切走的会话若有未完成的生成，由既有 `backgroundQueueRegistry` 在后台继续；

- 标签集合/标题由新建的轻量 store 维护，URL 仍是唯一事实来源。

### 2.2 变更文件

| 文件                                                  | 类型 | 说明                                                                                                                                                                                     |
| --------------------------------------------------- | -- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/stores/sessionTabsStore.ts`                    | 新增 | 打开的标签集合（chatId + title）与操作：`openTab` / `updateTitle` / `closeTab` / `neighborAfterClose` / `resetTabs`；`persist` 到 `sessionStorage`（键 `aiarb-session-tabs`），仿 `agentStore` per-tab 隔离。 |
| `src/components/ChatTabsBar/index.tsx`              | 新增 | URL 驱动的标签条组件（仅 `/chat*` 路径渲染）。                                                                                                                                                         |
| `src/components/ChatTabsBar/index.module.less`      | 新增 | 标签条样式（激活态蓝色下划线、关闭 ×、+ 按钮、hover 态）。                                                                                                                                                     |
| `src/layouts/DesignLayout/index.tsx`                | 修改 | 引入并渲染 `<ChatTabsBar />` 到第 3 栏内容区顶部（`.content` 内、`.page-content` 之前）。                                                                                                                  |
| `src/layouts/DesignLayout/designLayout.module.less` | 修改 | `.content` 改为 flex 纵向布局；`.page-content` 改为 `flex:1; min-height:0`，使标签条与内容堆叠。                                                                                                           |

### 2.3 行为契约

- **注册标签**：`ChatTabsBar` 的 effect 监听当前 URL；当 `getSessionIdFromPath` 命中真实会话时调用 `openTab(chatId, title)` 确保存在对应标签。标题优先从全局 `sessionListStore` 解析（兼容 `id / realId / sessionId`），否则用默认名「新对话」。

- **标题同步**：当 `sessionListStore.sessions` 更新（如会话重命名）时，同步 `updateTitle`。

- **点标签切换**：`navigate(buildChatPath(chatId))`；点击当前标签为 no-op。

- **关闭标签**：取 `neighborAfterClose`（优先左侧、其次剩余第一个）；若关闭的是当前标签则导航到邻居，否则 `navigate(/chat)` 兜底。

- **新开对话**：`+` 按钮派发 `aiarb:sidebar-new-chat` 事件（`ChatSessionInitializer` 已在场监听并调用 `createNewSession`）。

- **激活态**：`tab.chatId === currentChatId` 高亮。

- **非聊天页**：`isChatPath === false` 时组件返回 `null`，不影响记忆/知识库/设置等页面。

### 2.4 验证结果

- `npx tsc -b --noEmit`：仅存在两个与本次无关的预置告警（`pages/Memory/index.tsx` 未使用变量），本方案文件全部编译通过。

- 浏览器实测（vite dev 5173）：

  - 标签条正常渲染：含会话名、关闭 ×、+ 按钮，激活标签带蓝色下划线。

  - 点 `+` 触发 `createNewSession`（URL 进入 `/chat` 欢迎态）。

  - 点会话标签成功路由回 `/chat/<id>`（切换生效）。

  - 关闭按钮 a11y 名解析为「关闭标签页」（可见 × 保留）。

### 2.5 已知边界（Phase 1）

- 新建对话在 `/chat` 基路径时 `chatId` 尚为 undefined，暂不生成标签；待后端解析出 `realId`（即用户真正发言后）才会出现对应标签。

- 标签仅对 `/chat/:id` 生效；`/chat` 基路径不渲染独立标签。

- 标签持久化在 `sessionStorage`（刷新保留、跨浏览器标签页不共享，与 `agentStore` 语义一致）。

***

## 3. 后续演进（Phase 2：真多实例 / 弹窗）

### 3.1 Phase 2A：真多标签（多实例同时在内存保活）

给 Phase 1 的标签条增加「同时保活」能力：

- 将 `ChatPage` 的会话视图拆成「每个打开标签一个常驻实例」，切换只改 `display`，不卸载；切走的实例后台继续，不再依赖 `backgroundQueueRegistry` 的重拉历史。

- 需要确认/改造点：

  1. `AgentScopeRuntimeWebUI` 同屏多实例的 SSE 连接与内存占用（需压测 N=3\~5）。
  2. `options.api.getSessionList/getSession` 当前按单智能体加载，多智能体并存时需按实例隔离的 `api`（传入各自的 `agentId`）。
  3. `agentStore.selectedAgent` 从“全局单值”演进为“按会话 tag 绑定”，标签条需携带 `agentId`。
  4. 每个实例独立 `window.currentSessionId` / `sessionApi` 缓冲（当前这些是模块级单例，需做成按 tag 的 keyed map）。

- 产出：一个「工作区」模型 = 打开的标签列表 + 实例生命周期管理 + 内存回收（LRU、静置释放）。

### 3.2 Phase 2B：应用内弹窗（可选形态）

- 复用 Phase 2A 的多实例运行时基建。

- 主内容区不变；`+` 旁提供「在弹窗打开」，弹窗为独立 `<AgentScopeRuntimeWebUI>` 实例，自带拖拽 / 最小化 / 层级 / 关闭，持久化窗口位置。

- 依赖前置：多实例运行时（Phase 2A）先落地；否则每个弹窗仍需独立的 `ComposedProvider` 与 `agentId` 绑定。

- 移动端不可用，需降级为全屏路由（弹窗开关仅桌面显示）。

### 3.3 Phase 2 优先级建议

1. 先做 **多实例运行时**（决定“真标签”与“弹窗”哪种更划算）。
2. 再做 **按会话绑定智能体**（`agentStore` 演进 + `sessionApi` keyed map）。
3. 最后按产品偏好选择 **真标签 UI** 或 **弹窗 UI**（可两者并存、互为入口）。

***

## 4. 风险与缓解

| 风险             | 说明                                                      | 缓解                                               |
| -------------- | ------------------------------------------------------- | ------------------------------------------------ |
| 会话上下文串扰        | 单例逻辑（`window.currentSessionId`、`sessionApi`）在多实例下可能读错会话 | Phase 1 用 URL 作唯一事实源；Phase 2 改为按 tag 的 keyed map |
| 内存 / SSE 连接膨胀  | 多实例同时保活                                                 | 限制最大标签数、静置释放、LRU                                 |
| 标题不新           | 会话名变化后标签旧                                               | 已接入 `sessionListStore` 同步 + `updateTitle`        |
| `/chat` 基路径无标签 | 新建会话未解析 id                                              | 接受为过渡态；可在输入即生成标签时优化                              |
| 移动端拥挤          | 标签条横向溢出                                                 | `overflow-x:auto` + 隐藏滚动条（Phase 1 已含）            |
| 与现有 Drawer 冲突  | FilesDrawer / ChatSessionDrawer 层级                      | 弹窗阶段再评估 z-index 与焦点                              |

***

## 5. 待确认项（需产品确认）

1. 标签上限（默认建议 10）。
2. 是否桌面优先（移动端降级策略）。
3. Phase 2 优先“真标签”还是“弹窗”，或两者并存。
4. 关闭最后一个标签后的落点（跳 `/chat` 欢迎页 vs 关闭整个聊天区）。

