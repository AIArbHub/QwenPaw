"""S3-compatible cloud storage provider.

Supports AWS S3, Cloudflare R2, MinIO, Backblaze B2, and any S3-compatible
object storage service.  Uses httpx for HTTP requests with AWS Signature V4
signing to avoid requiring boto3 as a dependency.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import logging
from datetime import datetime, timezone
from email.utils import formatdate
from urllib.parse import quote, urlparse

import httpx

from .base import CloudBackupEntry, CloudStorageProvider, register_provider
from .config import CloudBackupConfig

logger = logging.getLogger(__name__)


@register_provider("s3")
class S3Provider(CloudStorageProvider):
    """S3-compatible cloud storage provider using raw HTTP + SigV4."""

    def __init__(self, config: CloudBackupConfig) -> None:
        super().__init__(config)
        s3 = config.s3
        self._bucket = s3.bucket
        self._region = s3.region
        self._access_key = s3.access_key_id
        self._secret_key = s3.secret_access_key

        endpoint = s3.endpoint_url.strip()
        if endpoint:
            self._endpoint = endpoint.rstrip("/")
        else:
            self._endpoint = f"https://s3.{s3.region}.amazonaws.com"

        self._client = httpx.AsyncClient(timeout=httpx.Timeout(60.0))

    async def _request(
        self,
        method: str,
        path: str,
        query: str = "",
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        url = f"{self._endpoint}/{self._bucket}/{path}"
        if query:
            url += f"?{query}"

        date_str = formatdate(usegmt=True)
        req_headers: dict[str, str] = {
            "Host": urlparse(self._endpoint).netloc or urlparse(
                f"https://{self._bucket}.s3.{self._region}.amazonaws.com",
            ).netloc,
            "x-amz-date": datetime.now(timezone.utc).strftime(
                "%Y%m%dT%H%M%SZ",
            ),
            "x-amz-content-sha256": (
                hashlib.sha256(body).hexdigest()
                if body
                else "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            ),
        }
        if headers:
            req_headers.update(headers)

        signature = self._sign(
            method,
            path,
            query,
            req_headers,
            req_headers["x-amz-content-sha256"],
        )
        req_headers["Authorization"] = signature

        return await self._client.request(
            method,
            url,
            content=body,
            headers=req_headers,
        )

    def _sign(
        self,
        method: str,
        path: str,
        query: str,
        headers: dict[str, str],
        payload_hash: str,
    ) -> str:
        amz_date = headers["x-amz-date"]
        date_stamp = amz_date[:8]
        service = "s3"
        scope = f"{date_stamp}/{self._region}/{service}/aws4_request"

        signed_headers = ";".join(sorted(key.lower() for key in headers))
        canonical_headers = "".join(
            f"{k.lower()}:{v}\n" for k, v in sorted(headers.items())
        )

        canonical_request = "\n".join([
            method,
            f"/{self._bucket}/{path}",
            query,
            canonical_headers,
            signed_headers,
            payload_hash,
        ])

        string_to_sign = "\n".join([
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ])

        def _hmac(key: bytes, msg: str) -> bytes:
            return hmac.new(key, msg.encode(), hashlib.sha256).digest()

        signing_key = _hmac(
            _hmac(
                _hmac(
                    _hmac(f"AWS4{self._secret_key}".encode(), date_stamp),
                    self._region,
                ),
                service,
            ),
            "aws4_request",
        )

        signature = hmac.new(
            signing_key,
            string_to_sign.encode(),
            hashlib.sha256,
        ).hexdigest()

        return (
            f"AWS4-HMAC-SHA256 "
            f"Credential={self._access_key}/{scope}, "
            f"SignedHeaders={signed_headers}, "
            f"Signature={signature}"
        )

    async def check_connection(self) -> bool:
        if not self._bucket or not self._access_key:
            return False
        try:
            resp = await self._request("HEAD", "")
            return resp.status_code < 500
        except Exception:
            return False

    async def list_backups(self) -> list[CloudBackupEntry]:
        entries: list[CloudBackupEntry] = []
        query = f"prefix={quote(self._prefix + '/')}"
        try:
            resp = await self._request("GET", "", query=query)
            if resp.status_code != 200:
                logger.error("S3 list failed: %s %s", resp.status_code, resp.text)
                return entries
            import xml.etree.ElementTree as ET
            root = ET.fromstring(resp.text)
            ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
            for content in root.findall(".//s3:Contents", ns):
                key_el = content.find("s3:Key", ns)
                size_el = content.find("s3:Size", ns)
                mod_el = content.find("s3:LastModified", ns)
                if key_el is not None and key_el.text:
                    key = key_el.text
                    if not key.startswith(self._prefix + "/"):
                        continue
                    name = key[len(self._prefix) + 1:]
                    if name.endswith("/") or not name.endswith(".zip"):
                        continue
                    size = int(size_el.text) if size_el is not None and size_el.text else 0
                    lm = (
                        datetime.fromisoformat(
                            mod_el.text.replace("Z", "+00:00"),
                        )
                        if mod_el is not None and mod_el.text
                        else datetime.now(timezone.utc)
                    )
                    entries.append(
                        CloudBackupEntry(
                            key=key,
                            size=size,
                            last_modified=lm,
                            backup_name=name.replace(".zip", ""),
                        ),
                    )
        except Exception as exc:
            logger.exception("S3 list error: %s", exc)
        return sorted(entries, key=lambda e: e.last_modified, reverse=True)

    async def upload_backup(
        self,
        local_path: str,
        remote_name: str,
    ) -> CloudBackupEntry:
        key = self._remote_key(remote_name)
        with open(local_path, "rb") as f:
            body = f.read()
        resp = await self._request("PUT", key, body=body)
        if resp.status_code not in (200, 204):
            raise OSError(f"S3 upload failed: {resp.status_code} {resp.text}")
        return CloudBackupEntry(
            key=key,
            size=len(body),
            last_modified=datetime.now(timezone.utc),
            backup_name=remote_name.replace(".zip", ""),
        )

    async def download_backup(self, key: str) -> io.BytesIO:
        resp = await self._request("GET", key)
        if resp.status_code != 200:
            raise FileNotFoundError(
                f"S3 download failed: {resp.status_code} {key}",
            )
        return io.BytesIO(resp.content)

    async def delete_backup(self, key: str) -> None:
        resp = await self._request("DELETE", key)
        if resp.status_code not in (200, 204, 404):
            logger.warning(
                "S3 delete returned %s for %s: %s",
                resp.status_code,
                key,
                resp.text,
            )

    async def close(self) -> None:
        await self._client.aclose()
