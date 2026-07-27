# TRAE Work 实施指示文档：QwenPaw 借鉴 StaffDeck 功能二次开发（v4.0）

> **文档版本**：4.0
> **更新日期**：2026-07-26
> **适用项目**：QwenPaw（moot5 分支）
> **前置条件**：已按 v3.0 完成知识库 OKF/引用/解析器、SOP 引擎、StaffDeck 设计 token 注入

---

## 0. 文档变更说明

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.1 | 2026-07-26 | 移除 doc_processing 依赖，改为内嵌轻量解析器 |
| 3.0 | 2026-07-26 | 确认 SOP/知识库已实现部分；聚焦 OKF/引用/Router/反思/归因 |
| **4.0** | **2026-07-26** | **函数级代码审计后发现：组件齐全但"未拼装通电"；核心修复从"添加新组件"转向"打通已有组件闭环"** |

---

## 1. 为什么 v3.0 方案"还是不行"——根因诊断

v3.0 方案指导实现了 OKF 概念图、知识引用、轻量解析器、Router、7 维反思等组件。函数级代码审计确认这些组件**都有真实实现（非骨架）**，但系统仍然不工作，根因是**三处断裂**：

### 1.1 断裂一：QUERY_KNOWLEDGE 不闭环（最致命）

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

### 1.2 断裂二：CALL_TOOL 不执行

**现象**：系统回复 `[工具调用] tool_name(args)` 但不执行工具。

**根因**：`runtime.py:apply_decision` 的 CALL_TOOL 分支（L136-147）只把工具调用记录到 `active_context["_pending_tool_calls"]`，注释写"actual execution is the caller's responsibility"。但调用方 `sop.py:api_runtime_step` 也**没有执行工具**，只返回字符串。

**StaffDeck 对照**：StaffDeck `agent_loop.py:_execute_tool_action_cycle` 真正调度 `ToolExecutor` 执行工具并回填结果。

### 1.3 断裂三：Router 是死代码

**现象**：Router 完整实现了 9 种决策类型，但从未影响任何对话流程。

**根因**：`router.py:Router.decide()` 在整个项目中**零调用**。`sop.py:api_runtime_step` 直接从 StepAgent 开始，跳过了 Router 的场景路由层。主聊天流程 `chats/api.py` 完全不接 SOP。

**StaffDeck 对照**：StaffDeck `agent_loop.py:_prepare_turn`（L2402）每轮对话首步调用 `router.decide()`，结果经 `runtime.apply_decision()` 落地，决定走 skill 还是直答。

### 1.4 次要问题：字段"定义即废弃"

| 字段 | 定义位置 | 废弃状态 |
|------|---------|---------|
| `node.allowed_actions` | schema.py L104 | `_validate_decision` 完全不校验 |
| `node.expected_user_info` | schema.py L103 | 无任何逻辑读取 |
| `node.retry_policy` | schema.py L105 | 无重试逻辑 |
| `card.terminal_node_ids` | schema.py | 靠 `node.type==TERMINAL` 判断，未用此字段 |
| `card.response_rules` | schema.py | prompt 构造中未注入 |
| `card.call_count` | schema.py | `start_skill` 不自增，排行榜恒为 0 |
| `pending_tasks` 队列 | runtime.py | 可 add/pop 但 `_complete_skill` 不自动消费 |

### 1.5 知识库检索质量问题

**vector_store.py 是伪向量存储**：名为 VectorStore，实为关键词子串匹配。`search` 函数用 `query_lower.split()` 分词——**按空格切分，中文几乎无效**。评分是硬编码：全匹配 0.8，词匹配 `0.3 + 0.1 * matched`。

**StaffDeck 对照**：StaffDeck `_score_text`（service.py L1962）有中文 n-gram（4/3/2 字滑动窗口）、词长加权（中文 4 字 +3.0，5 字 +3.4）、多级漏斗路由（concept→document→bucket→section→chunk）。

**注意**：StaffDeck 自己也没有真正的向量嵌入（无 sentence-transformers），但其词法评分算法比 QwenPaw 精细得多，且有多级路由缩小搜索范围。

---

## 2. v4.0 修复方案总览

核心思路：**不是添加新组件，而是"拼装通电"**——把已有组件用 AgentLoop 模式编排起来，打通闭环。

| 修复点 | 优先级 | 核心改动 | 影响文件 |
|--------|--------|---------|---------|
| 创建 SOP 编排器 | P0 | 实现 run_turn 循环：检索→回灌→生成 | 新建 `sop/orchestrator.py` |
| 修复 api_runtime_step | P0 | 单步逻辑改为调用编排器 | `app/routers/sop.py` |
| 修复中文检索 | P0 | n-gram 分词 + 改进评分 | `builtin_plugins/knowledge-base/backend/vector_store.py` |
| 激活 allowed_actions | P1 | 校验 + 动态裁剪可用动作 | `sop/step_agent.py` + `sop/prompts.py` |
| 激活动态规则组装 | P1 | 按运行时状态条件拼接规则 | `sop/prompts.py` |
| 集成 Router | P1 | 编排器首步调用 Router | `sop/orchestrator.py` |
| 修复 pending_tasks 消费 | P2 | 完成后自动 pop | `sop/runtime.py` |
| 修复 call_count 自增 | P2 | start_skill 时计数 | `sop/runtime.py` + `sop/store.py` |

---

## 3. P0 修复：打通 SOP 主流程闭环

### 3.1 创建 SOP 编排器 `sop/orchestrator.py`

**这是 v4.0 最核心的新增文件。** 借鉴 StaffDeck `agent_loop.py` 的编排模式，实现知识检索和工具执行的自动闭环。

**创建文件**：`src/aiarb/sop/orchestrator.py`

```python
"""SOP 编排器 - 借鉴 StaffDeck agent_loop.py 的编排模式。

核心职责：把 StepAgent + Runtime + 知识检索 + 工具执行编排成闭环。
解决 v3.0 的"三处断裂"：QUERY_KNOWLEDGE 不闭环、CALL_TOOL 不执行、Router 死代码。
"""
from __future__ import annotations
import logging
from typing import Any

from .schema import SkillCard, SkillGraphNode, StepDecision, StepAction
from .runtime import SkillRuntime, SkillRuntimeState
from .step_agent import StepAgent
from .prompts import build_step_agent_prompt

logger = logging.getLogger(__name__)

MAX_TURN_ITERATIONS = 5  # 单轮最多循环 5 次（检索→工具→检索→工具→回复）


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
            "reply_text": str,           # 用户可见回复
            "decision": StepDecision,     # 最终决策
            "state": SkillRuntimeState,   # 更新后的状态
            "status": str,                # runtime 返回的状态
            "iterations": int,            # 实际循环次数
            "knowledge_used": bool,       # 是否使用了知识检索
            "tools_used": list[str],      # 使用的工具列表
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

把单步逻辑替换为编排器调用。将 `api_runtime_step` 函数（L246-301）替换为：

```python
@router.post("/runtime/step", response_model=RuntimeStepResponse)
async def api_runtime_step(req: RuntimeStepRequest):
    """Execute one conversation turn with auto-closure.

    v4.0: 使用编排器自动闭环知识检索和工具执行。
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

### 3.3 修复知识库中文检索

**修改文件**：`src/aiarb/builtin_plugins/knowledge-base/backend/vector_store.py`

**问题**：`search` 函数用 `query_lower.split()` 分词——按空格切分，中文几乎无效。评分是硬编码：全匹配 0.8，词匹配 `0.3 + 0.1 * matched`。

**修复**：添加中文 n-gram 分词 + 改进评分算法（借鉴 StaffDeck `_score_text` 和 `_query_terms`）。

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

---

## 4. P1 修复：激活"定义即废弃"的字段

### 4.1 激活 allowed_actions 校验

**修改文件**：`src/aiarb/sop/step_agent.py`

在 `_validate_decision` 函数中（现有校验之后、`return decision` 之前）添加 allowed_actions 校验：

```python
# 在 _validate_decision 函数末尾添加：

    # v4.0: 校验 allowed_actions
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

注意：编排器 `orchestrator.py` 中的 `_validate_against_node_actions` 是运行时双重校验，`step_agent._validate_decision` 是决策时校验。两处校验确保越界动作被拦截。

### 4.2 激活动态规则组装

**修改文件**：`src/aiarb/sop/prompts.py`

在 `build_step_agent_prompt` 函数中根据运行时状态动态组装规则段。在现有 prompt 构造逻辑的基础上，添加以下动态段：

```python
def build_step_agent_prompt(card, current_node, context):
    """构建 StepAgent 系统提示词。

    v4.0: 动态规则组装，借鉴 StaffDeck step_agent._step_instructions。
    按运行时状态条件拼接规则段。
    """
    parts = []

    # 基础规则（保留现有 7 条静态规则）
    parts.append(_base_rules())  # 现有函数

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

### 4.3 Router 集成说明

Router 集成已在 `orchestrator.py:run_turn` 中实现（见 3.1 代码的 Router 部分）。无需额外修改 `router.py` 本身。

集成逻辑：
- 仅在没有活跃 skill 时调用 Router
- Router 返回 `start_new_task` 且有 `target_skill_id` 时自动启动 skill
- Router 失败时静默降级（不阻断主流程）

---

## 5. P2 修复：次要问题

### 5.1 修复 pending_tasks 自动消费

**修改文件**：`src/aiarb/sop/runtime.py`

在 `_complete_skill` 函数中添加 pending_tasks 消费。在现有 `restore_task_frame` 调用之后添加：

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

    # v4.0: 消费 pending_tasks 队列
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

### 5.2 修复 call_count 自增

**修改文件**：`src/aiarb/sop/runtime.py` + `src/aiarb/sop/store.py`

在 `runtime.py:start_skill` 中添加 call_count 自增（在设置 active_skill_id 之后）：

```python
# 在 start_skill 函数中，设置 state.active_skill_id = card.id 之后添加：

    # v4.0: 自增 call_count
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

## 6. 实施顺序与验收标准

### 6.1 实施顺序

```
Phase 1 (P0, 1 周):
  1. 创建 sop/orchestrator.py（3.1）
  2. 修改 sop.py:api_runtime_step 调用编排器（3.2）
  3. 修复 vector_store.py 中文检索（3.3）
  -> 验收：知识检索后能自动生成回复，不再返回 [知识检索] xxx

Phase 2 (P1, 1 周):
  4. 激活 allowed_actions 校验（4.1）
  5. 激活动态规则组装（4.2）
  6. 确认 Router 集成（4.3，已在编排器中实现）
  -> 验收：节点动作受限、知识/工具有专用规则、Router 影响流程

Phase 3 (P2, 0.5 周):
  7. 修复 pending_tasks 消费（5.1）
  8. 修复 call_count 自增（5.2）
  -> 验收：排行榜有数据、任务队列自动消费
```

### 6.2 验收标准

| 验收项 | 验证方法 | 预期结果 |
|--------|---------|---------|
| 知识检索闭环 | 启动 SOP -> 提问 -> 单次 API 调用返回知识回复 | 回复含知识内容 + [N] 引用，不是 [知识检索] xxx |
| 工具执行闭环 | StepAgent 输出 call_tool -> 单次 API 调用返回工具结果 | 回复含工具执行结果，不是 [工具调用] xxx |
| 中文检索 | 上传中文文档 -> 搜索中文关键词 | 能检索到结果（不再因空格分词失效） |
| allowed_actions | 节点设 allowed_actions=["reply"] -> StepAgent 输出 advance | 降级为 reply，不越界 |
| 动态规则 | 知识检索后检查 prompt | prompt 含知识规则段 + 检索结果 |
| Router | 无活跃 skill 时发消息 | Router 决定是否启动 skill |
| pending_tasks | 完成 skill 后有待办任务 | 自动激活下一个待办 |
| call_count | 多次启动同一 skill | 排行榜 call_count 递增 |

### 6.3 回归检查

每个 Phase 完成后验证以下功能不受影响：
- SOP 图编辑器正常保存/加载
- 知识库文档上传/检索/删除
- 技能蒸馏功能
- 反思引擎手动触发
- 前端 Workbench 5 Tab 展示

---

## 7. 关键注意事项

### 7.1 不要删除现有代码

v4.0 是**增强**不是重写。所有修改都是在现有函数内添加逻辑或替换实现，不删除现有文件。`runtime.py`、`step_agent.py`、`router.py`、`reflection.py` 的现有实现保留。

### 7.2 编排器是新增文件

`orchestrator.py` 是唯一的新增文件。它不替代 `runtime.py`（状态管理）和 `step_agent.py`（决策生成），而是在它们之上编排闭环。

### 7.3 前端无需改动

v4.0 的修复都在后端。前端调用 `/sop/runtime/step` 的接口不变（请求/响应结构不变），只是响应内容从 `[知识检索] xxx` 变为真正的知识回复。

### 7.4 向量嵌入不是当务之急

函数级审计确认 **StaffDeck 自己也没有真正的向量嵌入**（无 sentence-transformers）。两者的差距在评分算法精细度和检索路由深度，不在向量嵌入。v4.0 的中文 n-gram 修复已能显著改善检索质量。后续如需真正的向量嵌入，可单独引入 `sentence-transformers`，但不在 v4.0 范围内。

### 7.5 doc_processing 废弃状态不变

v3.0 已决策不使用 `doc_processing`，v4.0 维持此决策。知识库插件继续使用内嵌 `parser.py`。

---

## 8. v3.0 与 v4.0 差异对照

| 维度 | v3.0 方案 | v4.0 修正 |
|------|----------|----------|
| 核心思路 | 添加新组件（OKF/引用/Router/反思） | 打通已有组件闭环（编排器） |
| 知识检索 | 假设检索后自动生成回复 | 发现检索后不闭环，需编排器 |
| Router | 假设会被集成 | 发现是死代码，需在编排器中调用 |
| 工具执行 | 未提及 | 发现不执行，需在编排器中执行 |
| allowed_actions | 假设会被校验 | 发现不校验，需激活 |
| 中文检索 | 未提及 | 发现空格分词失效，需 n-gram |
| 动态规则 | 未提及 | 发现静态 7 条规则，需动态组装 |
| 代码分析粒度 | 文件级 | 函数级（逐行分析关键逻辑） |
