# -*- coding: utf-8 -*-
"""知识库插件入口。

导出 ``plugin`` 对象，插件加载器调用 ``plugin.register(api)`` 完成注册。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class KnowledgeBasePlugin:
    """知识库插件定义。"""

    def register(self, api: Any) -> None:
        """注册插件能力。"""
        from .backend.routes import create_kb_router

        # 注册 HTTP 路由
        router = create_kb_router()
        api.register_http_router(
            router,
            prefix="/kb",
            tags=["knowledge_base"],
        )

        # 注册工具（供 Agent 调用）
        from .backend.service import kb_search_tool

        api.register_tool(
            tool_name="kb_search",
            tool_func=kb_search_tool,
            description="在知识库中检索相关文档",
            icon="🔍",
            enabled=False,
            tool_type="internal",
        )

        # 注册启动钩子
        async def _on_startup() -> None:
            from .backend.service import KnowledgeBaseService

            svc = KnowledgeBaseService()
            await svc.initialize()
            logger.info("知识库插件启动完成")

        api.register_startup_hook(
            hook_name="kb_init",
            callback=_on_startup,
            priority=90,
        )

        logger.info("知识库插件注册完成")


# 插件加载器查找的 ``plugin`` 变量
plugin = KnowledgeBasePlugin()
