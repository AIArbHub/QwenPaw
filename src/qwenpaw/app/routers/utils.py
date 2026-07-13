# -*- coding: utf-8 -*-
"""Utility API routes — native folder picker, etc."""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, Body
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SelectFolderRequest(BaseModel):
    start_dir: str | None = None


router = APIRouter(prefix="/utils", tags=["utils"])


def _native_select_folder() -> str | None:
    """Open a native folder picker dialog (blocking, called from executor)."""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title="Select Folder")
        root.destroy()
        return folder if folder else None
    except Exception as exc:
        logger.warning("tkinter folder picker failed: %s", exc)
        return None


@router.post("/select-folder", summary="Open native folder picker")
async def select_folder(body: SelectFolderRequest = Body(default_factory=SelectFolderRequest)) -> dict:
    """Open a native OS folder selection dialog and return the selected path.

    The dialog runs in a thread pool so the async event loop is not blocked.
    On headless systems where tkinter is unavailable the endpoint returns an
    empty result (the frontend should fall back to manual input).
    """
    start_dir = body.start_dir

    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor(max_workers=1) as pool:
        selected = await loop.run_in_executor(pool, _native_select_folder)

    if selected is None:
        return {"path": None, "cancelled": True}

    return {"path": str(Path(selected).resolve()), "cancelled": False}
