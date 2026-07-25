# -*- coding: utf-8 -*-
"""Mini floating dialog for text selection interactions."""

from __future__ import annotations

import logging
import sys
from typing import Any, Callable

from PySide6.QtCore import (
    QEvent,
    QPoint,
    QRect,
    Qt,
    QTimer,
    Signal,
)
from PySide6.QtGui import (
    QColor,
    QCursor,
    QFont,
    QFontMetrics,
    QKeyEvent,
    QPainter,
    QPainterPath,
    QPen,
)
from PySide6.QtWidgets import (
    QApplication,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSizePolicy,
)

logger = logging.getLogger(__name__)

# ---- Color scheme ----
_COLOR_BG = QColor(255, 255, 255, 248)
_COLOR_BORDER = QColor(200, 200, 210, 180)
_COLOR_TEXT = QColor(22, 24, 28)
_COLOR_SECONDARY = QColor(100, 100, 110)
_COLOR_PRIMARY = QColor(59, 130, 246)
_COLOR_PRIMARY_HOVER = QColor(37, 99, 235)
_COLOR_BTN_BG = QColor(243, 244, 246)
_COLOR_BTN_HOVER = QColor(229, 231, 235)
_COLOR_BTN_TEXT = QColor(55, 65, 81)
_COLOR_RESULT_BG = QColor(249, 250, 251)
_COLOR_DIVIDER = QColor(229, 231, 235)

_DIALOG_WIDTH = 380
_DIALOG_MAX_HEIGHT = 500
_TEXT_PREVIEW_MAX_LEN = 80
_CORNER_RADIUS = 12


def _ui_font(size: int = 9, bold: bool = False) -> QFont:
    font = QFont()
    if sys.platform == "win32":
        font.setFamilies(["Microsoft YaHei UI", "Segoe UI", "Sans Serif"])
    elif sys.platform == "darwin":
        font.setFamilies([".AppleSystemUIFont", "PingFang SC", "Sans Serif"])
    else:
        font.setFamilies(["Noto Sans CJK SC", "Sans Serif"])
    font.setPointSize(size)
    font.setBold(bold)
    return font


def _elide_text(text: str, font: QFont, max_width: int) -> str:
    fm = QFontMetrics(font)
    if fm.horizontalAdvance(text) <= max_width:
        return text
    return fm.elidedText(text, Qt.ElideRight, max_width)


class TextSelectionDialog(QWidget):
    """Floating dialog shown when text is selected globally."""

    # Signals to communicate with main thread
    action_triggered = Signal(str, str)  # action_name, selected_text

    def __init__(
        self,
        quick_tools: list[dict[str, Any]],
        on_action: Callable[[str, str], None] | None = None,
    ):
        super().__init__()
        self.quick_tools = quick_tools
        self._on_action = on_action
        self._selected_text = ""
        self._result_text = ""
        self._is_loading = False
        self._expanded = False

        self._init_ui()
        self._setup_window()

    def _init_ui(self) -> None:
        """Build the dialog layout."""
        self.setFixedWidth(_DIALOG_WIDTH)
        self.setMinimumHeight(120)
        self.setMaximumHeight(_DIALOG_MAX_HEIGHT)

        # Main layout
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(16, 12, 16, 12)
        self._layout.setSpacing(10)

        # Text preview label
        self._text_label = QLabel("")
        self._text_label.setFont(_ui_font(10))
        self._text_label.setStyleSheet(
            f"color: {_COLOR_TEXT.name()}; "
            "padding: 8px 12px; "
            f"background-color: {_COLOR_RESULT_BG.name()}; "
            "border-radius: 8px;"
        )
        self._text_label.setWordWrap(True)
        self._text_label.setMaximumHeight(56)
        self._text_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        self._layout.addWidget(self._text_label)

        # Action buttons row
        self._btn_layout = QHBoxLayout()
        self._btn_layout.setSpacing(6)
        self._btn_layout.setContentsMargins(0, 0, 0, 0)

        self._action_buttons: list[QPushButton] = []
        for tool in self.quick_tools:
            btn = QPushButton(tool.get("name", tool.get("nameEn", "?")))
            btn.setFont(_ui_font(9))
            btn.setCursor(Qt.PointingHandCursor)
            btn.setFixedHeight(30)
            btn.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Fixed)
            btn.setStyleSheet(self._btn_style())
            btn.clicked.connect(lambda checked, t=tool: self._on_tool_click(t))
            self._action_buttons.append(btn)
            self._btn_layout.addWidget(btn)

        # Stretch to push buttons left
        self._btn_layout.addStretch()
        self._layout.addLayout(self._btn_layout)

        # Result area (hidden by default)
        self._result_container = QWidget()
        self._result_layout = QVBoxLayout(self._result_container)
        self._result_layout.setContentsMargins(0, 0, 0, 0)
        self._result_layout.setSpacing(4)

        self._divider = QWidget()
        self._divider.setFixedHeight(1)
        self._divider.setStyleSheet(f"background-color: {_COLOR_DIVIDER.name()};")
        self._divider.hide()
        self._result_layout.addWidget(self._divider)

        self._loading_label = QLabel("AI 正在处理...")
        self._loading_label.setFont(_ui_font(9))
        self._loading_label.setStyleSheet(f"color: {_COLOR_SECONDARY.name()};")
        self._loading_label.setAlignment(Qt.AlignCenter)
        self._loading_label.hide()
        self._result_layout.addWidget(self._loading_label)

        self._result_label = QLabel("")
        self._result_label.setFont(_ui_font(9))
        self._result_label.setWordWrap(True)
        self._result_label.setStyleSheet(
            f"color: {_COLOR_TEXT.name()}; "
            f"background-color: {_COLOR_RESULT_BG.name()}; "
            "padding: 8px 10px; "
            "border-radius: 6px;"
        )
        self._result_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        self._result_label.hide()
        self._result_layout.addWidget(self._result_label)

        self._result_container.hide()
        self._layout.addWidget(self._result_container)

        # Hint label
        self._hint_label = QLabel("Esc 关闭")
        self._hint_label.setFont(_ui_font(7))
        self._hint_label.setStyleSheet(f"color: {_COLOR_SECONDARY.name()};")
        self._hint_label.setAlignment(Qt.AlignRight)
        self._layout.addWidget(self._hint_label)

    def _btn_style(self) -> str:
        return (
            "QPushButton {"
            f"background-color: {_COLOR_BTN_BG.name()}; "
            f"color: {_COLOR_BTN_TEXT.name()}; "
            "border: none; "
            "border-radius: 6px; "
            "padding: 4px 12px; "
            "}"
            "QPushButton:hover {"
            f"background-color: {_COLOR_PRIMARY.name()}; "
            "color: white; "
            "}"
        )

    def _setup_window(self) -> None:
        """Configure the window as a frameless, always-on-top floating dialog."""
        self.setWindowFlags(
            Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | Qt.Tool
            | Qt.NoDropShadowWindowHint,
        )
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WA_ShowWithoutActivating, True)
        self.setFocusPolicy(Qt.StrongFocus)

    def show_with_text(self, text: str) -> None:
        """Show the dialog with selected text, positioned near cursor."""
        if not text or not text.strip():
            return

        self._selected_text = text.strip()
        self._result_text = ""
        self._is_loading = False
        self._expanded = False

        # Update text preview
        preview = text[:200]
        display_text = preview if len(text) <= 200 else preview + "..."
        self._text_label.setText(display_text)

        # Reset result area
        self._divider.hide()
        self._loading_label.hide()
        self._result_label.hide()
        self._result_container.hide()

        # Position near cursor
        cursor_pos = QCursor.pos()
        screen = QApplication.screenAt(cursor_pos)
        if screen:
            screen_geo = screen.availableGeometry()
            x = min(cursor_pos.x() + 10, screen_geo.right() - _DIALOG_WIDTH - 10)
            y = min(cursor_pos.y() + 20, screen_geo.bottom() - 200)
        else:
            x = cursor_pos.x() + 10
            y = cursor_pos.y() + 20

        self.move(max(0, x), max(0, y))
        self.adjustSize()

        # Show and activate
        self.show()
        self.raise_()
        self.activateWindow()
        self.setFocus()

    def set_loading(self, loading: bool) -> None:
        """Show/hide loading indicator."""
        self._is_loading = loading
        if loading:
            self._show_result_area()
            self._loading_label.show()
            self._result_label.hide()
        else:
            self._loading_label.hide()

    def set_result(self, text: str) -> None:
        """Display AI processing result."""
        self._result_text = text
        self._is_loading = False

        self._show_result_area()
        self._loading_label.hide()
        self._result_label.setText(text)
        self._result_label.show()

        self.adjustSize()

    def _show_result_area(self) -> None:
        if not self._expanded:
            self._expanded = True
            self._divider.show()
            self._result_container.show()
            self.setMaximumHeight(_DIALOG_MAX_HEIGHT)

    def _on_tool_click(self, tool: dict[str, Any]) -> None:
        """Handle action button click."""
        tool_id = tool.get("id", "")
        if self._on_action:
            self._on_action(tool_id, self._selected_text)
        self.action_triggered.emit(tool_id, self._selected_text)

    def customEvent(self, event: QEvent) -> None:  # noqa: N802
        """Handle custom events dispatched from background threads."""
        # Show dialog with text (from HTTP /trigger endpoint)
        if getattr(event, "_ts_show_dialog", False):
            tools = getattr(event, "_ts_show_tools", None)
            if tools is not None:
                self.update_tools(tools)
            text = getattr(event, "_ts_show_text", "")
            if text:
                self.show_with_text(text)
            return

        # Result text delivery (from HTTP worker thread)
        result_text = getattr(event, "_ts_result_text", None)
        if result_text is not None:
            self.set_result(result_text)
            return

        # Config / tools update (from config change notification)
        if getattr(event, "_ts_config_update", False):
            tools = getattr(event, "_ts_tools", None)
            if tools is not None:
                self.update_tools(tools)
            return

        super().customEvent(event)

    def keyPressEvent(self, event: QKeyEvent) -> None:  # noqa: N802
        if event.key() == Qt.Key_Escape:
            self.hide()
        else:
            super().keyPressEvent(event)

    def focusOutEvent(self, event) -> None:  # noqa: N802
        """Hide dialog when focus is lost."""
        self.hide()
        super().focusOutEvent(event)

    def paintEvent(self, event) -> None:  # noqa: N802
        """Paint rounded background with shadow."""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.setRenderHint(QPainter.SmoothPixmapTransform, True)

        # Clear with transparency
        painter.setCompositionMode(QPainter.CompositionMode_Clear)
        painter.fillRect(self.rect(), QColor(0, 0, 0, 0))
        painter.setCompositionMode(QPainter.CompositionMode_SourceOver)

        # Draw shadow (simple offset)
        shadow_rect = QRect(
            self.rect().x() + 2,
            self.rect().y() + 2,
            self.rect().width() - 4,
            self.rect().height() - 4,
        )
        shadow_path = QPainterPath()
        shadow_path.addRoundedRect(
            shadow_rect.x(),
            shadow_rect.y(),
            shadow_rect.width(),
            shadow_rect.height(),
            _CORNER_RADIUS,
            _CORNER_RADIUS,
        )
        painter.fillPath(shadow_path, QColor(0, 0, 0, 20))

        # Draw background
        content_rect = self.rect().adjusted(1, 1, -3, -3)
        bg_path = QPainterPath()
        bg_path.addRoundedRect(
            content_rect.x(),
            content_rect.y(),
            content_rect.width(),
            content_rect.height(),
            _CORNER_RADIUS,
            _CORNER_RADIUS,
        )
        painter.fillPath(bg_path, _COLOR_BG)

        # Draw border
        pen = QPen(_COLOR_BORDER)
        pen.setWidth(1)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)
        painter.drawPath(bg_path)

    def update_tools(self, tools: list[dict[str, Any]]) -> None:
        """Refresh action buttons with new tool list."""
        self.quick_tools = tools

        # Remove old buttons
        for btn in self._action_buttons:
            self._btn_layout.removeWidget(btn)
            btn.deleteLater()
        self._action_buttons.clear()

        # Add new buttons
        for tool in tools:
            btn = QPushButton(tool.get("name", tool.get("nameEn", "?")))
            btn.setFont(_ui_font(9))
            btn.setCursor(Qt.PointingHandCursor)
            btn.setFixedHeight(30)
            btn.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Fixed)
            btn.setStyleSheet(self._btn_style())
            btn.clicked.connect(lambda checked, t=tool: self._on_tool_click(t))
            self._action_buttons.append(btn)
            self._btn_layout.addWidget(btn)

        # Remove old stretch and re-add
        stretch_item = self._btn_layout.takeAt(self._btn_layout.count() - 1)
        if stretch_item:
            del stretch_item
        self._btn_layout.addStretch()
