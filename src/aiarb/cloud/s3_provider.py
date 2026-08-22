# -*- coding: utf-8 -*-
"""S3-compatible cloud storage provider.

Supports AWS S3, Cloudflare R2, MinIO, Backblaze B2, and any S3-compatible
object storage service.  Uses httpx for HTTP requests with AWS Signature V4
signing to avoid requiring boto3 as a dependency.

The signing logic follows the AWS SigV4 specification:
https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html

Key design decisions learned from the remotely-save Obsidian plugin:
- ``forcePathStyle``: when True, use ``endpoint/bucket/key`` (path-style);
  when False, use ``bucket.endpoint/key`` (virtual-hosted-style).
- The canonical URI for signing is ``/key`` (without bucket prefix) when
  using virtual-hosted-style, and ``/bucket/key`` when using path-style.
- Keys are URI-encoded per RFC 3986 to handle spaces, Chinese chars, etc.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import logging
from datetime import datetime, timezone
from urllib.parse import quote, urlparse

import httpx

from .base import CloudBackupEntry, ConnectionResult, CloudStorageProvider, register_provider
from .config import CloudBackupConfig

logger = logging.getLogger(__name__)

# SHA-256 of an empty body — pre-computed for efficiency.
_EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def _uri_encode_path(path: str) -> str:
    """RFC 3986 encode a path component, preserving ``/`` separators."""
    return quote(path, safe="/~")


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
        self._force_path_style = s3.force_path_style

        endpoint = s3.endpoint_url.strip()
        if endpoint:
            self._endpoint = endpoint.rstrip("/")
        else:
            # Default AWS endpoint — always virtual-hosted-style.
            self._endpoint = f"https://s3.{s3.region}.amazonaws.com"
            self._force_path_style = False

        # Pre-compute the host header value and the URL prefix.
        parsed = urlparse(self._endpoint)
        self._host = parsed.netloc or parsed.hostname
        if parsed.port:
            self._host = f"{self._host}:{parsed.port}"

        self._client = httpx.AsyncClient(timeout=httpx.Timeout(60.0))

    # ------------------------------------------------------------------
    # URL helpers
    # ------------------------------------------------------------------

    def _build_url(self, key: str, query: str = "") -> str:
        """Build the full request URL for a given object key.

        - Path-style:    ``endpoint/bucket/key``
        - Virtual-hosted: ``bucket.endpoint/key``
        """
        encoded_key = _uri_encode_path(key)
        if self._force_path_style:
            if encoded_key:
                url = f"{self._endpoint}/{self._bucket}/{encoded_key}"
            else:
                url = f"{self._endpoint}/{self._bucket}"
        else:
            url = f"{self._endpoint}/{encoded_key}"
        if query:
            url += f"?{query}"
        return url

    def _canonical_uri(self, key: str) -> str:
        """The canonical URI for SigV4 signing.

        When using path-style, the bucket name is part of the URI.
        When using virtual-hosted-style, only the key path is signed.
        """
        encoded_key = _uri_encode_path(key)
        if self._force_path_style:
            if encoded_key:
                return f"/{self._bucket}/{encoded_key}"
            return f"/{self._bucket}"
        return f"/{encoded_key}"

    # ------------------------------------------------------------------
    # SigV4 signing
    # ------------------------------------------------------------------

    def _sign(
        self,
        method: str,
        canonical_uri: str,
        canonical_query_string: str,
        headers: dict[str, str],
        payload_hash: str,
    ) -> str:
        """Compute the AWS Signature Version 4 Authorization header."""
        amz_date = headers["x-amz-date"]
        date_stamp = amz_date[:8]
        service = "s3"
        scope = f"{date_stamp}/{self._region}/{service}/aws4_request"

        # Build canonical headers (lowercase keys, sorted, trimmed values).
        sorted_items = sorted((k.lower(), v.strip()) for k, v in headers.items())
        signed_headers = ";".join(k for k, _ in sorted_items)
        canonical_headers = "".join(f"{k}:{v}\n" for k, v in sorted_items)

        canonical_request = "\n".join([
            method,
            canonical_uri,
            canonical_query_string,
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

    async def _request(
        self,
        method: str,
        key: str,
        query: str = "",
        body: bytes | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Send a signed S3 request."""
        url = self._build_url(key, query)
        canonical_uri = self._canonical_uri(key)

        payload_hash = (
            hashlib.sha256(body).hexdigest() if body else _EMPTY_SHA256
        )

        req_headers: dict[str, str] = {
            "Host": self._host,
            "x-amz-date": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
            "x-amz-content-sha256": payload_hash,
        }
        if extra_headers:
            req_headers.update(extra_headers)

        # Remove Host header — httpx sets it automatically from the URL.
        headers_for_httpx = {k: v for k, v in req_headers.items() if k.lower() != "host"}

        authorization = self._sign(
            method,
            canonical_uri,
            query,
            req_headers,
            payload_hash,
        )
        headers_for_httpx["Authorization"] = authorization

        return await self._client.request(
            method,
            url,
            content=body,
            headers=headers_for_httpx,
        )

    # ------------------------------------------------------------------
    # CloudStorageProvider implementation
    # ------------------------------------------------------------------

    async def check_connection(self) -> ConnectionResult:
        """Verify connectivity by listing objects with max-keys=1.

        Returns a detailed result so the caller can surface the exact
        HTTP status / error message to the user.
        """
        if not self._bucket:
            return ConnectionResult(ok=False, error="S3 bucket name is not set")
        if not self._access_key:
            return ConnectionResult(
                ok=False, error="S3 access key ID is not set",
            )
        if not self._secret_key:
            return ConnectionResult(
                ok=False, error="S3 secret access key is not set",
            )
        try:
            # ListObjectsV2 with max-keys=1 — lightweight and validates auth.
            query = f"list-type=2&max-keys=1&prefix={quote(self._prefix + '/')}"
            resp = await self._request("GET", "", query=query)
            if resp.status_code == 200:
                return ConnectionResult(ok=True)
            # Build a human-readable error from the S3 XML error response.
            error_msg = self._parse_s3_error(resp)
            return ConnectionResult(
                ok=False,
                status_code=resp.status_code,
                error=error_msg,
                detail=resp.text[:500],
            )
        except httpx.ConnectError as exc:
            logger.warning("S3 check_connection connect error: %s", exc)
            return ConnectionResult(
                ok=False,
                error=f"Cannot connect to {self._endpoint} ({exc})",
            )
        except httpx.TimeoutException:
            logger.warning("S3 check_connection timeout")
            return ConnectionResult(
                ok=False,
                error=f"Connection timed out to {self._endpoint}",
            )
        except Exception as exc:
            logger.warning("S3 check_connection error: %s", exc)
            return ConnectionResult(
                ok=False, error=f"Unexpected error: {exc}",
            )

    @staticmethod
    def _parse_s3_error(resp: httpx.Response) -> str:
        """Extract a human-readable message from an S3 error response."""
        status = resp.status_code
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(resp.text)
            ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
            code_el = root.find(".//s3:Code", ns) or root.find(".//Code")
            msg_el = root.find(".//s3:Message", ns) or root.find(".//Message")
            code = code_el.text if code_el is not None and code_el.text else ""
            msg = msg_el.text if msg_el is not None and msg_el.text else ""
            if code or msg:
                return f"HTTP {status}: {code} — {msg}".strip(" —")
        except Exception:
            pass
        # Fallback: raw status + first 200 chars of body
        body_preview = resp.text[:200].strip() if resp.text else ""
        if body_preview:
            return f"HTTP {status}: {body_preview}"
        return f"HTTP {status}"

    async def list_backups(self) -> list[CloudBackupEntry]:
        entries: list[CloudBackupEntry] = []
        try:
            continuation = ""
            while True:
                query = (
                    f"list-type=2&prefix={quote(self._prefix + '/')}"
                    f"&max-keys=1000"
                )
                if continuation:
                    query += f"&continuation-token={quote(continuation)}"
                resp = await self._request("GET", "", query=query)
                if resp.status_code != 200:
                    logger.error(
                        "S3 list failed: %s %s",
                        resp.status_code,
                        resp.text[:300],
                    )
                    break

                import xml.etree.ElementTree as ET

                root = ET.fromstring(resp.text)
                ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
                for content in root.findall(".//s3:Contents", ns):
                    key_el = content.find("s3:Key", ns)
                    size_el = content.find("s3:Size", ns)
                    mod_el = content.find("s3:LastModified", ns)
                    if key_el is None or not key_el.text:
                        continue
                    key = key_el.text
                    if not key.startswith(self._prefix + "/"):
                        continue
                    name = key[len(self._prefix) + 1:]
                    if name.endswith("/") or not name.endswith(".zip"):
                        continue
                    size = (
                        int(size_el.text)
                        if size_el is not None and size_el.text
                        else 0
                    )
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

                # Handle pagination
                is_truncated_el = root.find(".//s3:IsTruncated", ns)
                next_token_el = root.find(".//s3:NextContinuationToken", ns)
                if (
                    is_truncated_el is not None
                    and is_truncated_el.text == "true"
                    and next_token_el is not None
                    and next_token_el.text
                ):
                    continuation = next_token_el.text
                else:
                    break
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
            raise OSError(
                f"S3 upload failed: {resp.status_code} {resp.text[:300]}",
            )
        return CloudBackupEntry(
            key=key,
            size=len(body),
            last_modified=datetime.now(timezone.utc),
            backup_name=remote_name.replace(".zip", ""),
        )

    async def download_backup(self, key: str) -> io.BytesIO:
        # The key already includes the full path (prefix/name.zip).
        # If the key has the prefix stripped, re-add it.
        full_key = key if key.startswith(self._prefix + "/") else self._remote_key(key)
        resp = await self._request("GET", full_key)
        if resp.status_code != 200:
            raise FileNotFoundError(
                f"S3 download failed: {resp.status_code} for key={key}",
            )
        return io.BytesIO(resp.content)

    async def delete_backup(self, key: str) -> None:
        full_key = key if key.startswith(self._prefix + "/") else self._remote_key(key)
        resp = await self._request("DELETE", full_key)
        if resp.status_code not in (200, 204, 404):
            logger.warning(
                "S3 delete returned %s for %s: %s",
                resp.status_code,
                key,
                resp.text[:200],
            )

    async def close(self) -> None:
        await self._client.aclose()
