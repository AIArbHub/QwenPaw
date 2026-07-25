# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import io
import logging
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_CLOUD_URL = "https://mineru.net/api/v4"
_DEFAULT_LOCAL_URL = "http://localhost:8000/api/v4"
_POLL_INTERVAL = 5
_MAX_POLLS = 120
# Upload timeout scales with file size: 120s base + 30s per 10MB
_UPLOAD_BASE_TIMEOUT = 120
_UPLOAD_PER_10MB = 30


class MinerUAuthError(Exception):
    """Raised when MinerU API returns 401 (invalid or expired API key)."""
    pass


class MinerUParser:
    def __init__(
        self,
        api_key: str = "",
        base_url: str = _DEFAULT_CLOUD_URL,
        backend: str = "pipeline",
        effort: str = "medium",
    ):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._backend = backend
        self._effort = effort

    @property
    def available(self) -> bool:
        # Cloud mode: needs an API key
        if self._api_key:
            return True
        # Local mode: available even without API key (no auth needed)
        return self.is_local

    @property
    def is_local(self) -> bool:
        return "localhost" in self._base_url or "127.0.0.1" in self._base_url

    async def parse(self, file_path: Path) -> str:
        if not self.available:
            logger.warning("MinerU not available (no API key and not local mode)")
            return ""

        try:
            import httpx
        except ImportError:
            logger.warning("httpx not installed, cannot call MinerU API")
            return ""

        try:
            if self.is_local:
                result = await self._parse_local(file_path)
            else:
                result = await self._parse_cloud(file_path)
            if result:
                return result
        except MinerUAuthError:
            return "[MinerU: API密钥认证失败，请检查密钥是否正确或是否已过期]"
        except Exception as exc:
            logger.error("MinerU parse failed for %s: %s", file_path, exc)
            return f"[MinerU: 解析失败 - {exc}]"

        return ""

    # ── Cloud API (mineru.net) ──────────────────────────────────────

    async def _parse_cloud(self, file_path: Path) -> str:
        """MinerU cloud API: file-urls/batch → PUT upload → extract-results/batch → download ZIP."""
        import httpx

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }

        file_size_mb = file_path.stat().st_size / (1024 * 1024)
        upload_timeout = _UPLOAD_BASE_TIMEOUT + int(file_size_mb / 10) * _UPLOAD_PER_10MB
        logger.info("MinerU cloud: uploading %s (%.1f MB, timeout=%ds)",
                     file_path.name, file_size_mb, upload_timeout)

        async with httpx.AsyncClient(timeout=upload_timeout) as client:
            # Step 1: Request presigned upload URLs
            logger.info("MinerU cloud: requesting upload URL for %s", file_path.name)
            resp = await client.post(
                f"{self._base_url}/file-urls/batch",
                headers=headers,
                json={
                    "files": [
                        {"name": file_path.name, "data_id": "aiarb", "is_ocr": True}
                    ],
                    "model_version": "vlm",
                    "enable_formula": True,
                    "enable_table": True,
                    "language": "ch",
                },
            )
            if resp.status_code == 401:
                raise MinerUAuthError(f"401: {resp.text[:200]}")
            resp.raise_for_status()
            data = resp.json()

            if data.get("code") != 0:
                error_msg = data.get("msg", "unknown error")
                logger.error("MinerU cloud: file-urls/batch failed: %s", error_msg)
                return f"[MinerU: 申请上传URL失败 - {error_msg}]"

            batch_id = data["data"]["batch_id"]
            file_urls = data["data"]["file_urls"]
            if not file_urls:
                return "[MinerU: 未获取到上传URL]"

            logger.info("MinerU cloud: got batch_id=%s, uploading file...", batch_id)

            # Step 2: Upload file to presigned URL via PUT
            with open(file_path, "rb") as f:
                file_data = f.read()

            put_resp = await client.put(file_urls[0], content=file_data)
            if put_resp.status_code not in (200, 201):
                logger.error("MinerU cloud: file upload failed: %d %s",
                             put_resp.status_code, put_resp.text[:200])
                return f"[MinerU: 文件上传失败 - HTTP {put_resp.status_code}]"

            logger.info("MinerU cloud: file uploaded, polling for results (batch_id=%s)...", batch_id)

            # Step 3: Poll for completion
            for i in range(_MAX_POLLS):
                await asyncio.sleep(_POLL_INTERVAL)
                status_resp = await client.get(
                    f"{self._base_url}/extract-results/batch/{batch_id}",
                    headers=headers,
                )
                status_data = status_resp.json()

                if status_data.get("code") != 0:
                    logger.error("MinerU cloud: status query failed: %s", status_data)
                    continue

                extract_results = status_data.get("data", {}).get("extract_result", [])
                if not extract_results:
                    continue

                result_item = extract_results[0]
                state = result_item.get("state", "")

                if state == "done":
                    full_zip_url = result_item.get("full_zip_url", "")
                    if not full_zip_url:
                        return "[MinerU: 解析完成但未返回下载地址]"

                    logger.info("MinerU cloud: task done, downloading ZIP: %s", full_zip_url[:100])

                    # Step 4: Download ZIP and extract markdown
                    zip_resp = await client.get(full_zip_url, timeout=300)
                    zip_resp.raise_for_status()

                    return self._extract_markdown_from_zip(zip_resp.content)

                elif state in ("failed", "error"):
                    err_msg = result_item.get("err_msg", "unknown error")
                    logger.error("MinerU cloud: task failed: %s", err_msg)
                    return f"[MinerU: 解析任务失败 - {err_msg}]"

                logger.debug("MinerU cloud: polling... state=%s (%d/%d)", state, i + 1, _MAX_POLLS)

            return "[MinerU: 解析超时，请稍后重试]"

    def _extract_markdown_from_zip(self, zip_data: bytes) -> str:
        """Extract markdown content from a MinerU result ZIP file."""
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
                # Look for .md file in the ZIP
                md_files = [n for n in zf.namelist() if n.endswith(".md")]
                if md_files:
                    # Prefer full.md or the first .md file
                    md_name = next((n for n in md_files if "full" in n.lower()), md_files[0])
                    content = zf.read(md_name).decode("utf-8", errors="replace")
                    logger.info("MinerU: extracted %s from ZIP (%d chars)", md_name, len(content))
                    return content

                # No .md file found, try to find any text content
                logger.warning("MinerU: no .md file in ZIP, contents: %s", zf.namelist())
                return ""
        except Exception as exc:
            logger.error("MinerU: failed to extract from ZIP: %s", exc)
            return f"[MinerU: ZIP解压失败 - {exc}]"

    # ── Local API (mineru-api FastAPI server) ───────────────────────

    async def _parse_local(self, file_path: Path) -> str:
        """MinerU local FastAPI server: POST /tasks with file upload → poll → result."""
        import httpx

        headers = {}
        if self._api_key and self._api_key != "local":
            headers["Authorization"] = f"Bearer {self._api_key}"

        file_size_mb = file_path.stat().st_size / (1024 * 1024)
        upload_timeout = _UPLOAD_BASE_TIMEOUT + int(file_size_mb / 10) * _UPLOAD_PER_10MB
        logger.info("MinerU local: uploading %s (%.1f MB, timeout=%ds)",
                     file_path.name, file_size_mb, upload_timeout)

        async with httpx.AsyncClient(timeout=upload_timeout) as client:
            with open(file_path, "rb") as f:
                form_data = {
                    "backend": self._backend,
                    "effort": self._effort,
                }
                resp = await client.post(
                    f"{self._base_url}/tasks",
                    headers=headers,
                    files=[("files", (file_path.name, f))],
                    data=form_data,
                )
            if resp.status_code == 401:
                raise MinerUAuthError(f"401: {resp.text[:200]}")
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get("task_id") or data.get("id") or data.get("batch_id", "")

            if not task_id:
                return ""

            logger.info("MinerU local: task created (id=%s), polling...", task_id)

            for _ in range(_MAX_POLLS):
                await asyncio.sleep(_POLL_INTERVAL)
                status_resp = await client.get(
                    f"{self._base_url}/tasks/{task_id}",
                    headers=headers,
                )
                status_data = status_resp.json()
                status = status_data.get("status", "")

                if status in ("done", "completed", "success"):
                    return self._extract_markdown_from_local_result(status_data, client)
                if status in ("failed", "error"):
                    error_msg = status_data.get("error", "unknown error")
                    logger.error("MinerU local: task %s failed: %s", task_id, error_msg)
                    return ""

            return ""

    def _extract_markdown_from_local_result(self, status_data: dict, client) -> str:
        """Extract markdown from local FastAPI response format."""
        results = status_data.get("results", [])
        if isinstance(results, list):
            for item in results:
                if isinstance(item, dict):
                    url = item.get("url", "") or item.get("full_zip_url", "")
                    if url and item.get("file_name", "").endswith(".md"):
                        resp = client.get(url)
                        return resp.text
                    # If there's a zip URL, download and extract
                    if url and (url.endswith(".zip") or "zip" in url):
                        resp = client.get(url)
                        return self._extract_markdown_from_zip(resp.content)

        content_url = status_data.get("content_url", "")
        if content_url:
            resp = client.get(content_url)
            return resp.text

        markdown_content = status_data.get("markdown", "") or status_data.get("content", "")
        if markdown_content:
            return markdown_content

        return ""

    @staticmethod
    async def check_local_deployment(base_url: str) -> dict:
        try:
            import httpx

            url = base_url.rstrip("/")
            async with httpx.AsyncClient(timeout=10) as client:
                for endpoint in ["/tasks", "/file-urls/batch"]:
                    try:
                        resp = await client.get(url + endpoint)
                        return {"reachable": True, "status_code": resp.status_code}
                    except Exception:
                        continue
                return {"reachable": False, "error": "all endpoints unreachable"}
        except Exception as e:
            return {"reachable": False, "error": f"{type(e).__name__}: {e}"}