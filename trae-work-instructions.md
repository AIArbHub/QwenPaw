# QwenPaw 借鉴 StaffDeck 全量改造指示文档（v5.0）

> **文档版本**：5.0（整合版）
> **更新日期**：2026-07-27
> **适用项目**：QwenPaw（moot5 分支）
> **文档性质**：发给 AI Agent 执行的完整实施指示，涵盖 SOP 闭环修复 + 知识库 LLM 增强 + 前端体验升级三大改造
> **前置条件**：已按 v3.0/v4.0 完成知识库 OKF/引用/解析器、SOP 引擎、StaffDeck 设计 token 注入、AgentCard 重设计、Workbench 聚合页

---

## 0. 文档变更说明

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.1 | 2026-07-26 | 移除 doc_processing 依赖，改为内嵌轻量解析器 |
| 3.0 | 2026-07-26 | 确认 SOP/知识库已实现部分；聚焦 OKF/引用/Router/反思/归因 |
| 4.0 | 2026-07-26 | 函数级代码审计：发现"组件齐全但未拼装通电"；提出编排器打通 SOP 闭环 |
| **5.0** | **2026-07-27** | **整合 v4.0 SOP 闭环修复 + 知识库 L1 算法层复刻 + 前端选择性 L2 体验升级；含函数级代码示例和验收标准** |

---

## 1. 根因诊断：为什么之前的方案"还是不行"

v3.0/v4.0 方案指导实现了 OKF 概念图、知识引用、轻量解析器、Router、7 维反思等组件。函数级代码审计确认这些组件**都有真实实现（非骨架）**，但系统仍然不工作，根因是**三大类问题**：

### 1.1 SOP 执行三处断裂

#### 断裂一：QUERY_KNOWLEDGE 不闭环（最致命）

**现象**：用户提问后，系统只回复 `[知识检索] xxx`，不返回知识内容。

**根因**：`runtime.py:apply_decision` 的 QUERY_KNOWLEDGE 分支（L149-203）只做两件事：
1. 调用 `kb_svc.search()` 检索知识
2. 把结果存入 `active_context["_knowledge_results"]`
3. 返回 `"knowledge_queried"`

**但从未自动重新调用 StepAgent 来基于检索结果生成回复。**

`sop.py:api_runtime_step`（L287-288）收到 `"knowledge_queried"` 后只返回：
```python
reply_text = f"[知识检索] {decision.knowledge_query}"
```

知识结果只有在**用户下一轮再次发消息时**，才通过 `build_step_agent_prompt` 注入 prompt。即用户问"仲裁证据规则是什么" → 系统检索后只回"[知识检索] 仲裁证据规则" → 要等用户再发一条消息才基于检索结果回答。

**StaffDeck 对照**：StaffDeck `agent_loop.py:_execute_knowledge_query_cycle`（L3969）检索后，`_continue_after_knowledge_query`（L4108）用 `current_knowledge` 参数**二次调用 StepAgent**，让 LLM 基于知识重新决策并生成回复——**同轮闭环**。

#### 断裂二：CALL_TOOL 不执行

**现象**：系统回复 `[工具调用] tool_name(args)` 但不执行工具。

**根因**：`runtime.py:apply_decision` 的 CALL_TOOL 分支（L136-147）只把工具调用记录到 `active_context["_pending_tool_calls"]`，注释写"actual execution is the caller's responsibility"。但调用方 `sop.py:api_runtime_step` 也**没有执行工具**，只返回字符串。

**StaffDeck 对照**：StaffDeck `agent_loop.py:_execute_tool_action_cycle` 真正调度 `ToolExecutor` 执行工具并回填结果。

#### 断裂三：Router 是死代码

**现象**：Router 完整实现了 9 种决策类型，但从未影响任何对话流程。

**根因**：`router.py:Router.decide()` 在整个项目中**零调用**。`sop.py:api_runtime_step` 直接从 StepAgent 开始，跳过了 Router 的场景路由层。主聊天流程 `chats/api.py` 完全不接 SOP。

**StaffDeck 对照**：StaffDeck `agent_loop.py:_prepare_turn`（L2402）每轮对话首步调用 `router.decide()`，结果经 `runtime.apply_decision()` 落地，决定走 skill 还是直答。

### 1.2 知识库检索质量问题

#### vector_store.py 是伪向量存储

名为 VectorStore，实为关键词子串匹配。`search` 函数用 `query_lower.split()` 分词——**按空格切分，中文几乎无效**。评分是硬编码：全匹配 0.8，词匹配 `0.3 + 0.1 * matched`。

**StaffDeck 对照**：StaffDeck `_score_text`（service.py L1962）有中文 n-gram（4/3/2 字滑动窗口）、词长加权（中文 4 字 +3.0，5 字 +3.4）、多级漏斗路由（concept→document→bucket→section→chunk）。

#### QwenPaw 知识库完全无 LLM 参与

经 Grep 确认，QwenPaw `builtin_plugins/knowledge-base/backend/` 目录**没有任何 LLM 调用**。分桶是规则匹配（标题关键词分类），知识发现也是规则匹配（正则），检索是关键词子串匹配。

**StaffDeck 对照**：StaffDeck 知识库有 4 处 LLM 调用——分桶规划（`_bucket_with_llm`）、文档路由（`_select_documents_with_llm`）、桶路由（`_select_buckets_with_llm`）、知识发现（`_discover_from_document`）。有 LLM 时走智能路由，无 LLM 时降级为词法评分。

**注意**：StaffDeck 自己也没有真正的向量嵌入（无 sentence-transformers），但其词法评分算法比 QwenPaw 精细得多，且有多级路由缩小搜索范围 + LLM 智能筛选。

### 1.3 字段"定义即废弃"

| 字段 | 定义位置 | 废弃状态 |
|------|---------|---------|
| `node.allowed_actions` | schema.py L104 | `_validate_decision` 完全不校验 |
| `node.expected_user_info` | schema.py L103 | 无任何逻辑读取 |
| `node.retry_policy` | schema.py L105 | 无重试逻辑 |
| `card.terminal_node_ids` | schema.py | 靠 `node.type==TERMINAL` 判断，未用此字段 |
| `card.response_rules` | schema.py | prompt 构造中未注入 |
| `card.call_count` | schema.py | `start_skill` 不自增，排行榜恒为 0 |
| `pending_tasks` 队列 | runtime.py | 可 add/pop 但 `_complete_skill` 不自动消费 |

### 1.4 前端体验差距

QwenPaw 知识库前端（`console/src/pages/KnowledgeBase/index.tsx`，923 行）功能覆盖了基本的入库/检索/OKF 浏览/发现建议，但与 StaffDeck（`KnowledgePage.tsx`，3170 行）相比缺少：

| StaffDeck 有 | QwenPaw 缺 | 影响 |
|---|---|---|
| 文件拖拽上传（FileDropzone） | 只有文本入库弹窗 | 用户无法直接上传文件 |
| 入库任务进度（10 阶段进度条 + 1.4s 轮询） | 同步入库，无进度反馈 | 大文件上传时用户无感知 |
| 检索调试面板（route_trace 可视化 + 证据包展示） | 只有结果列表 | 无法调试检索质量 |
| 知识图谱三视图（目录索引/概念图/引用来源） | 只有 OKF 概念列表 | 知识结构不直观 |
| Bucket/Chunk 编辑 | 无 | 知识切片不可修正 |

---

## 2. v5.0 改造方案总览

核心思路：**不是添加新组件，而是"拼装通电 + 算法升级 + 体验补齐"**。

### 2.1 三大改造板块

| 板块 | 优先级 | 核心目标 | 工期 |
|------|--------|---------|------|
| **板块 A：SOP 执行闭环** | P0 | 创建编排器，打通知识检索→生成回复、工具调用→执行→回灌的闭环 | 1 周 |
| **板块 B：知识库 LLM 增强（L1 复刻）** | P0 | 移植 StaffDeck 的 LLM 分桶/路由/发现 + 中文 n-gram 评分，保留 JSON 存储 | 2 周 |
| **板块 C：前端体验升级（选择性 L2）** | P1 | 用 Ant Design 重写 StaffDeck 的文件上传/检索调试/知识图谱三视图 | 2 周 |

### 2.2 不做的部分

| 不做项 | 原因 |
|--------|------|
| 引入数据库（SQLModel + SQLite） | 改动太大，JSON 存储够用；后续可独立引入 |
| 多租户 / 多知识库实体 | QwenPaw 无多租户概念，单全局知识库即可 |
| 版本管理 / 广场同步 / 分支回滚 | 深度绑定数据库层，投入产出比低 |
| shadcn/ui 前端直接移植 | 与 QwenPaw 的 Ant Design 技术栈冲突，必须重写 |
| 真正的向量嵌入（sentence-transformers） | StaffDeck 自己也没有，n-gram + LLM 路由已足够 |

### 2.3 技术栈约束

- **后端**：继续 FastAPI + Pydantic + aiofiles + orjson，不引入 SQLModel/SQLAlchemy
- **前端**：继续 React + Ant Design 5 + Less + `--sd-*` token，不引入 TailwindCSS/shadcn
- **LLM 调用**：使用 QwenPaw 已有的 `create_model_and_formatter` + `consume_model_response` 异步接口
- **解析器依赖**：仅 `pypdf` + `python-docx`（已有降级方案）

---

## 3. 板块 A：SOP 执行闭环修复

### 3.1 创建 SOP 编排器 `sop/orchestrator.py`

**这是 v5.0 最核心的新增文件。** 借鉴 StaffDeck `agent_loop.py` 的编排模式，实现知识检索和工具执行的自动闭环。

**创建文件**：`src/aiarb/sop/orchestrator.py`

```python
"""SOP 编排器 - 借鉴 StaffDeck agent_loop.py 的编排模式。

核心职责：把 StepAgent + Runtime + 知识检索 + 工具执行编排成闭环。
解决"三处断裂"：QUERY_KNOWLEDGE 不闭环、CALL_TOOL 不执行、Router 死代码。
"""
from __future__ import annotations
import logging
from typing import Any

from .schema import SkillCard, SkillGraphNode, StepDecision, StepAction
from .runtime import SkillRuntime, SkillRuntimeState
from .step_agent import StepAgent
from .prompts import build_step_agent_prompt

logger = logging.getLogger(__name__)

MAX_TURN_ITERATIONS = 5  # 单轮最多循环 5 次（检索->工具->检索->工具->回复）


async def run_turn(
    *,
    state: SkillRuntimeState,
    card: SkillCard,
    user_message: str,
    history: list[dict[str, Any]] | None = None,
    agent_id: str | None = None,
    enable_router: bool = True,
) -> dict[str, Any]:
    """执行一轮对话，自动闭环知识检索和工具执行。

    流程（借鉴 StaffDeck agent_loop._prepare_turn）：
    1. [可选] Router 决策场景路由
    2. StepAgent 生成 decision
    3. Runtime.apply_decision 应用决策
    4. 若 action == query_knowledge -> 检索 -> 注入 context -> 回到步骤 2
    5. 若 action == call_tool -> 执行工具 -> 注入 context -> 回到步骤 2
    6. 若 action == reply/ask_user/clarify/advance/handoff -> 返回最终回复

    Returns:
        {
            "reply_text": str,
            "decision": StepDecision,
            "state": SkillRuntimeState,
            "status": str,
            "iterations": int,
            "knowledge_used": bool,
            "tools_used": list[str],
        }
    """
    runtime = SkillRuntime()
    agent = StepAgent(agent_id=agent_id)
    tools_used: list[str] = []
    knowledge_used = False

    # ---- Router 场景路由（可选，仅在没有活跃 skill 时）----
    if enable_router and not state.active_skill_id:
        router_result = await _try_router_decision(
            user_message=user_message,
            state=state,
            history=history,
        )
        if router_result and router_result.get("skill_id"):
            from .store import load_skill
            new_card = load_skill(router_result["skill_id"])
            if new_card:
                card = new_card
                await runtime.start_skill(state, card, user_message)
                logger.info("Router started skill '%s'", router_result["skill_id"])

    # ---- 主循环 ----
    for iteration in range(1, MAX_TURN_ITERATIONS + 1):
        current_node = runtime.get_current_node(card, state)
        if current_node is None:
            return _result(
                reply_text="当前无活跃节点",
                decision=None, state=state, status="no_node",
                iterations=iteration, knowledge_used=knowledge_used, tools_used=tools_used,
            )

        # StepAgent 决策
        decision = await agent.run(
            card=card,
            current_node=current_node,
            user_message=user_message if iteration == 1 else "",
            context=state.active_context,
            history=history if iteration == 1 else None,
        )

        # 校验 allowed_actions
        decision = _validate_against_node_actions(decision, current_node)

        # Runtime 应用决策
        status = await runtime.apply_decision(state, decision, card)

        action = decision.action.value

        # ---- 闭环：QUERY_KNOWLEDGE ----
        if action == "query_knowledge":
            knowledge_used = True
            # 检索结果已由 runtime 存入 context["_knowledge_results"]
            # 关键：不返回，而是继续循环，让 StepAgent 基于知识结果生成回复
            logger.info(
                "Turn iteration %d: knowledge queried '%s', re-invoking StepAgent",
                iteration, decision.knowledge_query,
            )
            continue

        # ---- 闭环：CALL_TOOL ----
        if action == "call_tool":
            tool_name = decision.tool_name or "unknown"
            tools_used.append(tool_name)
            # 执行工具
            tool_result = await _execute_tool(decision, state, card)
            # 把工具结果注入 context
            if "_tool_results" not in state.active_context:
                state.active_context["_tool_results"] = []
            state.active_context["_tool_results"].append({
                "tool_name": tool_name,
                "tool_args": decision.tool_args,
                "result": tool_result,
                "timestamp": _now_iso(),
            })
            logger.info(
                "Turn iteration %d: tool '%s' executed, re-invoking StepAgent",
                iteration, tool_name,
            )
            continue

        # ---- 终态动作：返回回复 ----
        reply_text = _build_reply_text(decision, status, runtime, card, state)
        return _result(
            reply_text=reply_text,
            decision=decision, state=state, status=status,
            iterations=iteration, knowledge_used=knowledge_used, tools_used=tools_used,
        )

    # 超过最大循环次数，强制返回
    logger.warning("Turn exceeded %d iterations, forcing reply", MAX_TURN_ITERATIONS)
    return _result(
        reply_text="处理超时，请重试或换一种问法。",
        decision=None, state=state, status="max_iterations",
        iterations=MAX_TURN_ITERATIONS, knowledge_used=knowledge_used, tools_used=tools_used,
    )


async def _try_router_decision(
    *,
    user_message: str,
    state: SkillRuntimeState,
    history: list[dict] | None,
) -> dict | None:
    """调用 Router 进行场景路由。

    借鉴 StaffDeck agent_loop._prepare_turn 中的 router.decide 调用。
    """
    try:
        from .router import get_router
        from .store import list_skills

        router = get_router()
        if router is None:
            return None

        skills = list_skills(status="active")
        if not skills:
            return None

        decision = await router.decide(
            user_input=user_message,
            session_state=state,
            available_skills=[
                {"id": s.id, "name": s.name, "description": s.description,
                 "trigger_intents": s.trigger_intents or []}
                for s in skills
            ],
            pending_tasks=state.pending_tasks or [],
        )

        if decision and decision.decision == "start_new_task" and decision.target_skill_id:
            return {"skill_id": decision.target_skill_id}

        return None
    except Exception as e:
        logger.warning("Router decision failed: %s, continuing without router", e)
        return None


def _validate_against_node_actions(
    decision: StepDecision,
    node: SkillGraphNode,
) -> StepDecision:
    """校验 decision 是否在节点 allowed_actions 范围内。

    借鉴 StaffDeck step_agent._available_tools_for_step。
    若节点定义了 allowed_actions 且 decision.action 不在其中，降级为 reply。
    """
    allowed = node.allowed_actions or []
    if not allowed:
        return decision

    action_str = decision.action.value
    simple_allowed = set()
    for a in allowed:
        if isinstance(a, str) and ":" in a:
            simple_allowed.add(a.split(":")[0])
        elif isinstance(a, str):
            simple_allowed.add(a)

    if action_str in simple_allowed:
        return decision

    logger.warning(
        "Action '%s' not in node '%s' allowed_actions %s, downgrading to reply",
        action_str, node.id, allowed,
    )
    decision.action = StepAction.REPLY
    if not decision.content:
        decision.content = "当前步骤不支持此操作。"
    return decision


def _build_reply_text(
    decision: StepDecision,
    status: str,
    runtime: SkillRuntime,
    card: SkillCard,
    state: SkillRuntimeState,
) -> str:
    """构建用户可见回复。"""
    if decision.content:
        return decision.content

    if status == "completed":
        return "流程已完成。"

    if decision.action.value == "advance":
        next_node = runtime.get_current_node(card, state)
        if next_node:
            return f"已进入：{next_node.title}"
        return "已推进到下一步"

    if decision.action.value == "ask_user":
        return decision.content or "请提供更多信息。"

    if decision.action.value == "clarify":
        return decision.content or "让我确认一下您的需求。"

    return decision.content or ""


async def _execute_tool(
    decision: StepDecision,
    state: SkillRuntimeState,
    card: SkillCard,
) -> str:
    """执行工具调用。

    借鉴 StaffDeck agent_loop._execute_tool_action_cycle。
    通过插件系统的工具注册表查找并执行工具。
    """
    tool_name = decision.tool_name or ""
    tool_args = decision.tool_args or {}

    try:
        from aiarb.plugins import get_plugin_registry
        registry = get_plugin_registry()
        tool = registry.get_tool(tool_name)
        if tool is None:
            return f"工具 '{tool_name}' 未找到"

        result = await tool.execute(**tool_args) if hasattr(tool, "execute") else str(tool)
        return str(result)
    except Exception as e:
        logger.error("Tool execution failed: %s(%s) -> %s", tool_name, tool_args, e)
        return f"工具执行失败: {e}"


def _result(
    reply_text: str,
    decision: StepDecision | None,
    state: SkillRuntimeState,
    status: str,
    iterations: int,
    knowledge_used: bool,
    tools_used: list[str],
) -> dict[str, Any]:
    return {
        "reply_text": reply_text,
        "decision": decision,
        "state": state,
        "status": status,
        "iterations": iterations,
        "knowledge_used": knowledge_used,
        "tools_used": tools_used,
    }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
```

**关键设计说明**：

1. **`run_turn` 是一个循环**，不是单步。StepAgent 输出 `query_knowledge` 后不返回，而是 `continue` 重新循环。下一轮循环时，`build_step_agent_prompt` 会从 `context["_knowledge_results"]` 读取检索结果注入 prompt，StepAgent 基于知识生成 `reply`。

2. **工具执行后也是 `continue`**，工具结果存入 `context["_tool_results"]`，下一轮 StepAgent 能看到。

3. **`MAX_TURN_ITERATIONS = 5`** 防止无限循环：最多 检索→工具→检索→工具→回复。

4. **`_validate_against_node_actions`** 激活了 `allowed_actions` 字段校验。

5. **Router 集成**：仅在没有活跃 skill 时调用，决定是否启动新 skill。

### 3.2 修复 `app/routers/sop.py:api_runtime_step`

**修改文件**：`src/aiarb/app/routers/sop.py`

将 `api_runtime_step` 函数（L246-301）替换为：

```python
@router.post("/runtime/step", response_model=RuntimeStepResponse)
async def api_runtime_step(req: RuntimeStepRequest):
    """Execute one conversation turn with auto-closure.

    v5.0: 使用编排器自动闭环知识检索和工具执行。
    """
    state = req.state
    if not state.active_skill_id:
        raise HTTPException(
            status_code=400,
            detail="No active skill. Call /runtime/start first.",
        )

    card = load_skill(state.active_skill_id)
    if card is None:
        raise HTTPException(
            status_code=404,
            detail=f"Active skill '{state.active_skill_id}' not found",
        )

    from aiarb.sop.orchestrator import run_turn
    result = await run_turn(
        state=state,
        card=card,
        user_message=req.user_message,
        history=req.history,
        agent_id=req.agent_id or None,
    )

    return RuntimeStepResponse(
        decision=result["decision"],
        state=result["state"],
        status=result["status"],
        reply_text=result["reply_text"],
    )
```

### 3.3 激活 allowed_actions 校验

**修改文件**：`src/aiarb/sop/step_agent.py`

在 `_validate_decision` 函数中（现有校验之后、`return decision` 之前）添加：

```python
    # v5.0: 校验 allowed_actions
    allowed = getattr(current_node, "allowed_actions", None) or []
    if allowed:
        action_str = decision.action.value
        simple_allowed = set()
        for a in allowed:
            if isinstance(a, str) and ":" in a:
                simple_allowed.add(a.split(":")[0])
            elif isinstance(a, str):
                simple_allowed.add(a)

        if action_str not in simple_allowed:
            logger.warning(
                "Action '%s' not allowed at node '%s' (allowed: %s), downgrading to reply",
                action_str, current_node.id, allowed,
            )
            decision.action = StepAction.REPLY
            if not decision.content:
                decision.content = "当前步骤不支持此操作。"

    return decision
```

### 3.4 激活动态规则组装

**修改文件**：`src/aiarb/sop/prompts.py`

在 `build_step_agent_prompt` 函数中根据运行时状态动态组装规则段。在现有 prompt 构造逻辑的基础上添加以下动态段：

```python
def build_step_agent_prompt(card, current_node, context):
    """构建 StepAgent 系统提示词。

    v5.0: 动态规则组装，借鉴 StaffDeck step_agent._step_instructions。
    按运行时状态条件拼接规则段。
    """
    parts = []

    # 基础规则（保留现有 7 条静态规则）
    parts.append(_base_rules())

    # 动态：节点 allowed_actions 裁剪可用动作
    allowed = getattr(current_node, "allowed_actions", None) or []
    if allowed:
        parts.append(f"\n## 当前节点允许的动作\n你只能选择以下动作：{', '.join(allowed)}\n")
    else:
        parts.append("\n## 当前节点允许的动作\n无限制，所有动作可用。\n")

    # 动态：知识检索结果存在时，追加知识规则
    knowledge_results = context.get("_knowledge_results", []) if context else []
    if knowledge_results:
        parts.append(_knowledge_rules())
        parts.append(_format_knowledge_results(knowledge_results[-3:]))

    # 动态：工具结果存在时，追加工具规则
    tool_results = context.get("_tool_results", []) if context else []
    if tool_results:
        parts.append(_tool_continuation_rules())
        parts.append(_format_tool_results(tool_results[-3:]))

    # 动态：技能级 response_rules
    response_rules = getattr(card, "response_rules", None) or []
    if response_rules:
        parts.append("\n## 响应规则\n")
        for rule in response_rules:
            parts.append(f"- {rule}\n")

    # 动态：等待输入状态
    awaiting = context.get("_awaiting_input", False) if context else False
    if awaiting:
        parts.append(_awaiting_input_rules())

    return "".join(parts)


def _knowledge_rules() -> str:
    return """
## 知识检索结果规则
上方已注入知识库检索结果。请基于检索结果回答用户问题：
- 引用知识时使用 [N] 编号标注来源
- 若检索结果不足以回答，明确告知用户
- 不要编造检索结果中不存在的信息
"""


def _tool_continuation_rules() -> str:
    return """
## 工具执行结果规则
上方已注入工具执行结果。请基于工具结果继续判断下一步动作：
- 若工具结果已满足需求，生成 reply 回复用户
- 若需要进一步操作，继续输出相应 action
"""


def _awaiting_input_rules() -> str:
    return """
## 等待输入规则
当前正在等待用户提供信息。请：
- 检查用户是否已提供所需信息
- 若信息完整，继续推进流程
- 若信息不完整，再次询问
"""


def _format_knowledge_results(results: list) -> str:
    """格式化知识检索结果注入 prompt。"""
    if not results:
        return ""
    parts = ["\n## 知识检索结果\n"]
    for i, kr in enumerate(results, 1):
        parts.append(f"\n### 检索 {i}: {kr.get('query', '')}\n")
        for j, chunk in enumerate(kr.get("results", [])[:3], 1):
            parts.append(f"[{j}] {chunk.get('document_title', '')}: {chunk.get('chunk_content', '')[:500]}\n")
        for concept in kr.get("concepts", [])[:2]:
            parts.append(f"  概念: {concept.get('title', '')} - {concept.get('description', '')[:200]}\n")
    return "".join(parts)


def _format_tool_results(results: list) -> str:
    """格式化工具执行结果注入 prompt。"""
    if not results:
        return ""
    parts = ["\n## 工具执行结果\n"]
    for i, tr in enumerate(results, 1):
        parts.append(f"\n### 工具 {i}: {tr.get('tool_name', '')}\n")
        parts.append(f"参数: {tr.get('tool_args', {})}\n")
        result_str = str(tr.get("result", ""))
        parts.append(f"结果: {result_str[:1000]}\n")
    return "".join(parts)
```

### 3.5 修复 pending_tasks 自动消费

**修改文件**：`src/aiarb/sop/runtime.py`

在 `_complete_skill` 函数中（现有 `restore_task_frame` 调用之后）添加 pending_tasks 消费：

```python
def _complete_skill(self, state, card):
    """完成当前 skill，自动恢复挂起的任务或消费 pending_tasks。"""
    completed_skill_id = state.active_skill_id
    state.active_skill_id = None
    state.active_node_id = None
    state.active_context = {}

    # 先尝试恢复挂起的 task frame
    restored = self.restore_task_frame(state)
    if restored:
        return "completed_and_restored"

    # v5.0: 消费 pending_tasks 队列
    if state.pending_tasks:
        next_task = state.pending_tasks[0]
        state.pending_tasks = state.pending_tasks[1:]
        if next_task.get("skill_id"):
            from .store import load_skill
            next_card = load_skill(next_task["skill_id"])
            if next_card:
                state.active_skill_id = next_card.id
                state.active_node_id = next_card.start_node_id
                state.active_context = next_task.get("context", {})
                logger.info("Auto-activated pending task: skill '%s'", next_task["skill_id"])
                return "completed_and_activated_pending"

    return "completed"
```

### 3.6 修复 call_count 自增

**修改文件**：`src/aiarb/sop/runtime.py` + `src/aiarb/sop/store.py`

在 `runtime.py:start_skill` 中（设置 `state.active_skill_id = card.id` 之后）添加：

```python
    # v5.0: 自增 call_count
    try:
        from .store import increment_call_count
        increment_call_count(card.id)
    except Exception as e:
        logger.warning("Failed to increment call_count: %s", e)
```

在 `store.py` 中新增函数：

```python
def increment_call_count(skill_id: str) -> None:
    """自增技能调用次数。"""
    card = load_skill(skill_id)
    if card:
        card.call_count = (card.call_count or 0) + 1
        save_skill(card)
```

---

## 4. 板块 B：知识库 LLM 增强（L1 复刻）

### 4.1 StaffDeck vs QwenPaw 知识库函数级对比

| 维度 | QwenPaw 现状 | StaffDeck 对照 | 差距 |
|------|---------|-----------|------|
| **分桶方式** | 规则匹配（标题关键词分类 topics/playbooks/rules） | LLM 规划（`_bucket_with_llm` + 结构桶回退） | QwenPaw 无 LLM 分桶 |
| **检索路由** | 单层：chunk 关键词匹配 | 多级漏斗：concept→document→bucket→section→chunk | QwenPaw 仅 1 级 |
| **LLM 路由** | 无 | `_select_documents_with_llm` + `_select_buckets_with_llm` | QwenPaw 缺 LLM 智能路由 |
| **知识发现** | 规则匹配（正则） | LLM 发现（`_discover_from_document`） | QwenPaw 无 LLM 发现 |
| **评分算法** | 粗糙：全匹配 0.8，词匹配 `0.3+0.1*n`，**空格分词** | 精细：全匹配 5.0 + 词长加权 n-gram（中文 4 字 +3.0，5 字 +3.4） | QwenPaw 中文检索能力弱 |
| **概念搜索** | `okf.search_concepts` 有 n-gram（2/3/4 字） | 同源算法 | **基本对齐** |
| **LLM 调用方式** | 无 LLM 调用 | `LLMClient(model_config).generate_json(prompt, payload)` 同步 | 需适配为 QwenPaw 异步方式 |
| **prompt 文件** | 无 | 4 个 .md 文件（bucket/discovery/document_route/search） | 需移植 |
| **存储后端** | JSON 文件 | 数据库（SQLModel） | **保持 JSON，不改** |

### 4.2 新建知识库 LLM 封装层 `kb_llm.py`

**创建文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/kb_llm.py`

StaffDeck 用同步 `LLMClient.generate_json(prompt, payload)`，QwenPaw 用异步 `create_model_and_formatter` + `consume_model_response`。需要新建封装层抹平差异。

```python
"""知识库 LLM 封装层 - 把 StaffDeck 的同步 generate_json 适配为 QwenPaw 的异步调用方式。

StaffDeck 调用方式：LLMClient(model_config).generate_json(prompt, payload) -> dict
QwenPaw 调用方式：await consume_model_response(model, messages) -> str -> 自己解析 JSON

本模块提供与 StaffDeck generate_json 语义对齐的异步函数。
"""
from __future__ import annotations
import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# prompt 文件目录（复刻 StaffDeck 的 4 个 prompt 文件到此目录）
PROMPTS_DIR = Path(__file__).parent / "prompts"
BUCKET_PROMPT = PROMPTS_DIR / "knowledge_bucket_prompt.md"
DISCOVERY_PROMPT = PROMPTS_DIR / "knowledge_discovery_prompt.md"
DOCUMENT_ROUTE_PROMPT = PROMPTS_DIR / "knowledge_document_route_prompt.md"
SEARCH_PROMPT = PROMPTS_DIR / "knowledge_search_prompt.md"


async def kb_generate_json(
    prompt_path: Path,
    payload: dict[str, Any],
    agent_id: str | None = None,
) -> dict[str, Any]:
    """异步调用 LLM 生成 JSON，语义对齐 StaffDeck LLMClient.generate_json。

    Args:
        prompt_path: prompt 文件路径（.md）
        payload: 传给 LLM 的结构化数据（会被 JSON 序列化为 user message）
        agent_id: QwenPaw agent ID（用于获取模型配置）

    Returns:
        解析后的 dict

    Raises:
        Exception: LLM 调用失败或 JSON 解析失败
    """
    from aiarb.agents.model_factory import create_model_and_formatter
    from aiarb.framework.message import Msg, TextBlock
    from aiarb.utils.model_response import consume_model_response

    model, _formatter = create_model_and_formatter(agent_id=agent_id)

    system_prompt = prompt_path.read_text(encoding="utf-8")
    user_text = json.dumps(payload, ensure_ascii=False, indent=2)

    messages: list[Msg] = [
        Msg(name="system", role="system",
            content=[TextBlock(type="text", text=system_prompt)]),
        Msg(name="user", role="user",
            content=[TextBlock(type="text", text=user_text)]),
    ]

    raw_response = await consume_model_response(model, messages)
    return _parse_json_robust(raw_response)


def _parse_json_robust(text: str) -> dict[str, Any]:
    """鲁棒 JSON 解析，借鉴 StaffDeck _loads_llm_json 的多变体修复策略。

    StaffDeck generate_json 内置 3 次重试 + 多变体解析：
    1. 剥离 markdown 围栏
    2. 截取首尾 {}
    3. 去除 trailing comma
    4. 修复字符串内未转义引号
    """
    if not text or not text.strip():
        raise ValueError("Empty LLM response")

    stripped = text.strip()

    # 1. 剥离 markdown 围栏
    if stripped.startswith("```"):
        stripped = stripped.strip("`").strip()
        if stripped.startswith("json"):
            stripped = stripped[4:].strip()

    # 2. 截取首尾 {}
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end >= start:
        stripped = stripped[start : end + 1]
    else:
        raise ValueError(f"No JSON object found in response: {text[:200]}")

    # 3. 尝试直接解析
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # 4. 去除 trailing comma（StaffDeck _remove_trailing_commas）
    cleaned = re.sub(r",\s*([}\]])", r"\1", stripped)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 5. 最终尝试
    raise ValueError(f"Failed to parse JSON from LLM response: {stripped[:200]}")
```

### 4.3 移植 4 个 prompt 文件

**操作**：将 StaffDeck 的 4 个 prompt 文件复制到 QwenPaw 知识库插件目录。

源文件（StaffDeck）：
- `d:\BaiduSyncdisk\Project\StaffDeck\backend\app\llm\prompts\knowledge_bucket_prompt.md`
- `d:\BaiduSyncdisk\Project\StaffDeck\backend\app\llm\prompts\knowledge_discovery_prompt.md`
- `d:\BaiduSyncdisk\Project\StaffDeck\backend\app\llm\prompts\knowledge_document_route_prompt.md`
- `d:\BaiduSyncdisk\Project\StaffDeck\backend\app\llm\prompts\knowledge_search_prompt.md`

目标位置（QwenPaw）：
- `src/aiarb/builtin_plugins/knowledge-base/backend/prompts/knowledge_bucket_prompt.md`
- `src/aiarb/builtin_plugins/knowledge-base/backend/prompts/knowledge_discovery_prompt.md`
- `src/aiarb/builtin_plugins/knowledge-base/backend/prompts/knowledge_document_route_prompt.md`
- `src/aiarb/builtin_plugins/knowledge-base/backend/prompts/knowledge_search_prompt.md`

prompt 文件内容无需改动——它们已是中文、与 provider 无关、只描述输入 payload 结构和输出 JSON schema。

### 4.4 改造入库流程：LLM 分桶

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/service.py`

在 `ingest_document` 和 `ingest_text` 的 OKF 构建步骤中，增加 LLM 分桶分支（有 LLM 时用 LLM，失败回退到现有规则分桶）。

StaffDeck 的 `_bucket_with_llm` 接收 section_nodes（含 section_id/path/title/summary/excerpt），返回 LLM 规划的 bucket 列表。QwenPaw 现有 section 只有 `title/content`，需要补齐字段映射。

在 `service.py` 的入库流程中（现有 `build_buckets_from_sections` 调用处）改为：

```python
# 现有代码（保留作为回退）：
# buckets = build_buckets_from_sections(sections)

# v5.0: 先尝试 LLM 分桶，失败回退到规则分桶
buckets = await _build_buckets_with_llm_fallback(sections, agent_id)

# concepts = build_okf_for_document(doc_id, title, sections, buckets)  # 后续不变
```

新增函数：

```python
async def _build_buckets_with_llm_fallback(
    sections: list[dict[str, str]],
    agent_id: str | None = None,
) -> dict[str, list[dict[str, str]]]:
    """LLM 分桶 + 规则回退。

    借鉴 StaffDeck _build_buckets：先取 model_config，有则 LLM 分桶，无则/失败则规则分桶。
    """
    # 先尝试 LLM 分桶
    try:
        from .kb_llm import kb_generate_json, BUCKET_PROMPT
        from pathlib import Path

        if not BUCKET_PROMPT.exists():
            logger.warning("Bucket prompt file not found, falling back to rule-based bucketing")
            return build_buckets_from_sections(sections)

        # 构造 StaffDeck 格式的 section_nodes
        section_nodes = []
        for i, s in enumerate(sections[:60]):  # StaffDeck 限制最多 60 个 section
            content = s.get("content", "")
            section_nodes.append({
                "section_id": str(i),
                "path": s.get("title", ""),
                "title": s.get("title", ""),
                "summary": content[:180],
                "excerpt": content[:1800],
            })

        payload = {"sections": section_nodes}
        raw = await kb_generate_json(BUCKET_PROMPT, payload, agent_id)

        # StaffDeck LLM 返回: {buckets: [{bucket_key, title, summary, bucket_type, concept_type, section_ids, applicable_query_types}]}
        llm_buckets = raw.get("buckets", [])
        if not isinstance(llm_buckets, list) or not llm_buckets:
            logger.info("LLM bucketing returned empty, falling back to rules")
            return build_buckets_from_sections(sections)

        # 转换 LLM 桶为 QwenPaw 的 OKF bucket 格式 {topics: [], playbooks: [], rules: []}
        return _convert_llm_buckets_to_okf_format(llm_buckets, sections)

    except Exception as e:
        logger.warning("LLM bucketing failed: %s, falling back to rule-based bucketing", e)
        return build_buckets_from_sections(sections)


def _convert_llm_buckets_to_okf_format(
    llm_buckets: list[dict],
    sections: list[dict[str, str]],
) -> dict[str, list[dict[str, str]]]:
    """把 StaffDeck LLM 桶格式转换为 QwenPaw OKF bucket 格式。

    StaffDeck LLM 桶: {bucket_key, title, summary, bucket_type, concept_type, section_ids}
    QwenPaw OKF 桶: {topics: [{title, content}], playbooks: [...], rules: [...]}

    concept_type 映射: Topic -> topics, Playbook -> playbooks, Business Rule -> rules
    """
    buckets: dict[str, list[dict[str, str]]] = {"topics": [], "playbooks": [], "rules": []}

    # section_id -> section 映射
    section_map = {str(i): s for i, s in enumerate(sections)}

    for lb in llm_buckets:
        if not isinstance(lb, dict):
            continue
        concept_type = str(lb.get("concept_type", "Topic")).strip()
        title = str(lb.get("title", lb.get("bucket_key", "未命名")))
        summary = str(lb.get("summary", ""))

        # 根据 section_ids 收集内容
        section_ids = lb.get("section_ids", [])
        if isinstance(section_ids, list):
            content_parts = []
            for sid in section_ids:
                s = section_map.get(str(sid))
                if s:
                    content_parts.append(f"## {s.get('title', '')}\n{s.get('content', '')}")
            content = "\n\n".join(content_parts) if content_parts else summary
        else:
            content = summary

        bucket_item = {"title": title, "content": content}

        if concept_type == "Playbook":
            buckets["playbooks"].append(bucket_item)
        elif concept_type == "Business Rule":
            buckets["rules"].append(bucket_item)
        else:
            buckets["topics"].append(bucket_item)

    # 若 LLM 桶为空，回退
    if not any(buckets.values()):
        return build_buckets_from_sections(sections)

    return buckets
```

### 4.5 改造检索流程：中文 n-gram + LLM 路由

#### 4.5.1 修复中文 n-gram 分词和评分

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/vector_store.py`

在文件头部添加以下两个函数：

```python
def _query_terms(query: str) -> list[str]:
    """中文 n-gram 分词，借鉴 StaffDeck _query_terms。

    对中文做 4/3/2 字滑动窗口扩展，解决中文无空格问题。
    """
    query = query.strip().lower()
    if not query:
        return []

    terms: list[str] = []
    parts = query.split()
    for part in parts:
        if part.isascii():
            terms.append(part)
        else:
            n = len(part)
            for size in (4, 3, 2):
                if n >= size:
                    for i in range(n - size + 1):
                        gram = part[i : i + size]
                        if gram not in terms:
                            terms.append(gram)
            if part not in terms:
                terms.append(part)
    return terms


def _score_text(query: str, content: str) -> float:
    """改进的词法评分，借鉴 StaffDeck _score_text。

    - 整句命中 +5.0
    - 中文 n-gram 按词长加权（4字 +3.0，3字 +2.5，2字 +2.0）
    - 英文按词长加权（>=5字 +3.4，3-4字 +2.0）
    - 上限 8.0
    """
    query_lower = query.lower().strip()
    content_lower = content.lower()

    if not query_lower or not content_lower:
        return 0.0

    score = 0.0

    if query_lower in content_lower:
        score += 5.0

    terms = _query_terms(query_lower)
    for term in terms:
        if term in content_lower:
            tlen = len(term)
            if tlen >= 5:
                score += 3.4
            elif tlen >= 4:
                score += 3.0
            elif tlen >= 3:
                score += 2.5
            elif tlen >= 2:
                score += 2.0
            else:
                score += 1.0

    return min(score, 8.0)
```

然后修改 `search` 方法，用 `_score_text` 替换硬编码评分。将原有评分逻辑：

```python
# 原代码（删除）：
score = 0.0
if query_lower in content_lower:
    score = 0.8
elif query_terms:
    matched_terms = sum(1 for t in query_terms if t in content_lower)
    score = 0.3 + 0.1 * matched_terms
```

替换为：

```python
# 新代码：
score = _score_text(query, chunk["content"])
```

#### 4.5.2 增加多级漏斗检索路由

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/service.py`

在 `search` 方法中增加多级漏斗路由（借鉴 StaffDeck `_search` 的 concept→document→bucket→section→chunk 结构）。

现有 `search` 方法已有 OKF 概念搜索 + chunk 检索 + 引用生成三路并行。改造为**多级漏斗**：先概念搜索缩小范围，再文档级筛选，再 chunk 排序。

```python
async def search(self, query: str, top_k: int = 5, knowledge_scope: str = "",
                 filter_tags: list[str] | None = None,
                 agent_id: str | None = None) -> dict[str, Any]:
    """多级漏斗检索，借鉴 StaffDeck _search。

    Level 1: OKF 概念搜索（已有，保留）
    Level 2: 文档级筛选（新增：LLM 路由或词法评分）
    Level 3: chunk 排序（已有，改用 _score_text）
    """
    trace: list[dict] = []  # 检索路由追踪

    # Level 1: OKF 概念搜索（保留现有逻辑）
    all_concepts = await self._load_okf_concepts()
    concept_results = search_concepts(all_concepts, query, top_k=3)
    trace.append({"phase": "concept_search", "hit_count": len(concept_results)})

    # Level 2: 文档级筛选
    all_docs = await self._vector_store.list_documents()
    trace.append({"phase": "document_load", "candidate_count": len(all_docs)})

    # 尝试 LLM 文档路由
    selected_doc_ids = await _route_documents(query, all_docs, concept_results, agent_id, trace)

    # Level 3: chunk 检索（在选中文档范围内）
    if selected_doc_ids:
        # 只在选中文档中检索
        chunks = await self._vector_store.search_in_documents(
            query, selected_doc_ids, top_k=top_k,
            filter_scope=knowledge_scope, filter_tags=filter_tags,
        )
    else:
        # 回退：全量检索
        chunks = await self._vector_store.search(
            query, top_k, filter_scope=knowledge_scope, filter_tags=filter_tags,
        )
    trace.append({"phase": "chunk_rank", "result_count": len(chunks)})

    # 生成引用（保留现有逻辑）
    from .citations import knowledge_citations_from_results
    citations = knowledge_citations_from_results(
        {"selected_concepts": [c for c, _ in concept_results[:3]],
         "evidence_pack": chunks[:top_k]},
        limit=4,
    )

    return {
        "chunks": chunks,
        "concepts": [c for c, _ in concept_results],
        "citations": citations,
        "trace": trace,  # 新增：检索路由追踪
    }


async def _route_documents(
    query: str,
    documents: list[dict],
    concept_results: list,
    agent_id: str | None,
    trace: list[dict],
) -> list[str]:
    """文档级路由：LLM 路由或词法评分。

    借鉴 StaffDeck _select_documents_with_llm / _score_documents。
    """
    # 合并概念关联的 document_id
    concept_doc_ids = set()
    for concept, _ in concept_results:
        doc_id = concept.get("document_id", "") if isinstance(concept, dict) else ""
        if doc_id:
            concept_doc_ids.add(doc_id)

    # 尝试 LLM 路由
    try:
        from .kb_llm import kb_generate_json, DOCUMENT_ROUTE_PROMPT

        if DOCUMENT_ROUTE_PROMPT.exists() and documents:
            # 构造文档卡片（借鉴 StaffDeck _document_card_for_route）
            doc_cards = []
            for doc in documents[:40]:  # 最多 40 个候选
                doc_cards.append({
                    "id": doc.get("id", ""),
                    "title": (doc.get("title", "") or "")[:120],
                    "filename": (doc.get("source_path", "") or "")[:120],
                    "summary": (doc.get("title", "") or "")[:160],
                    "chunk_count": doc.get("chunk_count", 0),
                })

            payload = {
                "query": query,
                "max_documents": 5,
                "documents": doc_cards,
            }
            raw = await kb_generate_json(DOCUMENT_ROUTE_PROMPT, payload, agent_id)
            selected = raw.get("selected_document_ids", [])
            if isinstance(selected, list) and selected:
                # 合并概念关联文档
                selected_set = set(str(s) for s in selected) | concept_doc_ids
                trace.append({"phase": "document_route_llm", "selected": list(selected_set)})
                return list(selected_set)[:5]
    except Exception as e:
        trace.append({"phase": "document_route_llm_failed", "message": str(e)})

    # 回退：词法评分（借鉴 StaffDeck _score_documents）
    scored = []
    for doc in documents:
        title = (doc.get("title", "") or "").lower()
        score = _score_text(query, doc.get("title", ""))
        if score > 0:
            scored.append((doc.get("id", ""), score))
    scored.sort(key=lambda x: x[1], reverse=True)

    selected = [doc_id for doc_id, _ in scored[:5]]
    # 合并概念关联文档
    selected_set = set(selected) | concept_doc_ids
    trace.append({"phase": "document_route_lexical", "selected": list(selected_set)})
    return list(selected_set)[:5]
```

同时在 `vector_store.py` 中新增 `search_in_documents` 方法：

```python
async def search_in_documents(
    self, query, doc_ids: list[str], top_k=5, filter_scope="", filter_tags=None
) -> list[dict]:
    """在指定文档范围内检索（多级漏斗用）。"""
    doc_id_set = set(doc_ids)
    results = []

    for doc in self.index["documents"]:
        if doc["id"] not in doc_id_set:
            continue
        if filter_scope and filter_scope not in doc.get("tags", []):
            continue
        if filter_tags:
            doc_tags = set(doc.get("tags", []))
            if not doc_tags.intersection(filter_tags):
                continue

        for chunk in doc["chunks"]:
            score = _score_text(query, chunk["content"])
            if score > 0:
                results.append({
                    "document_id": doc["id"],
                    "document_title": doc["title"],
                    "chunk_id": chunk["id"],
                    "chunk_content": chunk["content"],
                    "score": round(score, 4),
                    "metadata": chunk.get("metadata", {}),
                })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]
```

### 4.6 改造知识发现：LLM 发现

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/discovery.py`

现有 `discovery.py` 是纯规则匹配（正则）。增加 LLM 发现分支（借鉴 StaffDeck `_discover_from_document`）。

在 `DiscoveryManager` 类中新增 LLM 发现方法：

```python
async def discover_with_llm(
    self,
    doc_id: str,
    title: str,
    sections: list[dict[str, str]],
    buckets: dict[str, list[dict[str, str]]],
    agent_id: str | None = None,
) -> list[dict]:
    """LLM 知识发现，借鉴 StaffDeck _discover_from_document。

    StaffDeck 用 DISCOVERY_PROMPT 调 LLM，产出 skill/tool/warning 三类建议。
    QwenPaw 适配：保留现有规则发现作为回退，新增 LLM 发现分支。
    """
    try:
        from .kb_llm import kb_generate_json, DISCOVERY_PROMPT

        if not DISCOVERY_PROMPT.exists():
            return self.discover_suggestions(doc_id, title, sections, buckets)  # 回退规则

        # 构造 StaffDeck 格式的 payload
        # 展平 buckets 为列表
        bucket_list = []
        for category, items in buckets.items():
            for i, item in enumerate(items):
                bucket_list.append({
                    "id": f"{category}_{i}",
                    "title": item.get("title", ""),
                    "summary": item.get("content", "")[:200],
                    "excerpt": item.get("content", "")[:2400],
                })

        payload = {
            "document": {
                "id": doc_id,
                "filename": title,
                "title": title,
                "file_type": "txt",
            },
            "buckets": bucket_list,
        }

        raw = await kb_generate_json(DISCOVERY_PROMPT, payload, agent_id)
        discoveries = raw.get("discoveries", [])

        if not isinstance(discoveries, list):
            return []

        # 转换为 QwenPaw 的 DiscoverySuggestion 格式
        suggestions = []
        for item in discoveries:
            if not isinstance(item, dict):
                continue
            suggestion_type = str(item.get("suggestion_type", "warning"))
            if suggestion_type not in ("skill", "tool", "warning"):
                suggestion_type = "warning"

            suggestions.append({
                "id": f"llm_{doc_id}_{len(suggestions)}",
                "document_id": doc_id,
                "suggestion_type": suggestion_type,
                "title": str(item.get("title", "")),
                "reason": str(item.get("reason", "")),
                "payload": item.get("payload", {}),
                "source_refs": item.get("source_refs", []),
                "status": "pending",
                "source": "llm",
            })

        return suggestions

    except Exception as e:
        logger.warning("LLM discovery failed: %s, falling back to rules", e)
        return self.discover_suggestions(doc_id, title, sections, buckets)
```

在 `service.py` 的入库流程中，调用 LLM 发现（替换或补充现有规则发现）：

```python
# 现有代码（保留作为回退）：
# suggestions = discovery_mgr.discover_suggestions(doc_id, title, sections, buckets)

# v5.0: 先尝试 LLM 发现，失败回退到规则发现
suggestions = await discovery_mgr.discover_with_llm(
    doc_id, title, sections, buckets, agent_id
)
```

---

## 5. 板块 C：前端体验升级（选择性 L2）

### 5.1 StaffDeck vs QwenPaw 前端对比

| 维度 | StaffDeck | QwenPaw | 差距 |
|------|-----------|---------|------|
| UI 组件库 | shadcn/ui (Radix) | Ant Design 5 | **不同，必须重写** |
| 样式方案 | TailwindCSS 4 原子类 | Less CSS Modules | **不同，必须重写** |
| 状态管理 | 无（useState+事件） | zustand | 可选迁移 |
| 文件上传 | base64+异步任务轮询 | 仅文本入库 | 需新增 |
| 入库进度 | 10 阶段进度条 + 1.4s 轮询 | 同步无进度 | 需新增 |
| 检索调试 | route_trace 可视化 + 证据包 | 仅结果列表 | 需新增 |
| 知识图谱 | 三视图（目录/概念/引用） | OKF 概念列表 | 需增强 |
| Bucket/Chunk 编辑 | 有 | 无 | 可选 |

### 5.2 前端改造范围

**用 Ant Design 重写以下 StaffDeck 交互**（不引入 shadcn/ui / TailwindCSS）：

| 改造项 | StaffDeck 组件 | QwenPaw 对应 (antd) | 优先级 |
|--------|---------------|---------------------|--------|
| 文件上传 | FileDropzone (自研拖拽) | antd `Upload.Dragger` | P0 |
| 入库进度 | KnowledgeJobCard (10 阶段进度条) | antd `Progress` + `Steps` | P1 |
| 检索调试 | KnowledgeSearchDebug (route_trace) | antd `Collapse` + `Timeline` | P1 |
| 知识图谱 | 三视图 Tabs | antd `Tabs` + `Tree` | P2 |
| Bucket 编辑 | Dialog | antd `Modal` + `Form` | P2 |

### 5.3 后端新增端点：文件上传

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/routes.py`

StaffDeck 用 base64 + 异步任务。QwenPaw 可简化为 **FormData 上传 + 同步入库**（保持现有架构简单）。

新增端点：

```python
from fastapi import UploadFile, File

@router.post("/upload")
async def api_upload_document(
    file: UploadFile = File(...),
    title: str = "",
    tags: str = "",
):
    """文件上传入库（FormData 方式）。

    v5.0: 新增文件上传端点，前端用 antd Upload.Dragger 调用。
    保存文件到临时路径后调用 ingest_document。
    """
    import tempfile, os, pathlib

    # 保存上传文件到临时路径
    suffix = pathlib.Path(file.filename or "upload").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # 重命名为原始文件名
        final_path = os.path.join(os.path.dirname(tmp_path), file.filename or "upload")
        os.rename(tmp_path, final_path)

        # 调用入库
        from .models import IngestRequest
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
        request = IngestRequest(
            file_path=final_path,
            title=title or pathlib.Path(file.filename or "").stem,
            tags=tag_list,
        )
        result = await _get_service().ingest_document(request)
        return result
    finally:
        # 清理临时文件
        if os.path.exists(final_path):
            try:
                os.unlink(final_path)
            except Exception:
                pass
```

### 5.4 前端改造：文件上传组件

**修改文件**：`console/src/pages/KnowledgeBase/index.tsx`

用 antd `Upload.Dragger` 替换现有 `IngestModal` 的文本入库：

```tsx
import { Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

const { Dragger } = Upload;

function FileUploadZone({ onUploaded }: { onUploaded: () => void }) {
  const props = {
    name: 'file',
    action: '/api/kb/upload',
    multiple: true,
    accept: '.txt,.md,.markdown,.html,.htm,.pdf,.docx',
    onChange(info: any) {
      const { status, response } = info.file;
      if (status === 'done') {
        message.success(`${info.file.name} 上传成功`);
        onUploaded();
      } else if (status === 'error') {
        message.error(`${info.file.name} 上传失败`);
      }
    },
  };

  return (
    <Dragger {...props} style={{ background: 'var(--sd-surface)', borderRadius: 'var(--sd-radius-card)' }}>
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
      <p className="ant-upload-hint">支持 txt / md / html / pdf / docx 格式</p>
    </Dragger>
  );
}
```

### 5.5 前端改造：检索调试面板

**新增组件**：`console/src/pages/KnowledgeBase/components/SearchDebugPanel.tsx`

展示后端返回的 `trace`（检索路由追踪）和 `evidence_pack`：

```tsx
import { Collapse, Timeline, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

function SearchDebugPanel({ result }: { result: any }) {
  const trace = result?.trace || [];

  return (
    <Collapse
      ghost
      items={[{
        key: 'debug',
        label: '检索路由追踪',
        children: (
          <Timeline
            items={trace.map((t: any, i: number) => ({
              dot: t.phase?.includes('failed')
                ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                : <CheckCircleOutlined style={{ color: '#52c41a' }} />,
              children: (
                <div>
                  <Text strong>{t.phase}</Text>
                  {t.hit_count !== undefined && <Tag>{t.hit_count} 命中</Tag>}
                  {t.candidate_count !== undefined && <Tag>{t.candidate_count} 候选</Tag>}
                  {t.result_count !== undefined && <Tag>{t.result_count} 结果</Tag>}
                  {t.selected && <Tag color="blue">选中: {t.selected.length}</Tag>}
                  {t.message && <Text type="danger">{t.message}</Text>}
                </div>
              ),
            }))}
          />
        ),
      }]}
    />
  );
}
```

### 5.6 前端样式约束

**所有新/改前端组件必须引用 `--sd-*` token**，与 v3.0 设计原则一致：

```less
// 知识库页面样式
.kbPage {
  padding: var(--sd-page-px);

  .kbCard {
    background: var(--sd-surface);
    border-radius: var(--sd-radius-card);
    box-shadow: var(--sd-shadow-soft);
    border: 1px solid var(--sd-border);
  }

  .kbSearchBar {
    background: var(--sd-surface);
    border-radius: var(--sd-radius-md);
    border: 1px solid var(--sd-border);
  }
}
```

---

## 6. 实施顺序与验收标准

### 6.1 实施顺序

```
Phase 1: SOP 执行闭环（板块 A，1 周）
  A1. 创建 sop/orchestrator.py（3.1）
  A2. 修改 sop.py:api_runtime_step 调用编排器（3.2）
  A3. 激活 allowed_actions 校验（3.3）
  A4. 激活动态规则组装（3.4）
  A5. 修复 pending_tasks 消费（3.5）
  A6. 修复 call_count 自增（3.6）
  -> 验收：知识检索后能自动生成回复

Phase 2: 知识库 LLM 增强（板块 B，2 周）
  B1. 创建 kb_llm.py 封装层（4.2）
  B2. 移植 4 个 prompt 文件（4.3）
  B3. 改造入库流程 LLM 分桶（4.4）
  B4. 修复中文 n-gram 检索（4.5.1）
  B5. 增加多级漏斗检索路由（4.5.2）
  B6. 改造知识发现 LLM（4.6）
  -> 验收：中文检索有效、LLM 分桶/路由/发现工作

Phase 3: 前端体验升级（板块 C，2 周）
  C1. 新增文件上传端点（5.3）
  C2. 前端文件上传组件（5.4）
  C3. 前端检索调试面板（5.5）
  C4. 样式统一（5.6）
  -> 验收：文件可上传、检索过程可调试
```

### 6.2 验收标准

| 验收项 | 验证方法 | 预期结果 |
|--------|---------|---------|
| 知识检索闭环 | 启动 SOP -> 提问 -> 单次 API 调用 | 回复含知识内容 + [N] 引用，不是 [知识检索] xxx |
| 工具执行闭环 | StepAgent 输出 call_tool -> 单次 API 调用 | 回复含工具执行结果 |
| 中文检索 | 上传中文文档 -> 搜索中文关键词 | 能检索到结果（不再因空格分词失效） |
| LLM 分桶 | 上传文档 -> 查看入库日志 | 有 LLM 分桶日志，失败时回退规则分桶 |
| LLM 文档路由 | 搜索 -> 查看返回的 trace | trace 含 document_route_llm 或 document_route_lexical |
| LLM 知识发现 | 上传文档 -> 查看发现建议 | 有 LLM 产出的建议（source=llm） |
| allowed_actions | 节点设 allowed_actions=["reply"] -> 输出 advance | 降级为 reply |
| 动态规则 | 知识检索后检查 prompt | prompt 含知识规则段 |
| Router | 无活跃 skill 时发消息 | Router 决定是否启动 skill |
| pending_tasks | 完成 skill 后有待办 | 自动激活下一个待办 |
| call_count | 多次启动同一 skill | 排行榜 call_count 递增 |
| 文件上传 | 前端拖拽文件到上传区 | 文件上传成功并入库 |
| 检索调试面板 | 搜索后展开调试面板 | 显示 route_trace 时间线 |

### 6.3 回归检查

每个 Phase 完成后验证以下功能不受影响：
- SOP 图编辑器正常保存/加载
- 知识库文档上传/检索/删除
- 技能蒸馏功能
- 反思引擎手动触发
- 前端 Workbench 5 Tab 展示
- OKF 概念图浏览
- 知识发现建议接受/拒绝

---

## 7. 关键注意事项

### 7.1 不要删除现有代码

v5.0 是**增强**不是重写。所有修改都是在现有函数内添加逻辑或替换实现，不删除现有文件。`runtime.py`、`step_agent.py`、`router.py`、`reflection.py`、`okf.py`、`citations.py`、`parser.py` 的现有实现保留。LLM 增强都有规则回退。

### 7.2 新增文件清单

| 文件 | 板块 | 说明 |
|------|------|------|
| `src/aiarb/sop/orchestrator.py` | A | SOP 编排器 |
| `src/aiarb/builtin_plugins/knowledge-base/backend/kb_llm.py` | B | 知识库 LLM 封装层 |
| `src/aiarb/builtin_plugins/knowledge-base/backend/prompts/*.md` | B | 4 个 prompt 文件 |
| `console/src/pages/KnowledgeBase/components/SearchDebugPanel.tsx` | C | 检索调试面板 |

### 7.3 前端无需大改

板块 A 和 B 的修复都在后端。前端调用 `/sop/runtime/step` 和 `/api/kb/search` 的接口结构基本不变（search 新增 `trace` 字段但不破坏现有消费）。板块 C 是体验增强，不影响核心功能。

### 7.4 LLM 调用适配要点

StaffDeck 用同步 `LLMClient.generate_json(prompt, payload)`，QwenPaw 用异步 `await consume_model_response(model, messages)`。关键差异：

| 维度 | StaffDeck | QwenPaw | 适配方式 |
|------|-----------|---------|---------|
| 调用方式 | 同步 | 异步 | `kb_generate_json` 用 `await` |
| 入参 | dict 自动序列化 | Msg 列表手动构造 | `kb_generate_json` 内部转换 |
| JSON 输出 | 内置 3 次修复重试 | 纯文本自己解析 | `_parse_json_robust` 多变体修复 |
| 配置来源 | 多租户 DB | `create_model_and_formatter(agent_id)` | 用 agent_id 获取模型 |
| Prompt 载入 | `Path.read_text` | 字符串/函数 | `kb_generate_json` 用 `Path.read_text` |

### 7.5 向量嵌入不在范围内

函数级审计确认 **StaffDeck 自己也没有真正的向量嵌入**（无 sentence-transformers）。两者的差距在评分算法精细度和检索路由深度，不在向量嵌入。v5.0 的中文 n-gram + LLM 路由已能显著改善检索质量。

### 7.6 doc_processing 废弃状态不变

v3.0 已决策不使用 `doc_processing`，v5.0 维持此决策。知识库插件继续使用内嵌 `parser.py`。

---

## 8. StaffDeck 与 QwenPaw 知识库/SOP 函数级对比速查

### 8.1 知识库对比

| 函数/能力 | StaffDeck | QwenPaw v4.0 | QwenPaw v5.0 目标 |
|-----------|-----------|-------------|-------------------|
| 文档解析 | `parser.py extract_text` | 已移植 | 不变 |
| 文本分节 | `_build_section_nodes` 标题正则+层级 | `_split_sections` 标题+中文章节 | 不变 |
| 分桶 | `_bucket_with_llm` LLM + `_structure_bucket_specs` 回退 | `_build_buckets` 规则匹配 | **LLM 分桶 + 规则回退** |
| OKF 概念图 | `build_okf_for_document` + DB 持久化 | 已移植 + JSON 持久化 | 不变 |
| 概念搜索 | `search_concepts` n-gram 评分 | 已移植 | 不变 |
| 知识引用 | `knowledge_citations_from_results` | 已移植 | 不变 |
| chunk 评分 | `_score_text` n-gram + 词长加权 | 空格分词 + 硬编码 | **移植 n-gram 评分** |
| 文档路由 | `_select_documents_with_llm` / `_score_documents` | 无 | **新增 LLM 路由 + 词法回退** |
| 桶路由 | `_select_buckets_with_llm` / `_score_buckets` | 无 | 暂不实现（JSON 存储无 bucket 实体） |
| 知识发现 | `_discover_from_document` LLM | `discover_suggestions` 正则 | **LLM 发现 + 规则回退** |
| 存储后端 | SQLModel + SQLite | JSON 文件 | **保持 JSON** |
| 多租户 | 全程 tenant_id | 无 | **不引入** |

### 8.2 SOP/状态机对比

| 函数/能力 | StaffDeck | QwenPaw v4.0 | QwenPaw v5.0 目标 |
|-----------|-----------|-------------|-------------------|
| 主循环编排 | `agent_loop._prepare_turn` 9 步编排 | 无（单步 API） | **新增 `orchestrator.run_turn`** |
| Router 集成 | `_prepare_turn` 首步调 `router.decide` | 死代码 | **编排器首步调用** |
| 知识检索闭环 | `_execute_knowledge_query_cycle` + `_continue_after_knowledge_query` | 不闭环 | **编排器循环 continue** |
| 工具执行闭环 | `_execute_tool_action_cycle` | 不执行 | **编排器执行工具** |
| allowed_actions | `_available_tools_for_step` 双重校验 | 不校验 | **激活校验** |
| 动态规则 | `_step_instructions` 6 条件拼接 | 静态 7 条 | **动态组装** |
| pending_tasks | 完成后自动 pop | 不消费 | **自动消费** |
| call_count | 启动时自增 | 不自增 | **自增** |
| 7 维反思 | `skill_reflection.py` 3 轮 LLM | 已移植 | 不变 |

---

## 9. 依赖文件索引

### QwenPaw 需修改的文件

| 文件路径 | 板块 | 改动类型 |
|---------|------|---------|
| `src/aiarb/sop/orchestrator.py` | A | 新建 |
| `src/aiarb/app/routers/sop.py` | A | 修改 api_runtime_step |
| `src/aiarb/sop/step_agent.py` | A | 修改 _validate_decision |
| `src/aiarb/sop/prompts.py` | A | 修改 build_step_agent_prompt |
| `src/aiarb/sop/runtime.py` | A | 修改 _complete_skill + start_skill |
| `src/aiarb/sop/store.py` | A | 新增 increment_call_count |
| `src/aiarb/builtin_plugins/knowledge-base/backend/kb_llm.py` | B | 新建 |
| `src/aiarb/builtin_plugins/knowledge-base/backend/prompts/*.md` | B | 新建（4 个文件） |
| `src/aiarb/builtin_plugins/knowledge-base/backend/service.py` | B | 修改入库+检索流程 |
| `src/aiarb/builtin_plugins/knowledge-base/backend/vector_store.py` | B | 修改 search + 新增 search_in_documents |
| `src/aiarb/builtin_plugins/knowledge-base/backend/discovery.py` | B | 新增 discover_with_llm |
| `src/aiarb/builtin_plugins/knowledge-base/backend/routes.py` | C | 新增 upload 端点 |
| `console/src/pages/KnowledgeBase/index.tsx` | C | 修改页面 |
| `console/src/pages/KnowledgeBase/components/SearchDebugPanel.tsx` | C | 新建 |
| `console/src/api/modules/kb.ts` | C | 新增 upload API |

### StaffDeck 参考文件

| 文件路径 | 参考内容 |
|---------|---------|
| `backend/app/knowledge/service.py` | 入库流程、检索漏斗、LLM 调用 |
| `backend/app/knowledge/okf.py` | OKF 概念图（已移植） |
| `backend/app/knowledge/citations.py` | 知识引用（已移植） |
| `backend/app/knowledge/parser.py` | 轻量解析器（已移植） |
| `backend/app/llm/client.py` | LLMClient 接口（适配参考） |
| `backend/app/llm/prompts/knowledge_bucket_prompt.md` | 分桶 prompt（待移植） |
| `backend/app/llm/prompts/knowledge_discovery_prompt.md` | 发现 prompt（待移植） |
| `backend/app/llm/prompts/knowledge_document_route_prompt.md` | 文档路由 prompt（待移植） |
| `backend/app/llm/prompts/knowledge_search_prompt.md` | 桶路由 prompt（待移植） |
| `backend/app/core/agent_loop.py` | 主循环编排（orchestrator 参考） |
| `backend/app/core/skill_runtime.py` | 状态机（runtime 参考） |
| `backend/app/core/router.py` | Router（集成参考） |
| `backend/app/skills/skill_reflection.py` | 7 维反思（已移植） |
| `backend/app/skills/skill_schema.py` | SkillCard 模型（schema 参考） |
