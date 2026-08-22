# -*- coding: utf-8 -*-
"""Cloud backup configuration model."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

CloudProviderType = Literal["s3", "webdav"]


class S3Config(BaseModel):
    endpoint_url: str = Field(
        default="",
        description="S3-compatible endpoint URL. Leave empty for AWS S3.",
    )
    region: str = Field(default="us-east-1", description="Region name")
    bucket: str = Field(default="", description="Bucket name")
    access_key_id: str = Field(default="", description="Access key ID")
    secret_access_key: str = Field(default="", description="Secret access key")
    force_path_style: bool = Field(
        default=True,
        description=(
            "Use path-style URLs (endpoint/bucket/key). "
            "Set to False for virtual-hosted-style (bucket.endpoint/key). "
            "Most S3-compatible services (MinIO, R2, etc.) need True."
        ),
    )


class WebDAVConfig(BaseModel):
    url: str = Field(default="", description="WebDAV server URL")
    username: str = Field(default="", description="Username")
    password: str = Field(default="", description="Password")


class CloudBackupConfig(BaseModel):
    provider: CloudProviderType | None = Field(
        default=None,
        description="Cloud storage provider type: 's3' or 'webdav'",
    )
    enabled: bool = Field(
        default=False,
        description="Whether cloud backup sync is enabled",
    )
    remote_prefix: str = Field(
        default="qwenpaw-backups",
        description="Remote path prefix for backup files",
    )
    auto_sync: bool = Field(
        default=False,
        description="Automatically sync local backups to cloud after creation",
    )
    sync_on_schedule: bool = Field(
        default=False,
        description="Sync to cloud on a regular schedule",
    )
    sync_schedule_cron: str = Field(
        default="0 3 * * *",
        description="Cron expression for scheduled cloud sync (default: 3 AM daily)",
    )
    max_cloud_backups: int = Field(
        default=30,
        description="Maximum number of backups to keep in cloud storage",
    )
    s3: S3Config = Field(default_factory=S3Config)
    webdav: WebDAVConfig = Field(default_factory=WebDAVConfig)
    last_sync_at: Optional[str] = Field(default=None)
    last_sync_status: Optional[str] = Field(default=None)
    last_sync_message: Optional[str] = Field(default=None)


def load_cloud_config(config_dict: dict[str, Any] | None) -> CloudBackupConfig:
    if config_dict is None:
        return CloudBackupConfig()
    return CloudBackupConfig(**config_dict)
