# -*- coding: utf-8 -*-
"""Desktop app entry point."""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
from copy import deepcopy
from pathlib import Path
from queue import Empty, SimpleQueue
from typing import Any, Callable

import uvicorn
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction, QIcon, QPixmap
from PySide6.QtWidgets import QApplication, QMenu, QSystemTrayIcon

from . import runtime
from .pet_package import resolve_pet_dir
from .server import build_app
from .sprites import CELL_HEIGHT, CELL_WIDTH, STATE_SPECS
from .window import PetWindow

logger = logging.getLogger(__name__)

_PET_EVENT_QUEUE: SimpleQueue[dict[str, Any]] = SimpleQueue()
_PET_SWITCH_QUEUE: SimpleQueue[Path] = SimpleQueue()


def _make_tray_icon(pet_dir: Path) -> QIcon:
    """Build a QIcon from the pet's idle frame for the system tray."""
    from .pet_package import validate_pet_package

    try:
        manifest, sheet_path = validate_pet_package(pet_dir)
        sheet = QPixmap(str(sheet_path))
        if not sheet.isNull():
            idle_spec = STATE_SPECS.get("idle", {})
            row = idle_spec.get("row", 0)
            frame = QPixmap(sheet, 0, row * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT)
            icon = QIcon(frame)
            sizes = [16, 22, 24, 32, 48, 64]
            for s in sizes:
                icon.addPixmap(frame.pixmap(s, s))
            return icon
    except Exception:
        logger.debug("Could not create tray icon from pet spritesheet", exc_info=True)

    fallback = QPixmap(32, 32)
    fallback.fill()
    from PySide6.QtGui import QPainter, QColor
    painter = QPainter(fallback)
    painter.setRenderHint(QPainter.Antialiasing)
    painter.setBrush(QColor(75, 63, 227))
    painter.setPen(Qt.PenStyle.NoPen)
    painter.drawEllipse(2, 2, 28, 28)
    painter.end()
    return QIcon(fallback)


def enqueue_pet_event(payload: dict[str, Any]) -> None:
    """Thread-safe handoff from HTTP worker to the pet window (main thread)."""
    try:
        _PET_EVENT_QUEUE.put_nowait(deepcopy(payload))
    except Exception:
        logger.exception("Failed to enqueue pet event")


def enqueue_switch_pet(pet_dir: Path) -> None:
    """Thread-safe: reload sprites on the GUI thread."""
    try:
        _PET_SWITCH_QUEUE.put_nowait(pet_dir)
    except Exception:
        logger.exception("Failed to enqueue pet switch")


def run_http_server(
    on_event: Callable[[dict[str, Any]], None],
    on_switch_pet: Callable[[Path], None],
    host: str,
    port: int,
) -> None:
    app = build_app(on_event, on_switch_pet)
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level=os.environ.get("AIARB_PET_LOG_LEVEL", "warning"),
    )
    server = uvicorn.Server(config)
    server.run()


def run_desktop(pet_dir: Path, host: str, port: int, scale: float) -> int:
    runtime.ensure_runtime()
    runtime.ensure_token()
    runtime.write_pid(os.getpid())
    runtime.write_json(runtime.bubble_path(), {"text": "", "counter": 0})
    display_host = "127.0.0.1" if host in ("0.0.0.0", "::", "[::]") else host
    runtime.write_bridge_url(f"http://{display_host}:{port}")

    qt_app = QApplication(sys.argv)
    qt_app.setQuitOnLastWindowClosed(False)

    window = PetWindow(pet_dir, scale=scale)

    # ── System tray icon ──────────────────────────────────────────────
    tray_icon = QSystemTrayIcon(_make_tray_icon(pet_dir), qt_app)
    tray_menu = QMenu()

    pet_name = window.manifest.get("displayName", "AIArb Pet")
    title_action = tray_menu.addAction(pet_name)
    title_action.setEnabled(False)
    tray_menu.addSeparator()

    toggle_action = tray_menu.addAction("隐藏宠物")
    toggle_action.setCheckable(False)

    def _toggle_pet_visibility() -> None:
        if window.isVisible():
            window.hide()
            toggle_action.setText("显示宠物")
        else:
            window.show()
            toggle_action.setText("隐藏宠物")

    toggle_action.triggered.connect(_toggle_pet_visibility)
    tray_menu.addSeparator()

    anim_menu = tray_menu.addMenu("切换动画")
    for state_name in ("idle", "waving", "running", "waiting", "jumping"):
        act = anim_menu.addAction(state_name.capitalize())
        act.setData(state_name)

    def _on_anim_trigger(action: QAction) -> None:
        state = action.data()
        if isinstance(state, str):
            window.set_state(state)

    anim_menu.triggered.connect(_on_anim_trigger)
    tray_menu.addSeparator()

    quit_action = tray_menu.addAction("退出")

    def _quit_from_tray() -> None:
        tray_icon.hide()
        qt_app.quit()

    quit_action.triggered.connect(_quit_from_tray)

    tray_icon.setContextMenu(tray_menu)
    tray_icon.setToolTip(pet_name)

    def _on_tray_activated(reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            _toggle_pet_visibility()

    tray_icon.activated.connect(_on_tray_activated)
    tray_icon.show()

    # ── Signal handlers ───────────────────────────────────────────────
    def _request_shutdown(signum: int, _frame: Any) -> None:
        logger.info("Pet desktop received signal %s; quitting", signum)
        QTimer.singleShot(0, qt_app.quit)

    for _sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(_sig, _request_shutdown)
        except (OSError, ValueError):
            pass

    # ── Event pump ────────────────────────────────────────────────────
    pump = QTimer(window)

    def _drain_pet_events() -> None:
        try:
            while True:
                pet_path = _PET_SWITCH_QUEUE.get_nowait()
                try:
                    window.reload_pet(pet_path)
                except Exception:
                    logger.exception("Pet reload failed for %s", pet_path)
        except Empty:
            pass
        try:
            while True:
                payload = _PET_EVENT_QUEUE.get_nowait()
                window.apply_event(payload)
        except Empty:
            pass

    pump.timeout.connect(_drain_pet_events)
    pump.start(40)

    # ── HTTP server ───────────────────────────────────────────────────
    server_thread = threading.Thread(
        target=run_http_server,
        args=(enqueue_pet_event, enqueue_switch_pet, host, port),
        daemon=True,
    )
    server_thread.start()
    window.show()
    try:
        return qt_app.exec()
    finally:
        try:
            runtime.pid_path().unlink(missing_ok=True)
        except OSError:
            logger.exception("Failed to remove pid file at shutdown")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run AIArb Pet Desktop")
    parser.add_argument("--pet-dir", default=None)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--scale", type=float, default=0.58)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO)
    args = parse_args(argv)
    if not runtime.try_acquire_instance_lock():
        logger.info(
            "Another AIArb Pet Desktop instance is already running; exiting",
        )
        return 0
    try:
        pet_dir = resolve_pet_dir(args.pet_dir)
        return run_desktop(
            pet_dir=pet_dir,
            host=args.host,
            port=args.port,
            scale=args.scale,
        )
    finally:
        runtime.release_instance_lock()


if __name__ == "__main__":
    raise SystemExit(main())