# -*- coding: utf-8 -*-
"""Seed built-in MCP clients for legal research platforms.

On workspace startup, this module checks whether the pre-defined legal
research MCP clients (元典, 北大法宝) already exist in the driver card
store. If missing, it creates them with sensible defaults so the user
can simply fill in their API key to activate them.

These MCP clients are created in a **disabled** state by default — they
only become enabled after the user provides the required API key through
the Console UI. The frontend, after login, checks for these built-in
clients and guides the user to configure them.
"""

from __future__ import annotations

import logging
from typing import Any

from .config_service import MCPConfigService
from .schemas import MCPClientCreateRequest

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Built-in MCP client definitions
# ---------------------------------------------------------------------------

BUILTIN_MCP_CLIENTS: list[dict[str, Any]] = [
    # --- 元典法律智能 ---
    {
        "client_key": "yuandian-law",
        "name": "元典·法律法规",
        "description": (
            "元典法律智能 MCP — 法律法规检索（法条语义/关键词检索、"
            "法条详情、法规检索/详情）。"
            "需在元典开放平台 https://open.chineselaw.com 注册并获取 API Key。"
        ),
        "transport": "streamable_http",
        "url": "https://open.chineselaw.com/mcp/law/stream",
        "headers": {"Authorization": "Bearer ${YD_API_KEY}"},
    },
    {
        "client_key": "yuandian-case",
        "name": "元典·案例文书",
        "description": (
            "元典法律智能 MCP — 案例文书检索（案例语义/关键词检索、"
            "案例详情、权威案例检索）。"
            "需在元典开放平台 https://open.chineselaw.com 注册并获取 API Key。"
        ),
        "transport": "streamable_http",
        "url": "https://open.chineselaw.com/mcp/case/stream",
        "headers": {"Authorization": "Bearer ${YD_API_KEY}"},
    },
    {
        "client_key": "yuandian-company",
        "name": "元典·企业信息",
        "description": (
            "元典法律智能 MCP — 企业信息检索（工商、年报、商标、专利、"
            "风险等）。"
            "需在元典开放平台 https://open.chineselaw.com 注册并获取 API Key。"
        ),
        "transport": "streamable_http",
        "url": "https://open.chineselaw.com/mcp/company/stream",
        "headers": {"Authorization": "Bearer ${YD_API_KEY}"},
    },
    # --- 北大法宝 ---
    {
        "client_key": "pkulaw-law",
        "name": "北大法宝·法律法规",
        "description": (
            "北大法宝 MCP — 法规关键词/语义检索、法条精准定位、"
            "法条识别与溯源、引用核验。"
            "需在北大法宝 https://www.pkulaw.com 注册并获取 MCP Token。"
        ),
        "transport": "streamable_http",
        "url": "https://hub.pkulaw.com/mcp",
        "headers": {"Authorization": "Bearer ${PKULAW_MCP_TOKEN}"},
    },
]


async def seed_builtin_mcp_clients(workspace: Any) -> list[str]:
    """Create built-in MCP clients if they don't already exist.

    This runs during workspace startup. For each built-in MCP client
    defined in ``BUILTIN_MCP_CLIENTS``, it checks whether a driver card
    with that client_key already exists. If not, it creates one in
    **disabled** state — the user must fill in their API key and enable
    it from the Console.

    Args:
        workspace: The workspace instance (must have ``workspace_dir``
            and driver card storage).

    Returns:
        A list of client keys that were newly seeded.
    """
    service = MCPConfigService(workspace)
    seeded: list[str] = []

    existing_cards = await service.list_cards()
    existing_keys = {card.name for card in existing_cards}

    for spec in BUILTIN_MCP_CLIENTS:
        client_key = spec["client_key"]
        if client_key in existing_keys:
            logger.debug(
                "Built-in MCP client '%s' already exists, skipping seed",
                client_key,
            )
            continue

        try:
            create_req = MCPClientCreateRequest(
                name=spec["name"],
                description=spec.get("description", ""),
                enabled=False,  # Disabled until user provides API key
                transport=spec.get("transport", "streamable_http"),
                url=spec.get("url", ""),
                headers=spec.get("headers", {}),
                command=spec.get("command", ""),
                args=spec.get("args", []),
                env=spec.get("env", {}),
                cwd=spec.get("cwd", ""),
            )
            await service.create_client(client_key, create_req)
            seeded.append(client_key)
            logger.info(
                "Seeded built-in MCP client '%s' (%s)",
                client_key,
                spec["name"],
            )
        except Exception:
            logger.warning(
                "Failed to seed built-in MCP client '%s'",
                client_key,
                exc_info=True,
            )

    return seeded


def get_builtin_mcp_keys() -> list[str]:
    """Return the list of built-in MCP client keys."""
    return [spec["client_key"] for spec in BUILTIN_MCP_CLIENTS]


def is_builtin_mcp_key(client_key: str) -> bool:
    """Check whether a client_key is a built-in MCP client."""
    return client_key in get_builtin_mcp_keys()
