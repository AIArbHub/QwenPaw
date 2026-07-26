# -*- coding: utf-8 -*-
"""评分反馈服务。"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles
import orjson

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FeedbackService:
    """评分反馈服务 — JSON 文件持久化。"""

    _instance: "FeedbackService | None" = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not hasattr(self, "_initialized"):
            self._data_dir: Path | None = None
            self._data_file: Path | None = None
            self._initialized = False

    async def initialize(self) -> None:
        """初始化服务。"""
        if self._initialized:
            return
        try:
            from aiarb.constant import WORKING_DIR

            self._data_dir = WORKING_DIR / "feedback"
        except Exception:
            self._data_dir = Path.home() / ".aiarb" / "feedback"

        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._data_file = self._data_dir / "feedbacks.json"
        if not self._data_file.exists():
            await self._write_data([])
        self._initialized = True
        logger.info("评分反馈服务初始化完成")

    async def _read_data(self) -> list[dict[str, Any]]:
        """读取全部反馈数据。"""
        if not self._data_file or not self._data_file.exists():
            return []
        try:
            async with aiofiles.open(self._data_file, "rb") as f:
                return orjson.loads(await f.read())
        except Exception as e:
            logger.error("读取反馈数据失败: %s", e)
            return []

    async def _write_data(self, data: list[dict[str, Any]]) -> None:
        """写入全部反馈数据。"""
        if not self._data_file:
            return
        try:
            async with aiofiles.open(self._data_file, "wb") as f:
                await f.write(orjson.dumps(data))
        except Exception as e:
            logger.error("写入反馈数据失败: %s", e)

    async def add_feedback(self, request: Any) -> dict[str, Any]:
        """添加一条评分反馈。"""
        await self.initialize()
        entry = {
            "id": str(uuid.uuid4()),
            "agent_id": request.agent_id,
            "session_id": getattr(request, "session_id", ""),
            "message_id": getattr(request, "message_id", ""),
            "rating": request.rating,
            "comment": getattr(request, "comment", ""),
            "tags": getattr(request, "tags", []),
            "created_at": _now_iso(),
            # 新增归因字段
            "analysis_status": "pending",
            "analysis_bucket": "",
            "analysis_reason": "",
            "analysis_summary": "",
            "analysis_confidence": 0.0,
            "analyzed_at": "",
            # 新增技能级反馈字段
            "skill_id": getattr(request, "skill_id", ""),
            "skill_version": getattr(request, "skill_version", ""),
            "step_id": getattr(request, "step_id", ""),
        }
        data = await self._read_data()
        data.append(entry)
        await self._write_data(data)
        logger.info(
            "添加评分: agent=%s rating=%d skill=%s",
            request.agent_id,
            request.rating,
            getattr(request, "skill_id", ""),
        )

        # 异步触发归因（不阻塞响应）
        try:
            asyncio.create_task(
                self._run_attribution(entry),
            )
        except Exception as e:
            logger.warning("触发归因失败: %s", e)

        return entry

    async def _run_attribution(self, entry: dict[str, Any]) -> None:
        """异步执行归因并更新反馈记录。"""
        try:
            from .attribution import trigger_attribution

            feedback_id = entry.get("id", "")
            result = await trigger_attribution(
                feedback_id=feedback_id,
                feedback=entry,
                agent_id=entry.get("agent_id", ""),
            )

            # 更新反馈记录
            data = await self._read_data()
            for item in data:
                if item.get("id") == feedback_id:
                    item["analysis_status"] = result.status
                    item["analysis_bucket"] = result.bucket
                    item["analysis_reason"] = result.reason
                    item["analysis_summary"] = result.summary
                    item["analysis_confidence"] = result.confidence
                    item["analyzed_at"] = _now_iso()
                    break
            await self._write_data(data)
            logger.info(
                "反馈 %s 归因更新完成: bucket=%s",
                feedback_id,
                result.bucket,
            )
        except Exception as e:
            logger.error("归因更新失败: %s", e)

    async def list_feedback(
        self,
        agent_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """列出评分反馈。"""
        await self.initialize()
        data = await self._read_data()
        if agent_id:
            data = [d for d in data if d.get("agent_id") == agent_id]
        # 按时间倒序
        data.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return data[:limit]

    async def get_summary(self, agent_id: str) -> dict[str, Any]:
        """获取 Agent 评分汇总（含归因分布）。"""
        await self.initialize()
        data = await self._read_data()
        agent_feedbacks = [d for d in data if d.get("agent_id") == agent_id]
        total = len(agent_feedbacks)
        if total == 0:
            return {
                "agent_id": agent_id,
                "total_feedback": 0,
                "avg_rating": 0.0,
                "rating_distribution": {
                    "1": 0,
                    "2": 0,
                    "3": 0,
                    "4": 0,
                    "5": 0,
                },
                "recent_comments": [],
                "buckets": {},
                "top_down_summaries": [],
                "summary_text": "",
            }

        dist = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
        total_score = 0
        buckets: dict[str, int] = {}
        down_feedbacks: list[dict[str, Any]] = []

        for fb in agent_feedbacks:
            rating = str(fb.get("rating", 0))
            if rating in dist:
                dist[rating] += 1
            total_score += fb.get("rating", 0)

            # 归因分类统计
            bucket = fb.get("analysis_bucket", "")
            if bucket:
                buckets[bucket] = buckets.get(bucket, 0) + 1

            # 点踩（1-2 星且有归因摘要）
            if fb.get("rating", 0) <= 2 and fb.get("analysis_summary"):
                down_feedbacks.append(fb)

        # 按时间倒序取最近评论
        agent_feedbacks.sort(
            key=lambda x: x.get("created_at", ""),
            reverse=True,
        )
        recent = [
            fb
            for fb in agent_feedbacks[:10]
            if fb.get("comment")
        ]

        # Top 5 点踩摘要
        down_feedbacks.sort(
            key=lambda x: x.get("created_at", ""),
            reverse=True,
        )
        top_down = [
            {
                "bucket": fb.get("analysis_bucket", ""),
                "summary": fb.get("analysis_summary", fb.get("comment", "")),
                "rating": fb.get("rating", 0),
                "created_at": fb.get("created_at", ""),
            }
            for fb in down_feedbacks[:5]
        ]

        return {
            "agent_id": agent_id,
            "total_feedback": total,
            "avg_rating": round(total_score / total, 2),
            "rating_distribution": dist,
            "recent_comments": recent,
            "buckets": buckets,
            "top_down_summaries": top_down,
            "summary_text": self._build_summary_text(total, dist, buckets),
        }

    def _build_summary_text(
        self,
        total: int,
        dist: dict[str, int],
        buckets: dict[str, int],
    ) -> str:
        """构建汇总文本。"""
        from .attribution import BUCKET_LABELS

        parts: list[str] = []
        parts.append(f"共 {total} 条反馈")

        # 评分分布
        positive = dist.get("4", 0) + dist.get("5", 0)
        negative = dist.get("1", 0) + dist.get("2", 0)
        parts.append(f"好评 {positive} 条，差评 {negative} 条")

        # 归因分布
        if buckets:
            top_buckets = sorted(
                buckets.items(),
                key=lambda x: x[1],
                reverse=True,
            )[:3]
            bucket_parts = []
            for bucket, count in top_buckets:
                label = BUCKET_LABELS.get(bucket, bucket)
                bucket_parts.append(f"{label}: {count}")
            if bucket_parts:
                parts.append("主要归因：" + "、".join(bucket_parts))

        return "；".join(parts)

    async def delete_feedback(self, feedback_id: str) -> bool:
        """删除一条评分反馈。"""
        await self.initialize()
        data = await self._read_data()
        original_len = len(data)
        data = [d for d in data if d.get("id") != feedback_id]
        if len(data) < original_len:
            await self._write_data(data)
            return True
        return False
