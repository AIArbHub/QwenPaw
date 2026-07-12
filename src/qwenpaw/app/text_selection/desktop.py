# -*- coding: utf-8 -*-
"""Text Selection Desktop: PySide6 process for global text selection capture."""

from __future__ import annotations

import argparse
import asyncio
import ctypes
import logging
import os
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any

# Add parent src to path for imports
_parent_src = str(Path(__file__).resolve().parent.parent.parent.parent)
if _parent_src not in sys.path:
    sys.path.insert(0, _parent_src)

logger = logging.getLogger("qwenpaw.text_selection.desktop")


# ==========================================================================
# Windows API helpers
# ==========================================================================

def _init_win32() -> None:
    """Ensure Windows API functions are available."""
    global user32, kernel32, WM_HOTKEY

    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
    except Exception:
        logger.exception("Windows API unavailable")


user32 = None
kernel32 = None

# Windows constants
WM_HOTKEY = 0x0312
WM_QUERYENDSESSION = 0x0011

VK_CONTROL = 0x11
VK_MENU = 0x12  # Alt
VK_SHIFT = 0x10
VK_SPACE = 0x20
VK_C = 0x43
VK_A = 0x41
VK_T = 0x54  # For Alt+T shortcut

MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_NOREPEAT = 0x4000

HOTKEY_ID = 1  # Our hotkey identifier

KEYBDEVENTF_KEYUP = 0x0002


def _send_ctrl_c() -> None:
    """Send Ctrl+C keystroke to copy selected text."""
    try:
        # Ctrl down
        user32.keybd_event(VK_CONTROL, 0, 0, 0)
        time.sleep(0.01)
        # C down
        user32.keybd_event(VK_C, 0, 0, 0)
        time.sleep(0.01)
        # C up
        user32.keybd_event(VK_C, 0, KEYBDEVENTF_KEYUP, 0)
        # Ctrl up
        user32.keybd_event(VK_CONTROL, 0, KEYBDEVENTF_KEYUP, 0)
    except Exception:
        logger.exception("Failed to send Ctrl+C")


def _get_foreground_window_name() -> str:
    """Get the executable name of the foreground window."""
    try:
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ""

        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        # Get process name
        PROCESS_QUERY_INFORMATION = 0x0400
        PROCESS_VM_READ = 0x0010

        hprocess = kernel32.OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
            False,
            pid,
        )
        if not hprocess:
            return ""

        try:
            path_buffer = ctypes.create_unicode_buffer(260)
            size = wintypes.DWORD(260)
            if kernel32.QueryFullProcessImageNameW(
                hprocess, 0, path_buffer, ctypes.byref(size)
            ):
                full_path = path_buffer.value
                return Path(full_path).name
        finally:
            kernel32.CloseHandle(hprocess)
    except Exception:
        pass
    return ""


def _register_global_hotkey(hwnd: int, hotkey_str: str) -> bool:
    """Register a global hotkey for the given window handle."""
    try:
        parts = hotkey_str.lower().replace("+", " ").split()
        modifiers = 0
        virtual_key = VK_SPACE  # default

        key_map = {
            "ctrl": (MOD_CONTROL, None),
            "alt": (MOD_ALT, None),
            "shift": (MOD_SHIFT, None),
            "space": (0, VK_SPACE),
            "a": (0, VK_A),
            "b": (0, 0x42),
            "c": (0, VK_C),
            "d": (0, 0x44),
            "e": (0, 0x45),
            "f": (0, 0x46),
            "g": (0, 0x47),
            "h": (0, 0x48),
            "i": (0, 0x49),
            "j": (0, 0x4A),
            "k": (0, 0x4B),
            "l": (0, 0x4C),
            "m": (0, 0x4D),
            "n": (0, 0x4E),
            "o": (0, 0x4F),
            "p": (0, 0x50),
            "q": (0, 0x51),
            "r": (0, 0x52),
            "s": (0, 0x53),
            "t": (0, VK_T),
            "u": (0, 0x55),
            "v": (0, 0x56),
            "w": (0, 0x57),
            "x": (0, 0x58),
            "y": (0, 0x59),
            "z": (0, 0x5A),
            "f1": (0, 0x70),
            "f2": (0, 0x71),
            "f3": (0, 0x72),
            "f4": (0, 0x73),
            "f5": (0, 0x74),
            "f6": (0, 0x75),
            "f7": (0, 0x76),
            "f8": (0, 0x77),
            "f9": (0, 0x78),
            "f10": (0, 0x79),
            "f11": (0, 0x7A),
            "f12": (0, 0x7B),
        }

        for part in parts:
            part = part.strip()
            if not part:
                continue
            if part in key_map:
                mod, vk = key_map[part]
                if vk is not None:
                    virtual_key = vk
                if mod:
                    modifiers |= mod
            else:
                logger.warning("Unknown hotkey part: %s", part)

        result = user32.RegisterHotKey(
            wintypes.HWND(hwnd),
            HOTKEY_ID,
            MOD_NOREPEAT | modifiers,
            virtual_key,
        )
        return bool(result)
    except Exception:
        logger.exception("Failed to register hotkey: %s", hotkey_str)
        return False


def _unregister_global_hotkey(hwnd: int) -> bool:
    try:
        return bool(user32.UnregisterHotKey(wintypes.HWND(hwnd), HOTKEY_ID))
    except Exception:
        return False


def _register_hotkey(hwnd: int, hotkey_str: str) -> bool:
    """Re-register a hotkey (unregister first)."""
    _unregister_global_hotkey(hwnd)
    return _register_global_hotkey(hwnd, hotkey_str)


# ==========================================================================
# Custom Qt Event for cross-thread result delivery
# ==========================================================================

# This will be assigned after QEvent is imported
_RESULT_EVENT_TYPE: int | None = None


def _result_event_type() -> int:
    """Return the registered custom event type for result updates."""
    global _RESULT_EVENT_TYPE
    if _RESULT_EVENT_TYPE is None:
        from PySide6.QtCore import QEvent
        _RESULT_EVENT_TYPE = QEvent.registerEventType()
    return _RESULT_EVENT_TYPE


def _create_result_event(dialog: Any, result_text: str) -> Any:
    """Create a QEvent carrying result text for GUI-thread delivery."""
    from PySide6.QtCore import QEvent
    event = QEvent(_result_event_type())
    # Attach result data as dynamic attribute
    event._ts_result_text = result_text
    return event


# ==========================================================================
# Main Application
# ==========================================================================


class NativeEventFilter(ctypes.Structure):
    """Qt native event filter for Windows messages."""


# We'll import PySide6 after Windows API init
def _run_desktop_app(
    host: str,
    port: int,
    backend_url: str,
    *,
    bridge_token: str,
) -> None:
    """Start the desktop process main loop."""
    _init_win32()

    from PySide6.QtCore import QAbstractNativeEventFilter, Qt
    from PySide6.QtGui import QIcon
    from PySide6.QtWidgets import QApplication
    from PySide6.QtWidgets import QMessageBox

    import httpx

    from . import runtime as ts_rt
    from .config import get_config, get_quick_tools, is_app_allowed
    from .dialog import TextSelectionDialog

    # Initialize runtime
    ts_rt.ensure_runtime()
    ts_rt.ensure_token()

    # Write bridge info
    ts_rt.write_bridge_url(f"http://{host}:{port}")
    ts_rt.write_pid(os.getpid())

    # Initialize QApplication
    qt_app = QApplication.instance()
    if qt_app is None:
        qt_app = QApplication(sys.argv)
    qt_app.setQuitOnLastWindowClosed(False)

    # Load configuration
    config = get_config()
    quick_tools = get_quick_tools()

    # Create the dialog (hidden initially)
    dialog = TextSelectionDialog(quick_tools=quick_tools)

    # Track if dialog is currently shown
    dialog_visible = threading.Event()

    def _handle_action(tool_id: str, selected_text: str) -> None:
        """Handle action button click - call backend for AI processing."""
        dialog_visible.set()
        dialog.set_loading(True)

        # Reload current tools (config may have changed)
        current_tools = get_quick_tools()
        tool = next((t for t in current_tools if t.get("id") == tool_id), None)
        if not tool:
            dialog.set_result("未知操作")
            return

        prompt_template = tool.get("prompt", "")
        processed_text = prompt_template.replace("{text}", selected_text)

        def _do_request() -> None:
            result_text: str
            try:
                resp = httpx.post(
                    f"{backend_url.rstrip('/')}/api/text-selection/process",
                    json={
                        "text": selected_text,
                        "action": tool_id,
                        "prompt": processed_text,
                    },
                    headers={
                        "X-QwenPaw-TS-Token": bridge_token,
                    },
                    timeout=60.0,
                    trust_env=False,
                )
                resp.raise_for_status()
                data = resp.json()
                result_text = data.get("result", data.get("message", ""))
            except Exception as e:
                logger.exception("AI processing request failed")
                result_text = f"处理出错: {str(e)}"
            finally:
                dialog_visible.set()

            # Marshal UI update back to the GUI thread (PySide6 requirement)
            QApplication.instance().postEvent(
                dialog,
                _create_result_event(dialog, result_text),
            )

        threading.Thread(target=_do_request, daemon=True).start()

    dialog._on_action = _handle_action

    # Register hotkey
    class HotkeyFilter(QAbstractNativeEventFilter):
        def nativeEventFilter(self, event_type: bytes, message: int) -> tuple[bool, int]:
            if not isinstance(message, int):
                return False, 0

            try:
                msg = ctypes.wintypes.MSG.from_address(message)
            except Exception:
                return False, 0

            # Handle WM_HOTKEY
            if msg.message == WM_HOTKEY:
                if msg.wParam == HOTKEY_ID:
                    _on_hotkey_triggered()
                    return True, 0

            # Handle WM_QUERYENDSESSION (system shutdown/logoff)
            if msg.message == WM_QUERYENDSESSION:
                dialog.hide()
                return True, 1

            return False, 0

    hotkey_filter = HotkeyFilter()
    qt_app.installNativeEventFilter(hotkey_filter)

    # Get initial window handle for hotkey registration
    # Use a hidden dummy window for hotkey registration
    from PySide6.QtWidgets import QWidget as QtWidget

    _hotkey_window = QtWidget()
    _hotkey_window.setAttribute(Qt.WA_ShowWithoutActivating, True)
    _hotkey_window.setWindowFlags(
        Qt.FramelessWindowHint | Qt.Tool | Qt.NoDropShadowWindowHint,
    )
    _hotkey_window.setFixedSize(1, 1)
    _hotkey_window.move(-100, -100)
    _hotkey_window.show()
    _hotkey_window.hide()

    hwnd = int(_hotkey_window.winId())

    hotkey_str = config.get("hotkey", "ctrl+alt+space")
    if not _register_global_hotkey(hwnd, hotkey_str):
        logger.warning("Failed to register global hotkey: %s", hotkey_str)

    def _on_hotkey_triggered() -> None:
        """Handle global hotkey press."""
        try:
            # Reload config (it may have changed)
            cfg = get_config()

            # Check if globally enabled
            if not cfg.get("enabled", True) or not cfg.get("globalEnabled", True):
                return

            # Check app filter
            app_name = _get_foreground_window_name()
            if not is_app_allowed(app_name):
                return

            # Capture selected text via clipboard
            selected_text = _capture_selected_text()
            if not selected_text:
                return

            # Update tools and show dialog - we're on the GUI thread via event filter
            tools = get_quick_tools()
            dialog.update_tools(tools)
            dialog.show_with_text(selected_text)

        except Exception:
            logger.exception("Hotkey handler failed")

    def _capture_selected_text() -> str:
        """Capture currently selected text via Ctrl+C then clipboard read."""
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance()
        if app is None:
            return ""
        clipboard = app.clipboard()
        if clipboard is None:
            return ""

        # Save current clipboard content
        try:
            old_text = clipboard.text()
            old_mime = clipboard.mimeData()
        except Exception:
            old_text = ""
            old_mime = None

        # Send Ctrl+C
        _send_ctrl_c()

        # Wait for clipboard update
        time.sleep(0.08)

        # Read clipboard
        try:
            new_text = clipboard.text()
        except Exception:
            new_text = ""

        # Restore clipboard content (only if it was actually changed by us)
        try:
            if new_text != old_text and old_mime:
                time.sleep(0.02)
                clipboard.setMimeData(old_mime)
        except Exception:
            pass

        if new_text and new_text.strip() and new_text != old_text:
            return new_text.strip()

        return ""

    # Start HTTP server in background thread
    from .server import build_app

    app_server = build_app(
        on_show_dialog=lambda text: _show_dialog_programmatically(
            dialog,
            text,
        ),
        on_update_config=lambda cfg: _on_config_updated(hwnd, cfg),
    )

    def _show_dialog_programmatically(
        dlg: TextSelectionDialog,
        text: str,
    ) -> None:
        """Schedule dialog show on the GUI thread (may be called from any thread)."""
        from PySide6.QtCore import QEvent
        evt = QEvent(_result_event_type())
        evt._ts_show_dialog = True
        evt._ts_show_text = text
        evt._ts_show_tools = get_quick_tools()
        QApplication.instance().postEvent(dlg, evt)

    def _on_config_updated(hwnd_val: int, cfg: dict[str, Any]) -> None:
        new_hotkey = cfg.get("hotkey", "ctrl+alt+space")
        _register_hotkey(hwnd_val, new_hotkey)
        tools = get_quick_tools()

        # Update dialog buttons on the GUI thread via postEvent
        from PySide6.QtCore import QEvent
        evt = QEvent(_result_event_type())
        evt._ts_config_update = True
        evt._ts_tools = tools
        QApplication.instance().postEvent(dialog, evt)

    import uvicorn

    server_thread = threading.Thread(
        target=lambda: uvicorn.run(
            app_server,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
        ),
        daemon=True,
    )
    server_thread.start()

    # Status message
    logger.info(
        "Text Selection Desktop running on %s:%s, hotkey: %s",
        host,
        port,
        hotkey_str,
    )

    # Main event loop
    try:
        exit_code = qt_app.exec()
    except KeyboardInterrupt:
        exit_code = 0
    finally:
        _unregister_global_hotkey(hwnd)
        ts_rt.release_instance_lock()
        dialog.hide()

    sys.exit(exit_code)


# ==========================================================================
# Entry point
# ==========================================================================


def main() -> None:
    parser = argparse.ArgumentParser(description="QwenPaw Text Selection Desktop")
    parser.add_argument("--host", default="127.0.0.1", help="Listen host")
    parser.add_argument("--port", type=int, default=18765, help="Listen port")
    parser.add_argument(
        "--backend-url",
        default="http://127.0.0.1:8023",
        help="QwenPaw backend URL",
    )
    args = parser.parse_args()

    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    # Read bridge token (created by main process)
    try:
        from . import runtime as ts_rt
        bridge_token = ts_rt.read_token() or ""
    except ImportError:
        bridge_token = ""

    _run_desktop_app(
        host=args.host,
        port=args.port,
        backend_url=args.backend_url,
        bridge_token=bridge_token,
    )


if __name__ == "__main__":
    main()
