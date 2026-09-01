# 原生群聊运行时 —— 设计 · 风险登记表 · 任务拆解

> 状态：**设计定稿待评审**（尚未编码）
> 作者：QwenPaw 工程团队
> 日期：2026-09-01
> 关联代码：`src/aiarb/app/routers/console.py`、`src/aiarb/app/channels/console/channel.py`、`src/aiarb/app/task_tracker.py`、`src/aiarb/agents/tools/agent_management.py`、`console/src/pages/Chat/*`

***

## 1. 背景与现状

当前"多智能体群聊"并非独立运行时，而是一次**靠 LLM 自律拼出来的普通 agent run**：

* 群聊 host 就是一个普通 agent，用户发话走通用 `/console/chat`（[console.py](src/aiarb/app/routers/console.py#L364-L473)），一次发言 = 一个 AgentScopeRuntime 响应 = 前端一个气泡。

* "轮转 / 超时 / 终结"没有硬编码，写死在 host 的 AGENTS.md「串行圆桌」协议里（[migration.py](src/aiarb/app/migration.py#L1169-L1222)），由 host LLM 自选说话人并调用 `chat_with_agent`（[agent\_management.py](src/aiarb/agents/tools/agent_management.py#L597-L684)）。

* 成员回答通过工具结果回流，被塞进 host 的工具链 → **前端看到"成员发言混在 host 卡片里"**（本项目此前已多次收到该体验反馈）。

**不稳定点**：轮转顺序靠 LLM 自觉、超时会掐断、单个 run 上下文膨胀、成员发言无实时转写。

### 方案选型

* **方案 A（采纳）**：群聊 host 仍走 `/console/chat`，复用整条基建（SSE、`task_tracker` 并发/断线重连、`chat_manager` 会话、`/chat/stop`），只在 `stream_one` 内更换"迭代源"。

* 方案 B（弃用）：群聊独立 router，完全不经过 `/console/chat`。更干净但改动面大、风险高。

理由：`stream_one`（[channel.py](src/aiarb/app/channels/console/channel.py#L358-L492)）是 web 流式 / 后台任务 / CLI 三路**共用单点**，且 `task_tracker` 与断线重连按**原始** **`data:`** **行**重放。只要能产出"能被下游序列化 + 重放的 event"，下行全部复用得零改动。

***

## 2. 目标与范围（Scope）

### 目标

1. 后端真正管理群聊的**成员轮转、会话、超时、上下文与输出**（原生编排运行时）。
2. 成员发言渲染为**真正独立、带头像、可实时转写（边想边显示）的会话气泡**。
3. 保持向后兼容，旧 host / 旧会话可回退。

### 非目标（明确不做）

* 不改动 `chat_with_agent` / `submit_to_agent` / `check_agent_task` 既有工具语义（作为"手工/降级模式"保留）。

* `autonomous` 模式（依赖 host LLM 自选）本版**不支持**，命中即报 NotImplemented 并回退旧逻辑。

* 不改动渠道（IM）群聊（`plugins/channel/*` 那是"机器人进 IM 群"，与本群聊正交）。

### 交付范围

全部排期（M1–M6）：round\_robin 串行 + 上下文摘要 + 前端独立气泡 + **成员实时转写** + parallel 并发 + 后台任务/回退验证。

***

## 3. 总体架构

```
[前端 Chat 页] --POST /console/chat--> [routers/console.py]
        ^ SSE (raw data: lines)               | attach_or_start(...)
        |                                    v
[task_tracker 后台任务 + 断线重连] <-- stream fn (SNED _tracked_stream)
        |                                    v
[channels/console/channel.py].stream_one(payload)        ← 唯一改动点：更换迭代源
        |                                    |
        |  is_group_host(request) ?          |
        |      ├─ true  → async for e in group_chats.runtime.run(request, self)   ← 群聊编排
        |      └─ false → async for e in self._process(request)                    ← 原路径(不变)
        v
[serialize_event_for_sse → yield "data: {...}"]   ← 下行(序列化/commit/重连)零改动
```

**新模块**（`src/aiarb/app/group_chats/`）：

```
group_chats/
  __init__.py
  models.py     # pydantic 模型与状态枚举：GroupSession / Member / MemberTurn
  store.py      # JSON 持久化与恢复（复用 app/chats/session.py 的存盘规范）
  context.py    # 上下文窗口：成员观点摘要注入,防膨胀
  runtime.py    # 编排器：状态机、轮转、并发、超时、汇总、SSE 产出
  adapter.py    # 驱动成员 agent：串行/并发/实时转写(流式)
  sse.py        # 群聊事件 → 标准 message event + meta 标记
```

***

## 4. 详细设计

### 4.1 触发检测

在 `stream_one` 构建 `request` 之后判定（复用现有判据，避免误伤普通 agent）：

```python
is_group_host = request 目标工作区存在 AGENTS.md/PROFILE 里的 <!-- HOST:{...} --> 元数据
```

旧/普通 session 无该元数据 → 走 `self._process` 原路径，行为完全不变。

### 4.2 数据模型（models.py）

```python
class GroupMode(str, Enum):
    ROUND_ROBIN = "round_robin"   # 串行（M1–M4）
    PARALLEL    = "parallel"      # 并发（M5）
    AUTONOMOUS  = "autonomous"    # 不支持，命中回退旧逻辑

class Member(BaseModel):
    agent_id: str
    name: str
    role: str = ""
    order: int = 0
    member_session_id: str = ""   # 群聊专用会话: group:{gid}:member:{aid}

class MemberTurn(BaseModel):
    member_id: str
    prompt: str
    status: Literal["pending","running","done","error","timeout"]
    result: str = ""
    started_at: float = 0
    finished_at: float = 0

class RoundRecord(BaseModel):
    round_no: int
    opener: str = ""                          # host 开场/拆题
    turns: list[MemberTurn]                   # 本轮各成员结果
    summary: str = ""                         # host 汇总/纪要

class GroupSession(BaseModel):
    group_id: str
    host_agent_id: str
    schedule_mode: GroupMode
    members: list[Member]
    round: int = 0
    rounds: list[RoundRecord] = []            # 历史轮
    version: str = "group_v1"                 # 迁移/回退用
    created_at: float = 0
    updated_at: float = 0
```

持久化：`sessions/console/group_chats/{group_id}.json`，与 host 的 `console:{sender_id}` 会话解耦。

### 4.3 编排状态机（runtime.py）

用户每发一条消息 = 开启一轮：

```
NEW_USER_MSG
 ├─ HOST_OPENER     host 受限子 run：拆题+开场白，流式输出（失败则带默认开场续走）
 ├─ round_robin:    for m in members(order)：
 │                   MEMBER_START(m) → adapter.stream_member(m, prompt=m 观点注入)
 │                   MEMBER_STREAM(m, delta)             ← 实时转写，边想边显示
 │                   MEMBER_RESULT(m, status, result)
 ├─ parallel:       MEMBER_START 全部 → asyncio.gather(带并发闸门) → 各自 STREAM/RESULT
 ├─ autonomous:     raise NotImplemented → 回退旧 logic
 ├─ HOST_SUMMARY    host 受限子 run：汇总各方观点 → 纪要，流式输出
 └─ ROUND_DONE
```

* **轮转由 runtime 决定**（按 `members.order`），不再让 host LLM 自选说话人；host 只做 opener / summary。

* 每成员独立超时：下限沿用 `MIN_CHAT_WITH_AGENT_TIMEOUT_SECS = 300`（[agent\_management.py](src/aiarb/agents/tools/agent_management.py#L37)），可配置。

* 单轮成员数、总 token 双上限校验，防无限/防膨胀。

### 4.4 成员交互 adapter.py（实时转写）

**关键原则（对应风险 R1/R3/R11）**：不发明 SDK 事件类型、不在群聊任务内借道成员自己的 `/chat/task`。

* **默认（实时转写，M6 起）**：`adapter.stream_member(member, prompt, timeout)` 在群聊 run 的**进程内**为成员构造一个流式 agent run（复用 `runtime.builder` / `phases` 语义，类似 `_process` 驱动 host 的方式），逐条 message 增量产出。上半部分把每次增量封装为**带** **`meta.group_member:{member_id}`** **的标准 message event**：running 态连续追加、completed 态收尾为发言全文。

* **回退（一次性，M6 未就绪或成员无法进程内流式时）**：复用 `collect_final_agent_chat_response_async` 收全量再一次性转成员气泡。

`parallel` 用进程内 `asyncio.gather`（并发上限：成员数且 ≤ 4），**不借道子任务**，规避 task\_tracker 竞态。

**成员会话隔离（R2）**：强制 `member_session_id = group:{gid}:member:{aid}`，adapter 校验拒绝复用外部单聊/其它群会话。

### 4.5 上下文管理 context.py（R4）

* round\_robin 给成员的 prompt = `host_opener + 前序成员观点摘要（截断）`，保证信息不丢失又防膨胀。

* host 的 `HOST_SUMMARY` 输入 = `openers + 各 MemberTurn.result 摘要`，**不读全文**。

* 历史轮只保留"纪要 + 各方观点摘要"，原文按需轮换。

* 继承/加强 `tool_result_pruning_config`：本轮不豁免聚合内容，沿用"旧发言按长度裁剪"思路，杜绝再次冲到 378k。

### 4.6 SSE 与前端契约（sse.py + HostBubbles/messageDisplay）

**契约（R1 缓解）**：成员消息 = **标准** **`message`** **事件 +** **`meta.group_member`** **标记**，不新增 SDK 类型。

| 事件         | 形式                                                                      | 语义                          |
| ---------- | ----------------------------------------------------------------------- | --------------------------- |
| host 开场/汇总 | 标准 message event（无标记）                                                   | 复用现有 host 气泡                |
| 成员发言       | 标准 message event + `meta={group_member:{member_id}, group_member_name}` | running 多次增量 → completed 收尾 |
| 轮结束        | 隐藏的 `group_round` 元标记（随 summary message 附带）                             | 供前端/日志对齐                    |

前端改动点：

* `messageDisplay.ts`：新增 `isGroupMemberMessage(message.meta)` 分流（替代/并存 `isMemberReplyMessage` 工具名猜测）。

* `HostBubbles.tsx`：带 `meta.group_member` 的 message 走独立 `MemberReplyRow`（头像 + 昵称 + **增量追加的流式正文**）；

* 刷新/重连历史回放：从 `rounds[]` 重建与运行时相同的带标记 message 序列，保证独立气泡在刷新后不丢失。

### 4.7 API 设计（走 console channel）

```text
POST   /api/console/group-chats                 # 创建（members, schedule_mode → 生成 host agent）
POST   /api/console/groups/{id}/messages        # 用户发话（走 {id}/stream）
GET    /api/console/groups/{id}                 # 会话状态 / 成员 / 历史回合
PATCH  /api/console/groups/{id}                 # 调整成员 / schedule_mode
POST   /api/console/groups/{id}/stream          # SSE 流式编排事件（web / 后台 / CLI 共用）
```

### 4.8 超时 / 取消 / 断线重连 / 后台任务（R3/R5）

* **取消**：`POST /console/chat/stop` 由 `task_tracker` 原样处理；编排器收到 cancel 时 `cancel` 全部 `in_flight` 成员调用后安全终止。

* **断线**：workers 后台继续跑，reconnect 重放原始 `data:` 行；成员同理会恢复，最新消息缺失由前端 `rounds[]` 补齐。

* **后台任务**：`stream_one` 是共享通道，`/chat/task` 自动获得，无需额外改造；adapter 内不再启动成员子任务。

### 4.9 持久化与迁移（R8）

* 新增 `group_chats/` 存储，与 host 会话解耦。

* `group_v` 版本字段 + 开关 `GROUP_CHAT_NATIVE_ENABLED`（默认开，可一键回退 `_process` 旧路径）。

* 旧 host / 旧会话不迁移，`is_group_host` 判据不变，无群聊元数据自动走旧路径。

### 4.10 安全与边界（R10）

* 成员以 `<!-- HOST:members -->` 元数据为白名单；adapter 先 `agent_exists(m.agent_id)` + 白名单交集，拒绝名单外 agent。

* 循环防护：同成员连续发言上限、单轮成员数/超时上限。

* 成员 LLM 输出仅作展示与摘要输入，不进 host 可执行工具上下文，降低注入面。

***

## 5. 风险登记表

| ID  | 风险                                     | 级别     | 缓解 / 设计调整                                                |
| --- | -------------------------------------- | ------ | -------------------------------------------------------- |
| R1  | 前端对未知 SSE 类型丢弃/校验错                     | 🔴 高   | 不发明事件类型；成员=标准 message + `meta.group_member`              |
| R2  | 成员会话与单聊/其它群串扰                          | 🔴 高   | 群聊专用会话 `group:{gid}:member:{aid}`，强制校验                   |
| R3  | 后台任务 / 流式 / 取消竞态                       | 🟠 中   | adapter 仅进程内驱动/收集，不借道成员子任务                               |
| R4  | 上下文再次膨胀（曾 378k）                        | 🟠 中   | `context.py` 硬上限摘要注入；不豁免聚合内容                             |
| R5  | 成员超时产生孤儿任务                             | 🟠 中   | turn 取消即停成员 run；`in_flight` 集合结束即 cancel                 |
| R6  | parallel 并发闸门 / 成员过多                   | 🟢\~🟠 | 并发上限(≤成员 且 ≤4)、成员数上限；M5 才开放                              |
| R7  | host opener/summary 复用 `_process` 触发工具 | 🟡     | host 用**受限子 run**，禁用 `chat_with_agent`，防旧病复发             |
| R8  | 旧 host / 旧会话回归                         | 🟡     | `group_v` 版本 + `GROUP_CHAT_NATIVE_ENABLED` 开关；不迁移旧会话     |
| R9  | 断线重连成员气泡缺失                             | 🟡     | `rounds[]` 落盘全量，前端据此重建，不在线重跑                             |
| R10 | 成员合法性/越权                               | 🟢     | 元数据白名单 + `agent_exists`；拒绝名单外                            |
| R11 | 群聊事件序列化篇幅 / turn usage 失配              | 🟡     | 成员拆分独立 message event，复用 `_serialize_event_for_sse`       |
| R12 | 多步编排难排障                                | 🟡     | 结构化日志(round/member/status/耗时/token) + `group_round` 结束标记 |
| R13 | 成员实时转写在高并发下占用资源                        | 🟠     | 进程内流式受并发闸门；超时/取消可中断；必要时回退一次性模式                           |

**接纳项**：R13 在 parallel + 多长回复时可能影响整体吞吐，接受以闸门缓解；`autonomous` 明确不支持。

***

## 6. 里程碑拆分（全部排期）

| 里程碑    | 内容                                                                                                        | 验收                                                        |
| ------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **M1** | `group_chats.{models,store,context}` + `is_group_host` 检测与路由占位（`_group_process` 空实现,先 yield host message） | 群聊消息进 `_group_process`，普通 agent 不受影响；`tsc -b`、`pytest` 通过 |
| **M2** | `runtime.py` round\_robin 串行编排 + `adapter.collect_member_once`（一次性回退路径）                                   | 群聊按成员顺序发言，超时/取消正确，无孤儿                                     |
| **M3** | `sse.py` 标准 message + `meta.group_member` 事件输出；前端 `isGroupMemberMessage` 分流 + `MemberReplyRow` 独立气泡（一次性）  | 前端显示真正独立气泡；刷新后从 `rounds[]` 回放                             |
| **M4** | `context.py` 摘要窗口 + host opener/summary 受限子 run                                                           | 长轮不膨胀；host 正常拆题与汇总纪要                                      |
| **M5** | `parallel` 模式（`asyncio.gather` + 并发闸门） + `/chat/task` 后台平滑 + 旧会话回退验证                                      | 并行可用；旧 host 不回归                                           |
| **M6** | 成员**实时转写**：`adapter.stream_member` 进程内流式增量 → 前端增量追加气泡                                                     | 成员"边想边显示"，running→completed 完整链路                          |

每步向后兼容，可随时回退 `_process` 旧路径。

### 验证方式

* 后端：`pytest`（新 `tests/unit/group_chats/`）；手动：群聊 3\~5 个成员、长回复、中途停止、断线重连、刷新回放。

* 前端：`tsc -b --noEmit` + dev server 热加载；`http://localhost:5173/chat` 开群聊验证独立气泡与实时转写。

* 回归：单智能体对话行为不变；旧群聊 host 回退可用。

***

## 7. 遗留 / 待评审问题

1. 成员实时转写走进程内流式 vs 成员自身 SSE 直连的更彻底方案（M6 先做进程内，评估后再议）。
2. `parallel` 与成员共享进程的吞吐权衡是否有线上指标需要采集。
3. `group_clapback`（自动唤醒被点名的成员）是否纳入后续版本（不在本 scope）。
4. 是否把本运行时统一抽成 SDK 可复用的"AgentRoundTableRuntime"，供渠道层群聊共享（远期）。

