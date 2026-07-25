# -*- coding: utf-8 -*-
"""PawApp API router - List, manage, and serve installed PawApps.

Delegates to the PluginRegistry for app listing. Any plugin with
``meta.pawapp`` fields is automatically recognized as a PawApp.
Falls back to scanning the plugins directory for ``plugin.json`` files
with ``meta.pawapp`` when the PluginRegistry is not yet ready.
"""

import json
import logging
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

import asyncio
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pawapps", tags=["pawapps"])


def _get_apps_dir() -> Path:
    """Return the directory holding installed 'app'-type plugins.

    Apps install into the plugins directory alongside every other
    plugin; there is no separate apps directory.
    """
    from ...config.utils import get_plugins_dir

    return get_plugins_dir()


# ─── Shared helpers ────────────────────────────────────────────────────


def _build_app_info(
    manifest: Dict[str, Any],
    fallback_id: str = "",
    builtin: bool = False,
) -> Dict[str, Any]:
    """Build a normalised app-info dict from a manifest."""
    meta = manifest.get("meta", {}) or {}
    pawapp_meta = meta.get("pawapp", {})
    return {
        "id": manifest.get("id", fallback_id),
        "name": manifest.get("name", fallback_id),
        "name_i18n": manifest.get("name_i18n"),
        "version": manifest.get("version", "0.0.0"),
        "description": manifest.get("description", ""),
        "description_i18n": manifest.get("description_i18n"),
        "author": manifest.get("author", ""),
        "category": pawapp_meta.get("category", ""),
        "icon": pawapp_meta.get("icon", ""),
        "entry_page": pawapp_meta.get("entry_page", ""),
        "launch_scope": pawapp_meta.get(
            "launch_scope",
            "page",
        ),
        "status": "installed",
        "settings": meta.get("settings", []),
        "builtin": builtin,
    }


# ─── Registry-based listing (preferred) ───────────────────────────────


def _get_pawapps_from_registry(
    request: Request,
) -> List[Dict[str, Any]]:
    """Query PluginRegistry for all loaded PawApp plugins."""
    registry = getattr(
        request.app.state,
        "plugin_registry",
        None,
    )
    if registry is None:
        return []

    loader = getattr(request.app.state, "plugin_loader", None)

    apps: List[Dict[str, Any]] = []
    for plugin_id, manifest in registry.get_all_plugin_manifests().items():
        if not isinstance(manifest, dict):
            continue
        meta = manifest.get("meta", {})
        if not meta.get("pawapp"):
            continue
        # Determine if this plugin is built-in via the loader record.
        builtin = False
        if loader is not None:
            record = loader.get_loaded_plugin(plugin_id)
            if record is not None:
                builtin = record.builtin
        apps.append(_build_app_info(manifest, plugin_id, builtin=builtin))

    return apps


# ─── Fallback: directory scanning ─────────────────────────────────────


def _load_plugin_json(
    plugin_dir: Path,
) -> Optional[Dict[str, Any]]:
    """Load ``plugin.json`` from a plugin directory."""
    manifest_path = plugin_dir / "plugin.json"
    if not manifest_path.exists():
        return None
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(
            "Failed to load plugin.json from %s: %s",
            manifest_path,
            e,
        )
        return None


def _scan_installed_apps_fallback() -> List[Dict[str, Any]]:
    """Scan plugins dirs for app-type plugins (startup fallback).

    Used only before the PluginRegistry is populated.  Scans both the
    built-in plugins directory and the user plugins directory; user
    plugins override built-in plugins with the same id.
    """
    from ...config.utils import get_all_plugin_dirs

    plugin_dirs = get_all_plugin_dirs()
    seen_ids: set[str] = set()
    apps: List[Dict[str, Any]] = []

    # Iterate in reverse so user dir entries override built-in entries
    # with the same id (matching discover_plugins behaviour).
    from ...config.utils import get_builtin_plugins_dir

    builtin_dir = get_builtin_plugins_dir()
    for plugin_dir in reversed(plugin_dirs):
        if not plugin_dir.exists():
            continue
        is_builtin_dir = plugin_dir.resolve() == builtin_dir.resolve() or (
            plugin_dir.is_relative_to(builtin_dir.resolve())
            if builtin_dir.exists()
            else False
        )
        for item in plugin_dir.iterdir():
            if not item.is_dir():
                continue
            manifest = _load_plugin_json(item)
            if not manifest:
                continue
            meta = manifest.get("meta", {}) or {}
            if not meta.get("pawapp"):
                continue
            plugin_id = manifest.get("id", item.name)
            if plugin_id in seen_ids:
                continue
            seen_ids.add(plugin_id)
            apps.append(
                _build_app_info(manifest, item.name, builtin=is_builtin_dir),
            )

    return apps


# ─── API Endpoints ────────────────────────────────────────────────────


@router.get("")
async def list_pawapps(request: Request) -> Dict[str, Any]:
    """List all installed PawApps.

    Prefers PluginRegistry data; falls back to directory scan when
    the registry is not yet populated (e.g. during early startup).
    """
    apps = _get_pawapps_from_registry(request)
    if not apps:
        # Run blocking directory scan in thread pool
        apps = await asyncio.to_thread(_scan_installed_apps_fallback)
    return {"apps": apps, "total": len(apps)}


@router.get("/{app_id}")
async def get_pawapp(app_id: str, request: Request) -> Dict[str, Any]:
    """Get details of a specific PawApp."""
    apps = _get_pawapps_from_registry(request)
    if not apps:
        # Run blocking directory scan in thread pool
        apps = await asyncio.to_thread(_scan_installed_apps_fallback)
    for app in apps:
        if app["id"] == app_id:
            return app
    raise HTTPException(status_code=404, detail=f"PawApp '{app_id}' not found")


@router.delete("/{app_id}")
async def uninstall_pawapp(app_id: str, request: Request) -> Dict[str, Any]:
    """Uninstall a PawApp by deleting its directory under the plugins dir.

    Falls back to unloading a plugin-based PawApp via the plugin loader
    when no matching directory exists. A backend restart may be needed to
    fully unmount any already-mounted backend routers.

    Built-in plugins (shipped with the package) cannot be uninstalled.
    """
    # Security: app_id must be a single, non-traversal path segment.
    if not app_id or "/" in app_id or "\\" in app_id or app_id in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid app id")

    # Refuse to uninstall built-in plugins.
    loader = getattr(request.app.state, "plugin_loader", None)
    if loader is not None:
        record = loader.get_loaded_plugin(app_id)
        if record is not None and record.builtin:
            raise HTTPException(
                status_code=403,
                detail="Built-in plugins cannot be uninstalled.",
            )

    apps_dir = _get_apps_dir()
    app_dir = apps_dir / app_id
    try:
        if app_dir.resolve().parent != apps_dir.resolve():
            raise HTTPException(status_code=400, detail="Invalid app path")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Invalid app path",
        ) from exc

    # If the plugin is loaded, unload it first (which also deletes files).
    if loader is not None and loader.get_loaded_plugin(app_id) is not None:
        try:
            await loader.unload_plugin(app_id, delete_files=True)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=500,
                detail=f"Uninstall failed: {exc}",
            ) from exc
        return {"id": app_id, "message": f"PawApp '{app_id}' uninstalled."}

    # If not loaded but directory exists, delete it directly.
    if app_dir.exists() and app_dir.is_dir():
        try:
            # Run blocking directory deletion in thread pool
            await asyncio.to_thread(shutil.rmtree, app_dir)
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to remove PawApp '%s': %s", app_id, exc)
            raise HTTPException(
                status_code=500,
                detail=f"Uninstall failed: {exc}",
            ) from exc
        return {"id": app_id, "message": f"PawApp '{app_id}' uninstalled."}

    raise HTTPException(status_code=404, detail=f"PawApp '{app_id}' not found")


@router.get("/{app_id}/settings")
async def get_pawapp_settings(app_id: str, request: Request) -> Dict[str, Any]:
    """Get settings schema for a PawApp."""
    apps = _get_pawapps_from_registry(request)
    if not apps:
        # Run blocking directory scan in thread pool
        apps = await asyncio.to_thread(_scan_installed_apps_fallback)
    for app in apps:
        if app["id"] == app_id:
            return {"app_id": app_id, "settings": app.get("settings", [])}
    raise HTTPException(status_code=404, detail=f"PawApp '{app_id}' not found")


@router.get("/{app_id}/static/{file_path:path}")
async def serve_pawapp_static(app_id: str, file_path: str):
    """Serve static files for a PawApp (frontend assets).

    Checks both the user plugins directory and the built-in plugins
    directory so that built-in apps (e.g. agent-kanban) can serve
    their frontend assets.
    """
    # Security: app_id must be a single, non-traversal path segment.
    if not app_id or "/" in app_id or "\\" in app_id or app_id in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid app id")

    from ...config.utils import get_all_plugin_dirs

    # Search all plugin directories (user dir first, then built-in).
    app_dir: Optional[Path] = None
    for plugin_dir in get_all_plugin_dirs():
        candidate = plugin_dir / app_id
        if candidate.is_dir() and (candidate / "plugin.json").exists():
            app_dir = candidate
            break

    if app_dir is None:
        raise HTTPException(
            status_code=404,
            detail=f"PawApp '{app_id}' not found",
        )

    # Security: prevent path traversal.
    # Resolve the requested file path and verify it stays inside app_dir.
    requested_path = (app_dir / file_path).resolve()

    if not requested_path.is_relative_to(app_dir.resolve()):
        raise HTTPException(
            status_code=403,
            detail="Access denied",
        )

    if not requested_path.exists() or not requested_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {file_path}",
        )

    return FileResponse(str(requested_path))
