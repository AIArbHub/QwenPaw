# -*- coding: utf-8 -*-
"""KB Curator pipeline: run the builtin curator agent and publish results.

Flow for one task:

1. ``start_curate_task`` schedules the background run.
2. ``_run_task`` obtains the curator's ``Workspace`` from the manager and
   stages the material into ``curate/<task_id>/inbox`` inside the curator
   workspace (text + uploaded files).
3. It runs the agent **in-process** via ``Workspace.stream_query()`` with a
   per-run prompt that tells the curator to write structured documents into
   ``curate/<task_id>/outbox`` (never directly into the shared corpus).
4. ``_publish_outbox`` scans the outbox and copies valid generated
   documents (``.md``/``.txt``) into the global knowledge base via the
   publishing bridge, preserving category subdirectories.

The knowledge base stays read-only from the agent's perspective: writing
into ``WORKING_DIR/knowledge_base`` only ever happens here, after the
agent's run has completed.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import time
from pathlib import Path
from typing import Any, Optional

from ...agents.tools.agent_management import (
    agent_exists,
)
from ...constant import BUILTIN_KB_CURATOR_AGENT_ID
from ...knowledge import get_global_knowledge_base_dir
from ...utils.io_utils import run_sync_io
from .settings import load_settings
from .tasks import CurateTask

logger = logging.getLogger(__name__)

#: Subdirectory of the curator workspace where per-task staging lives.
_CURATE_REL = "curate"
#: Allowed publishable document extensions.
_PUBLISHABLE_SUFFIXES = (".md", ".txt")
#: Fallback top-level category when the curator wrote a file directly in
#: the outbox root without any category subdirectory.
_FALLBACK_CATEGORY = "misc"


# ── Public entrypoint ─────────────────────────────────────────────────


def start_curate_task(manager: Any, task: CurateTask) -> asyncio.Task:
    """Schedule the background curation run for *task*.

    Returns the asyncio task so callers can await/observe if needed.
    """
    return asyncio.create_task(_run_task(manager, task))


# ── Background run ───────────────────────────────────────────────────


async def _run_task(manager: Any, task: CurateTask) -> None:
    """Execute one curation job end-to-end (never raises)."""
    from . import tasks as tasks_module

    registry = tasks_module.get_registry()
    await registry.mark_running(task)
    try:
        settings = await load_settings()
        if not settings.get("enabled", True):
            await registry.mark_error(
                task, "AI 整理功能已关闭，请先在设置中开启"
            )
            return
        if not await run_sync_io(agent_exists, BUILTIN_KB_CURATOR_AGENT_ID):
            await registry.mark_error(
                task, "内置知识库整理器不存在，无法执行整理"
            )
            return

        workspace = await manager.get_agent(BUILTIN_KB_CURATOR_AGENT_ID)
        inbox_rel, outbox_rel = await _prepare_staging(workspace, task)
        prompt = _build_prompt(task, settings, inbox_rel, outbox_rel)
        await _run_curator_inprocess(
            workspace,
            prompt,
            session_id=f"curate_{task.id}",
            timeout=float(settings.get("timeout_seconds", 600)),
        )
        published = await _publish_outbox(workspace, task, settings)
        await registry.mark_done(task, published)
    except asyncio.CancelledError:
        await registry.mark_error(task, "任务已取消")
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("KB curator task %s failed", task.id)
        await registry.mark_error(task, f"{type(exc).__name__}: {exc}")
    finally:
        await registry.cleanup_spool(task)


async def _prepare_staging(workspace: Any, task: CurateTask) -> tuple[str, str]:
    """Create inbox/outbox under the curator workspace; return relative paths.

    Material text is written as ``material.txt``; uploaded files from the
    spool dir are copied in as-is.
    """
    base_rel = f"{_CURATE_REL}/{task.id}"
    inbox_rel = f"{base_rel}/inbox"
    outbox_rel = f"{base_rel}/outbox"

    def _stage() -> None:
        inbox = Path(workspace.workspace_dir) / inbox_rel
        outbox = Path(workspace.workspace_dir) / outbox_rel
        inbox.mkdir(parents=True, exist_ok=True)
        outbox.mkdir(parents=True, exist_ok=True)
        if task.text and task.text.strip():
            (inbox / "material.txt").write_text(
                task.text, encoding="utf-8"
            )
        spool = Path(task.spool_dir)
        if spool.is_dir():
            for entry in sorted(spool.iterdir()):
                if entry.is_file():
                    target = inbox / entry.name
                    if not target.exists():
                        shutil.copy2(entry, target)

    await run_sync_io(_stage)
    return inbox_rel, outbox_rel


def _build_prompt(task: CurateTask, settings: dict, inbox_rel: str, outbox_rel: str) -> str:
    """Build the per-run instruction prompt for the curator agent."""
    category_hint = (task.category or "").strip()
    language = (settings.get("language") or "zh") if (settings.get("language") or "zh") in ("zh", "en") else "zh"
    lines = [
        "请整理一批素材，把内容提炼成结构化、可直接入库的知识库文档。",
        "",
        f"素材位置：`{inbox_rel}`（用 read_file 逐个阅读；图片用 view_image 查看）。",
        f"整理产物：请写入 `{outbox_rel}`，并在其下按分类建立子目录：",
        "  - laws    — 法律、司法解释",
        "  - rules   — 仲裁规则、机构规则",
        "  - cases   — 案例",
        "  - templates — 文书模板",
        "",
        "要求：",
        "1. 先完整阅读收件箱里的素材，理解内容后再动手，不要凭空发挥。",
        "2. 判断每份素材归属的分类，在 outbox 下建立对应子目录（如 laws/）。",
        "3. 用 write_file 生成结构化 markdown 文档，文件名用有意义的名称（例如《仲裁法》-2023版.md）。",
        "4. 文档应包含：来源、机构/制定机关、版本/生效日期、关键词、正文要点。忠于原文，严禁编造条文、条款或数据。",
        "5. 写入前用 search_knowledge 检索全局知识库；若已有同主题文档，请在文件名后加序号或用版本标注，避免重复。",
        "6. 不要直接写入全局知识库目录，你的产物只写到 outbox；系统会自动发布到共享知识库。",
        f"7. 产物文档的语言：{'中文' if language == 'zh' else 'English'}。",
    ]
    if category_hint:
        lines.append(f"用户指定的分类：{category_hint}（可优先使用，仍可自行判断）。")
    lines.append(f"素材标题：{task.title or '（未命名）'}")
    return "\n".join(lines)


async def _run_curator_inprocess(
    workspace: Any,
    prompt: str,
    *,
    session_id: str,
    timeout: float,
) -> None:
    """Run the curator in-process, consuming the stream until completion.

    The generated documents live on disk in the outbox; the returned text
    is informational only.
    """
    from ...schemas import (
        AgentRequest,
        ContentType,
        Message as SchemaMessage,
        MessageType,
        Role,
        RunStatus,
        TextContent as SchemaTextContent,
    )

    content_parts = [SchemaTextContent(type=ContentType.TEXT, text=prompt)]
    user_msg = SchemaMessage(
        type=MessageType.MESSAGE,
        role=Role.USER,
        content=content_parts,
    )
    request = AgentRequest(
        session_id=session_id,
        user_id=workspace.agent_id,
        input=[user_msg],
        channel="console",
    )
    request.request_context = {"source": "kb_curator"}

    deadline = time.time() + timeout
    try:
        async for event in workspace.stream_query(request):
            if time.time() > deadline:
                raise asyncio.TimeoutError(
                    f"KB curator run exceeded {timeout:.0f}s"
                )
            obj = getattr(event, "object", None)
            status = getattr(event, "status", None)
            if obj == "response" and status is not None:
                if status in (RunStatus.Completed, RunStatus.Failed):
                    if status == RunStatus.Failed:
                        logger.warning("KB curator run reported failure")
                    break
    except asyncio.TimeoutError:
        logger.warning("KB curator task timed out after %.0fs", timeout)
        raise


# ── Publishing bridge (knowledge base write channel) ─────────────────


async def _publish_outbox(workspace: Any, task: CurateTask, settings: dict) -> list[dict]:
    """Copy valid generated documents from the outbox into the global KB.

    Respects ``publish_enabled``: when disabled, documents stay in the
    curator workspace outbox and are reported as ``published=False``.
    """
    outbox_rel = f"{_CURATE_REL}/{task.id}/outbox"
    outbox = Path(workspace.workspace_dir) / outbox_rel
    if not outbox.is_dir():
        return []

    def _scan() -> list[Path]:
        return sorted(outbox.rglob("*"))

    files = await run_sync_io(_scan)
    publish_enabled = bool(settings.get("publish_enabled", True))
    if not publish_enabled:
        return [
            {
                "path": str(f.relative_to(outbox)).replace("\\", "/"),
                "category": _category_for(f, outbox, task, settings),
                "name": f.name,
                "published": False,
            }
            for f in files
            if f.is_file() and f.suffix.lower() in _PUBLISHABLE_SUFFIXES
        ]

    root = get_global_knowledge_base_dir()
    published: list[dict] = []
    for f in files:
        if not f.is_file() or f.suffix.lower() not in _PUBLISHABLE_SUFFIXES:
            continue
        category = _category_for(f, outbox, task, settings)
        if category is None:
            logger.warning(
                "Skipping KB curator output without a valid category: %s", f
            )
            continue

        def _copy() -> dict:
            target = _unique_target(root / category / f.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)
            return {
                "path": str(target.relative_to(root)).replace("\\", "/"),
                "category": category,
                "name": target.name,
                "published": True,
            }

        try:
            published.append(await run_sync_io(_copy))
        except OSError as exc:  # noqa: BLE001
            logger.warning("Publish failed for %s: %s", f, exc)
    return published


def _category_for(file_path: Path, outbox: Path, task: CurateTask, settings: dict) -> Optional[str]:
    """Resolve the target top-level category for an outbox file."""
    rel = file_path.relative_to(outbox)
    parts = list(rel.parts)
    if len(parts) >= 2:
        candidate = _sanitize_category(parts[0])
        if candidate is not None:
            return candidate
    candidate = _sanitize_category(task.category)
    if candidate is not None:
        return candidate
    candidate = _sanitize_category(settings.get("default_category", ""))
    if candidate is not None:
        return candidate
    return _FALLBACK_CATEGORY


def _sanitize_category(name: Any) -> Optional[str]:
    """Validate a category segment; return None if unsafe."""
    if name is None:
        return None
    text = str(name).strip().strip("/\\")
    if not text:
        return None
    parts = text.replace("\\", "/").split("/")
    if len(parts) != 1:
        return None
    if any(part in ("", ".", "..") for part in parts):
        return None
    if any(ch in text for ch in '<>:"|?*'):
        return None
    return text


def _unique_target(target: Path) -> Path:
    """Return *target*, or a ``name-1``/``name-2`` variant if it exists."""
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix
    counter = 1
    while True:
        candidate = target.with_name(f"{stem}-{counter}{suffix}")
        if not candidate.exists():
            return candidate
        counter += 1
