# -*- coding: utf-8 -*-
"""Configuration loaded from environment variables.

Optional (can also be provided at runtime via the
set_credentials tool):
    AIARBMAIL_EMAIL       full email address,
        e.g. someone@163.com or someone@qq.com
    AIARBMAIL_AUTH_CODE   credential for IMAP/SMTP
        login. The semantics vary by provider:
          - NetEase (163/126/yeah.net) / QQ / Sina:
            authorization code
          - Gmail: 16-char app-specific password
            (requires 2-Step Verification)
          - Aliyun Mail / NetEase Enterprise /
            Aliyun Enterprise:
            login password or security password
          - Tencent Exmail: client-specific password

Optional overrides (needed for domains not in the
PROVIDERS table, e.g. enterprise mail with a custom
domain):
    AIARBMAIL_IMAP_HOST / AIARBMAIL_IMAP_PORT
    AIARBMAIL_SMTP_HOST / AIARBMAIL_SMTP_PORT
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .errors import ConfigError
from .providers import (
    ProviderCapabilities,
    provider_for_email,
    provider_for_imap_host,
)

CLIENT_NAME = "aiarbmail-mcp"
CLIENT_VERSION = "0.1.0"
CLIENT_VENDOR = "aiarb"


@dataclass(frozen=True)
class Config:
    email: str
    auth_code: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    requires_id_command: bool
    capabilities: ProviderCapabilities = field(
        default_factory=ProviderCapabilities,
    )


def load_config(env: dict[str, str] | None = None) -> Config:
    """Build a Config from env variables.

    Routes hosts by email domain.
    """
    env = dict(os.environ) if env is None else env

    email = (env.get("AIARBMAIL_EMAIL") or "").strip()
    auth_code = (env.get("AIARBMAIL_AUTH_CODE") or "").strip()
    if not email or not auth_code:
        raise ConfigError(
            "Missing required environment variables AIARBMAIL_EMAIL and/or "
            "AIARBMAIL_AUTH_CODE. Set AIARBMAIL_EMAIL to your "
            "full address (e.g. someone@163.com, someone@qq.com, "
            "or someone@gmail.com) and AIARBMAIL_AUTH_CODE to "
            "the credential for your provider — this may be an "
            "authorization code (网易/QQ/新浪), an app-specific "
            "password (Gmail), or your login password "
            "(阿里邮箱/企业邮). For custom domains not in the "
            "built-in provider list, also set "
            "AIARBMAIL_IMAP_HOST and AIARBMAIL_SMTP_HOST.",
        )
    if "@" not in email:
        raise ConfigError(
            f"AIARBMAIL_EMAIL={email!r} is not a valid email address.",
        )

    provider = provider_for_email(email)

    imap_host = (env.get("AIARBMAIL_IMAP_HOST") or "").strip()
    smtp_host = (env.get("AIARBMAIL_SMTP_HOST") or "").strip()
    if provider is not None:
        imap_host = imap_host or provider.imap_host
        smtp_host = smtp_host or provider.smtp_host
    if not imap_host or not smtp_host:
        domain = email.rpartition("@")[2]
        raise ConfigError(
            f"Unknown email domain {domain!r}: no built-in provider entry. "
            "Set AIARBMAIL_IMAP_HOST and AIARBMAIL_SMTP_HOST explicitly.",
        )

    try:
        imap_port = int(
            env.get("AIARBMAIL_IMAP_PORT")
            or (provider.imap_port if provider else 993),
        )
        smtp_port = int(
            env.get("AIARBMAIL_SMTP_PORT")
            or (provider.smtp_port if provider else 465),
        )
    except ValueError as exc:
        raise ConfigError(f"Invalid port value in environment: {exc}") from exc

    # A custom enterprise address has no built-in domain entry, but its IMAP
    # host still identifies the provider's verified capability profile.
    capability_provider = provider or provider_for_imap_host(imap_host)

    return Config(
        email=email,
        auth_code=auth_code,
        imap_host=imap_host,
        imap_port=imap_port,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        requires_id_command=(
            capability_provider.requires_id_command
            if capability_provider
            else True
        ),
        capabilities=(
            capability_provider.capabilities
            if capability_provider
            else ProviderCapabilities()
        ),
    )
