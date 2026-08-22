# -*- coding: utf-8 -*-
"""Resolve OAuth callbacks across standalone and managed runtimes."""

from __future__ import annotations

import os

from fastapi import Request

HUB_OAUTH_CALLBACK_URL_HEADER = "X-AIArb-Hub-OAuth-Callback-Url"


def managed_oauth_callback_url(request: Request) -> str | None:
    """Return the callback URL injected by a trusted Hub control plane."""
    if not os.environ.get("AIARB_RUNTIME_INTERNAL_TOKEN", ""):
        return None
    value = request.headers.get(HUB_OAUTH_CALLBACK_URL_HEADER, "").strip()
    return value or None
