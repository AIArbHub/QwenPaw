"""WebDAV cloud storage provider.

Supports NextCloud, ownCloud, and any WebDAV-compatible server.
Uses httpx for HTTP requests (already a project dependency).
"""
from __future__ import annotations

import io
import logging
from datetime import datetime, timezone
from xml.etree import ElementTree

import httpx

from .base import CloudBackupEntry, CloudStorageProvider, register_provider
from .config import CloudBackupConfig

logger = logging.getLogger(__name__)


@register_provider("webdav")
class WebDAVProvider(CloudStorageProvider):
    """WebDAV-compatible cloud storage provider."""

    def __init__(self, config: CloudBackupConfig) -> None:
        super().__init__(config)
        wd = config.webdav
        self._base_url = wd.url.rstrip("/")
        self._username = wd.username
        self._password = wd.password
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0),
            auth=(self._username, self._password) if self._username else None,
        )

    def _remote_url(self, name: str = "") -> str:
        url = f"{self._base_url}/{self._prefix}"
        if name:
            url += f"/{name}"
        return url

    def _entry_from_href(
        self,
        href: str,
        props: dict[str, str],
    ) -> CloudBackupEntry | None:
        if not href.endswith(".zip"):
            return None
        # href might be a partial path from the PROPFIND response
        name = href.rstrip("/").split("/")[-1]
        key = self._remote_key(name)
        size = int(props.get("{DAV:}getcontentlength", "0") or "0")
        modified_str = props.get("{DAV:}getlastmodified", "")
        try:
            from email.utils import parsedate_to_datetime
            last_modified = parsedate_to_datetime(modified_str)
        except (TypeError, ValueError):
            last_modified = datetime.now(timezone.utc)
        return CloudBackupEntry(
            key=key,
            size=size,
            last_modified=last_modified,
            backup_name=name.replace(".zip", ""),
        )

    async def check_connection(self) -> bool:
        if not self._base_url:
            return False
        try:
            resp = await self._client.options(self._base_url)
            return resp.status_code < 500
        except Exception:
            return False

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
                    resp.text[:200],
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
                f"WebDAV upload failed: {resp.status_code} {resp.text[:200]}",
            )
        return CloudBackupEntry(
            key=self._remote_key(remote_name),
            size=len(body),
            last_modified=datetime.now(timezone.utc),
            backup_name=remote_name.replace(".zip", ""),
        )

    async def download_backup(self, key: str) -> io.BytesIO:
        url = self._remote_url(key.rsplit("/", 1)[-1] if "/" in key else key)
        resp = await self._client.get(url)
        if resp.status_code != 200:
            raise FileNotFoundError(
                f"WebDAV download failed: {resp.status_code}",
            )
        return io.BytesIO(resp.content)

    async def delete_backup(self, key: str) -> None:
        url = self._remote_url(key.rsplit("/", 1)[-1] if "/" in key else key)
        resp = await self._client.delete(url)
        if resp.status_code not in (200, 204, 404):
            logger.warning(
                "WebDAV delete returned %s: %s",
                resp.status_code,
                resp.text[:200],
            )

    async def _ensure_prefix_dir(self) -> None:
        """Create the prefix directory if it doesn't exist."""
        try:
            resp = await self._client.request(
                "PROPFIND",
                self._remote_url(),
                headers={"Depth": "0"},
            )
            if resp.status_code == 404:
                await self._client.request("MKCOL", self._remote_url())
        except Exception:
            pass

    async def close(self) -> None:
        await self._client.aclose()
