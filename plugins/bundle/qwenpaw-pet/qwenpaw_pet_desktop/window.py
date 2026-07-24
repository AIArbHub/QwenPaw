# -*- coding: utf-8 -*-
"""Transparent Qt desktop pet window."""

from __future__ import annotations

import sys
import time
import json
import threading
from pathlib import Path
from typing import Any, Callable

from PySide6.QtCore import QPoint, QRect, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QFont, QFontMetrics, QPainter, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QLineEdit,
    QMenu,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from . import runtime
from .pet_package import validate_pet_package
from .sprites import CELL_HEIGHT, CELL_WIDTH, STATE_SPECS, state_for_event

# Query lifecycle events that may arrive after ``approval.pending`` and
# would clobber the approval bubble or animation. ``tool.result`` and
# ``query.done`` are excluded: the former updates animation mid-flight;
# the latter must always land (HTTP may deliver it before ``approval.*``).
_LIFECYCLE_WHILE_APPROVAL_BLOCKED = frozenset(
    {
        "idle",
        "query.received",
        "query.running",
        "query.first_token",
        "tool.detected",
    },
)

# Lifecycle events that may arrive out-of-order *after* ``query.done`` and
# would replace the Done bubble (e.g. a slow HTTP POST for ``tool.result``).
_LIFECYCLE_AFTER_DONE_BLOCKED = frozenset(
    {
        "idle",
        "query.running",
        "query.first_token",
        "tool.detected",
        "tool.result",
    },
)

# After ``query.done``, keep the Done bubble but revert animation to idle.
_POST_DONE_ANIMATION_MS = 3500

# After ``query.received``, keep jumping + bubble before ``query.running``.
_POST_RECEIVED_ANIMATION_MS = 1500

_LIFECYCLE_DURING_RECEIVED_HOLD = frozenset({"query.running"})


def _bubble_font() -> QFont:
    """Pick a UI font that renders CJK bubble text on macOS and Windows."""
    font = QFont()
    if sys.platform == "win32":
        font.setFamilies(["Microsoft YaHei UI", "Segoe UI", "Sans Serif"])
    elif sys.platform == "darwin":
        font.setFamilies([".AppleSystemUIFont", "PingFang SC", "Sans Serif"])
    else:
        font.setFamilies(["Noto Sans CJK SC", "Sans Serif"])
    font.setPointSize(10)
    return font


def _wrap_bubble_text(
    text: str,
    font: QFont,
    max_width: int,
    *,
    max_lines: int = 2,
) -> str:
    """Lay out bubble copy within ``max_width`` (up to ``max_lines``)."""
    fm = QFontMetrics(font)
    lines: list[str] = []

    def _append(line: str) -> None:
        line = line.strip()
        if line and len(lines) < max_lines:
            lines.append(line)

    for paragraph in text.split("\n"):
        paragraph = paragraph.strip()
        if not paragraph or len(lines) >= max_lines:
            continue

        current = ""
        for token in paragraph.split():
            trial = token if not current else f"{current} {token}"
            if fm.horizontalAdvance(trial) <= max_width:
                current = trial
                continue
            _append(current)
            current = token
            if len(lines) >= max_lines:
                break

        if len(lines) >= max_lines:
            break

        if current:
            while current and len(lines) < max_lines:
                if fm.horizontalAdvance(current) <= max_width:
                    _append(current)
                    break
                # Long tool names without spaces: break by character.
                cut = 1
                while cut < len(current):
                    if fm.horizontalAdvance(current[:cut]) > max_width:
                        break
                    cut += 1
                cut = max(1, cut - 1)
                _append(current[:cut])
                current = current[cut:]

    return "\n".join(lines)


def _ends_approval_wait(ev_name: str | None) -> bool:
    """``approval.*`` follow-ups that clear the approval-wait interlock."""
    return (
        isinstance(ev_name, str)
        and ev_name.startswith("approval.")
        and ev_name != "approval.pending"
    )


# ---------------------------------------------------------------------------
# Chat support: SSE client thread + chat input bubble
# ---------------------------------------------------------------------------

class _SSEWorker(threading.Thread):
    """Background thread that reads an SSE stream and emits events via callback.

    Uses urllib (not httpx) to keep the dependency surface small — the pet
    desktop process may not have httpx installed.
    """

    def __init__(
        self,
        url: str,
        payload: dict[str, Any],
        token: str | None,
        on_event: Callable[[dict], None],
        on_done: Callable[[], None],
    ):
        super().__init__(daemon=True, name="pet-sse")
        self._url = url
        self._payload = payload
        self._token = token
        self._on_event = on_event
        self._on_done = on_done
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        import urllib.request
        import urllib.error

        try:
            data = json.dumps(self._payload).encode("utf-8")
            req = urllib.request.Request(
                self._url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                    **({"X-QwenPaw-Pet-Token": self._token} if self._token else {}),
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                for raw_line in resp:
                    if self._stop.is_set():
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line or not line.startswith("data:"):
                        continue
                    json_str = line[5:].strip()
                    if not json_str:
                        continue
                    try:
                        evt = json.loads(json_str)
                        self._on_event(evt)
                    except json.JSONDecodeError:
                        continue
        except Exception as exc:
            self._on_event({"type": "error", "message": f"{type(exc).__name__}: {exc}"[:200]})
        finally:
            self._on_done()


class ChatBubbleWidget(QWidget):
    """A floating chat input + reply panel that appears above the pet.

    Layout (top to bottom):
      1. Reply display area (QTextEdit, read-only, grows with content)
      2. Input field (QLineEdit — press Enter to send)
    """

    # Signals
    reply_token = Signal(str)    # incremental reply text
    reply_done = Signal(str)     # full reply text
    state_change = Signal(str)   # "thinking" | "talking" | "idle" | "error"
    tool_used = Signal(str)      # tool name

    def __init__(self, pet_window: "PetWindow", parent=None):
        super().__init__(parent)
        self._pet_window = pet_window
        self._sse_worker: _SSEWorker | None = None
        self._full_reply_parts: list[str] = []

        self.setWindowFlags(
            Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | (Qt.Tool if sys.platform == "win32" else Qt.Window)
        )
        self.setAttribute(Qt.WA_TranslucentBackground, False)
        self.setMinimumWidth(320)
        self.setMaximumWidth(420)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(4)

        # Reply area
        self.reply_area = QTextEdit()
        self.reply_area.setReadOnly(True)
        self.reply_area.setMaximumHeight(200)
        self.reply_area.setPlaceholderText("Pet reply will appear here...")
        self.reply_area.setStyleSheet("""
            QTextEdit {
                background: rgba(255, 255, 255, 240);
                border: 1px solid #d0d5dd;
                border-radius: 8px;
                padding: 6px;
                font-size: 13px;
                color: #1a1d21;
            }
        """)
        layout.addWidget(self.reply_area)

        # Input field
        self.input_field = QLineEdit()
        self.input_field.setPlaceholderText("Type a message and press Enter...")
        self.input_field.setStyleSheet("""
            QLineEdit {
                background: rgba(255, 255, 255, 255);
                border: 1px solid #6366f1;
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 13px;
                color: #1a1d21;
            }
            QLineEdit:focus {
                border: 2px solid #6366f1;
            }
        """)
        self.input_field.returnPressed.connect(self._send_message)
        layout.addWidget(self.input_field)

        # Connect signals
        self.reply_token.connect(self._on_reply_token)
        self.reply_done.connect(self._on_reply_done)
        self.state_change.connect(self._on_state_change)
        self.tool_used.connect(self._on_tool_used)

    def _send_message(self) -> None:
        """Send the typed message to the bound agent via SSE."""
        msg = self.input_field.text().strip()
        if not msg or self._sse_worker is not None:
            return  # Don't send empty or while a request is in flight

        pet_id = self._pet_window.manifest.get("id", "arbpet")
        self._full_reply_parts = []
        self.reply_area.clear()
        self.input_field.clear()
        self.state_change.emit("thinking")

        # Determine the main app URL — default to localhost:26740
        import os
        base_url = os.environ.get("QWENPAW_API_BASE", "http://127.0.0.1:26740")
        url = f"{base_url}/api/qwenpaw-pet/chat"

        token = None
        try:
            token = runtime.read_token()
        except Exception:
            pass

        payload = {"pet_id": pet_id, "message": msg}

        self._sse_worker = _SSEWorker(
            url=url,
            payload=payload,
            token=token,
            on_event=self._on_sse_event,
            on_done=self._on_sse_done,
        )
        self._sse_worker.start()

    def _on_sse_event(self, evt: dict) -> None:
        """Called from the SSE thread — emit Qt signals to marshal to UI thread."""
        evt_type = evt.get("type", "")
        if evt_type == "start":
            self.state_change.emit(evt.get("state", "thinking"))
        elif evt_type == "token":
            self.reply_token.emit(evt.get("text", ""))
        elif evt_type == "tool":
            self.tool_used.emit(evt.get("name", ""))
        elif evt_type == "done":
            self.reply_done.emit(evt.get("text", ""))
            self.state_change.emit("idle")
        elif evt_type == "error":
            self.state_change.emit("error")
            self.reply_done.emit(f"⚠ {evt.get('message', 'Error')}")

    def _on_sse_done(self) -> None:
        """Called from the SSE thread when the stream ends."""
        # Marshal to UI thread via a zero-length signal
        self.state_change.emit("idle")

    # --- UI-thread slots ---

    def _on_reply_token(self, text: str) -> None:
        self._full_reply_parts.append(text)
        cursor = self.reply_area.textCursor()
        cursor.movePosition(cursor.End)
        cursor.insertText(text)
        self.reply_area.setTextCursor(cursor)
        # Auto-scroll to bottom
        scrollbar = self.reply_area.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def _on_reply_done(self, text: str) -> None:
        if text and not self._full_reply_parts:
            # Error case — show full text directly
            self.reply_area.setPlainText(text)
        self.input_field.setEnabled(True)

    def _on_state_change(self, state: str) -> None:
        # Map chat state to pet animation state
        pet_state_map = {
            "thinking": "running",
            "talking": "waving",
            "idle": "idle",
            "error": "failed",
        }
        pet_state = pet_state_map.get(state, "idle")
        self._pet_window.set_state(pet_state)

        if state == "thinking":
            self._pet_window.bubble_text = "Thinking..."
        elif state == "talking":
            self._pet_window.bubble_text = ""
        elif state == "error":
            self._pet_window.bubble_text = "Oops!"
        self._pet_window.update()

    def _on_tool_used(self, name: str) -> None:
        self._pet_window.bubble_text = f"Using {name}"[:40]
        self._pet_window.set_state("review")
        self._pet_window.update()

    def closeEvent(self, event) -> None:  # noqa: N802
        if self._sse_worker is not None:
            self._sse_worker.stop()
            self._sse_worker = None
        self._pet_window.set_state("idle")
        self._pet_window.bubble_text = ""
        self._pet_window.update()
        super().closeEvent(event)

    def position_above_pet(self, pet_pos: QPoint, pet_width: int) -> None:
        """Position the chat bubble directly above the pet window."""
        self.adjustSize()
        chat_w = self.width()
        x = pet_pos.x() + (pet_width - chat_w) // 2
        y = pet_pos.y() - self.height() - 4
        if y < 0:
            y = pet_pos.y() + 200  # If no room above, place below
        self.move(x, y)


class PetWindow(QWidget):
    """Small draggable always-on-top pet window."""

    def __init__(self, pet_dir: Path, scale: float = 0.58):
        super().__init__()
        manifest, sheet_path = validate_pet_package(pet_dir)
        self.pet_dir = pet_dir
        self.manifest = manifest
        self.sheet = QPixmap(str(sheet_path))
        if self.sheet.isNull():
            raise RuntimeError(f"could not load spritesheet: {sheet_path}")

        self.scale = scale
        self.pet_width = int(CELL_WIDTH * scale)
        self.pet_height = int(CELL_HEIGHT * scale)
        self.bubble_height = 46
        self.margin = 8
        self.resize(
            self.pet_width + self.margin * 2,
            self.pet_height + self.bubble_height + self.margin * 2,
        )

        self.state = "idle"
        self.frame = 0
        self.bubble_text = ""
        self._approval_pending = False
        self._turn_complete = False
        self._last_event_serial = 0
        self._state_revert_token = 0
        self._received_hold_token = 0
        self._deferred_lifecycle_event: dict[str, Any] | None = None
        self.drag_start: QPoint | None = None
        self._state_counter = 0

        # Chat support
        self._chat_bubble: ChatBubbleWidget | None = None

        # On Windows, use Qt.Tool to prevent a taskbar entry (the system
        # tray icon serves as the entry point instead). On macOS, Qt.Tool
        # maps to NSPanel and the system hides tool panels when the app
        # loses activation, so we keep Qt.Window there.
        _base = Qt.Tool if sys.platform == "win32" else Qt.Window
        self.setWindowFlags(
            Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | _base
            | Qt.NoDropShadowWindowHint,
        )
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setMouseTracking(True)

        self.frame_timer = QTimer(self)
        self.frame_timer.timeout.connect(self._next_frame)
        self.frame_timer.start(STATE_SPECS[self.state]["dur"])

        self.move(40, 80)
        self._write_state()

    def reload_pet(self, pet_dir: Path) -> None:
        """Replace spritesheet and manifest without restarting the process."""
        manifest, sheet_path = validate_pet_package(pet_dir)
        sheet = QPixmap(str(sheet_path))
        if sheet.isNull():
            raise RuntimeError(f"could not load spritesheet: {sheet_path}")
        self.pet_dir = pet_dir
        self.manifest = manifest
        self.sheet = sheet
        self.bubble_text = ""
        self._approval_pending = False
        self._turn_complete = False
        self._last_event_serial = 0
        self._state_revert_token = 0
        self._received_hold_token = 0
        self._deferred_lifecycle_event = None
        self.frame = 0
        if self.state != "idle":
            self.set_state("idle")
        else:
            self.frame_timer.start(STATE_SPECS["idle"]["dur"])
            self.update()
        self._write_state({"event": "pet.reload"})

    def apply_event(self, event: dict[str, Any]) -> None:
        ev_name = event.get("event")
        text = event.get("text")

        if self._is_stale_event(event):
            return
        if self._handle_early_lifecycle(ev_name, event):
            return

        self._advance_event_serial(event)
        state = state_for_event(ev_name, event.get("state"))
        self._apply_bubble_text(ev_name, text)
        self.set_state(state)
        self._write_state(event)
        self._schedule_post_event_timing(ev_name, state, event)
        self.update()

    def _is_stale_event(self, event: dict[str, Any]) -> bool:
        serial = event.get("serial")
        if isinstance(serial, int) and serial > 0:
            if serial < self._last_event_serial:
                self.update()
                return True
        return False

    def _advance_event_serial(self, event: dict[str, Any]) -> None:
        serial = event.get("serial")
        if isinstance(serial, int) and serial > self._last_event_serial:
            self._last_event_serial = serial

    def _handle_early_lifecycle(
        self,
        ev_name: str | None,
        event: dict[str, Any],
    ) -> bool:
        if ev_name == "query.received":
            self._approval_pending = False
            self._turn_complete = False
            self._deferred_lifecycle_event = None
            self._received_hold_token = 0
            self._bump_state_revert_token()
        elif ev_name == "approval.pending":
            self._approval_pending = True
        elif ev_name == "query.done":
            self._approval_pending = False
            self._turn_complete = True
        elif _ends_approval_wait(ev_name):
            self._approval_pending = False
            if self._turn_complete:
                self.update()
                return True
        elif ev_name in ("query.cancelled", "query.error"):
            self._approval_pending = False

        if self._turn_complete and ev_name in _LIFECYCLE_AFTER_DONE_BLOCKED:
            self.update()
            return True

        if (
            ev_name != "query.received"
            and self._received_hold_active()
            and ev_name in _LIFECYCLE_DURING_RECEIVED_HOLD
        ):
            self._deferred_lifecycle_event = dict(event)
            self.update()
            return True

        if (
            self._approval_pending
            and ev_name in _LIFECYCLE_WHILE_APPROVAL_BLOCKED
        ):
            self.update()
            return True

        if self._approval_pending and ev_name == "tool.result":
            self._advance_event_serial(event)
            state = state_for_event(ev_name, event.get("state"))
            self.set_state(state)
            self._write_state(event)
            self.update()
            return True

        return False

    def _apply_bubble_text(
        self,
        ev_name: str | None,
        text: Any,
    ) -> None:
        if not isinstance(text, str):
            return
        # Empty ``text`` clears the bubble only for intentional lifecycle
        # events; otherwise a stray "" could erase e.g. "Approval required".
        if text or ev_name in ("idle", "qwenpaw.shutdown"):
            self.bubble_text = text[:200]

    def _schedule_post_event_timing(
        self,
        ev_name: str | None,
        state: str,
        event: dict[str, Any],
    ) -> None:
        duration_ms = event.get("duration_ms")
        if ev_name == "query.received":
            hold_ms = (
                duration_ms
                if isinstance(duration_ms, int) and duration_ms > 0
                else _POST_RECEIVED_ANIMATION_MS
            )
            self._begin_received_hold(hold_ms)
            return
        if ev_name == "query.done":
            if not isinstance(duration_ms, int) or duration_ms <= 0:
                duration_ms = _POST_DONE_ANIMATION_MS
            self._schedule_state_revert(duration_ms)
            return

        delay_ms = event.get("delay_ms")
        if (
            isinstance(duration_ms, int)
            and duration_ms > 0
            and state != "idle"
        ):
            self._schedule_state_revert(duration_ms)
        elif state == "idle" and isinstance(delay_ms, int) and delay_ms > 0:
            self._schedule_state_revert(delay_ms)

    def _received_hold_active(self) -> bool:
        return (
            self._received_hold_token != 0
            and self._received_hold_token == self._state_revert_token
        )

    def _begin_received_hold(self, duration_ms: int) -> None:
        """Hold ``query.received``; defer ``query.running`` until hold ends."""
        token = self._bump_state_revert_token()
        self._received_hold_token = token

        def _flush_received_hold() -> None:
            if token != self._state_revert_token:
                return
            self._received_hold_token = 0
            deferred = self._deferred_lifecycle_event
            self._deferred_lifecycle_event = None
            if deferred is not None:
                self.apply_event(deferred)
            elif not self._approval_pending:
                self.set_state("idle")

        QTimer.singleShot(duration_ms, _flush_received_hold)

    def _bump_state_revert_token(self) -> int:
        self._state_revert_token += 1
        return self._state_revert_token

    def _schedule_state_revert(self, duration_ms: int) -> None:
        """Revert animation to idle after ``duration_ms``; keep bubble text."""
        token = self._bump_state_revert_token()

        def _revert_animation_only() -> None:
            if token != self._state_revert_token:
                return
            if self._approval_pending:
                return
            self._turn_complete = False
            self.set_state("idle")

        QTimer.singleShot(duration_ms, _revert_animation_only)

    def set_state(self, state: str) -> None:
        if state not in STATE_SPECS:
            state = "idle"
        if state != self.state:
            self.state = state
            self.frame = 0
            self.frame_timer.start(STATE_SPECS[self.state]["dur"])
            self._write_state()
            self.update()

    def _write_state(self, event: dict[str, Any] | None = None) -> None:
        self._state_counter += 1
        runtime.write_json(
            runtime.state_path(),
            {
                "state": self.state,
                "event": event.get("event") if event else None,
                "text": self.bubble_text,
                "updatedAt": int(time.time() * 1000),
                "counter": self._state_counter,
            },
        )

    def _next_frame(self) -> None:
        spec = STATE_SPECS[self.state]
        self.frame = (self.frame + 1) % int(spec["frames"])
        delay = spec["last"] if self.frame == 0 else spec["dur"]
        self.frame_timer.start(int(delay))
        self.update()

    def _pet_rect(self) -> QRect:
        return QRect(
            self.margin,
            self.bubble_height + self.margin,
            self.pet_width,
            self.pet_height,
        )

    # pylint: disable-next=unused-argument
    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.SmoothPixmapTransform, False)
        painter.setRenderHint(QPainter.Antialiasing, True)

        # Translucent frameless windows do not erase prior pixels each frame.
        # Pet cells also use partial transparency: without clearing first,
        # a hot-swapped spritesheet leaves the *previous* pet visible in alpha
        # holes (e.g. goose silhouette behind a snow leopard).
        painter.setCompositionMode(QPainter.CompositionMode_Clear)
        painter.fillRect(self.rect(), QColor())
        painter.setCompositionMode(QPainter.CompositionMode_SourceOver)

        self._draw_bubble(painter)

        spec = STATE_SPECS[self.state]
        row = int(spec["row"])
        frames = int(spec["frames"])
        col = self.frame % frames
        source = QRect(
            col * CELL_WIDTH,
            row * CELL_HEIGHT,
            CELL_WIDTH,
            CELL_HEIGHT,
        )
        painter.drawPixmap(self._pet_rect(), self.sheet, source)

    def _draw_bubble(self, painter: QPainter) -> None:
        if not self.bubble_text:
            return
        rect = QRect(
            self.margin,
            self.margin,
            self.width() - self.margin * 2,
            self.bubble_height - 6,
        )
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(255, 255, 255, 235))
        painter.drawRoundedRect(rect, 9, 9)
        font = _bubble_font()
        painter.setPen(QColor(22, 24, 28))
        painter.setFont(font)
        text_rect = rect.adjusted(8, 5, -8, -5)
        wrapped = _wrap_bubble_text(
            self.bubble_text,
            font,
            text_rect.width(),
        )
        painter.drawText(
            text_rect,
            Qt.AlignLeft | Qt.AlignVCenter,
            wrapped,
        )

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if event.button() == Qt.LeftButton:
            self.drag_start = (
                event.globalPosition().toPoint()
                - self.frameGeometry().topLeft()
            )
        elif event.button() == Qt.RightButton:
            self._open_menu(event.globalPosition().toPoint())

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if self.drag_start is not None and event.buttons() & Qt.LeftButton:
            self.move(event.globalPosition().toPoint() - self.drag_start)

    # pylint: disable-next=unused-argument
    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        self.drag_start = None

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: N802
        """Double-click opens the chat panel."""
        if event.button() == Qt.LeftButton:
            self._toggle_chat()

    def _toggle_chat(self) -> None:
        """Open or close the chat bubble panel."""
        if self._chat_bubble is not None:
            self._chat_bubble.close()
            self._chat_bubble = None
            return

        chat = ChatBubbleWidget(self)
        chat.position_above_pet(self.pos(), self.pet_width)
        chat.show()
        chat.input_field.setFocus()
        self._chat_bubble = chat
        # Pet waves when chat opens
        self.set_state("waving")
        self.bubble_text = "Hi! Let's chat."
        self.update()

    def _open_menu(self, pos: QPoint) -> None:
        menu = QMenu(self)
        title = self.manifest.get("displayName", "QwenPaw Pet")
        menu.addAction(title).setEnabled(False)
        menu.addSeparator()
        menu.addAction("💬 Chat", self._toggle_chat)
        menu.addAction("Idle", lambda: self.set_state("idle"))
        menu.addAction("Wave", lambda: self.set_state("waving"))
        menu.addAction("Thinking", lambda: self.set_state("running"))
        menu.addAction("Waiting", lambda: self.set_state("waiting"))
        menu.addSeparator()
        menu.addAction("Quit", QApplication.instance().quit)
        menu.exec(pos)