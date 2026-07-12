# -*- coding: utf-8 -*-
"""Local HTTP bridge for text selection desktop process."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from fastapi import FastAPI, Header, HTTPException

from . import runtime as ts_rt
from .config import get_config, update_config

logger = logging.getLogger(__name__)


def _token_required() -> bool:
    return os.environ.get("QWENPAW_TS_REQUIRE_TOKEN", "1") != "0"


def _check_token(header_value: str | None) -> None:
    if not _token_required():
        return
    expected = ts_rt.read_token()
    if not expected:
        raise HTTPException(status_code=503, detail="token not initialized")
    if header_value != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


def build_app(
    on_show_dialog: Any = None,
    on_update_config: Any = None,
) -> FastAPI:
    app = FastAPI(title="QwenPaw Text Selection Desktop")
    ts_rt.ensure_runtime()
    ts_rt.ensure_token()

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "service": "qwenpaw-text-selection-desktop",
            "tokenRequired": _token_required(),
            **ts_rt.current_process_status(),
        }

    @app.get("/config")
    def get_ts_config(
        x_qwenpaw_ts_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_qwenpaw_ts_token)
        return get_config()

    @app.post("/config")
    def update_ts_config(
        body: dict[str, Any],
        x_qwenpaw_ts_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_qwenpaw_ts_token)
        result = update_config(body)
        if on_update_config:
            on_update_config(result)
        return result

    @app.post("/trigger")
    def trigger_dialog(
        body: dict[str, Any],
        x_qwenpaw_ts_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        """Programmatically trigger the text selection dialog."""
        _check_token(x_qwenpaw_ts_token)
        text = body.get("text", "")
        if on_show_dialog:
            on_show_dialog(text)
        return {"ok": True, "triggered": bool(text)}

    return app
