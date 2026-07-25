# -*- coding: utf-8 -*-
"""AIArb Pet Desktop runtime (built-in feature)."""

import atexit
import logging

__version__ = "0.1.0"

logger = logging.getLogger("aiarb.pet_desktop")


def _atexit_stop_pet_desktop() -> None:
    """Best-effort stop when the interpreter exits without lifespan hooks."""
    try:
        from .emitter import stop_desktop

        stop_desktop(force=True, aggressive=True, grace=5.0)
    except Exception:
        logger.debug(
            "Pet Desktop: atexit stop skipped or failed",
            exc_info=True,
        )


async def pet_startup() -> None:
    """Built-in startup: patch agent runner and start desktop.

    Called from the application lifespan during background startup.
    """
    from .emitter import emit_pet_event, ensure_desktop_available
    from .patch_approval import patch_approval_service
    from .patch_runner import patch_agent_runner

    # Runtime patches
    try:
        patch_agent_runner()
    except Exception:
        logger.exception(
            "Pet Desktop: failed to patch AgentRunner; "
            "lifecycle events will be unavailable",
        )
    try:
        patch_approval_service()
    except Exception:
        logger.exception(
            "Pet Desktop: failed to patch ApprovalService; "
            "approval events will be unavailable",
        )

    # Start desktop
    try:
        ensure_desktop_available()
        emit_pet_event(
            "aiarb.startup",
            text="AIArb started",
            duration_ms=1500,
        )
        logger.info("Pet Desktop startup complete")
    except Exception:
        logger.exception("Pet Desktop startup hook failed")

    # Register atexit fallback
    atexit.register(_atexit_stop_pet_desktop)


async def pet_shutdown() -> None:
    """Built-in shutdown: stop desktop and restore patches."""
    from .emitter import emit_pet_event, stop_desktop
    from .patch_approval import restore_approval_service
    from .patch_runner import restore_agent_runner

    try:
        emit_pet_event("aiarb.shutdown", text="", duration_ms=500)
    except Exception:
        logger.warning(
            "Pet Desktop: shutdown event emit failed",
            exc_info=True,
        )

    try:
        result = stop_desktop(force=True, aggressive=True, grace=5.0)
        logger.info("Pet Desktop: stop_desktop result=%s", result)
    except Exception:
        logger.exception("Pet Desktop: failed to stop desktop process")

    try:
        restore_approval_service()
        restore_agent_runner()
    except Exception:
        logger.exception("Pet Desktop: failed to restore class methods")

    logger.info("Pet Desktop shutdown complete")
