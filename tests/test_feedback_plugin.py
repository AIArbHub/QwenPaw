# -*- coding: utf-8 -*-
"""评分反馈插件单元测试。"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from aiarb.builtin_plugins.agent_feedback.backend.service import (
    FeedbackService,
)


def test_add_feedback():
    """测试添加评分反馈。"""
    class FeedbackCreate:
        agent_id = "test_agent"
        session_id = "session_001"
        message_id = "msg_001"
        rating = 5
        comment = "回复非常专业"
        tags = ["专业", "及时"]

    svc = FeedbackService()

    async def run():
        await svc.initialize()
        result = await svc.add_feedback(FeedbackCreate())
        assert result["agent_id"] == "test_agent"
        assert result["rating"] == 5
        assert result["comment"] == "回复非常专业"
        # 清理
        await svc.delete_feedback(result["id"])
        print("✓ test_add_feedback passed")

    asyncio.run(run())


def test_get_summary():
    """测试评分汇总。"""
    class FeedbackCreate:
        agent_id = "test_agent_summary"
        session_id = ""
        message_id = ""
        rating = 4
        comment = "还不错"
        tags = []

    svc = FeedbackService()

    async def run():
        await svc.initialize()
        # 添加几条评分
        for i in range(5):
            req = FeedbackCreate()
            req.rating = i + 1
            await svc.add_feedback(req)

        # 获取汇总
        summary = await svc.get_summary("test_agent_summary")
        assert summary["total_feedback"] == 5
        assert summary["avg_rating"] == 3.0  # (1+2+3+4+5)/5

        # 清理
        feedbacks = await svc.list_feedback(agent_id="test_agent_summary")
        for fb in feedbacks:
            await svc.delete_feedback(fb["id"])

        print("✓ test_get_summary passed")

    asyncio.run(run())


if __name__ == "__main__":
    test_add_feedback()
    test_get_summary()
    print("\n所有测试通过 ✓")
