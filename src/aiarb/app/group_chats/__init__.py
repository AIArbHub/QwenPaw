# -*- coding: utf-8 -*-
"""Native group-chat runtime for multi-agent round-table discussions.

This package provides a structured orchestration layer for group-chat host
agents.  Instead of relying on the host LLM to self-select speakers and
call ``chat_with_agent`` ad-hoc, the runtime manages member turns, context
windowing, timeouts, and SSE event production.

Activation (priority order, highest first):
    1. ``GROUP_CHAT_NATIVE_DISABLED`` env var → force-off (operator override).
    2. Per-request ``group_chat_native`` flag from frontend
       (``useGroupChatSettingsStore`` → ``request_context``).
    3. ``group_chat_native_enabled`` in ``config.json``
       (managed via ``/workspace/group-chat-native`` API, included in backups).
    4. Default: **True** (enabled — does NOT affect regular single-agent
       chats; only activates for host agents with ``<!-- HOST:{...} -->``
       metadata in their description).
"""
