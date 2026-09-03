# -*- coding: utf-8 -*-
"""In-memory registry for KB Curator tasks.

Tasks are created by the API, run in the background by ``pipeline.py`` and
queried by the console for progress/result display.  The registry keeps a
bounded recent history in memory; only lightweight metadata is retained
(never the uploaded material content).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from ...utils.io_utils import run_sync_io

#: Bounded number of tasks kept in memory (oldest are pruned).
_MAX_TASKS = 100


class CurateTask:
    """A single AI curation job."""

    def __init__(
        self,
        *,
        task_id: str,
        title: str,
        category: str,
        text: str,
        spool_dir: str,
        file_names: Optional[list[str]] = None,
    ) -> None:
        self.id = task_id
        self.status = "pending"  # pending | running | done | error
        self.title = title or "(未命名素材)"
        self.category = category
        self.text = text
        self.spool_dir = spool_dir
        self.file_names = list(file_names or [])
        self.created_at = time.time()
        self.started_at: Optional[float] = None
        self.finished_at: Optional[float] = None
        self.published: list[dict] = []
        self.error: Optional[str] = None

    def to_dict(self) -> dict:
        """Serialize metadata for the API (never includes raw text)."""
        return {
            "id": self.id,
            "status": self.status,
            "title": self.title,
            "category": self.category,
            "file_names": list(self.file_names),
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "published": list(self.published),
            "error": self.error,
        }


class TaskRegistry:
    """Thread-safe (asyncio) registry with bounded history."""

    def __init__(self) -> None:
        self._tasks: dict[str, CurateTask] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        *,
        task_id: str,
        title: str,
        category: str,
        text: str,
        spool_dir: str,
        file_names: Optional[list[str]] = None,
    ) -> CurateTask:
        task = CurateTask(
            task_id=task_id,
            title=title,
            category=category,
            text=text,
            spool_dir=spool_dir,
            file_names=file_names,
        )
        async with self._lock:
            self._tasks[task_id] = task
            # Prune the oldest entries beyond the cap.
            if len(self._tasks) > _MAX_TASKS:
                for old_id in list(self._tasks)[: len(self._tasks) - _MAX_TASKS]:
                    self._tasks.pop(old_id, None)
        return task

    async def get(self, task_id: str) -> Optional[CurateTask]:
        async with self._lock:
            return self._tasks.get(task_id)

    async def list(self, limit: int = 50) -> list[dict]:
        async with self._lock:
            tasks = sorted(
                self._tasks.values(),
                key=lambda t: t.created_at,
                reverse=True,
            )
        return [t.to_dict() for t in tasks[: max(1, min(limit, 200))]]

    async def mark_running(self, task: CurateTask) -> None:
        task.status = "running"
        task.started_at = time.time()

    async def mark_done(self, task: CurateTask, published: list[dict]) -> None:
        task.status = "done"
        task.published = list(published)
        task.finished_at = time.time()

    async def mark_error(self, task: CurateTask, error: str) -> None:
        task.status = "error"
        task.error = error
        task.finished_at = time.time()

    async def cleanup_spool(self, task: CurateTask) -> None:
        """Best-effort remove the upload spool dir after the run."""
        try:
            import shutil
            from pathlib import Path

            spool = Path(task.spool_dir)
            if spool.is_dir():

                def _rm() -> None:
                    shutil.rmtree(spool, ignore_errors=True)

                await run_sync_io(_rm)
        except Exception:  # noqa: BLE001
            pass


#: Shared registry instance used by the router and pipeline.
REGISTRY = TaskRegistry()


def get_registry() -> TaskRegistry:
    """Return the shared task registry (kept for dependency injection)."""
    return REGISTRY
