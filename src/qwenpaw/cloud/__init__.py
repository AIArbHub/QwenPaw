# -*- coding: utf-8 -*-
"""Cloud storage sync package — S3 and WebDAV backup providers."""
from .base import (
    CloudBackupEntry,
    CloudProviderType,
    CloudStorageProvider,
    ConnectionResult,
    get_cloud_provider,
)
from .config import CloudBackupConfig

# Import provider modules so their @register_provider decorators run
# and populate _PROVIDER_REGISTRY.  Without these imports the registry
# stays empty and get_cloud_provider() always returns None.
from . import s3_provider as _s3_provider  # noqa: F401
from . import webdav_provider as _webdav_provider  # noqa: F401

__all__ = [
    "CloudBackupEntry",
    "CloudBackupConfig",
    "CloudProviderType",
    "CloudStorageProvider",
    "ConnectionResult",
    "get_cloud_provider",
]
