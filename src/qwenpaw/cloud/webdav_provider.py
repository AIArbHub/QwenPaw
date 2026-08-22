# -*- coding: utf-8 -*-
"""WebDAV cloud storage provider.

Supports NextCloud, ownCloud, and any WebDAV-compatible server.
Uses httpx for HTTP requests (already a project dependency).

Key design decisions learned from the remotely-save Obsidian plugin:
- ``check_connection`` uses PROPFIND with ``Depth: 0`` instead of OPTIONS,
  because many WebDAV servers (especially Nextcloud) respond to OPTIONS
  with 200 even when auth is wrong, while PROPFIND correctly returns 401.
- File paths are URI-encoded to handle spaces, Chinese characters, etc.
- The prefix directory is created lazily via MKCOL when PROPFIND returns 404.
- Basic auth is used by default; digest auth is supported via config.
"""
from __future__ import annotations

import io
import logging
from datetime import datetime, timezone
from urllib.parse import quote
from xml.etree import ElementTree

import httpx

from .base import CloudBackupEntry, ConnectionResult, CloudStorageProvider, register_provider
from .config import CloudBackupConfig

logger = logging.getLogger(__name__)


def _encode_path_segment(segment: str) -> str:
    """URI-encode a single path segment, preserving only unreserved chars."""
    return quote(segment, safe="")


@register_provider("webdav")
class WebDAVProvider(CloudStorageProvider):
    """WebDAV-compatible cloud storage provider."""

    def __init__(self, config: CloudBackupConfig) -> None:
        super().__init__(config)
        wd = config.webdav
        self._base_url = wd.url.rstrip("/")
        self._username = wd.username
        self._password = wd.password

        # Build auth tuple for httpx (Basic auth).
        auth = (
            (self._username, self._password) if self._username else None
        )

        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0),
            auth=auth,
            # Follow redirects — some WebDAV servers redirect on trailing slash.
            follow_redirects=True,
        )

    def _remote_url(self, name: str = "") -> str:
        """Build the full URL for a remote file.

        Each path segment is individually URI-encoded so that spaces,
        Chinese characters, and other special characters are handled
        correctly.
        """
        # Encode the prefix path segments.
        prefix_parts = [
            _encode_path_segment(seg)
            for seg in self._prefix.split("/")
            if seg
        ]
        url = f"{self._base_url}/" + "/".join(prefix_parts)
        if name:
            # Encode the filename segments too.
            name_parts = [_encode_path_segment(seg) for seg in name.split("/") if seg]
            url += "/" + "/".join(name_parts)
        return url

    def _entry_from_href(
        self,
        href: str,
        props: dict[str, str],
    ) -> CloudBackupEntry | None:
        """Parse a WebDAV ``<response>`` element into a CloudBackupEntry."""
        if not href.endswith(".zip"):
            return None
        # href might be a full URL or a partial path from the PROPFIND response.
        # Extract just the filename.
        name = href.rstrip("/").split("/")[-1]
        # Decode URI-encoded characters in the href.
        from urllib.parse import unquote
        name = unquote(name)
        key = self._remote_key(name)
        size = int(props.get("{DAV:}getcontentlength", "0") or "0")
        modified_str = props.get("{DAV:}getlastmodified", "")
        try:
            from email.utils import parsedate_to_datetime
            last_modified = parsedate_to_datetime(modified_str)
            if last_modified.tzinfo is None:
                last_modified = last_modified.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            last_modified = datetime.now(timezone.utc)
        return CloudBackupEntry(
            key=key,
            size=size,
            last_modified=last_modified,
            backup_name=name.replace(".zip", ""),
        )

    async def check_connection(self) -> ConnectionResult:
        """Check connectivity by sending a PROPFIND with Depth: 0.

        We use PROPFIND instead of OPTIONS because:
        1. Some servers (e.g. Nextcloud) return 200 on OPTIONS even with
           wrong credentials.
        2. PROPFIND with Depth: 0 validates both auth and that the path exists.
        3. remotely-save uses the same approach (via webdav library's
           ``exists()`` which internally does a PROPFIND).

        Returns a detailed result so the caller can surface the exact
        HTTP status / error message to the user.
        """
        if not self._base_url:
            return ConnectionResult(ok=False, error="WebDAV URL is not set")
        try:
            body = (
                '<?xml version="1.0" encoding="utf-8"?>'
                '<d:propfind xmlns:d="DAV:">'
                "<d:prop>"
                "<d:resourcetype/>"
                "</d:prop>"
                "</d:propfind>"
            )
            resp = await self._client.request(
                "PROPFIND",
                self._base_url,
                content=body,
                headers={"Depth": "0", "Content-Type": "application/xml"},
            )
            # 207 Multi-Status = success.
            # 200 is also acceptable from some servers.
            if resp.status_code in (200, 207):
                return ConnectionResult(ok=True)
            # Build a human-readable error message
            if resp.status_code == 401:
                error_msg = "HTTP 401: Authentication failed — check username and password"
            elif resp.status_code == 403:
                error_msg = "HTTP 403: Forbidden — user lacks permission"
            elif resp.status_code == 404:
                error_msg = f"HTTP 404: URL not found — {self._base_url}"
            else:
                body_preview = resp.text[:200].strip() if resp.text else ""
                error_msg = f"HTTP {resp.status_code}" + (
                    f": {body_preview}" if body_preview else ""
                )
            return ConnectionResult(
                ok=False,
                status_code=resp.status_code,
                error=error_msg,
                detail=resp.text[:500],
            )
        except httpx.ConnectError as exc:
            logger.warning("WebDAV check_connection connect error: %s", exc)
            return ConnectionResult(
                ok=False,
                error=f"Cannot connect to {self._base_url} ({exc})",
            )
        except httpx.TimeoutException:
            logger.warning("WebDAV check_connection timeout")
            return ConnectionResult(
                ok=False,
                error=f"Connection timed out to {self._base_url}",
            )
        except Exception as exc:
            logger.warning("WebDAV check_connection error: %s", exc)
            return ConnectionResult(
                ok=False, error=f"Unexpected error: {exc}",
            )

    async def list_backups(self) -> list[CloudBackupEntry]:
        entries: list[CloudBackupEntry] = []
        try:
            await self._ensure_prefix_dir()
            body = (
                '<?xml version="1.0" encoding="utf-8"?>'
                '<d:propfind xmlns:d="DAV:">'
                "<d:prop>"
                "<d:getcontentlength/>"
                "<d:getlastmodified/>"
                "<d:resourcetype/>"
                "</d:prop>"
                "</d:propfind>"
            )
            resp = await self._client.request(
                "PROPFIND",
                self._remote_url(),
                content=body,
                headers={"Depth": "1", "Content-Type": "application/xml"},
            )
            if resp.status_code == 404:
                return entries
            if resp.status_code not in (207,):
                logger.error(
                    "WebDAV PROPFIND failed: %s %s",
                    resp.status_code,
                    resp.text[:300],
                )
                return entries

            ns = {"d": "DAV:"}
            root = ElementTree.fromstring(resp.text)
            for response in root.findall(".//d:response", ns):
                href_el = response.find("d:href", ns)
                if href_el is None or not href_el.text:
                    continue
                props: dict[str, str] = {}
                for propstat in response.findall("d:propstat", ns):
                    prop_el = propstat.find("d:prop", ns)
                    if prop_el is not None:
                        for child in prop_el.iter():
                            tag = child.tag
                            if tag.startswith("{DAV:}"):
                                props[tag] = child.text or ""
                entry = self._entry_from_href(href_el.text, props)
                if entry:
                    entries.append(entry)
        except Exception as exc:
            logger.exception("WebDAV list error: %s", exc)
        return sorted(entries, key=lambda e: e.last_modified, reverse=True)

    async def upload_backup(
        self,
        local_path: str,
        remote_name: str,
    ) -> CloudBackupEntry:
        await self._ensure_prefix_dir()
        url = self._remote_url(remote_name)
        with open(local_path, "rb") as f:
            body = f.read()
        resp = await self._client.put(url, content=body)
        if resp.status_code not in (200, 201, 204):
            raise OSError(
                f"WebDAV upload failed: {resp.status_code} {resp.text[:300]}",
            )
        return CloudBackupEntry(
            key=self._remote_key(remote_name),
            size=len(body),
            last_modified=datetime.now(timezone.utc),
            backup_name=remote_name.replace(".zip", ""),
        )

    async def download_backup(self, key: str) -> io.BytesIO:
        # Extract the filename from the full key (may contain prefix).
        name = key.rsplit("/", 1)[-1] if "/" in key else key
        url = self._remote_url(name)
        resp = await self._client.get(url)
        if resp.status_code != 200:
            raise FileNotFoundError(
                f"WebDAV download failed: {resp.status_code} for {url}",
            )
        return io.BytesIO(resp.content)

    async def delete_backup(self, key: str) -> None:
        name = key.rsplit("/", 1)[-1] if "/" in key else key
        url = self._remote_url(name)
        resp = await self._client.delete(url)
        if resp.status_code not in (200, 204, 404):
            logger.warning(
                "WebDAV delete returned %s: %s",
                resp.status_code,
                resp.text[:200],
            )

    async def _ensure_prefix_dir(self) -> None:
        """Create the prefix directory if it doesn't exist.

        Uses PROPFIND (Depth: 0) to check existence, then MKCOL if 404.
        This mirrors remotely-save's approach of checking with
        ``client.exists()`` before creating.
        """
        try:
            body = (
                '<?xml version="1.0" encoding="utf-8"?>'
                '<d:propfind xmlns:d="DAV:">'
                "<d:prop><d:resourcetype/></d:prop>"
                "</d:propfind>"
            )
            resp = await self._client.request(
                "PROPFIND",
                self._remote_url(),
                content=body,
                headers={"Depth": "0", "Content-Type": "application/xml"},
            )
            if resp.status_code in (200, 207):
                return  # Directory exists.
            if resp.status_code == 404:
                # Create the directory — try MKCOL, possibly recursively.
                await self._mkcol_recursive()
                return
            logger.warning(
                "WebDAV _ensure_prefix_dir: unexpected status %s",
                resp.status_code,
            )
        except Exception as exc:
            logger.warning("WebDAV _ensure_prefix_dir error: %s", exc)

    async def _mkcol_recursive(self) -> None:
        """Create the prefix directory, creating parent directories as needed.

        Some WebDAV servers don't support recursive MKCOL, so we create
        each path segment individually.
        """
        parts = [seg for seg in self._prefix.split("/") if seg]
        current = self._base_url
        for seg in parts:
            current = f"{current}/{_encode_path_segment(seg)}"
            # Check if this segment already exists.
            body = (
                '<?xml version="1.0" encoding="utf-8"?>'
                '<d:propfind xmlns:d="DAV:">'
                "<d:prop><d:resourcetype/></d:prop>"
                "</d:propfind>"
            )
            resp = await self._client.request(
                "PROPFIND",
                current,
                content=body,
                headers={"Depth": "0", "Content-Type": "application/xml"},
            )
            if resp.status_code in (200, 207):
                continue  # Already exists.
            # MKCOL to create it.
            resp = await self._client.request("MKCOL", current)
            if resp.status_code not in (200, 201, 405):
                logger.warning(
                    "WebDAV MKCOL %s returned %s: %s",
                    current,
                    resp.status_code,
                    resp.text[:200],
                )
                break

    async def close(self) -> None:
        await self._client.aclose()
