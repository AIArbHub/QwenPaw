# -*- coding: utf-8 -*-
"""知识库插件单元测试。"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# 确保能导入 aiarb 包
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from aiarb.builtin_plugins.knowledge_base.backend.service import (
    KnowledgeBaseService,
    kb_search_tool,
)


def test_ingest_text():
    """测试文本入库。"""
    # 创建一个模拟请求
    class IngestTextRequest:
        text = "这是一段测试文本，用于验证知识库入库功能。"
        title = "测试文档"
        tags = ["测试", "验证"]
        chunk_size = 512
        chunk_overlap = 50

    svc = KnowledgeBaseService()

    async def run():
        await svc.initialize()
        result = await svc.ingest_text(IngestTextRequest())
        assert result["success"] is True
        assert result["chunk_count"] > 0
        assert result["title"] == "测试文档"
        # 清理
        await svc.delete_document(result["document_id"])
        print("✓ test_ingest_text passed")

    asyncio.run(run())


def test_search():
    """测试知识库检索。"""
    # 先入库
    class IngestTextRequest:
        text = "仲裁程序是指当事人通过仲裁机构解决争议的法律程序。"
        title = "仲裁程序概述"
        tags = ["仲裁", "程序"]
        chunk_size = 512
        chunk_overlap = 50

    svc = KnowledgeBaseService()

    async def run():
        await svc.initialize()
        ingest_result = await svc.ingest_text(IngestTextRequest())
        assert ingest_result["success"]

        # 搜索
        results = await svc.search("仲裁程序", top_k=5)
        assert len(results) > 0
        assert "仲裁" in results[0]["chunk_content"]

        # 清理
        await svc.delete_document(ingest_result["document_id"])
        print("✓ test_search passed")

    asyncio.run(run())


def test_kb_search_tool():
    """测试 Agent 可调用的检索工具。"""
    # 先入库
    class IngestTextRequest:
        text = "证据交换是仲裁程序的重要环节。"
        title = "证据交换"
        tags = ["仲裁", "证据"]
        chunk_size = 512
        chunk_overlap = 50

    svc = KnowledgeBaseService()

    async def run():
        await svc.initialize()
        ingest_result = await svc.ingest_text(IngestTextRequest())
        assert ingest_result["success"]

        # 调用工具
        result_text = await kb_search_tool("证据交换", top_k=3)
        assert isinstance(result_text, str)
        assert len(result_text) > 0

        # 清理
        await svc.delete_document(ingest_result["document_id"])
        print("✓ test_kb_search_tool passed")

    asyncio.run(run())


if __name__ == "__main__":
    test_ingest_text()
    test_search()
    test_kb_search_tool()
    print("\n所有测试通过 ✓")
