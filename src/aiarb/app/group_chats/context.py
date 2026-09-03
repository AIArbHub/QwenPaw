# -*- coding: utf-8 -*-
"""Context window management for group-chat rounds.

Prevents context bloat by injecting only summaries of prior member
speech into each member's prompt, rather than full text.

Key principles:
    - Round-robin members receive ``host_opener + prior member summaries``
    - Host summary input = ``openers + each member's result summary``
    - Historical rounds only retain ``summary`` text, not full turns
    - Hard upper bounds on per-prompt token budget
"""

from __future__ import annotations

import logging
from typing import List

from .models import GroupSession, Member, MemberTurn, RoundRecord

logger = logging.getLogger(__name__)

# Hard limits to prevent context explosion (character-level, not exact
# tokens — these are generous upper bounds that the LLM's own context
# window can accommodate).
MAX_MEMBER_REPLY_CHARS = 4000
MAX_PRIOR_MEMBER_SUMMARY_CHARS = 2000
MAX_HISTORICAL_ROUND_SUMMARY_CHARS = 1000
MAX_ROUNDS_IN_CONTEXT = 5


def truncate(text: str, max_chars: int) -> str:
    """Truncate text to at most ``max_chars`` characters with a marker."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n…（已截断）"


def build_member_prompt(
    session: GroupSession,
    member: Member,
    host_opener: str,
    prior_turns: List[MemberTurn],
) -> str:
    """Build the prompt for a member in a round-robin round.

    The prompt includes:
    1. The host's opening framing
    2. Summaries of prior members' replies in this round
    3. Historical round summaries (last N rounds)
    """
    parts: list[str] = []

    # Historical context (last N rounds, summary only)
    recent_rounds = session.rounds[-MAX_ROUNDS_IN_CONTEXT:]
    if recent_rounds:
        history_parts: list[str] = []
        for rd in recent_rounds:
            if rd.summary:
                history_parts.append(
                    f"[第{rd.round_no}轮纪要] "
                    + truncate(rd.summary, MAX_HISTORICAL_ROUND_SUMMARY_CHARS),
                )
        if history_parts:
            parts.append("## 历史讨论纪要\n")
            parts.append("\n".join(history_parts))
            parts.append("")

    # Host opener
    if host_opener:
        parts.append("## 主持人引导\n")
        parts.append(host_opener)
        parts.append("")

    # Prior member replies in this round
    if prior_turns:
        parts.append("## 前序成员观点\n")
        for t in prior_turns:
            if t.result:
                member_name = "未知成员"
                m = session.find_member(t.member_id)
                if m:
                    member_name = m.name or m.agent_id
                parts.append(
                    f"**{member_name}**: "
                    + truncate(t.result, MAX_PRIOR_MEMBER_SUMMARY_CHARS),
                )
        parts.append("")

    # Instruction — remind the member of their identity
    member_name = member.name or member.agent_id
    parts.append("## 请你发言\n")
    parts.append(
        f"你是「{member_name}」，请基于以上信息给出你的独立观点。"
        "如果你同意前序成员的观点，请说明理由；"
        "如有不同意见或补充，也请明确阐述。",
    )

    # Assist hint (M1 HITL档4): if the member has an assist_hint,
    # append it as a direction for the agent to follow.
    if member.assist_hint:
        parts.append("")
        parts.append(f"发言方向提示：{member.assist_hint}")

    return "\n".join(parts)


def build_parallel_member_prompt(
    host_opener: str,
    topic: str,
) -> str:
    """Build the prompt for a member in a parallel round.

    All members receive the same prompt — no knowledge of other members.
    """
    parts: list[str] = []
    if host_opener:
        parts.append(host_opener)
        parts.append("")
    parts.append(
        "## 请你就以上议题给出你的独立观点。\n"
        "注意：你是群聊成员之一，请从你自身的专业角度出发，"
        "给出有依据的分析和判断。",
    )
    return "\n".join(parts)


def build_host_summary_prompt(
    session: GroupSession,
    host_opener: str,
    turns: List[MemberTurn],
) -> str:
    """Build the prompt for the host's summary sub-run.

    The host receives each member's reply (truncated) and produces a
    structured summary with consensus, disagreement, and conclusion.
    """
    parts: list[str] = []

    if host_opener:
        parts.append("## 本轮议题\n")
        parts.append(host_opener)
        parts.append("")

    parts.append("## 各成员观点\n")
    for t in turns:
        member_name = "未知成员"
        m = session.find_member(t.member_id)
        if m:
            member_name = m.name or m.agent_id
        # Annotate human-produced turns so the host knows which views
        # came from a human playing that role (M1 HITL).
        human_tag = "（由人类扮演者发言）" if t.human_override else ""
        parts.append(
            f"### {member_name}{human_tag}\n"
            + truncate(t.result, MAX_MEMBER_REPLY_CHARS),
        )
    parts.append("")

    parts.append("## 请你综合以上观点，输出讨论纪要：")
    parts.append("1. **议题概述**：简要概括本轮讨论的核心议题")
    parts.append("2. **各成员核心观点**：逐一列出每位成员的主要论点")
    parts.append("3. **共识与分歧**：明确标注哪些方面达成了共识、哪些存在分歧")
    parts.append("4. **主持人结论**：你的最终结论或建议")
    parts.append("")
    parts.append("请使用清晰的小标题和列表格式，面向 C 端用户，避免技术黑话。")

    return "\n".join(parts)


def build_host_opener_prompt(
    user_message: str,
    session: GroupSession,
    phase_hint: str = "",
) -> str:
    """Build the prompt for the host's opening sub-run.

    The host decomposes the user's topic into a clear discussion framing.

    M3: If a ``phase_hint`` is provided (from a script phase), the opener
    is guided to frame the discussion for that specific phase.
    """
    member_names = ", ".join(
        m.name or m.agent_id for m in session.ordered_members()
    )
    parts: list[str] = [
        "你是群聊主持人。请将以下用户议题拆解为清晰的讨论引导，"
        "作为本轮讨论的开场白。\n"
        "要求：\n"
        "- 简洁明了地介绍议题背景和讨论焦点\n"
        "- 不要替成员回答问题\n"
        "- 可以提出 1-3 个引导性问题供成员参考\n\n"
        f"成员名单：{member_names}\n\n"
        f"用户议题：{user_message}\n\n"
    ]

    if phase_hint:
        parts.append(
            f"当前讨论阶段：{phase_hint}\n"
            "请围绕该阶段的特点引导发言。\n\n"
        )

    parts.append("请输出开场白。")
    return "\n".join(parts)
