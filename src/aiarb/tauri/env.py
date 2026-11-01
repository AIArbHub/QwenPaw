# -*- coding: utf-8 -*-
"""Tauri sidecar environment variable helpers.

Keep this dependency-light: the Tauri entry imports it before AIARB.constant
has read import-time environment variables.
"""

import os

DESKTOP_APP_ENV = "AIARB_DESKTOP_APP"
DESKTOP_CORS_ORIGINS_ENV = "AIARB_CORS_ORIGINS"
RUNTIME_CONTROL_TOKEN_ENV = "AIARB_RUNTIME_CONTROL_TOKEN"
DESKTOP_MANAGED_PLAYWRIGHT_ENV = "AIARB_DESKTOP_MANAGED_PLAYWRIGHT"

DESKTOP_CORS_ORIGINS = (
    "tauri://localhost",
    "https://tauri.localhost",
    "http://tauri.localhost",
)


def ensure_desktop_cors_origins() -> None:
    origins = [
        origin.strip()
        for origin in os.environ.get(DESKTOP_CORS_ORIGINS_ENV, "").split(",")
        if origin.strip()
    ]
    for origin in DESKTOP_CORS_ORIGINS:
        if origin not in origins:
            origins.append(origin)
    os.environ[DESKTOP_CORS_ORIGINS_ENV] = ",".join(origins)
