# -*- coding: utf-8 -*-
"""Workspace API – download / upload the entire WORKING_DIR as a zip.

Also includes agent file management, language settings, audio/transcription
configuration, running config, and system prompt files.
"""

from __future__ import annotations

import asyncio
import io
import json
import shutil
import stat
import tempfile
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, UploadFile, File, Request, Query
from fastapi.responses import Response, StreamingResponse
from watchfiles import awatch, Change
from pydantic import BaseModel, Field

from ..utils import check_upload_size, safe_join, schedule_agent_reload
from ...config import (
    load_config,
    save_config,
    AgentsRunningConfig,
)
from ...config.config import load_agent_config, save_agent_config
from ...agents.memory.agent_md_manager import AgentMdManager
from ...agents.templates import get_workspace_md_template_id
from ...agents.utils import copy_workspace_md_files
from ...constant import BUILTIN_QA_AGENT_ID, SUPPORTED_AGENT_LANGUAGES
from ..agent_context import get_agent_for_request, get_coding_dir


router = APIRouter(prefix="/workspace", tags=["workspace"])


class MdFileInfo(BaseModel):
    """Markdown file metadata."""

    filename: str = Field(..., description="File name")
    path: str = Field(..., description="File path")
    size: int = Field(..., description="Size in bytes")
    created_time: str = Field(..., description="Created time")
    modified_time: str = Field(..., description="Modified time")


class MdFileContent(BaseModel):
    """Markdown file content."""

    content: str = Field(..., description="File content")


def _dir_stats(root: Path) -> tuple[int, int]:
    """Return (file_count, total_size) for *root* recursively."""
    count = 0
    size = 0
    if root.is_dir():
        for p in root.rglob("*"):
            if p.is_file():
                count += 1
                size += p.stat().st_size
    return count, size


def _zip_directory(root: Path) -> io.BytesIO:
    """Create an in-memory zip archive of *root* and return the buffer.

    All files **and** directories (including empty ones) are included.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for entry in sorted(root.rglob("*")):
            arcname = entry.relative_to(root).as_posix()
            if entry.is_file():
                zf.write(entry, arcname)
            elif entry.is_dir():
                # Zip spec: directory entries end with '/'
                zf.write(entry, arcname + "/")
    buf.seek(0)
    return buf


# ---------------------------------------------------------------------------
# Agent File Management Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/files",
    response_model=list[MdFileInfo],
    summary="List working files",
    description="List all working files (uses active agent)",
)
async def list_working_files(
    request: Request,
    agent_id: str | None = Query(default=None),
) -> list[MdFileInfo]:
    """List working directory markdown files."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        files = [
            MdFileInfo.model_validate(file)
            for file in workspace_manager.list_working_mds()
        ]
        return files
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/core-config-files",
    response_model=list[MdFileInfo],
    summary="List core configuration files",
    description="List agent core configuration markdown files (SOUL.md, PROFILE.md, etc.)",
)
async def list_core_config_files(
    request: Request,
    agent_id: str | None = Query(default=None),
) -> list[MdFileInfo]:
    """List core configuration markdown files in the workspace directory."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        files = [
            MdFileInfo.model_validate(file)
            for file in workspace_manager.list_core_config_mds()
        ]
        return files
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/files/{md_name}",
    response_model=MdFileContent,
    summary="Read a working file",
    description="Read a working markdown file (uses active agent)",
)
async def read_working_file(
    md_name: str,
    request: Request,
    agent_id: str | None = Query(default=None),
) -> MdFileContent:
    """Read a working directory markdown file."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        content = workspace_manager.read_working_md(md_name)
        return MdFileContent(content=content)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put(
    "/files/{md_name}",
    response_model=dict,
    summary="Write a working file",
    description="Create or update a working file (uses active agent)",
)
async def write_working_file(
    md_name: str,
    body: MdFileContent,
    request: Request,
    agent_id: str | None = Query(default=None),
) -> dict:
    """Write a working directory markdown file."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        workspace_manager.write_working_md(md_name, body.content)
        return {"written": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Coding Mode – full file-tree + file watcher (SSE)
# ---------------------------------------------------------------------------

_SKIP_NAMES: frozenset[str] = frozenset(
    {
        ".git",
        "__pycache__",
        ".venv",
        "node_modules",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".hypothesis",
    },
)


def _should_skip(rel_parts: tuple[str, ...]) -> bool:
    return any(p.startswith(".") or p in _SKIP_NAMES for p in rel_parts)


def _is_skipped_name(name: str) -> bool:
    return name.startswith(".") or name in _SKIP_NAMES


def _list_all_files(workspace_dir: Path) -> list[dict]:
    """Recursively list all non-hidden workspace files.

    Uses ``os.walk(topdown=True)`` and prunes ``dirnames`` in place so that
    we never descend into ``node_modules`` / ``.venv`` / ``.git`` etc. — the
    previous ``Path.rglob('*')`` walked them fully and filtered after the
    fact, which is the dominant cost on real projects. Each file is stat'd
    exactly once. Paths are returned with POSIX ``/`` separators so the
    frontend ``buildTree`` (which splits on ``/``) works on Windows too.
    """
    files: list[dict] = []
    root = str(workspace_dir)
    try:
        for dirpath, dirnames, filenames in os.walk(root, topdown=True):
            # Prune in place — must mutate, not rebind, for os.walk to honor.
            dirnames[:] = sorted(
                d for d in dirnames if not _is_skipped_name(d)
            )
            rel_dir = os.path.relpath(dirpath, root)
            for name in sorted(filenames):
                if _is_skipped_name(name):
                    continue
                full = os.path.join(dirpath, name)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                rel = (
                    name
                    if rel_dir == "."
                    else f"{rel_dir}/{name}".replace(os.sep, "/")
                )
                files.append(
                    {
                        "filename": rel,
                        "path": rel,
                        "size": st.st_size,
                        "modified_time": datetime.fromtimestamp(
                            st.st_mtime,
                            tz=timezone.utc,
                        ).isoformat(),
                    },
                )
    except Exception:
        pass
    return files


@router.get(
    "/code-files",
    summary="List all workspace files (Coding Mode)",
)
async def list_code_files(request: Request) -> list[dict]:
    """List every non-hidden file in the active coding project directory."""
    workspace = await get_agent_for_request(request)
    return await asyncio.get_event_loop().run_in_executor(
        None,
        _list_all_files,
        get_coding_dir(workspace),
    )


_CODE_FILE_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
_BINARY_FILE_MAX_BYTES = 50 * 1024 * 1024  # 50 MB

_MIME_MAP: dict[str, str] = {
    # Images
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "ico": "image/x-icon",
    "bmp": "image/bmp",
    # Documents
    "pdf": "application/pdf",
    # Data
    "csv": "text/csv",
}


@router.get(
    "/binary-files/{file_path:path}",
    summary="Serve a binary workspace file (images, PDFs) for preview",
)
async def read_binary_file(
    file_path: str,
    request: Request,
) -> StreamingResponse:
    """Return the raw bytes of *file_path* with the appropriate Content-Type.

    Intended for the IDE preview panel (images, PDFs, CSV).
    Rejects files that are not in ``_MIME_MAP`` or exceed 50 MB.
    """
    workspace = await get_agent_for_request(request)
    target = safe_join(get_coding_dir(workspace), file_path)

    ext = target.suffix.lstrip(".").lower()
    mime = _MIME_MAP.get(ext)
    if mime is None:
        raise HTTPException(
            status_code=415,
            detail=f"Preview not supported for .{ext} files",
        )

    try:
        size = await asyncio.to_thread(lambda: target.stat().st_size)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if size > _BINARY_FILE_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"File too large for preview ({size // 1024 // 1024} MB"
                f" > {_BINARY_FILE_MAX_BYTES // 1024 // 1024} MB limit)"
            ),
        )

    def _iter_chunks(chunk_size: int = 64 * 1024):
        with open(target, "rb") as fh:
            while True:
                data = fh.read(chunk_size)
                if not data:
                    break
                yield data

    return StreamingResponse(
        _iter_chunks(),
        media_type=mime,
        headers={"Content-Length": str(size)},
    )


def _file_etag(stat_result: os.stat_result) -> str:
    """Build a weak ETag from mtime+size — cheap and good enough for IDE."""
    return f'W/"{stat_result.st_mtime_ns}-{stat_result.st_size}"'


@router.get(
    "/code-files/{file_path:path}",
    summary="Read any workspace file (Coding Mode)",
)
async def read_code_file(file_path: str, request: Request):
    """Return the text content of *file_path* inside the workspace.

    Adds a weak ETag (mtime_ns + size) so repeat opens of an unchanged file
    short-circuit to ``304 Not Modified`` and skip the read entirely.
    Returns HTTP 413 if the file exceeds ``_CODE_FILE_MAX_BYTES`` (5 MB) to
    avoid flooding the browser with huge binary or log files.
    """
    workspace = await get_agent_for_request(request)
    target = safe_join(get_coding_dir(workspace), file_path)

    def _stat() -> os.stat_result:
        return target.stat()

    try:
        st = await asyncio.to_thread(_stat)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not stat.S_ISREG(st.st_mode):
        raise HTTPException(status_code=404, detail="File not found")

    etag = _file_etag(st)
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})

    if st.st_size > _CODE_FILE_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"File too large to open in editor "
                f"({st.st_size // 1024 // 1024} MB"
                f" > {_CODE_FILE_MAX_BYTES // 1024 // 1024} MB limit)"
            ),
        )

    def _read() -> str:
        return target.read_text(encoding="utf-8", errors="replace")

    try:
        content = await asyncio.to_thread(_read)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    from fastapi.responses import JSONResponse
    return JSONResponse(
        {"path": file_path, "content": content},
        headers={"ETag": etag},
    )


@router.put(
    "/code-files/{file_path:path}",
    summary="Write any workspace file (Coding Mode)",
)
async def write_code_file(
    file_path: str,
    request: Request,
    body: dict = Body(...),
) -> dict:
    """Overwrite *file_path* inside the workspace with the provided content.

    Request body::

        {"content": "<new file content>"}
    """
    workspace = await get_agent_for_request(request)
    target = safe_join(get_coding_dir(workspace), file_path)
    content = body.get("content", "")
    if not isinstance(content, str):
        raise HTTPException(status_code=422, detail="content must be a string")

    def _write() -> int:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return target.stat().st_size

    try:
        size = await asyncio.to_thread(_write)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"path": file_path, "size": size}


@router.get(
    "/watch",
    summary="SSE stream for workspace file changes (Coding Mode)",
)
async def watch_workspace_files(request: Request) -> StreamingResponse:
    """Server-Sent Events that emit file-change notifications.

    Each SSE payload has the form::

        {"type": "file_change", "events": [{"change": "modified", "path": "..."}]}  # noqa: E501

    A heartbeat comment (``": heartbeat"``) is sent every 30 s when idle.
    """
    workspace = await get_agent_for_request(request)
    watch_dir = get_coding_dir(workspace)

    async def event_generator():
        yield 'data: {"type": "connected"}\n\n'
        watcher = awatch(watch_dir)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    raw_changes = await asyncio.wait_for(
                        watcher.__anext__(),
                        timeout=30.0,
                    )
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                except (
                    StopAsyncIteration,
                    asyncio.CancelledError,
                    GeneratorExit,
                ):
                    # StopAsyncIteration  – watcher stopped naturally
                    # CancelledError      – app shutdown cancelled the task
                    # GeneratorExit       – streaming response closed
                    break

                events = []
                for change_type, path in raw_changes:
                    try:
                        rel = Path(path).relative_to(watch_dir)
                    except ValueError:
                        continue
                    if _should_skip(rel.parts):
                        continue
                    change_name = (
                        "added"
                        if change_type is Change.added
                        else "deleted"
                        if change_type is Change.deleted
                        else "modified"
                    )
                    events.append(
                        {"change": change_name, "path": rel.as_posix()},
                    )

                if events:
                    payload = json.dumps(
                        {"type": "file_change", "events": events},
                        ensure_ascii=False,
                    )
                    yield f"data: {payload}\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            pass  # normal during app shutdown
        finally:
            try:
                await watcher.aclose()
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/memory",
    response_model=list[MdFileInfo],
    summary="List memory files",
    description="List all memory files (uses active agent)",
)
async def list_memory_files(
    request: Request,
    agent_id: str | None = Query(default=None, description="Override active agent"),
) -> list[MdFileInfo]:
    """List memory directory markdown files."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        raw_files = await asyncio.to_thread(workspace_manager.list_memory_mds)
        files = [MdFileInfo.model_validate(file) for file in raw_files]
        return files
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/memory/stats",
    summary="Get memory statistics",
    description="Return file count, total size, and latest modification time",
)
async def get_memory_stats(
    request: Request,
    agent_id: str | None = Query(default=None, description="Override active agent"),
) -> dict:
    """Return aggregate statistics for memory files."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        stats = await asyncio.to_thread(workspace_manager.get_memory_stats)
        return stats
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/memory/status",
    summary="Get memory system status",
    description="Return whether the memory system is initialized and running",
)
async def get_memory_status(
    request: Request,
    agent_id: str | None = Query(default=None, description="Override active agent"),
) -> dict:
    """Return memory system status."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        memory_manager = workspace.memory_manager

        if memory_manager is None:
            return {
                "initialized": False,
                "backend": "none",
                "error": "No memory manager configured",
            }

        # Check if ReMeLightMemoryManager and its _reme attribute
        reme_app = getattr(memory_manager, "_reme", None)
        is_started = getattr(reme_app, "is_started", False) if reme_app else False

        backend_type = getattr(memory_manager, "__class__", None)
        backend_name = (
            backend_type.__name__ if backend_type else "unknown"
        )

        return {
            "initialized": reme_app is not None,
            "started": is_started,
            "backend": backend_name,
            "error": None if reme_app is not None else "Memory manager not initialized (import may have failed)",
        }
    except Exception as exc:
        return {
            "initialized": False,
            "started": False,
            "backend": "unknown",
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# Memory file version control (must be before {md_path:path} routes)
# ---------------------------------------------------------------------------

class MemoryVersionInfo(BaseModel):
    """Memory file version metadata."""
    version_id: str = Field(..., description="Version timestamp ID")
    filename: str = Field(..., description="Versioned filename")
    size: int = Field(..., description="Size in bytes")
    created_time: str = Field(..., description="Created time")
    modified_time: str = Field(..., description="Modified time")


@router.get(
    "/memory/{md_path:path}/versions",
    response_model=list[MemoryVersionInfo],
    summary="List memory file versions",
)
async def list_memory_versions(
    md_path: str,
    request: Request,
    agent_id: str | None = Query(default=None),
) -> list[MemoryVersionInfo]:
    """List all saved versions for a memory file."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        versions = workspace_manager.list_memory_versions(md_path)
        return [MemoryVersionInfo.model_validate(v) for v in versions]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/memory/{md_path:path}/versions/{version_id}",
    response_model=MdFileContent,
    summary="Read a memory file version",
)
async def read_memory_version(
    md_path: str,
    version_id: str,
    request: Request,
    agent_id: str | None = Query(default=None),
) -> MdFileContent:
    """Read a specific versioned backup of a memory file."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        content = workspace_manager.read_memory_version(md_path, version_id)
        return MdFileContent(content=content)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/memory/{md_path:path}/versions/{version_id}/restore",
    response_model=MdFileContent,
    summary="Restore a memory file version",
)
async def restore_memory_version(
    md_path: str,
    version_id: str,
    request: Request,
    agent_id: str | None = Query(default=None),
) -> MdFileContent:
    """Restore a memory file from a versioned backup."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        content = workspace_manager.restore_memory_version(md_path, version_id)
        return MdFileContent(content=content)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/memory/{md_path:path}",
    response_model=MdFileContent,
    summary="Read a memory file",
    description="Read a memory markdown file (uses active agent)",
)
async def read_memory_file(
    md_path: str,
    request: Request,
    agent_id: str | None = Query(default=None, description="Override active agent"),
) -> MdFileContent:
    """Read a memory directory markdown file."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        content = await asyncio.to_thread(
            workspace_manager.read_memory_md,
            md_path,
        )
        return MdFileContent(content=content)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put(
    "/memory/{md_path:path}",
    response_model=dict,
    summary="Write a memory file",
    description="Create or update a memory file (uses active agent)",
)
async def write_memory_file(
    md_path: str,
    body: MdFileContent,
    request: Request,
    agent_id: str | None = Query(default=None, description="Override active agent"),
) -> dict:
    """Write a memory directory markdown file."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        await asyncio.to_thread(
            workspace_manager.write_memory_md,
            md_path,
            body.content,
        )
        return {"written": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete(
    "/memory/{md_path:path}",
    summary="Delete a memory file",
    description="Delete a memory markdown file (uses active agent)",
)
async def delete_memory_file(
    md_path: str,
    request: Request,
    agent_id: str | None = Query(default=None, description="Override active agent"),
) -> dict:
    """Delete a memory directory markdown file."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
            agent_id=workspace.agent_id,
        )
        deleted = await asyncio.to_thread(
            workspace_manager.delete_memory_md,
            md_path,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail=f"File not found: {md_path}")
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class MemorySearchRequest(BaseModel):
    """Request body for memory search."""

    query: str = Field(..., description="Search query")
    limit: int = Field(default=5, ge=1, description="Max results")
    min_score: float = Field(default=0.0, ge=0.0, le=1.0, description="Min score")


@router.post(
    "/memory/search",
    summary="Search memory files",
    description="Semantic search across memory files (uses active agent's memory manager)",
)
async def search_memory(
    body: MemorySearchRequest,
    request: Request,
    agent_id: str | None = Query(default=None, description="Override active agent"),
) -> dict:
    """Search memory content via the agent's memory manager."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        memory_manager = workspace.memory_manager
        if memory_manager is None:
            return {
                "success": False,
                "answer": "",
                "error": "Memory manager not available",
            }

        # Try ReMeLightMemoryManager which has memory_search tool
        search_fn = getattr(memory_manager, "memory_search", None)
        if search_fn is None:
            return {
                "success": False,
                "answer": "",
                "error": "Memory search not supported by current backend",
            }

        result = await search_fn(
            query=body.query,
            max_results=body.limit,
            min_score=body.min_score,
        )

        # Extract text from ToolChunk
        answer = ""
        if hasattr(result, "content"):
            for block in result.content:
                if hasattr(block, "text"):
                    answer += block.text
        elif isinstance(result, str):
            answer = result

        return {
            "success": True,
            "answer": answer,
            "query": body.query,
        }
    except Exception as exc:
        return {
            "success": False,
            "answer": "",
            "error": str(exc),
        }


class TestEmbeddingRequest(BaseModel):
    """Request body for testing embedding connection."""

    backend: str = Field(default="openai")
    api_key: str = Field(default="")
    base_url: str = Field(default="")
    model_name: str = Field(default="")
    dimensions: int = Field(default=1024)


@router.post(
    "/memory/test-embedding",
    summary="Test embedding connection",
    description="Verify that the embedding model configuration works",
)
async def test_embedding(
    body: TestEmbeddingRequest,
    request: Request,
) -> dict:
    """Test embedding connection by generating a simple embedding."""
    import time

    try:
        # Build a minimal embedding request based on backend type
        if body.backend == "ollama":
            import httpx

            url = f"{body.base_url or 'http://localhost:11434'}/api/embeddings"
            start = time.time()
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    url,
                    json={
                        "model": body.model_name,
                        "prompt": "test",
                    },
                )
            latency_ms = int((time.time() - start) * 1000)
            if resp.status_code != 200:
                return {
                    "success": False,
                    "latency_ms": latency_ms,
                    "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
                }
            data = resp.json()
            embedding = data.get("embedding", [])
            return {
                "success": True,
                "latency_ms": latency_ms,
                "dimensions": len(embedding),
                "error": None,
            }
        else:
            # OpenAI-compatible (openai, dashscope, dashscope_multimodal, gemini)
            import httpx

            base = body.base_url or "https://api.openai.com/v1"
            url = f"{base.rstrip('/')}/embeddings"
            headers = {"Authorization": f"Bearer {body.api_key}"}
            start = time.time()
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    url,
                    headers=headers,
                    json={
                        "model": body.model_name,
                        "input": "test",
                    },
                )
            latency_ms = int((time.time() - start) * 1000)
            if resp.status_code != 200:
                return {
                    "success": False,
                    "latency_ms": latency_ms,
                    "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
                }
            data = resp.json()
            embedding = data.get("data", [{}])[0].get("embedding", [])
            return {
                "success": True,
                "latency_ms": latency_ms,
                "dimensions": len(embedding),
                "error": None,
            }
    except Exception as exc:
        return {
            "success": False,
            "latency_ms": 0,
            "error": str(exc),
        }


@router.post(
    "/memory/reindex",
    summary="Rebuild memory search index",
    description="Trigger a full rebuild of the memory search index",
)
async def reindex_memory(
    request: Request,
    agent_id: str | None = Query(default=None, description="Override active agent"),
) -> dict:
    """Trigger memory index rebuild via ReMe reindex job."""
    try:
        workspace = await get_agent_for_request(request, agent_id=agent_id)
        memory_manager = workspace.memory_manager
        if memory_manager is None:
            return {
                "success": False,
                "error": "Memory manager not available",
            }

        # Try to run reindex job on ReMeLightMemoryManager
        run_job = getattr(memory_manager, "_run_reme_job", None)
        if run_job is None:
            return {
                "success": False,
                "error": "Reindex not supported by current backend",
            }

        response = await run_job("reindex")
        answer = str(getattr(response, "answer", "") or "") if response else ""
        return {
            "success": response is not None,
            "answer": answer,
            "error": None if response else "Reindex returned no response",
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
        }


@router.get(
    "/language",
    summary="Get agent language",
    description="Get the language setting for agent MD files.",
)
async def get_agent_language(request: Request) -> dict:
    """Get agent language setting for current agent."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)
    return {
        "language": agent_config.language,
        "agent_id": workspace.agent_id,
    }


@router.put(
    "/language",
    summary="Update agent language",
    description=(
        "Update the language for agent MD files. "
        "Optionally copies MD files for the new language to agent workspace."
    ),
)
async def put_agent_language(
    request: Request,
    body: dict = Body(
        ...,
        description='Language setting, e.g. {"language": "id"}',
    ),
) -> dict:
    """
    Update agent language and optionally re-copy MD files to agent workspace.
    """
    language = (body.get("language") or "").strip().lower()
    valid = SUPPORTED_AGENT_LANGUAGES
    if language not in valid:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid language '{language}'. "
                f"Must be one of: {', '.join(sorted(valid))}"
            ),
        )

    workspace = await get_agent_for_request(request)
    agent_id = workspace.agent_id

    agent_config = load_agent_config(agent_id)
    old_language = agent_config.language

    agent_config.language = language
    save_agent_config(agent_id, agent_config)

    copied_files: list[str] = []
    if old_language != language:
        copied_files = copy_workspace_md_files(
            language,
            workspace.workspace_dir,
            md_template_id=get_workspace_md_template_id(
                agent_config.template_id
                or ("qa" if agent_id == BUILTIN_QA_AGENT_ID else None),
            ),
            only_if_missing=False,
        )

    return {
        "language": language,
        "copied_files": copied_files,
        "agent_id": agent_id,
    }


@router.get(
    "/audio-mode",
    summary="Get audio mode",
    description=(
        "Get the audio handling mode for incoming voice messages. "
        'Values: "auto", "native".'
    ),
)
async def get_audio_mode() -> dict:
    """Get audio mode setting."""
    config = load_config()
    return {"audio_mode": config.agents.audio_mode}


@router.put(
    "/audio-mode",
    summary="Update audio mode",
    description=(
        "Update how incoming audio/voice messages are handled. "
        '"auto": transcribe if provider available, else file placeholder; '
        '"native": send audio directly to model (may need ffmpeg).'
    ),
)
async def put_audio_mode(
    body: dict = Body(
        ...,
        description='Audio mode, e.g. {"audio_mode": "auto"}',
    ),
) -> dict:
    """Update audio mode setting."""
    raw = body.get("audio_mode")
    audio_mode = (str(raw) if raw is not None else "").strip().lower()
    valid = {"auto", "native"}
    if audio_mode not in valid:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid audio_mode '{audio_mode}'. "
                f"Must be one of: {', '.join(sorted(valid))}"
            ),
        )
    config = load_config()
    config.agents.audio_mode = audio_mode
    save_config(config)
    return {"audio_mode": audio_mode}


@router.get(
    "/transcription-provider-type",
    summary="Get transcription provider type",
    description=(
        "Get the transcription provider type. "
        'Values: "disabled", "whisper_api", "local_whisper".'
    ),
)
async def get_transcription_provider_type() -> dict:
    """Get transcription provider type setting."""
    config = load_config()
    return {
        "transcription_provider_type": (
            config.agents.transcription_provider_type
        ),
    }


@router.put(
    "/transcription-provider-type",
    summary="Set transcription provider type",
    description=(
        "Set the transcription provider type. "
        '"disabled": no transcription; '
        '"whisper_api": remote Whisper endpoint; '
        '"local_whisper": locally installed openai-whisper.'
    ),
)
async def put_transcription_provider_type(
    body: dict = Body(
        ...,
        description=(
            "Provider type, e.g. "
            '{"transcription_provider_type": "whisper_api"}'
        ),
    ),
) -> dict:
    """Set the transcription provider type."""
    raw = body.get("transcription_provider_type")
    provider_type = (str(raw) if raw is not None else "").strip().lower()
    valid = {"disabled", "whisper_api", "local_whisper"}
    if provider_type not in valid:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid transcription_provider_type '{provider_type}'. "
                f"Must be one of: {', '.join(sorted(valid))}"
            ),
        )
    config = load_config()
    config.agents.transcription_provider_type = provider_type
    save_config(config)
    return {"transcription_provider_type": provider_type}


@router.get(
    "/local-whisper-status",
    summary="Check local whisper availability",
    description=(
        "Check whether the local whisper provider can be used. "
        "Returns availability of ffmpeg and openai-whisper."
    ),
)
async def get_local_whisper_status() -> dict:
    """Check local whisper dependencies."""
    from ...agents.utils.audio_transcription import (
        check_local_whisper_available,
    )

    return check_local_whisper_available()


@router.get(
    "/transcription-providers",
    summary="List transcription providers",
    description=(
        "List providers capable of audio transcription (Whisper API). "
        "Returns available providers and the configured selection."
    ),
)
async def get_transcription_providers() -> dict:
    """List transcription-capable providers and configured selection."""
    from ...agents.utils.audio_transcription import (
        get_configured_transcription_provider_id,
        list_transcription_providers,
    )

    return {
        "providers": list_transcription_providers(),
        "configured_provider_id": (get_configured_transcription_provider_id()),
    }


@router.put(
    "/transcription-provider",
    summary="Set transcription provider",
    description=(
        "Set the provider to use for audio transcription. "
        'Use empty string "" to unset.'
    ),
)
async def put_transcription_provider(
    body: dict = Body(
        ...,
        description=(
            'Provider ID, e.g. {"provider_id": "openai"} '
            'or {"provider_id": ""} to unset'
        ),
    ),
) -> dict:
    """Set the transcription provider."""
    provider_id = (body.get("provider_id") or "").strip()
    config = load_config()
    config.agents.transcription_provider_id = provider_id
    save_config(config)
    return {"provider_id": provider_id}


@router.post(
    "/transcribe",
    summary="Transcribe audio to text",
    description=(
        "Transcribe an uploaded audio file "
        "using the configured Whisper provider. "
        "Returns the transcribed text."
    ),
)
async def post_transcribe_audio(
    file: UploadFile = File(..., description="Audio file to transcribe"),
) -> dict:
    """Transcribe uploaded audio file using configured Whisper provider."""
    from ...agents.utils.audio_transcription import transcribe_audio

    # Check transcription is enabled
    config = load_config()
    provider_type = config.agents.transcription_provider_type
    if provider_type == "disabled":
        raise HTTPException(
            status_code=400,
            detail={
                "code": "TRANSCRIPTION_DISABLED",
                "message": (
                    "Transcription is disabled. "
                    "Configure a transcription provider in Settings."
                ),
            },
        )

    # Validate file type
    allowed_extensions = {
        ".webm",
        ".mp4",
        ".m4a",
        ".wav",
        ".mp3",
        ".ogg",
        ".flac",
    }
    suffix = (
        os.path.splitext(file.filename or "audio.webm")[1].lower() or ".webm"
    )
    if suffix not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "UNSUPPORTED_FILE_TYPE",
                "message": (
                    f"Unsupported file type: {suffix}. "
                    f"Allowed: {', '.join(sorted(allowed_extensions))}"
                ),
            },
        )

    data = await file.read()
    check_upload_size(data)

    # Save uploaded file to temp directory
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        text = await transcribe_audio(tmp_path)
        if text is None:
            raise HTTPException(
                status_code=500,
                detail="Transcription failed. Check provider configuration.",
            )
        return {"text": text}
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@router.get(
    "/running-config",
    response_model=AgentsRunningConfig,
    summary="Get agent running config",
    description="Get running configuration for active agent",
)
async def get_agents_running_config(
    request: Request,
) -> AgentsRunningConfig:
    """Get agent running configuration."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)
    running = agent_config.running or AgentsRunningConfig()
    running.approval_level = getattr(agent_config, "approval_level", "AUTO")
    return running


@router.put(
    "/running-config",
    response_model=AgentsRunningConfig,
    summary="Update agent running config",
    description="Update running configuration for active agent",
)
async def put_agents_running_config(
    running_config: AgentsRunningConfig = Body(
        ...,
        description="Updated agent running configuration",
    ),
    request: Request = None,
) -> AgentsRunningConfig:
    """Update agent running configuration."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)

    if running_config.approval_level is not None:
        agent_config.approval_level = running_config.approval_level

    running_config.approval_level = None
    agent_config.running = running_config
    save_agent_config(workspace.agent_id, agent_config)

    schedule_agent_reload(request, workspace.agent_id)

    running_config.approval_level = agent_config.approval_level
    return running_config


@router.get(
    "/system-prompt-files",
    response_model=list[str],
    summary="Get system prompt files",
    description="Get system prompt files for active agent",
)
async def get_system_prompt_files(
    request: Request,
) -> list[str]:
    """Get list of enabled system prompt files."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)
    return agent_config.system_prompt_files or []


@router.put(
    "/system-prompt-files",
    response_model=list[str],
    summary="Update system prompt files",
    description="Update system prompt files for active agent",
)
async def put_system_prompt_files(
    files: list[str] = Body(
        ...,
        description="Markdown filenames to load into system prompt",
    ),
    request: Request = None,
) -> list[str]:
    """Update list of enabled system prompt files."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)
    agent_config.system_prompt_files = files
    save_agent_config(workspace.agent_id, agent_config)

    schedule_agent_reload(request, workspace.agent_id)

    return files


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_zip_data(data: bytes, workspace_dir: Path) -> None:
    """Ensure *data* is a valid zip without path-traversal entries."""
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is not a valid zip archive",
        )
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for name in zf.namelist():
            resolved = (workspace_dir / name).resolve()
            if not str(resolved).startswith(str(workspace_dir)):
                raise HTTPException(
                    status_code=400,
                    detail=f"Zip contains unsafe path: {name}",
                )


def _extract_and_merge_zip(data: bytes, workspace_dir: Path) -> None:
    """Extract zip data and merge into workspace_dir (blocking operation)."""
    tmp_dir = None
    try:
        tmp_dir = Path(tempfile.mkdtemp(prefix="qwenpaw_upload_"))
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(tmp_dir)

        top_entries = list(tmp_dir.iterdir())
        extract_root = tmp_dir
        if len(top_entries) == 1 and top_entries[0].is_dir():
            extract_root = top_entries[0]

        workspace_dir.mkdir(parents=True, exist_ok=True)

        for item in extract_root.iterdir():
            dest = workspace_dir / item.name
            if item.is_file():
                shutil.copy2(item, dest)
            else:
                if dest.exists() and dest.is_file():
                    dest.unlink()
                shutil.copytree(item, dest, dirs_exist_ok=True)
    finally:
        if tmp_dir and tmp_dir.is_dir():
            shutil.rmtree(tmp_dir, ignore_errors=True)


def _validate_and_extract_zip(data: bytes, workspace_dir: Path) -> None:
    """Validate and extract zip data (blocking operation)."""
    _validate_zip_data(data, workspace_dir)
    _extract_and_merge_zip(data, workspace_dir)


# ---------------------------------------------------------------------------
# Workspace Download/Upload Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/download",
    summary="Download workspace as zip",
    description=(
        "Package the entire agent workspace into a zip archive and stream "
        "it back as a downloadable file."
    ),
    responses={
        200: {
            "content": {"application/zip": {}},
            "description": "Zip archive of agent workspace",
        },
    },
)
async def download_workspace(request: Request):
    """Stream agent workspace as a zip file."""

    agent = await get_agent_for_request(request)
    workspace_dir = agent.workspace_dir

    if not workspace_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail=f"Workspace does not exist: {workspace_dir}",
        )

    buf = await asyncio.to_thread(_zip_directory, workspace_dir)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"qwenpaw_workspace_{agent.agent_id}_{timestamp}.zip"

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.post(
    "/upload",
    response_model=dict,
    summary="Upload zip and merge into workspace",
    description=(
        "Upload a zip archive.  Paths present in the zip are merged into "
        "agent workspace (files overwritten, dirs merged).  Paths not in "
        "the zip are left unchanged (e.g. qwenpaw.db, runtime dirs). "
        "Download packs the entire workspace; upload only "
        "overwrites/merges zip contents."
    ),
)
async def upload_workspace(
    request: Request,
    file: UploadFile = File(
        ...,
        description="Zip archive to merge into agent workspace",
    ),
) -> dict:
    """
    Merge uploaded zip contents into agent workspace (overwrite, not clear).
    """

    if file.content_type and file.content_type not in (
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Expected a zip file, got content-type: {file.content_type}"
            ),
        )

    agent = await get_agent_for_request(request)
    workspace_dir = agent.workspace_dir
    data = await file.read()

    try:
        await asyncio.to_thread(_validate_and_extract_zip, data, workspace_dir)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to merge workspace: {exc}",
        ) from exc


@router.get("/commands/available")
async def get_available_commands(request: Request):
    """Return all slash commands registered for the workspace.

    Merges built-in system commands with plugin-registered ones
    so the frontend can dynamically populate the slash menu.
    """
    agent = await get_agent_for_request(request)
    registry = getattr(
        getattr(agent, "plugins", None),
        "slash_command_registry",
        None,
    )
    commands = []
    if registry is not None:
        for name in registry.names():
            match = registry.resolve(f"/{name}")
            desc = ""
            category = ""
            if match:
                spec, _ = match
                desc = spec.help_text or ""
                category = spec.category or ""
            commands.append(
                {
                    "name": name,
                    "description": desc,
                    "category": category,
                },
            )
    return {"commands": commands}


# ---------------------------------------------------------------------------
# Work Directory – conversation-produced document management
# ---------------------------------------------------------------------------


class WorkDirConfigResponse(BaseModel):
    """Work directory configuration response."""

    enabled: bool
    base_dir: str | None = None
    session_isolation: bool
    subfolder_pattern: str
    resolved_preview: str | None = None


class WorkDirConfigUpdate(BaseModel):
    """Work directory configuration update body."""

    enabled: bool | None = None
    base_dir: str | None = None
    session_isolation: bool | None = None
    subfolder_pattern: str | None = None


@router.get(
    "/work-dir",
    response_model=WorkDirConfigResponse,
    summary="Get work directory configuration",
)
async def get_work_dir_config(
    request: Request,
    agent_id: str | None = Query(default=None),
) -> WorkDirConfigResponse:
    """Get the work directory configuration for the active agent."""
    workspace = await get_agent_for_request(request, agent_id=agent_id)
    cfg = load_agent_config(workspace.agent_id)
    wd = cfg.work_dir

    # Build a preview of the resolved path
    preview = None
    if wd.enabled:
        base = (
            Path(wd.base_dir).expanduser()
            if wd.base_dir
            else workspace.workspace_dir / "work"
        )
        preview = str(base)

    return WorkDirConfigResponse(
        enabled=wd.enabled,
        base_dir=wd.base_dir,
        session_isolation=wd.session_isolation,
        subfolder_pattern=wd.subfolder_pattern,
        resolved_preview=preview,
    )


@router.put(
    "/work-dir",
    response_model=WorkDirConfigResponse,
    summary="Update work directory configuration",
)
async def update_work_dir_config(
    body: WorkDirConfigUpdate,
    request: Request,
    agent_id: str | None = Query(default=None),
) -> WorkDirConfigResponse:
    """Update the work directory configuration for the active agent."""
    workspace = await get_agent_for_request(request, agent_id=agent_id)
    cfg = load_agent_config(workspace.agent_id)

    if body.enabled is not None:
        cfg.work_dir.enabled = body.enabled
    if body.base_dir is not None:
        # Empty string means "clear / use default"
        cfg.work_dir.base_dir = body.base_dir if body.base_dir.strip() else None
    if body.session_isolation is not None:
        cfg.work_dir.session_isolation = body.session_isolation
    if body.subfolder_pattern is not None:
        cfg.work_dir.subfolder_pattern = body.subfolder_pattern

    save_agent_config(cfg.id, cfg)

    preview = None
    if cfg.work_dir.enabled:
        base = (
            Path(cfg.work_dir.base_dir).expanduser()
            if cfg.work_dir.base_dir
            else workspace.workspace_dir / "work"
        )
        preview = str(base)

    return WorkDirConfigResponse(
        enabled=cfg.work_dir.enabled,
        base_dir=cfg.work_dir.base_dir,
        session_isolation=cfg.work_dir.session_isolation,
        subfolder_pattern=cfg.work_dir.subfolder_pattern,
        resolved_preview=preview,
    )


@router.get(
    "/work-files",
    summary="List work documents (conversation-produced files)",
)
async def list_work_files(
    request: Request,
    agent_id: str | None = Query(default=None),
) -> list[dict]:
    """List files in the work directory.

    Returns all non-hidden files in the work directory. When work_dir
    is disabled, returns an empty list (files are in workspace_dir and
    accessible via the /files endpoint).
    """
    workspace = await get_agent_for_request(request, agent_id=agent_id)
    cfg = load_agent_config(workspace.agent_id)

    if not cfg.work_dir.enabled:
        return []

    # Determine the work directory base
    if cfg.work_dir.base_dir:
        base = Path(cfg.work_dir.base_dir).expanduser().resolve()
    else:
        base = workspace.workspace_dir / "work"

    if not base.exists():
        return []

    return await asyncio.get_event_loop().run_in_executor(
        None,
        _list_all_files,
        base,
    )


async def _resolve_work_base(
    request: Request,
    agent_id: str | None,
) -> Path:
    """Resolve the work directory base for the current agent.

    Raises HTTPException(400) if work_dir is disabled.
    """
    workspace = await get_agent_for_request(request, agent_id=agent_id)
    cfg = load_agent_config(workspace.agent_id)
    if not cfg.work_dir.enabled:
        raise HTTPException(
            status_code=400,
            detail="Work directory is not enabled for this agent",
        )
    if cfg.work_dir.base_dir:
        return Path(cfg.work_dir.base_dir).expanduser().resolve()
    return (workspace.workspace_dir / "work").resolve()


@router.get(
    "/work-files/{file_path:path}",
    summary="Read a work document file",
)
async def read_work_file(
    file_path: str,
    request: Request,
    agent_id: str | None = Query(default=None),
) -> dict:
    """Read the content of a work document file.

    The file is resolved relative to the agent's work directory base.
    """
    base = await _resolve_work_base(request, agent_id)
    target = safe_join(base, file_path)

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    def _read() -> str:
        return target.read_text(encoding="utf-8", errors="replace")

    try:
        content = await asyncio.to_thread(_read)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"path": file_path, "content": content}


@router.put(
    "/work-files/{file_path:path}",
    summary="Write a work document file",
)
async def write_work_file(
    file_path: str,
    request: Request,
    body: dict = Body(...),
    agent_id: str | None = Query(default=None),
) -> dict:
    """Write content to a work document file.

    Request body::

        {"content": "<new file content>"}
    """
    base = await _resolve_work_base(request, agent_id)
    target = safe_join(base, file_path)
    content = body.get("content", "")
    if not isinstance(content, str):
        raise HTTPException(status_code=422, detail="content must be a string")

    # Ensure parent directory exists
    target.parent.mkdir(parents=True, exist_ok=True)

    def _write() -> int:
        target.write_text(content, encoding="utf-8")
        return target.stat().st_size

    try:
        size = await asyncio.to_thread(_write)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"path": file_path, "size": size}
