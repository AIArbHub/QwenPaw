# -*- coding: utf-8 -*-
"""Cloud backup REST API router."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ...cloud.config import CloudBackupConfig
from ...cloud.sync import (
    check_cloud_connection,
    delete_cloud_backup,
    download_from_cloud,
    list_cloud_backups,
    load_config,
    restore_from_cloud,
    save_config,
    sync_all_to_cloud,
    upload_to_cloud,
)
from ...backup.models import BackupTrustMode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cloud-backups", tags=["Cloud Backups"])


@router.get("/config", summary="Get cloud backup configuration")
async def get_cloud_config():
    config = load_config()
    return JSONResponse(content=config.model_dump())


@router.put("/config", summary="Save cloud backup configuration")
async def save_cloud_config(config: CloudBackupConfig):
    logger.info(
        "Saving cloud config: provider=%s, enabled=%s",
        config.provider,
        config.enabled,
    )
    save_config(config)
    return JSONResponse(content={"ok": True})


@router.post("/check", summary="Check cloud connection")
async def check_connection():
    """Test cloud storage connectivity.

    Returns diagnostic info so the frontend can show *why* the check failed.
    """
    config = load_config()
    if not config.provider:
        return JSONResponse(
            content={"connected": False, "error": "No provider configured"},
        )

    # Check required fields per provider before attempting a request.
    if config.provider == "s3":
        s3 = config.s3
        if not s3.bucket or not s3.access_key_id or not s3.secret_access_key:
            return JSONResponse(
                content={
                    "connected": False,
                    "error": "S3 bucket, access key, and secret key are required",
                },
            )
    elif config.provider == "webdav":
        wd = config.webdav
        if not wd.url:
            return JSONResponse(
                content={
                    "connected": False,
                    "error": "WebDAV URL is required",
                },
            )

    result = await check_cloud_connection()
    return JSONResponse(content=result.to_dict())


@router.get("/list", summary="List cloud backups")
async def list_cloud():
    entries = await list_cloud_backups()
    return JSONResponse(content={
        "entries": [
            {
                "key": e.key,
                "size": e.size,
                "last_modified": e.last_modified.isoformat(),
                "backup_name": e.backup_name,
            }
            for e in entries
        ],
    })


@router.post("/upload/{backup_id}", summary="Upload backup to cloud")
async def upload_backup(backup_id: str):
    try:
        entry = await upload_to_cloud(backup_id)
        return JSONResponse(content={
            "key": entry.key,
            "size": entry.size,
            "last_modified": entry.last_modified.isoformat(),
        })
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Local backup not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sync", summary="Sync all local backups to cloud")
async def sync_all():
    try:
        uploaded = await sync_all_to_cloud()
        return JSONResponse(content={
            "uploaded_count": len(uploaded),
            "entries": [
                {
                    "key": e.key,
                    "size": e.size,
                    "backup_name": e.backup_name,
                }
                for e in uploaded
            ],
        })
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/download/{cloud_key:path}", summary="Download backup from cloud")
async def download_backup(cloud_key: str):
    try:
        path = await download_from_cloud(cloud_key)
        return FileResponse(
            path=path,
            media_type="application/zip",
            filename=cloud_key.rsplit("/", 1)[-1],
            background=BackgroundTask(lambda: path.unlink(missing_ok=True)),
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Cloud backup not found",
        )


@router.post("/restore/{cloud_key:path}", summary="Restore from cloud")
async def restore_backup(
    cloud_key: str,
    trust_mode: BackupTrustMode | None = Query(
        default=None,
        alias="trust_mode",
    ),
):
    try:
        meta = await restore_from_cloud(cloud_key, trust_mode)
        return JSONResponse(content=meta.model_dump(mode="json"))
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Cloud backup not found",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{cloud_key:path}", summary="Delete cloud backup")
async def delete_backup(cloud_key: str):
    try:
        await delete_cloud_backup(cloud_key)
        return JSONResponse(content={"ok": True})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
