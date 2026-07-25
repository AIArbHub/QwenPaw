# -*- coding: utf-8 -*-
"""Communication bridge: manage text selection desktop process lifecycle."""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("aiarb.text_selection")

# Managed by this process
_DESKTOP_OWNED = False

# Last healthy URL
_active_desktop_base: str | None = None

# Cooldown for health probes
_DESKTOP_UNREACHABLE_UNTIL = 0.0
_HEALTH_RETRY_SEC = 3.0

# Serialize spawns
_SPAWN_LOCK = threading.RLock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mark_desktop_owned() -> None:
    global _DESKTOP_OWNED
    _DESKTOP_OWNED = True


def _clear_desktop_base_url_cache() -> None:
    global _active_desktop_base
    _active_desktop_base = None


def _reset_desktop_reachability_probe() -> None:
    global _DESKTOP_UNREACHABLE_UNTIL
    _DESKTOP_UNREACHABLE_UNTIL = 0.0


def _mark_desktop_unreachable() -> None:
    global _DESKTOP_UNREACHABLE_UNTIL
    _clear_desktop_base_url_cache()
    _DESKTOP_UNREACHABLE_UNTIL = time.monotonic() + _HEALTH_RETRY_SEC


def _desktop_is_reachable() -> bool:
    if _active_desktop_base:
        return True
    if time.monotonic() < _DESKTOP_UNREACHABLE_UNTIL:
        return False
    if desktop_health() is not None:
        _reset_desktop_reachability_probe()
        return True
    _mark_desktop_unreachable()
    return False


def _read_token() -> str | None:
    try:
        from . import runtime as ts_rt
        return ts_rt.read_token()
    except Exception:
        return None


def _headers() -> dict[str, str]:
    token = _read_token()
    if not token:
        return {}
    return {"X-AIArb-TS-Token": token}


def _httpx_client_kwargs() -> dict[str, Any]:
    return {"trust_env": False, "timeout": 5.0}


# ---------------------------------------------------------------------------
# Desktop URL / Port helpers
# ---------------------------------------------------------------------------

_DEFAULT_HOST = "127.0.0.1"
_DEFAULT_PORT = 18765


def _spawn_host_port_from_env() -> tuple[str, int]:
    url = (os.environ.get("AIARB_TS_DESKTOP_URL") or "").strip()
    if url:
        u = urlparse(url)
        host = (u.hostname or _DEFAULT_HOST).strip() or _DEFAULT_HOST
        if u.port is not None:
            return host, int(u.port)
        if (u.scheme or "http").lower() == "https":
            return host, 443
        return host, _DEFAULT_PORT
    host = (os.environ.get("AIARB_TS_DESKTOP_HOST") or _DEFAULT_HOST).strip() or _DEFAULT_HOST
    port = int(os.environ.get("AIARB_TS_DESKTOP_PORT", str(_DEFAULT_PORT)))
    return host, port


def _tcp_bind_test(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _pick_listen_port(host: str, preferred: int) -> int:
    if os.environ.get("AIARB_TS_DESKTOP_STRICT_PORT", "0") == "1":
        return preferred
    if (os.environ.get("AIARB_TS_DESKTOP_URL") or "").strip():
        return preferred
    if _tcp_bind_test(host, preferred):
        return preferred
    for p in range(preferred + 1, preferred + 128):
        if _tcp_bind_test(host, p):
            logger.info(
                "Text Selection: preferred port %s busy; using %s",
                preferred,
                p,
            )
            return p
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        ephem = int(s.getsockname()[1])
        logger.warning(
            "Text Selection: using ephemeral port %s on %s",
            ephem,
            host,
        )
        return ephem


def _desktop_url_candidates() -> list[str]:
    """Ordered URLs to try for health check."""
    explicit = (os.environ.get("AIARB_TS_DESKTOP_URL") or "").strip()
    if explicit:
        return [explicit.rstrip("/")]

    out: list[str] = []
    try:
        from . import runtime as ts_rt
        bu = ts_rt.read_bridge_url()
        if bu:
            out.append(bu.rstrip("/"))
    except Exception:
        pass

    host, port = _spawn_host_port_from_env()
    out.append(f"http://{host}:{port}")
    seen: set[str] = set()
    uniq: list[str] = []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def _resolved_desktop_base_url() -> str:
    global _active_desktop_base
    if _active_desktop_base:
        return _active_desktop_base.rstrip("/")
    desktop_health()
    if _active_desktop_base:
        return _active_desktop_base.rstrip("/")
    cands = _desktop_url_candidates()
    return cands[0].rstrip("/") if cands else f"http://{_DEFAULT_HOST}:{_DEFAULT_PORT}"


# ---------------------------------------------------------------------------
# Health / Status
# ---------------------------------------------------------------------------

def desktop_health() -> dict[str, Any] | None:
    global _active_desktop_base
    for base in _desktop_url_candidates():
        try:
            response = httpx.get(
                f"{base.rstrip('/')}/health",
                **_httpx_client_kwargs(),
            )
            response.raise_for_status()
            data = response.json()
            if isinstance(data, dict):
                _active_desktop_base = base.rstrip("/")
                _clear_desktop_spawn_markers()
                return data
        except Exception:
            continue
    _active_desktop_base = None
    return None


def desktop_status_summary() -> dict[str, Any]:
    health = desktop_health()
    if health and health.get("ok"):
        return {**health, "ready": True, "starting": False}
    try:
        from . import runtime as ts_rt
        pid = ts_rt.read_pid()
        running = bool(pid and ts_rt.is_pid_running(pid))
        starting = ts_rt.spawn_claim_active() or running
        return {
            "ok": False,
            "ready": False,
            "starting": starting,
            "running": running,
            "pid": pid if running else None,
        }
    except ImportError:
        return {
            "ok": False,
            "ready": False,
            "starting": False,
            "running": False,
        }


def _clear_desktop_spawn_markers() -> None:
    try:
        from . import runtime as ts_rt
        ts_rt.clear_spawn_claim()
    except ImportError:
        pass


def _living_desktop_present(_host: str, _port: int) -> bool:
    health = desktop_health()
    if health and health.get("ok"):
        return True
    try:
        from . import runtime as ts_rt
        if ts_rt.spawn_claim_active():
            return True
        pid = ts_rt.read_pid()
        if pid and ts_rt.is_pid_running(pid):
            return True
    except ImportError:
        pass
    return False


# ---------------------------------------------------------------------------
# Spawn / Stop
# ---------------------------------------------------------------------------

def _spawn_desktop_background_impl() -> tuple[bool, str | None]:
    try:
        from . import runtime as ts_rt
    except ImportError as exc:
        return False, f"runtime not importable: {exc}"

    host, preferred_port = _spawn_host_port_from_env()
    if _living_desktop_present(host, preferred_port):
        return False, "Text selection desktop is already running or starting."

    try:
        ts_rt.ensure_runtime()
        try:
            ts_rt.ensure_token()
        except Exception:
            logger.warning("Could not pre-create TS bridge token", exc_info=True)

        port = _pick_listen_port(host, preferred_port)
        ts_rt.write_spawn_claim(host, port)
        display_host = "127.0.0.1" if host in ("0.0.0.0", "::", "[::]") else host
        listen_url = f"http://{display_host}:{port}"
        ts_rt.write_bridge_url(listen_url)

        # Get the main AIArb backend URL to pass to the desktop process
        aiarb_backend_url = os.environ.get("AIARB_TS_BACKEND_URL", "http://127.0.0.1:8023")

        cmd: list[str] = [
            sys.executable,
            "-m",
            "aiarb.app.text_selection.desktop",
            "--host",
            host,
            "--port",
            str(port),
            "--backend-url",
            aiarb_backend_url,
        ]

        env = os.environ.copy()
        # Add the parent src directory to PYTHONPATH so the module can be found
        src_dir = str(Path(__file__).resolve().parent.parent.parent.parent)
        existing_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            src_dir + os.pathsep + existing_pp if existing_pp else src_dir
        )

        log_path = ts_rt.runtime_dir() / "text-selection-desktop.log"
        with log_path.open("ab") as log_file:
            proc = ts_rt.detached_popen(
                cmd,
                stdout=log_file,
                stderr=log_file,
                stdin=subprocess.DEVNULL,
                env=env,
            )
        ts_rt.write_pid(proc.pid)
        global _active_desktop_base
        _active_desktop_base = listen_url
        _mark_desktop_owned()
        _reset_desktop_reachability_probe()
        return True, None
    except OSError as exc:
        return False, f"failed to start text selection desktop: {exc}"


def stop_desktop(
    *,
    force: bool = False,
    aggressive: bool = False,
    grace: float = 2.0,
) -> dict[str, Any]:
    """Stop the text selection desktop process."""
    skip = _stop_desktop_skip_reason(force=force)
    if skip is not None:
        return {"ok": True, "stopped": False, "reason": skip}

    try:
        from . import runtime as ts_rt
    except ImportError as exc:
        return {"ok": True, "stopped": False, "reason": f"runtime not importable: {exc}"}

    pid = ts_rt.read_pid()
    if not pid and force:
        health = desktop_health()
        if isinstance(health, dict):
            health_pid = health.get("pid")
            if isinstance(health_pid, int) and health_pid > 0:
                pid = health_pid
    if not pid:
        _clear_desktop_base_url_cache()
        return {"ok": True, "stopped": False, "reason": "no pid file"}
    if pid == os.getpid():
        _clear_desktop_base_url_cache()
        return {"ok": True, "stopped": False, "reason": "pid is aiarb"}
    running = ts_rt.is_pid_running(pid)
    if not running and not force:
        _clear_desktop_base_url_cache()
        return {"ok": True, "stopped": False, "reason": "not running"}

    stopped = ts_rt.terminate_process_tree(pid, grace=grace, aggressive=aggressive or not running)
    _clear_desktop_spawn_markers()
    _clear_desktop_base_url_cache()
    return {"ok": True, "stopped": stopped, "pid": pid}


def _stop_desktop_skip_reason(*, force: bool) -> str | None:
    if os.environ.get("AIARB_TS_STOP_ON_SHUTDOWN", "1") == "0":
        return "opted out"
    if not _DESKTOP_OWNED and not force:
        return "not autostarted"
    return None


def _wait_for_desktop_ready(timeout: float, interval: float = 0.1) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if desktop_health():
            return True
        time.sleep(interval)
    return False


def ensure_desktop_available() -> None:
    """Best-effort autostart of the text selection desktop runtime."""
    import asyncio

    if desktop_health():
        _mark_desktop_owned()
        _reset_desktop_reachability_probe()
        return
    if os.environ.get("AIARB_TS_AUTOSTART", "0") == "0":
        return
    ok, hint = _spawn_desktop_background_impl()
    if not ok:
        logger.warning("Could not autostart text selection desktop: %s", hint)
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        wait_sec = 5.0 if sys.platform == "win32" else 2.0
        _wait_for_desktop_ready(wait_sec)
        return

    async def _poll() -> None:
        wait_sec = 5.0 if sys.platform == "win32" else 2.0
        await asyncio.to_thread(_wait_for_desktop_ready, wait_sec)

    loop.create_task(_poll())


def start_desktop_interactive() -> dict[str, Any]:
    """Explicit start from HTTP/UI."""
    with _SPAWN_LOCK:
        health = desktop_health()
        if health and health.get("ok"):
            _mark_desktop_owned()
            _reset_desktop_reachability_probe()
            return {
                "ok": True,
                "alreadyRunning": True,
                "launchAttempted": False,
                "message": "Text selection desktop is already running.",
            }

        host, preferred_port = _spawn_host_port_from_env()
        wait_sec = 5.0 if sys.platform == "win32" else 3.0
        if _living_desktop_present(host, preferred_port):
            _mark_desktop_owned()
            _reset_desktop_reachability_probe()
            _wait_for_desktop_ready(wait_sec, interval=0.12)
            if desktop_health():
                return {
                    "ok": True,
                    "alreadyRunning": True,
                    "launchAttempted": False,
                    "message": "Text selection desktop is already running.",
                }
            return {
                "ok": True,
                "alreadyRunning": False,
                "launchAttempted": False,
                "message": "Text selection desktop is already starting.",
            }

        ok, hint = _spawn_desktop_background_impl()
        if not ok:
            return {
                "ok": True,
                "alreadyRunning": False,
                "launchAttempted": False,
                "message": hint or "Could not start the text selection desktop.",
            }

        if _wait_for_desktop_ready(wait_sec, interval=0.12):
            return {
                "ok": True,
                "alreadyRunning": False,
                "launchAttempted": True,
                "message": "Text selection desktop started.",
            }

        return {
            "ok": True,
            "alreadyRunning": False,
            "launchAttempted": True,
            "message": "Desktop process spawned but not ready yet.",
        }
