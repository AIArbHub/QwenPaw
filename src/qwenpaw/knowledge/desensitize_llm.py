# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


async def _extract_model_text(response: Any) -> str:
    if hasattr(response, "__aiter__"):
        accumulated = ""
        async for chunk in response:
            text = _extract_chunk_text(chunk)
            if text:
                accumulated = text
        return accumulated
    return _extract_chunk_text(response)


def _extract_chunk_text(chunk: Any) -> str:
    if isinstance(chunk, str):
        return chunk
    if hasattr(chunk, "text") and chunk.text:
        return chunk.text
    choices = getattr(chunk, "choices", None)
    if choices:
        delta = getattr(choices[0], "delta", None) or getattr(choices[0], "message", None)
        if delta:
            content = getattr(delta, "content", None)
            if content:
                return content
    return ""


def get_llm_call_fn() -> Callable[[str], Coroutine[Any, Any, str]]:
    from ..providers.provider_manager import ProviderManager

    model = ProviderManager.get_active_chat_model()

    async def _call(prompt: str) -> str:
        from agentscope.message import Msg, TextBlock

        messages = [
            Msg(
                name="user",
                role="user",
                content=[TextBlock(type="text", text=prompt)],
            ),
        ]
        response = await model(messages)
        return await _extract_model_text(response)

    return _call

_DESENSITIZE_AI_ONLY_PROMPT = """你是一个专业的法律文档脱敏助手。请对以下文本进行全面脱敏，识别并替换所有敏感信息，包括但不限于：
1. 身份证号码
2. 手机号码
3. 银行卡号
4. 详细地址（精确到门牌号）
5. 人名（原告、被告、代理人、审判员等上下文中的人名）
6. 案号中可能暴露地域的信息（如 (2024)京01民初123号 中的地域标识）
7. 职务+年龄+性别组合可定位个人的描述
8. 其他可直接或间接识别自然人的信息

重要规则：
- 占位符格式：ID_{{seq:03d}}（身份证号）、PHONE_{{seq:03d}}（手机号）、BANK_{{seq:03d}}（银行卡号）、ADDR_{{seq:03d}}（地址）、PERSON_{{seq:03d}}（人名）、CASENO_{{seq:03d}}（案号）、OTHER_{{seq:03d}}（其他）
- seq从001开始自增
- 输出JSON格式，包含 desensitized_text 和 new_mappings 两个字段
- new_mappings 是一个对象，key 是占位符，value 是原始文本
- 不要遗漏任何敏感信息

输入文本：
---
{content}
---

请输出JSON："""

_DESENSITIZE_LLM_PROMPT = """你是一个专业的法律文档脱敏助手。以下文本已经过本地正则脱敏处理，部分敏感信息已被替换为占位符（如 ID_001、PHONE_001、PERSON_001 等）。

请仔细检查文本中是否还有遗漏的敏感信息，包括但不限于：
1. 无上下文标注的零散人名（不在已有占位符中的姓名）
2. 职务+年龄+性别组合可定位个人的描述
3. 案号中可能暴露地域的信息（如 (2024)京01民初123号 中的地域标识）
4. 其他间接可识别自然人的信息

重要规则：
- 不要修改已有的占位符
- 新增占位符格式：PERSON_{{seq:03d}}（人名）、CASENO_{{seq:03d}}（案号）、OTHER_{{seq:03d}}（其他）
- 输出JSON格式，包含 desensitized_text 和 new_mappings 两个字段
- new_mappings 是一个对象，key 是占位符，value 是原始文本

输入文本：
---
{content}
---

请输出JSON："""


async def llm_desensitize(
    desensitized_text: str,
    existing_backfill: dict[str, str] | None = None,
    llm_call_fn: Any = None,
    ai_only: bool = False,
) -> tuple[str, dict[str, str]]:
    if llm_call_fn is None:
        logger.warning("No LLM call function provided, skipping LLM desensitization")
        return desensitized_text, {}

    existing = existing_backfill or {}

    person_max = _max_seq(existing, "PERSON_")
    caseno_max = _max_seq(existing, "CASENO_")
    other_max = _max_seq(existing, "OTHER_")

    if ai_only:
        prompt = _DESENSITIZE_AI_ONLY_PROMPT.format(content=desensitized_text)
    else:
        prompt = _DESENSITIZE_LLM_PROMPT.format(content=desensitized_text)

    try:
        response = await llm_call_fn(prompt)
        parsed = _parse_llm_response(response)

        if not parsed:
            return desensitized_text, {}

        new_text = parsed.get("desensitized_text", desensitized_text)
        new_mappings = parsed.get("new_mappings", {})

        if not isinstance(new_mappings, dict):
            new_mappings = {}

        validated_mappings: dict[str, str] = {}
        for placeholder, original in new_mappings.items():
            if not isinstance(placeholder, str) or not isinstance(original, str):
                continue
            if not re.match(r"^(ID|PHONE|BANK|ADDR|PERSON|CASENO|OTHER)_\d{3}$", placeholder):
                continue
            if placeholder in existing:
                continue
            validated_mappings[placeholder] = original

        return new_text, validated_mappings

    except Exception as exc:
        logger.error("LLM desensitization failed: %s", exc)
        return desensitized_text, {}


def _max_seq(backfill: dict[str, str], prefix: str) -> int:
    max_val = 0
    for key in backfill:
        if key.startswith(prefix):
            try:
                num = int(key[len(prefix):])
                if num > max_val:
                    max_val = num
            except ValueError:
                pass
    return max_val


def _parse_llm_response(response: str) -> dict | None:
    json_match = re.search(r"```json\s*(.*?)\s*```", response, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    try:
        return json.loads(response)
    except json.JSONDecodeError:
        pass

    brace_start = response.find("{")
    brace_end = response.rfind("}")
    if brace_start != -1 and brace_end > brace_start:
        try:
            return json.loads(response[brace_start:brace_end + 1])
        except json.JSONDecodeError:
            pass

    logger.warning("Failed to parse LLM desensitization response as JSON")
    return None