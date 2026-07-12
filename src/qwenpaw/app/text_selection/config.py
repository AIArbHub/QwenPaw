# -*- coding: utf-8 -*-
"""Configuration management for text selection tool."""

from __future__ import annotations

import uuid
from typing import Any

from . import runtime


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": True,
    "hotkey": "ctrl+alt+space",
    "globalEnabled": True,
    "appFilterMode": "blacklist",  # "blacklist" | "whitelist"
    "appFilterList": [],  # list of app executable names
    "quickTools": [
        {
            "id": "translate",
            "name": "翻译",
            "nameEn": "Translate",
            "prompt": "请将以下文本翻译成中文：\n\n{text}",
            "icon": "translate",
            "order": 1,
        },
        {
            "id": "explain",
            "name": "解释",
            "nameEn": "Explain",
            "prompt": "请用通俗易懂的语言解释以下内容：\n\n{text}",
            "icon": "explain",
            "order": 2,
        },
        {
            "id": "summarize",
            "name": "总结",
            "nameEn": "Summarize",
            "prompt": "请用简洁的语言总结以下内容的核心要点：\n\n{text}",
            "icon": "summarize",
            "order": 3,
        },
        {
            "id": "search",
            "name": "搜索",
            "nameEn": "Search",
            "prompt": "请针对以下内容进行网络搜索并提供相关信息：\n\n{text}",
            "icon": "search",
            "order": 4,
        },
    ],
}


def _load_config() -> dict[str, Any]:
    """Load config from file, falling back to defaults."""
    data = runtime.read_json(runtime.config_path(), {})
    if not data:
        return dict(DEFAULT_CONFIG)
    # Merge with defaults to handle new fields added in updates
    merged = dict(DEFAULT_CONFIG)
    merged.update(data)
    return merged


def _save_config(data: dict[str, Any]) -> None:
    """Persist config to file."""
    runtime.write_json(runtime.config_path(), data)


def get_config() -> dict[str, Any]:
    """Get the full configuration."""
    return _load_config()


def update_config(updates: dict[str, Any]) -> dict[str, Any]:
    """Partially update configuration and return the new state."""
    current = _load_config()
    current.update({k: v for k, v in updates.items() if k in DEFAULT_CONFIG})
    _save_config(current)
    return current


def get_quick_tools() -> list[dict[str, Any]]:
    """Get all quick tools."""
    config = _load_config()
    tools = config.get("quickTools", [])
    tools.sort(key=lambda t: t.get("order", 999))
    return tools


def add_quick_tool(tool: dict[str, Any]) -> dict[str, Any]:
    """Add a new quick tool."""
    config = _load_config()
    tools = config.get("quickTools", [])
    tool["id"] = tool.get("id") or str(uuid.uuid4())[:8]
    # Remove existing with same id
    tools = [t for t in tools if t["id"] != tool["id"]]
    tools.append(tool)
    config["quickTools"] = tools
    _save_config(config)
    return tool


def update_quick_tool(tool_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    """Update an existing quick tool."""
    config = _load_config()
    tools = config.get("quickTools", [])
    for tool in tools:
        if tool["id"] == tool_id:
            tool.update(updates)
            _save_config(config)
            return tool
    return None


def delete_quick_tool(tool_id: str) -> bool:
    """Delete a quick tool."""
    config = _load_config()
    tools = config.get("quickTools", [])
    new_tools = [t for t in tools if t["id"] != tool_id]
    if len(new_tools) == len(tools):
        return False
    config["quickTools"] = new_tools
    _save_config(config)
    return True


def is_app_allowed(app_name: str) -> bool:
    """Check if text selection is allowed for the given app."""
    config = _load_config()
    if not config.get("enabled", True) or not config.get("globalEnabled", True):
        return False

    mode = config.get("appFilterMode", "blacklist")
    app_list = config.get("appFilterList", [])

    if mode == "blacklist":
        # Block listed apps
        for blocked in app_list:
            if blocked.lower() in app_name.lower():
                return False
        return True
    else:  # whitelist
        # Only allow listed apps
        for allowed in app_list:
            if allowed.lower() in app_name.lower():
                return True
        return False
