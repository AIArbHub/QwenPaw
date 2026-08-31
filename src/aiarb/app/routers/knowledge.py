# -*- coding: utf-8 -*-
"""Shared knowledge base management API.

Endpoints let the console browse, search, preview, upload, rename, delete and
manage categories of the *editable* global knowledge base, plus read/search
the read-only configured ``knowledge_paths`` roots.

Write operations are confined to the editable global directory only; any
configured ``knowledge_paths`` root is treated as read-only.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Body, Form, HTTPException, UploadFile

from aiarb.knowledge import (
    get_global_knowledge_base_dir,
    get_knowledge_dirs,
)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _editable_root() -> Path:
    return get_global_knowledge_base_dir()


def _safe_relative(path: str) -> Path:
    """Normalise a user-supplied relative path and forbid escaping."""
    p = path.replace("\\", "/").strip("/")
    if not p:
        raise HTTPException(status_code=400, detail="Empty path")
    rel = Path(p)
    # Each component must be a safe name (no .., no absolute, no illegal chars).
    for part in rel.parts:
        if part in ("", ".", ".."):
            raise HTTPException(status_code=400, detail="Invalid path")
    return rel


def _writable_target(rel: Path) -> Path:
    root = _editable_root()
    root.mkdir(parents=True, exist_ok=True)
    target = (root / rel).resolve()
    root_resolved = root.resolve()
    if not target.is_relative_to(root_resolved):
        raise HTTPException(status_code=400, detail="Outside knowledge base")
    if target == root_resolved:
        raise HTTPException(status_code=400, detail="Invalid target")
    return target


def _walk_dirs(root: Path) -> list[dict]:
    """Return immediate subdirectories (categories) of *root*."""
    if not root.is_dir():
        return []
    result = []
    for entry in sorted(root.iterdir(), key=lambda e: e.name.lower()):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            result.append({"name": entry.name, "path": str(entry.relative_to(root))})
    return result


def _walk_files(root: Path, rel: Path) -> list[dict]:
    """Return files under *root*/*rel* (recursive), with relative paths."""
    base = root if not rel or str(rel) == "." else root / rel
    if not base.is_dir():
        raise HTTPException(status_code=404, detail="Category not found")
    files = []
    for entry in sorted(base.rglob("*")):
        if entry.name.startswith("."):
            continue
        if entry.is_file():
            files.append(
                {
                    "name": entry.name,
                    "path": str(entry.relative_to(root)).replace("\\", "/"),
                    "size": entry.stat().st_size,
                }
            )
    return files


def _file_text(path: Path, limit: int = 200_000) -> tuple[str, bool]:
    """Return text content of *path* (utf-8, ignore errors) plus truncation flag."""
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Read failed: {exc}") from exc
    text = raw.decode("utf-8", errors="replace")
    truncated = len(text) > limit
    if truncated:
        text = text[:limit]
    return text, truncated


@router.get("/overview", summary="Knowledge base overview")
def overview() -> dict:
    """Return the knowledge-base tree: editable root + files, plus read-only roots."""
    edit_root = _editable_root().resolve()
    roots = []
    for d in get_knowledge_dirs():
        try:
            resolved = d.resolve()
        except OSError:
            resolved = d
        roots.append({"path": str(resolved), "writable": resolved == edit_root})

    editable = Path(edit_root)
    if not editable.is_dir():
        editable.mkdir(parents=True, exist_ok=True)

    return {
        "editable_root": str(edit_root),
        "roots": roots,
        "categories": [
            {"name": c["name"], "path": c["path"]} for c in _walk_dirs(edit_root)
        ],
    }


@router.get("/tree", summary="List files in a category")
def tree(rel: str = "") -> dict:
    """List files under a relative category path of the editable root."""
    safe = _safe_relative(rel) if rel else Path(".")
    root = _editable_root()
    try:
        files = _walk_files(root, safe)
    except HTTPException:
        raise
    return {"files": files}


@router.get("/search", summary="Search the whole knowledge base")
def search(
    q: str = "",
    scope: str = "",
    limit: int = 50,
) -> dict:
    """Search across all knowledge roots by keyword.

    ``scope`` matches a top-level category name (e.g. laws/rules/cases/templates)
    to restrict the search to a single category directory.
    """
    query = q.strip()
    if not query:
        return {"results": [], "total": 0}
    if limit < 1:
        limit = 1
    if limit > 200:
        limit = 200

    try:
        pattern = re.compile(re.escape(query), re.IGNORECASE)
    except re.error:
        return {"results": [], "total": 0}

    results = []
    for root in get_knowledge_dirs():
        base = root
        if scope:
            base = root / scope
            if not base.is_dir():
                continue
        if not base.is_dir():
            continue
        for entry in base.rglob("*"):
            if entry.name.startswith("."):
                continue
            if not entry.is_file():
                continue
            try:
                size = entry.stat().st_size
            except OSError:
                continue
            if size > 5_000_000:  # skip huge binaries
                continue
            try:
                text, _ = _file_text(entry, limit=200_000)
            except HTTPException:
                continue
            lines = text.splitlines()
            for i, line in enumerate(lines):
                if pattern.search(line):
                    results.append(
                        {
                            "path": str(entry.relative_to(root)).replace("\\", "/"),
                            "root": str(root.resolve()),
                            "line": i + 1,
                            "snippet": line.strip()[:500],
                        }
                    )
                    break
            if len(results) >= limit:
                return {"results": results, "total": len(results)}
    return {"results": results, "total": len(results)}


@router.get("/file", summary="Read a knowledge-base text file")
def read_file(rel: str) -> dict:
    """Read text content of a file in the editable knowledge base."""
    safe = _safe_relative(rel)
    target = _writable_target(safe)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    text, truncated = _file_text(target)
    return {"path": str(safe), "content": text, "truncated": truncated}


@router.post("/upload", summary="Upload a file into a category")
async def upload(
    file: UploadFile,
    category: str = Form(""),
) -> dict:
    """Upload a file into the editable knowledge base under *category*."""
    name = (file.filename or "upload").replace("\\", "/").split("/")[-1]
    if not name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")

    rel = _safe_relative(category + "/" + name) if category else _safe_relative(name)
    target = _writable_target(rel)
    if target.is_dir():
        raise HTTPException(status_code=400, detail="Target is a directory")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Write failed: {exc}") from exc
    return {
        "path": str(target.relative_to(_editable_root().resolve())).replace("\\", "/"),
        "name": name,
        "size": len(data),
    }


@router.post("/rename", summary="Rename or move a file/category")
def rename(rel: str = Body(...), new_name: str = Body(...)) -> dict:
    """Rename a file (or category) inside the editable knowledge base."""
    safe = _safe_relative(rel)
    target = _writable_target(safe)
    new_name = new_name.strip()
    if not new_name or new_name in (".", "..") or "/" in new_name.replace("\\", "/"):
        raise HTTPException(status_code=400, detail="Invalid new name")
    new_target = target.with_name(new_name)
    try:
        if not target.exists():
            raise HTTPException(status_code=404, detail="Not found")
        target.rename(new_target)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Rename failed: {exc}") from exc
    return {
        "path": str(new_target.relative_to(_editable_root().resolve())).replace("\\", "/"),
        "name": new_name,
    }


@router.delete("/file", summary="Delete a file or empty category")
def delete_item(rel: str) -> dict:
    """Delete a file (or an empty category) inside the editable root."""
    safe = _safe_relative(rel)
    target = _writable_target(safe)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Not found")
    try:
        if target.is_dir():
            if any(target.iterdir()):
                raise HTTPException(
                    status_code=400, detail="Category not empty"
                )
            target.rmdir()
        else:
            target.unlink()
    except HTTPException:
        raise
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}") from exc
    return {"deleted": str(safe)}


@router.post("/category", summary="Create a category")
def create_category(name: str = Body(...)) -> dict:
    """Create a top-level category folder in the editable knowledge base."""
    name = name.strip()
    safe = _safe_relative(name)
    if len(safe.parts) != 1:
        raise HTTPException(status_code=400, detail="Category must be a top-level name")
    target = _writable_target(safe)
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Create failed: {exc}") from exc
    return {"name": safe.parts[0], "path": str(safe).replace("\\", "/")}