# -*- coding: utf-8 -*-
"""Global Text Selection Tool — built-in feature.

Provides global text-selection capture, mini floating dialog,
quick AI actions (translate / explain / summarize / search),
per-app filtering, and configurable hotkeys.

Lifecycle hooks:
    ts_startup()  — called during QwenPaw background startup
    ts_shutdown() — called during QwenPaw graceful shutdown
"""

from __future__ import annotations

import atexit
import logging

logger = logging.getLogger("qwenpaw.text_selection")


def ts_startup() -> None:
    """Boot the text selection built-in feature at QwenPaw startup."""
    try:
        from .config import get_config
        from .emitter import ensure_desktop_available, desktop_status_summary

        config = get_config()
        if not config.get("enabled", True):
            logger.info("Text Selection: disabled in config, skipping startup")
            return

        # Optionally autostart based on config or env
        import os
        autostart = os.environ.get("QWENPAW_TS_AUTOSTART", "0")
        if autostart == "1" or config.get("autoStart", False):
            ensure_desktop_available()
        else:
            # Just log status
            status = desktop_status_summary()
            logger.info(
                "Text Selection: status=%s (autostart disabled)",
                "ready" if status.get("ready") else "inactive",
            )

        # Register atexit cleanup
        atexit.register(_atexit_stop_ts)

        logger.info("Text Selection built-in feature initialized")

    except Exception:
        logger.warning(
            "Text Selection: startup skipped (dependency error)",
            exc_info=True,
        )


def ts_shutdown() -> None:
    """Stop the text selection desktop process on QwenPaw shutdown."""
    try:
        from .emitter import stop_desktop

        result = stop_desktop(force=True, aggressive=True, grace=5.0)
        logger.info(
            "Text Selection: shutdown complete: %s",
            "stopped=%s" % result.get("stopped"),
        )
    except Exception:
        logger.warning(
            "Text Selection: shutdown failed",
            exc_info=True,
        )


def _atexit_stop_ts() -> None:
    """Last-resort cleanup registered via atexit."""
    try:
        from .emitter import stop_desktop

        stop_desktop(force=True, aggressive=False, grace=3.0)
    except Exception:
        pass
