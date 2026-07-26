# -*- coding: utf-8 -*-
"""Agent Feedback 插件入口。"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class AgentFeedbackPlugin:
    """评分反馈插件定义。"""

    def register(self, api: Any) -> None:
        """注册插件能力。"""
        from .backend.routes import create_feedback_router

        router = create_feedback_router()
        api.register_http_router(
            router,
            prefix="/feedback",
            tags=["agent_feedback"],
        )

        # 注册启动钩子
        async def _on_startup() -> None:
            from .backend.service import FeedbackService

            svc = FeedbackService()
            await svc.initialize()
            logger.info("评分反馈插件启动完成")

        api.register_startup_hook(
            hook_name="feedback_init",
            callback=_on_startup,
            priority=90,
        )

        logger.info("评分反馈插件注册完成")


plugin = AgentFeedbackPlugin()
