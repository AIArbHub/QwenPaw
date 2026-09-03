# 会话架构总体设计：A1 多会话 + 群聊人机协同

> 状态：设计定稿（待评审）
> 日期：2026-09-03
> 范围：跨智能体多会话多窗口（A1 路线）+ 群聊人机协同（角色操控/干预）
> 前置文档：`chat-workspace-currentSessionId-isolation.md`、`chat-workspace-message-panel-isolation.md`

***

## 1. 背景与原始诉求

1. **跨智能体、多会话多窗口**：一个入口里能跨智能体开多个会话，多个会话像多个浏览器窗口一样并行/独立（各自的会话列表、agent 认证、后台生成、互不串扰）。
2. **模拟仲裁（多智能体交互）**：一个会话内多智能体有并行、串行、混合编排；过程中人扮演的角色会变化，需要接管/干预其中某一个或两个智能体（Human-in-the-loop 的角色接管/切换）。

诉求 2 是"会话内"问题，与"多窗口"维度正交。本方案将二者统一在一个架构下落地。

## 2. 关键决策记录（ADR）

### D1：多会话采用 A1（单运行时切换 + 后台队列补发），不做 A2（真多实例并行）

**决策**：`/chat` URL 驱动标签栏为最终产品形态；同一时刻仅挂载一个聊天运行时；切走的会话由服务端继续生成、前端经消息队列后台补发、切回时从后端回填。

**理由**：

- **fork 二开背景**：`@agentscope-ai/chat` 是上游 npm 三方包（非同组织，无法上游化），其操控事件走 document 级 CustomEvent 全局总线、无命名空间。真并行（A2）必须 patch node\_modules / vendored 副本 / iframe，三者升级负担或工程量都不可接受。

- **A1 已被验证**：请求层隔离（实例级 sessionApi、`enqueue` 显式 `backendSessionId`、按 session 分桶的后台队列）已完成实测，无请求级串扰；"隐藏标签卸载"实验证明了单实例原则可行。

- **产品收益匹配**：诉求 2 的"并行"是群聊内多 agent 并行（后端编排已支持），不需要多窗口实时并行。A1 对法律工作流（切到哪个案例看哪个、其余后台继续、切回回填）体验足够。

**代价（明确接受）**：切走的会话不实时冒字，切回时回填；"多个独立会话窗口同时滚动输出"的体验不做。

### D2：人机协同 = 群聊编排器上的"档位 + 控制点"，不新增会话形态

角色接管/干预全部落在现有 `group_chats` 编排器内（控制点拦截 + 人工注入通道），复用 in-flight 取消、成员独立气泡、`chat_with_agent` 链路。**零 SDK 改动、不碰多窗口。**

### D3：已有多实例实验（Phase 2A）资产的处置

| 资产                                                                        | 处置                                                                    | 理由                                                               |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/chat` 标签栏（`sessionTabsStore` + `ChatTabsBar` + URL 驱动）                  | **转正为唯一产品入口**                                                         | A1 形态本体                                                          |
| `messageQueueStore.enqueue(backendSessionIdArg)` + 后台队列分桶                 | **保留，A1 核心复用**                                                        | 切走后补发的机制基础                                                       |
| `sessionApi` 实例化能力（`isInstance`/实例身份字段）                                   | **保留**                                                                | 请求层身份隔离，对 A1 后台补发仍必要                                             |
| `ChatScope`/`ChatScopeProvider` + `ChatPage` 内 `hasScope` 守卫              | **保留但限定实验入口**                                                         | 守卫在无 scope 时走 legacy 路径，对 `/chat` 逐字节无影响；体系留作未来 SDK 支持实例隔离时复活的基础 |
| `/experiments/chat-workspace`（`ChatMultiInstance` + `chatWorkspaceStore`） | **冻结为实验入口**：保留路由与代码、头部注释标注 `FROZEN/EXPERIMENTAL — A1 adopted`、不再投入新功能 | 不一删了之（验证资产 + 复活基础），也不迁就（不继续修其实验性缺陷，如 SDK 全局 store 串扰）            |
| 跨智能体会话聚合下拉（遍历 agents 调 `listChats` 合并去重）                                  | **迁移到正式入口**                                                           | 该能力与多实例解耦，是 A1"跨智能体开多会话"的入口件                                     |

### D4：参考 team\_chat-5.4.1 插件（仅借鉴，不照抄）

借鉴点：多标签 + 按 session 文件隔离的骨架（后端 `SessionStore` 每会话独立 JSON，与本项目 `GroupSession`/会话文件设计同构）。**不借鉴**：其前端全局忙锁（`busyRef.blocked` 锁死多标签，与 A1 后台补发理念相反）、会话内串行 `for await`（本项目已有 parallel/round-robin 双模式且质量更高）。

***

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│ 入口层：/chat 多标签（URL 驱动，唯一产品入口）                        │
│   · ChatTabsBar 标签栏（已有）                                      │
│   · 跨智能体"打开已有会话"聚合下拉（自实验入口迁入）                    │
│   · /experiments/chat-workspace（冻结实验入口，保留）                 │
├─────────────────────────────────────────────────────────────────┤
│ 运行时/渲染层：同一时刻仅一个 ChatPage 挂载（A1 核心）                 │
│   · 切标签 = 路由导航 = 卸载旧/挂载新（单 SDK 实例，无全局总线串扰）    │
│   · 修复项：重挂载后会话绑定正确（M-A1-1）                            │
├─────────────────────────────────────────────────────────────────┤
│ 请求/身份层（已完成并实测）：                                          │
│   · 入队快照 backendSessionId + agentId（messageQueueStore）         │
│   · sessionApi 实例身份（isInstance）                                │
│   · 按 session 分桶的后台队列（切走仍补发）                            │
├─────────────────────────────────────────────────────────────────┤
│ 会话内群聊编排（group_chats，后端）：                                 │
│   HOST_OPENER → MEMBER_TURNS(parallel|round_robin) → HOST_SUMMARY  │
│   + 人机协同控制点 0/1/2 + 角色操控档位 + 干预动作（本方案新增）         │
└─────────────────────────────────────────────────────────────────┘
```

***

## 4. A1 多会话方案细化

### 4.1 现状（已完成，不再重做）

- 标签 = `chatId` = URL `/chat/:chatId`；`sessionTabsStore` 持久化开着的标签集合（sessionStorage）。

- 发送链路：前端 `enqueue` 时快照 `backendSessionId` 与 `agentId` → 后台 sender 按 session 分桶、空闲即发 → 切走的会话照常补发。

- 请求级隔离已实测：不同标签的请求带各自 `chat_id`/`session_id`/`X-Agent-Id`。

### 4.2 待办（M-A1 系列）

| 编号     | 内容                    | 说明                                                                                                                                    |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| M-A1-1 | 修复 `/chat` 重挂载后面板错选会话 | 已复现：URL 已切但 `window.currentSessionId` 卡死在旧值、面板显示另一会话。修复 ChatPage 会话绑定对 URL 的响应，不依赖全局变量残留                                              |
| M-A1-2 | 跨智能体会话聚合下拉迁入 `/chat`  | 将 `ChatMultiInstance.tsx` 中的聚合逻辑（遍历 agents → `listChats({agent_id})` → 合并去重 → antd 分组）抽为独立组件/工具函数，挂到 `/chat` 的"打开已有会话"入口；实验入口改为引用同一实现 |
| M-A1-3 | 后台补发的 agent 头校验       | 验证切走后补发请求的 `X-Agent-Id` 取自入队快照而非全局 selected-agent（`enqueue` 已捕获 `agentId`，需端到端确认 sender 使用它）                                          |
| M-A1-4 | 实验入口冻结标注              | `ChatMultiInstance.tsx`/`chatWorkspaceStore.ts` 头部注释加 `FROZEN` 说明，指向本文档 D3                                                            |

***

## 5. 群聊人机协同主方案

### 5.1 协同程度光谱（每角色独立一档，随时切换）

| 档位 | 名称   | 语义                                          |
| -- | ---- | ------------------------------------------- |
| 0  | 全自动  | agent 自主发言（现状）                              |
| 1  | 导演调度 | 人定流程/阶段（剧本，M3）                              |
| 2  | 审批放行 | agent 起草 → 人确认/修改后放行（复用 ApprovalService，M2） |
| 3  | 角色接管 | 轮到该角色时停住，等人工以该身份输入（M1）                      |
| 4  | 半自动  | 人给方向（`assist_hint`），agent 代写（M3）            |
| 5  | 完全人代 | 该角色全程由人扮演（= 档3 的持续态，M1 即支持）                 |

不同角色可同时处于不同档位（仲裁员档0 + 申请人档3 + 秘书档4）。

### 5.2 控制点（横切现有编排器，不改四段流程）

- **控制点0**（HOST\_OPENER 前）：剧本由人定（档1，M3）。

- **控制点1**（每个成员发言前）：查 `member.controller` — auto 走 `stream_member`；human 挂起等人工；assist 拼 `assist_hint` 入 prompt。

- **控制点2**（成员产出后 / HOST\_SUMMARY 前）：档2 发言审批（M2）。

### 5.3 数据模型（`src/aiarb/app/group_chats/models.py`）

```python
class Member(BaseModel):
    agent_id: str
    name: str = ""
    role: str = ""
    order: int = 0
    member_session_id: str = ""
    # ── 人机协同：角色操控（新增）──
    controller: Literal["auto", "human", "assist"] = "auto"  # 档位（持久）
    assist_hint: str = ""        # 档4：人给的方向/要点
    override_count: int = 0      # 人工干预计数（审计）

class MemberTurn(BaseModel):
    member_id: str
    prompt: str = ""
    status: Literal["pending", "running", "done", "error", "timeout",
                    "awaiting_human"] = "pending"   # 新增 awaiting_human
    result: str = ""
    started_at: float = 0
    finished_at: float = 0
    human_override: bool = False                    # 新增：该发言由人产出
```

持久化：随 `GroupSession` JSON（`sessions/console/group_chats/{group_id}.json`），天然跨 round、跨重进恢复。

### 5.4 角色操控子模块（档位切换 + 一次性干预）

**档位切换（持久状态）**

| 动作         | 语义       | 后端处理                                                                         |
| ---------- | -------- | ---------------------------------------------------------------------------- |
| `takeover` | 某角色交给人类  | `controller=human`；若该成员在途生成 → 取消（`stop_agent_chat_async` / in-flight 取消，均已有） |
| `release`  | 交还 agent | `controller=auto`                                                            |

**一次性干预（不改变档位）**

| 动作          | 语义               | 后端处理                                                            |
| ----------- | ---------------- | --------------------------------------------------------------- |
| `inject`    | 人替某角色说一句         | 构造 `MemberTurn(human_override=True)` → 写回成员会话上下文 + 发气泡 + 计入本轮回合 |
| `interrupt` | 打断在途生成           | 仅取消在途调用，半成品不回写（明确丢弃策略）                                          |
| `edit`      | 修正某 agent 已产出的发言 | 替换 `RoundRecord.turns` 中对应 turn 的 result 并回写成员会话                |
| `nudge`     | 给某 agent 定向指令    | 以 host 身份走既有 `chat_with_agent`（不新增）                             |

### 5.5 编排运行时改动（`runtime.py` / `adapter.py`）

1. **串行 round\_robin**：`_stream_round_robin_turns` 中轮到 `controller=human` 成员 → 置 `awaiting_human`、发"等待人工"SSE 事件 → `await` 该成员的 `asyncio.Future` → 人工注入后 resolve，产出 turn 继续下一成员。
2. **并行 parallel**：`_stream_one` 中 human 成员不调 agent，改 `await future`；其余成员并行照旧，merge 循环不受阻。
3. **Pending Registry（进程内）**：`{group_id: {member_id: asyncio.Future}}`。inject API 命中活 future 则 resolve（本轮内生效）；轮次已结束则作为下一轮上下文写回（附提示消息）。
4. **超时豁免**：`awaiting_human` 不计入现有 300/600s 成员超时；人工等待设宽松上限（默认 15 分钟，可配），超时跳过该成员并在汇总中标注"该角色本轮未发言（等待人工超时）"。
5. **上下文回写（`adapter.inject_human_turn`，新增）**："只写不生成"——向成员的 `member_session_id` 会话记录追加一条 assistant 消息（不触发 LLM），同时把 `MemberTurn` 追加进 `round_record.turns`，保证 host 汇总（`build_host_summary_prompt` 读 turns）与该成员后续自动发言都能看到人的发言。
6. **assist 档**：`build_member_prompt` 追加"发言方向提示：{assist\_hint}"段。

### 5.6 模拟仲裁映射（档1 剧本，M3）

每轮 = 一个程序阶段：`开庭陈述`(round\_robin: 申请人→被申请人) → `质证`(round\_robin) → `合议`(parallel: 数位仲裁员) → `裁决`(host 汇总)。剧本以 host 元数据（`<!-- HOST:{...} -->`）扩展 `script` 字段声明阶段序列与每阶段调度模式；编排器按剧本推进而非固定单轮。人在其中随时 takeover 申请人/仲裁员、inject 补充质证意见、edit 修正文书表述。

***

## 6. 请求协议

### 6.1 REST（新增 `src/aiarb/app/group_chats/api.py`，挂路由，参照 kb\_curator 模块先例）

定位方式：用 `(host_agent_id, session_id)` 定位群聊（前端两者均已知），后端内部 `build_group_id`。

```
GET   /api/console/group-chats?host_agent_id=&session_id=
      → { members: [{agent_id, name, controller, assist_hint,
                     human_pending, override_count}], round, mode }

PATCH /api/console/group-chats/members/controller
      body: { host_agent_id, session_id, member_id,
              controller: "auto"|"human"|"assist", assist_hint?: string }
      → takeover 语义：后端同时取消该成员在途调用

POST  /api/console/group-chats/members/inject
      body: { host_agent_id, session_id, member_id, text }

POST  /api/console/group-chats/members/interrupt
      body: { host_agent_id, session_id, member_id }

POST  /api/console/group-chats/turns/edit
      body: { host_agent_id, session_id, turn_id, text }
```

鉴权沿用 `X-Agent-Id: host_agent_id`（与现有 console chat 一致）。

### 6.2 SSE 事件（沿用标准 `message` 事件 + meta 标记，避免前端未知事件类型问题）

| 场景     | meta                                               | 前端渲染               |
| ------ | -------------------------------------------------- | ------------------ |
| 等待人工   | `group_member` + `human_pending: true`（InProgress） | 该角色气泡"等待您发言…"+聚焦提示 |
| 人工注入发言 | `group_member` + `human_override: true`（Completed） | 该角色气泡 + "人类"徽标     |
| 档位变化   | `group_control: { member_id, controller }`         | 气泡角标切换（AI/人类）      |
| 干预超时跳过 | `group_member` + `human_pending_timeout: true`     | 该角色气泡灰色提示          |

### 6.3 前端发送入口

群聊输入框加"发送者"选择（默认"我（向主持人说话）"，可选"以 申请人 身份发言"等被接管/任意角色）。选择角色身份时走 `inject` API 而非普通 `/console/chat`。

***

## 7. 前端改动清单（console）

| 文件                                              | 改动                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pages/Chat/HostBubbles.tsx`（`MemberReplyRow`）  | 档位徽标（AI/人类/协助）、`human_override` 徽标、接管/交还按钮、`awaiting_human` 等待态、生成中"打断"按钮、完成后"编辑"入口 |
| `pages/Chat/index.tsx`                          | 输入框"发送者"选择（角色身份 → inject API）；`group_control` meta 事件消费                             |
| `pages/Chat/messageDisplay.ts`                  | `isMemberReplyMessage`/提取逻辑支持 `human_override`、`human_pending`                      |
| 新组件 `components/GroupChatControlBar`（或并入现有群聊设置） | 角色档位总览/切换面板（当前各角色 controller、待人工项）                                                  |
| 新 API 模块 `api/modules/groupChats.ts`            | 上述 4 个 REST 封装                                                                      |
| `pages/Experimental/ChatMultiInstance.tsx`      | M-A1-2：聚合下拉抽离后改为引用共享实现；头部加 FROZEN 标注                                                |
| i18n（zh/en）                                     | 新增文案                                                                                |

## 8. 后端改动清单（src/aiarb）

| 文件                           | 改动                                                           |
| ---------------------------- | ------------------------------------------------------------ |
| `app/group_chats/models.py`  | Member/MemberTurn 新增字段（见 5.3）                                |
| `app/group_chats/runtime.py` | 控制点1 拦截（串行/并行两处）、Pending Registry、awaiting\_human 超时豁免与宽松上限  |
| `app/group_chats/adapter.py` | `inject_human_turn`（只写不生成）、assist hint 拼接                    |
| `app/group_chats/api.py`（新增） | 4 个 REST 端点 + 路由注册                                           |
| `app/group_chats/sse.py`     | `human_pending`/`human_override`/`group_control` meta 标记辅助函数 |
| `app/group_chats/context.py` | 汇总 prompt 含 human\_override 标注（"（由人类扮演者发言）"）                 |
| `app/group_chats/store.py`   | 无结构变化（字段随 pydantic 序列化自动持久化）                                 |

***

## 9. 实施阶段

| 阶段                        | 内容                                                       | 交付判据                                                       |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| **M-A1**（先行）              | M-A1-1 修面板错选会话；M-A1-2 聚合下拉迁移；M-A1-3 后台补发头校验；M-A1-4 冻结标注  | `/chat` 多标签跨 agent 切换，切走补发、切回回填，无串扰                        |
| **M1**（档3 角色接管）           | 模型字段 + 控制点1 + Pending Registry + inject API + 前端控件/发送者选择 | 仲裁群聊中 takeover 申请人 → 等待 → 以申请人身份发言 → 汇总含该立场 → release 恢复自动 |
| **M2**（干预 + 档2 审批）        | interrupt/edit API + 前端打断/编辑；发言审批（复用 ApprovalService 结构） | 打断在途成员不污染上下文；edit 后汇总采用修正版                                 |
| **M3**（档1 剧本 + 档4 assist） | host 元数据 `script` 字段 + 剧本推进；assist\_hint                 | 仲裁四阶段流程按剧本推进；assist 成员按人给方向发言                              |

每阶段独立可交付、可回归（群聊现有 round\_robin/parallel 行为在 controller 全为 auto 时逐字节不变）。

***

## 10. 风险与对策

| 风险                               | 对策                                                        |
| -------------------------------- | --------------------------------------------------------- |
| 人工等待阻塞并行 merge                   | human 分支用独立 Future 挂起，不阻塞其他成员；剧本场景可退化为整轮 checkpoint       |
| 打断后半成品污染上下文                      | 明确丢弃策略：interrupt 只取消，不回写已生成片段                             |
| inject 回写与成员会话文件格式不一致            | `inject_human_turn` 复用现有会话存储的序列化路径，M1 中加对拍测试              |
| Pending Registry 跨进程失效（多 worker） | 当前部署为单进程 asyncio；registry 加 group\_id 维度 TTL 清理，文档标注单进程假设 |
| 前端未知 meta 字段                     | 全部走标准 `message` 事件 + meta 扩展（已验证的模式）                      |
| 上游合并冲突（fork 二开）                  | 见第 11 节                                                   |

## 11. 与上游 qwenpaw 的合并策略（fork 二开约束）

- **改动收敛在自研模块**：`group_chats/` 为本仓库自研目录（上游无此模块），新增 `api.py` 零冲突。

- **上游文件的最小侵入**：`channels/console/channel.py` 的群聊入口已存在于既有 hook 点（`_detect_group_host` → `run_group_chat`），本方案不再新增对该文件的改动；`agent_management.py` 不动。

- **前端**：console 目录为本项目主体，`ChatPage`（`pages/Chat/index.tsx`）改动集中在消息渲染分支与输入区，沿用已有 `hasScope` 守卫模式，保证无 scope 路径（`/chat`）行为不变。

- **SDK** **`@agentscope-ai/chat`** **零改动**（A1 决策核心收益），升级无感。

- **迁移幂等**：新增 Member 字段带默认值，旧 `GroupSession` JSON 加载时自动补默认（pydantic 行为），无需迁移脚本。

***

## 12. 验收清单（端到端）

1. `/chat` 开两个不同 agent 的会话标签，A 发消息后切 B，B 面板纯净；B 发消息切回 A，A 面板纯净且 A 的后台回复已回填。
2. 群聊（round\_robin）：takeover 申请人 → 轮到申请人时气泡显示等待 → 以申请人身份输入 → 气泡带人类徽标 → host 汇总包含该立场 → release 后下轮申请人恢复自动。
3. 群聊（parallel）：takeover 仲裁员甲，其余仲裁员并行照常冒字；甲等人工，输入后合议完成。
4. interrupt 正在生成的成员：气泡停止、无半截内容进入汇总。
5. edit 已完成发言：汇总采用修正后文本。
6. controller 全 auto 时，现有群聊行为与改动前一致（回归）。
7. 刷新页面/重进会话：档位与 override 状态从 `GroupSession` 恢复。

