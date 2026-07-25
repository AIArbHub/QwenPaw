# -*- coding: utf-8 -*-
"""API router for global text selection tool."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, HTTPException

logger = logging.getLogger("aiarb.routers.text_selection")


def build_router() -> APIRouter:
    router = APIRouter(prefix="/text-selection", tags=["text-selection"])

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    @router.get("/config")
    def get_config() -> dict[str, Any]:
        """Get full text selection configuration."""
        from ..text_selection.config import get_config
        try:
            return get_config()
        except Exception:
            logger.exception("Failed to load text selection config")
            return {
                "enabled": True,
                "hotkey": "ctrl+alt+space",
                "globalEnabled": True,
                "appFilterMode": "blacklist",
                "appFilterList": [],
                "quickTools": [],
            }

    @router.put("/config")
    def update_config(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Update text selection configuration."""
        from ..text_selection.config import update_config
        try:
            result = update_config(body)
            # Notify desktop process of config change if running
            _notify_desktop_config_change(result)
            return result
        except Exception:
            logger.exception("Failed to update text selection config")
            raise HTTPException(status_code=500, detail="Failed to update config")

    # ------------------------------------------------------------------
    # Status / Control
    # ------------------------------------------------------------------

    @router.get("/status")
    def status() -> dict[str, Any]:
        """Get text selection desktop process status."""
        from ..text_selection.emitter import desktop_status_summary
        from ..text_selection.config import get_config
        try:
            config = get_config()
            status_info = desktop_status_summary()
            return {
                "ok": True,
                "service": "aiarb-text-selection",
                "enabled": config.get("enabled", True),
                **status_info,
            }
        except Exception:
            logger.exception("Failed to get text selection status")
            return {
                "ok": False,
                "service": "aiarb-text-selection",
                "enabled": False,
                "ready": False,
                "starting": False,
                "running": False,
            }

    @router.post("/desktop/start")
    def desktop_start() -> dict[str, Any]:
        """Start the text selection desktop process."""
        from ..text_selection.emitter import start_desktop_interactive
        try:
            return start_desktop_interactive()
        except Exception:
            logger.exception("Failed to start text selection desktop")
            raise HTTPException(status_code=500, detail="Failed to start desktop")

    @router.post("/desktop/stop")
    def desktop_stop() -> dict[str, Any]:
        """Stop the text selection desktop process."""
        from ..text_selection.emitter import stop_desktop
        try:
            return stop_desktop(force=True)
        except Exception:
            logger.exception("Failed to stop text selection desktop")
            raise HTTPException(status_code=500, detail="Failed to stop desktop")

    # ------------------------------------------------------------------
    # Quick Tools CRUD
    # ------------------------------------------------------------------

    @router.get("/quick-tools")
    def list_quick_tools() -> list[dict[str, Any]]:
        """List all quick tools."""
        from ..text_selection.config import get_quick_tools
        try:
            return get_quick_tools()
        except Exception:
            logger.exception("Failed to list quick tools")
            return []

    @router.post("/quick-tools")
    def create_quick_tool(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Create or update a quick tool."""
        from ..text_selection.config import add_quick_tool
        try:
            result = add_quick_tool(body)
            _notify_desktop_tools_change()
            return result
        except Exception:
            logger.exception("Failed to create quick tool")
            raise HTTPException(status_code=500, detail="Failed to create quick tool")

    @router.put("/quick-tools/{tool_id}")
    def update_quick_tool(
        tool_id: str,
        body: dict[str, Any] = Body(...),
    ) -> dict[str, Any]:
        """Update an existing quick tool."""
        from ..text_selection.config import update_quick_tool
        try:
            result = update_quick_tool(tool_id, body)
            if result is None:
                raise HTTPException(status_code=404, detail="Tool not found")
            _notify_desktop_tools_change()
            return result
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed to update quick tool")
            raise HTTPException(status_code=500, detail="Failed to update quick tool")

    @router.delete("/quick-tools/{tool_id}")
    def delete_quick_tool(tool_id: str) -> dict[str, Any]:
        """Delete a quick tool."""
        from ..text_selection.config import delete_quick_tool
        try:
            deleted = delete_quick_tool(tool_id)
            if not deleted:
                raise HTTPException(status_code=404, detail="Tool not found")
            _notify_desktop_tools_change()
            return {"ok": True, "deleted": tool_id}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed to delete quick tool")
            raise HTTPException(status_code=500, detail="Failed to delete quick tool")

    # ------------------------------------------------------------------
    # AI Processing
    # ------------------------------------------------------------------

    @router.post("/process")
    async def process_text(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Process selected text with AI.

        Body: { text: str, action: str, prompt: str }
        Returns: { result: str }
        """
        text = body.get("text", "")
        action = body.get("action", "")
        prompt = body.get("prompt", "")

        if not prompt:
            prompt = text

        try:
            result = await _process_with_ai(prompt)
            return {"ok": True, "result": result, "action": action}
        except Exception as exc:
            logger.exception("AI processing failed for action=%s", action)
            raise HTTPException(
                status_code=500,
                detail=f"Processing failed: {str(exc)}",
            )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _notify_desktop_config_change(config: dict[str, Any]) -> None:
        """Notify running desktop process of config changes."""
        try:
            import httpx
            from ..text_selection.emitter import _active_desktop_base

            base = _active_desktop_base
            if not base:
                return

            token = None
            try:
                from ..text_selection import runtime as ts_rt
                token = ts_rt.read_token()
            except ImportError:
                pass

            headers = {}
            if token:
                headers["X-AIArb-TS-Token"] = token

            httpx.post(
                f"{base.rstrip('/')}/config",
                json=config,
                headers=headers,
                timeout=3.0,
                trust_env=False,
            )
        except Exception:
            pass

    def _notify_desktop_tools_change() -> None:
        """Notify desktop process that quick tools have changed."""
        try:
            from ..text_selection.config import get_config
            config = get_config()
            _notify_desktop_config_change(config)
        except Exception:
            pass

    async def _process_with_ai(prompt: str) -> str:
        """Process text using the AIArb AI agent infrastructure."""
        # Try to use the agent context if available
        try:
            from aiarb.app.chats.runner import (
                _build_chat_request,
            )  # type: ignore[import-untyped]
            from aiarb.app.chats.workflow import (
                execute_chat_workflow,
            )  # type: ignore[import-untyped]
            from aiarb.app.providers.manager import (
                ProviderManager,
            )  # type: ignore[import-untyped]

            # Use a simple direct LLM call
            provider_manager = ProviderManager.get_instance()
            if provider_manager:
                result = await provider_manager.chat_simple(
                    messages=[{"role": "user", "content": prompt}],
                    stream=False,
                )
                if isinstance(result, str):
                    return result
                if isinstance(result, dict):
                    return result.get("content", str(result))
                return str(result)
        except ImportError:
            logger.warning("Text Selection: provider manager not available")
        except Exception:
            logger.exception("Text Selection: AI processing via provider failed")

        # Fallback: return the prompt itself (will be improved when AI infra is available)
        return f"[AI处理结果]\n\n您提交了文本，正在等待AI响应。\n\n原文: {prompt[:200]}..."

    return router


router = build_router()
