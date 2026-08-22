# -*- coding: utf-8 -*-
"""Cloud storage provider abstraction for backup sync."""
from __future__ import annotations

import io
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .config import CloudBackupConfig, CloudProviderType

logger = logging.getLogger(__name__)


@dataclass
class CloudBackupEntry:
    key: str
    size: int
    last_modified: datetime
    backup_name: str = ""


@dataclass
class ConnectionResult:
    """Detailed result of a connection check.

    Carries diagnostic info so the frontend can show *why* a check failed,
    not just that it failed.
    """

    ok: bool
    status_code: int | None = None
    error: str | None = None
    detail: str | None = field(default=None, repr=False)

    def to_dict(self) -> dict:
        """Serialise to a dict suitable for JSONResponse."""
        return {
            "connected": self.ok,
            "status_code": self.status_code,
            "error": self.error,
            "detail": self.detail[:500] if self.detail else None,
        }


class CloudStorageProvider(ABC):
    """Abstract base for cloud storage backends.

    Each provider handles list/upload/download/delete of backup zip files
    stored under a configurable prefix in the remote bucket/path.
    """

    def __init__(self, config: CloudBackupConfig) -> None:
        self._config = config
        self._prefix = (config.remote_prefix or "aiarb-backups").rstrip(
            "/",
        )

    @abstractmethod
    async def list_backups(self) -> list[CloudBackupEntry]:
        """List all backup entries in the remote storage."""

    @abstractmethod
    async def upload_backup(
        self,
        local_path: str,
        remote_name: str,
    ) -> CloudBackupEntry:
        """Upload a local backup file to remote storage.

        Args:
            local_path: Absolute path to the local .zip file.
            remote_name: Key name under the prefix to store as.

        Returns:
            Metadata for the uploaded entry.
        """

    @abstractmethod
    async def download_backup(self, key: str) -> io.BytesIO:
        """Download a backup from remote storage by key.

        Returns:
            BytesIO buffer containing the backup data.
        """

    @abstractmethod
    async def delete_backup(self, key: str) -> None:
        """Delete a backup from remote storage by key."""

    @abstractmethod
    async def check_connection(self) -> ConnectionResult:
        """Verify that the provider is configured and reachable.

        Returns a ConnectionResult with diagnostic details.
        """

    def _remote_key(self, name: str) -> str:
        return f"{self._prefix}/{name}"

    def _key_from_remote(self, remote_key: str) -> str:
        return remote_key[len(self._prefix) + 1:]


_PROVIDER_REGISTRY: dict[CloudProviderType, type[CloudStorageProvider]] = {}


def register_provider(
    provider_type: CloudProviderType,
) -> callable:
    """Decorator to register a cloud storage provider class."""

    def wrapper(cls: type[CloudStorageProvider]) -> type[CloudStorageProvider]:
        _PROVIDER_REGISTRY[provider_type] = cls
        return cls

    return wrapper


def get_cloud_provider(
    config: CloudBackupConfig,
) -> CloudStorageProvider | None:
    """Factory: create a cloud provider instance from config."""
    if not config.provider:
        return None
    cls = _PROVIDER_REGISTRY.get(config.provider)
    if cls is None:
        logger.warning("Unsupported cloud provider: %s", config.provider)
        return None
    return cls(config)
