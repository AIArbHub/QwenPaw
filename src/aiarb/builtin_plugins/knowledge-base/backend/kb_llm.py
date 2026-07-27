# -*- coding: utf-8 -*-
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
        Msg(
            name="system",
            role="system",
            content=[TextBlock(type="text", text=system_prompt)],
        ),
        Msg(
            name="user",
            role="user",
            content=[TextBlock(type="text", text=user_text)],
        ),
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
