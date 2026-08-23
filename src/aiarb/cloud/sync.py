# -*- coding: utf-8 -*-
"""Cloud backup sync orchestration."""
from __future__ import annotations

import asyncio
import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from .base import CloudBackupEntry, ConnectionResult, get_cloud_provider
from .config import CloudBackupConfig, load_cloud_config
# Import provider modules so @register_provider decorators execute
# and populate _PROVIDER_REGISTRY at import time.
from . import s3_provider as _s3_provider  # noqa: F401
from . import webdav_provider as _webdav_provider  # noqa: F401

if TYPE_CHECKING:
    from ..backup.models import BackupTrustMode

logger = logging.getLogger(__name__)

CLOUD_CONFIG_PATH: Path | None = None


def _get_config_path() -> Path:
    global CLOUD_CONFIG_PATH
    if CLOUD_CONFIG_PATH is not None:
        return CLOUD_CONFIG_PATH
    from ..constant import WORKING_DIR
    CLOUD_CONFIG_PATH = WORKING_DIR / "cloud_config.json"
    assert CLOUD_CONFIG_PATH is not None
    return CLOUD_CONFIG_PATH


def load_config() -> CloudBackupConfig:
    path = _get_config_path()
    if not path.is_file():
        logger.info("Cloud config file does not exist: %s", path)
        return CloudBackupConfig()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        config = load_cloud_config(data)
        logger.info(
            "Loaded cloud config: provider=%s, enabled=%s, path=%s",
            config.provider,
            config.enabled,
            path,
        )
        return config
    except Exception as exc:
        logger.warning("Failed to load cloud config from %s: %s", path, exc)
        return CloudBackupConfig()


def save_config(config: CloudBackupConfig) -> None:
    path = _get_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # IMPORTANT: Do NOT use exclude_none here — it would strip the
    # ``provider`` field when it's None, and more importantly it would
    # strip ``last_sync_at`` / ``last_sync_status`` / ``last_sync_message``
    # which are legitimately None until the first sync.
    # We use exclude_none=False (default) to persist all fields.
    json_str = config.model_dump_json(indent=2)
    path.write_text(json_str, encoding="utf-8")
    logger.info(
        "Saved cloud config: provider=%s, enabled=%s, path=%s",
        config.provider,
        config.enabled,
        path,
    )


async def upload_to_cloud(backup_id: str) -> CloudBackupEntry:
    """Upload a specific local backup to cloud storage."""
    config = load_config()
    if not config.enabled or not config.provider:
        raise ValueError("Cloud backup is not configured")

    provider = get_cloud_provider(config)
    if provider is None:
        raise ValueError(f"Unsupported provider: {config.provider}")

    # Ensure the local backup exists — use the same lookup as the backup
    # module so non-canonical filenames are also found.
    from ..backup._utils.constants import find_zip_path

    local_path = find_zip_path(backup_id)
    if local_path is None or not local_path.is_file():
        raise FileNotFoundError(f"Local backup not found: {backup_id}")

    remote_name = f"{backup_id}.zip"
    entry = await provider.upload_backup(str(local_path), remote_name)
    logger.info("Uploaded backup %s to cloud (%d bytes)", backup_id, entry.size)
    return entry


async def sync_all_to_cloud() -> list[CloudBackupEntry]:
    """Sync all local backups to cloud storage."""
    config = load_config()
    if not config.enabled or not config.provider:
        raise ValueError("Cloud backup is not configured")

    provider = get_cloud_provider(config)
    if provider is None:
        raise ValueError(f"Unsupported provider: {config.provider}")

    # List local backups
    from ..backup._ops.storage import list_backups as list_local
    from ..backup._utils.constants import zip_path

    local_backups = await list_local()

    # List remote backups to find unsynced ones
    remote_entries = await provider.list_backups()
    remote_names = {e.key: e for e in remote_entries}

    uploaded: list[CloudBackupEntry] = []
    for local_meta in local_backups:
        remote_name = f"{local_meta.id}.zip"
        remote_key = provider._remote_key(remote_name)
        if remote_key in remote_names:
            continue  # already synced
        local_path = zip_path(local_meta.id)
        if not local_path.is_file():
            continue
        entry = await provider.upload_backup(str(local_path), remote_name)
        uploaded.append(entry)

    # Prune old backups if configured
    if config.max_cloud_backups > 0:
        await _prune_old_backups(provider, config.max_cloud_backups)

    # Update sync status
    config.last_sync_at = datetime.now(timezone.utc).isoformat()
    config.last_sync_status = "success"
    config.last_sync_message = f"Synced {len(uploaded)} backup(s)"
    save_config(config)

    return uploaded


async def _prune_old_backups(
    provider,
    max_keep: int,
) -> None:
    """Delete oldest cloud backups exceeding max_keep."""
    entries = await provider.list_backups()
    if len(entries) <= max_keep:
        return
    to_delete = entries[max_keep:]
    for entry in to_delete:
        try:
            await provider.delete_backup(entry.key)
            logger.info("Pruned cloud backup: %s", entry.key)
        except Exception as exc:
            logger.warning("Failed to prune %s: %s", entry.key, exc)


async def list_cloud_backups() -> list[CloudBackupEntry]:
    """List all backups in cloud storage."""
    config = load_config()
    if not config.enabled or not config.provider:
        return []
    provider = get_cloud_provider(config)
    if provider is None:
        return []
    return await provider.list_backups()


async def download_from_cloud(cloud_key: str) -> Path:
    """Download a backup from cloud and return the local file path."""
    config = load_config()
    if not config.enabled or not config.provider:
        raise ValueError("Cloud backup is not configured")
    provider = get_cloud_provider(config)
    if provider is None:
        raise ValueError(f"Unsupported provider: {config.provider}")

    buffer = await provider.download_backup(cloud_key)
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    try:
        tmp.write(buffer.getvalue())
        tmp.flush()
        return Path(tmp.name)
    finally:
        tmp.close()


async def restore_from_cloud(
    cloud_key: str,
    trust_mode: BackupTrustMode | None = None,
):
    """Download from cloud and import into local backups."""
    from ..backup._ops.storage import import_backup

    tmp_path = await download_from_cloud(cloud_key)
    try:
        meta = await import_backup(
            tmp_path,
            trust_mode=trust_mode,
        )
        return meta
    finally:
        tmp_path.unlink(missing_ok=True)


async def check_cloud_connection() -> ConnectionResult:
    """Check if the configured cloud provider is reachable.

    Returns a detailed ConnectionResult with error info.
    """
    config = load_config()
    provider = get_cloud_provider(config)
    if provider is None:
        return ConnectionResult(ok=False, error="No cloud provider configured")
    return await provider.check_connection()


async def delete_cloud_backup(cloud_key: str) -> None:
    """Delete a backup from cloud storage."""
    config = load_config()
    if not config.enabled or not config.provider:
        raise ValueError("Cloud backup is not configured")
    provider = get_cloud_provider(config)
    if provider is None:
        raise ValueError(f"Unsupported provider: {config.provider}")
    await provider.delete_backup(cloud_key)


# ---------------------------------------------------------------------------
# Scheduled sync — background loop driven by cron expression
# ---------------------------------------------------------------------------

_sync_task: asyncio.Task | None = None


async def _scheduled_sync_loop() -> None:
    """Background loop: wait until next cron fire time, then sync."""
    while True:
        try:
            config = load_config()
            if not config.enabled or not config.sync_on_schedule:
                await asyncio.sleep(300)  # re-check every 5 min
                continue

            from apscheduler.triggers.cron import CronTrigger

            trigger = CronTrigger.from_crontab(config.sync_schedule_cron)
            now = datetime.now(timezone.utc)
            next_time = trigger.get_next_fire_time(None, now)
            if next_time is None:
                await asyncio.sleep(3600)
                continue

            wait_secs = (next_time - now).total_seconds()
            logger.info(
                "Cloud sync scheduled at %s (waiting %.0fs)",
                next_time.isoformat(),
                max(wait_secs, 1),
            )
            await asyncio.sleep(max(wait_secs, 1))

            await sync_all_to_cloud()
            logger.info("Scheduled cloud sync completed")
        except asyncio.CancelledError:
            logger.info("Cloud sync loop cancelled")
            break
        except Exception as exc:
            logger.warning("Scheduled cloud sync failed: %s", exc)
            await asyncio.sleep(300)


def start_scheduled_sync() -> None:
    """Start the background scheduled sync loop if not already running."""
    global _sync_task
    if _sync_task is None or _sync_task.done():
        _sync_task = asyncio.create_task(_scheduled_sync_loop())
        logger.info("Cloud backup scheduled sync started")


async def stop_scheduled_sync() -> None:
    """Cancel the background scheduled sync loop."""
    global _sync_task
    if _sync_task is not None and not _sync_task.done():
        _sync_task.cancel()
        try:
            await _sync_task
        except asyncio.CancelledError:
            pass
    _sync_task = None
