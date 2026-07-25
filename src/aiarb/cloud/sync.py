"""Cloud backup sync orchestration."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from .base import CloudBackupEntry, get_cloud_provider
from .config import CloudBackupConfig, load_cloud_config
from ..backup._ops.storage import export_backup, import_backup
from ..backup._utils.constants import zip_path
from ..backup.models import BackupMeta, BackupTrustMode

logger = logging.getLogger(__name__)

CLOUD_CONFIG_PATH: Path | None = None


def _get_config_path() -> Path:
    global CLOUD_CONFIG_PATH
    if CLOUD_CONFIG_PATH is not None:
        return CLOUD_CONFIG_PATH
    from ..constant import WORKING_DIR
    CLOUD_CONFIG_PATH = WORKING_DIR / "cloud_config.json"
    return CLOUD_CONFIG_PATH


def load_config() -> CloudBackupConfig:
    path = _get_config_path()
    if not path.is_file():
        return CloudBackupConfig()
    import json
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return load_cloud_config(data)
    except Exception:
        return CloudBackupConfig()


def save_config(config: CloudBackupConfig) -> None:
    path = _get_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    import json
    path.write_text(
        config.model_dump_json(indent=2, exclude_none=True),
        encoding="utf-8",
    )


async def upload_to_cloud(backup_id: str) -> CloudBackupEntry:
    """Upload a specific local backup to cloud storage."""
    config = load_config()
    if not config.enabled or not config.provider:
        raise ValueError("Cloud backup is not configured")

    provider = get_cloud_provider(config)
    if provider is None:
        raise ValueError(f"Unsupported provider: {config.provider}")

    # Ensure the local backup exists
    local_path = zip_path(backup_id)
    if not local_path.is_file():
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

    import tempfile
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
) -> BackupMeta:
    """Download from cloud and import into local backups."""
    tmp_path = await download_from_cloud(cloud_key)
    try:
        meta = await import_backup(
            tmp_path,
            trust_mode=trust_mode or "portable",
        )
        return meta
    finally:
        tmp_path.unlink(missing_ok=True)


async def check_cloud_connection() -> bool:
    """Check if the configured cloud provider is reachable."""
    config = load_config()
    provider = get_cloud_provider(config)
    if provider is None:
        return False
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
