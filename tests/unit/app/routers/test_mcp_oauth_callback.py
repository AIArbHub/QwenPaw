# -*- coding: utf-8 -*-
"""Unit tests for managed MCP OAuth callback resolution."""

import pytest
from starlette.requests import Request

from aiarb.app.routers.mcp_oauth import _redirect_uri


def test_mcp_oauth_uses_managed_callback_when_injected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AIARB_RUNTIME_INTERNAL_TOKEN", "runtime-token")
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/api/mcp/oauth/start/client",
            "headers": [
                (
                    b"x-aiarb-hub-oauth-callback-url",
                    b"https://aiarb.example.com/callback/relay",
                ),
            ],
            "server": ("127.0.0.1", 30000),
        },
    )

    assert _redirect_uri(request) == (
        "https://aiarb.example.com/callback/relay"
    )
