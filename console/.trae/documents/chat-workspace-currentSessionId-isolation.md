# 多实例工作台：`window.currentSessionId` 按实例隔离

## Context（背景与目标）

`/experiments/chat-workspace`（ChatMultiInstance）已为每个标签注入独立 `SessionApi` 实例（经 ChatScope 上下文），队列也按 `queueSessionId`（= tab.chatId）天然分桶。但 `window.currentSessionId` 仍是浏览器全局唯一：

- `messageQueueStore.enqueue` 在入队时从 `window.currentSessionId` 捕获 `QueueItem.backendSessionId`（`src/stores/messageQueueStore.ts` line 369-371）。

- `sessionApi` 的 `createEmptySession/updateWindowVariables/resetWindowIdentity/getSessionIdentity` 读写 window 全局身份。

串扰根因：A 标签后台并行生成/入队时，读到的全局 currentSessionId 可能是当前聚焦的 B 标签，导致 backendSessionId 串到错误会话。

目标：让每个实例的会话身份（currentSessionId/userId/channel）由**实例自身字段**承载，拒不必要地触碰 window 全局；同时**完全不改变旧单聊路由** **`/chat/*`** **的行为**（无 ChatScope 时仍回退全局单例原逻辑）。

## 方案

### 1. `src/stores/messageQueueStore.ts` — enqueue 加可选 backendSessionId

`enqueue(sessionId, input)` 追加可选第 3 参 `backendSessionIdArg`：传入则优先用之；未传保留原 window 读取，作为单聊/旧调用回退。`QueueItemInput` 不改（backendSessionId 是独立追加参数）。

### 2. `src/pages/Chat/sessionApi/index.ts` — 实例级身份承载

- 构造器增加 `isInstance` 标记（默认 `false`），并新增实例字段 `instanceSessionId/UserId/Channel`。

- `createSessionApi(agentId)` 工厂改为 `new SessionApi(agentId, true)`（仅多实例 host 使用）。

- `createEmptySession` / `updateWindowVariables` / `resetWindowIdentity`：`isInstance` 时写实例字段，否则写 window（原逻辑逐字保留）。

- `getSessionIdentity` 的 window fallback 分支：`isInstance` 时从实例字段读，否则读 window。主路径（`lastActiveChatId` + `sessionList`）本就隔离，不动。

### 3. `src/pages/Chat/index.tsx` — 入队传实例 id + 发送副作用收敛

- 两个 enqueue 调用点（line \~2082、\~2977）：已用 scoped 实例调用 `sessionApi.getSessionIdentity()`，补充显式计算并传入 `backendSessionId`（`sessionApi.getBackendSessionId(queueSessionId) || enqueueIdentity.sessionId || undefined`）。

- `scheduleNextSend` 的 window 写回（line \~1549-1556）：加 `!hasScope` 守卫，多实例下不写全局以免疫污染。

- `syncLoopModeStatus` / `fetchActiveLoopMode`（line \~1442、\~1461）：优先级改为 `sessionApi.getBackendSessionId(queueSessionId) || window.currentSessionId`。

### 4. 不改（刻意收敛范围）

- `src/utils/resolveBackendSessionId.ts`、`src/plugins/hostSdk/hooks.ts`：插件 tool 调用走聚焦标签的全局语义，属预期。

- `src/pages/Experimental/ChatMultiInstance.tsx`：聚焦标签写 window 的 effect 保留，作为外部 SDK/插件读 window 的聚焦标定。

- `src/pages/Chat/sessionScope.ts`：fallback 已正确，不改。

## 复用点

- `sessionApi.lastActiveChatId` / `sessionList` / `getBackendSessionId(libraryId)` / `getRealIdForSession`：已 per-instance，直接复用做 backendId 解析与身份校验。

- ChatPage 已用 `useChatSessionApi()`（scoped 或单例）与 `useChatScope()`，可直接取得 `hasScope`。

## 验证

1. `tsc --noEmit` 通过；`npm run test` 无回归。
2. 核心实测：`/experiments/chat-workspace` 开 tab A、B（不同 agent），A 连发数条后立即切到 B 再发，两 tab 后台并行 SSE。抓包确认 A 请求 `session_id` 仍是 A 的 backend id、`X-Agent-Id` 各自正确，消息互不入对方会话；bg-task 面板各按各自 backendSessionId 过滤。
3. 单聊回归：`/chat/{会话}` 验证新会话首发、agent 切换后发送、队列连发、会话列表归属与改动前一致（尤其 `resetWindowIdentity` 后首条不串 channel）。

