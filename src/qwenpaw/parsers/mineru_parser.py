# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_CLOUD_URL = "https://mineru.net/api/v4"
_DEFAULT_LOCAL_URL = "http://localhost:8000/api/v4"
_POLL_INTERVAL = 5
_MAX_POLLS = 120


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
        return bool(self._api_key)

    @property
    def is_local(self) -> bool:
        return "localhost" in self._base_url or "127.0.0.1" in self._base_url

    async def parse(self, file_path: Path) -> str:
        if not self._api_key:
            logger.warning("MinerU API key not configured")
            return ""

        try:
            import httpx
        except ImportError:
            logger.warning("httpx not installed, cannot call MinerU API")
            return ""

        try:
            result = await self._parse_via_tasks_api(file_path)
            if result:
                return result
        except Exception as exc:
            logger.debug("Tasks API failed for %s, trying legacy API: %s", file_path, exc)

        try:
            return await self._parse_via_legacy_api(file_path)
        except Exception as exc:
            logger.error("MinerU API failed for %s: %s", file_path, exc)
            return ""

    async def _parse_via_tasks_api(self, file_path: Path) -> str:
        import httpx

        headers = {}
        if self._api_key and self._api_key != "local":
            headers["Authorization"] = f"Bearer {self._api_key}"

        async with httpx.AsyncClient(timeout=120) as client:
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
            resp.raise_for_status()
            data = resp.json()
            task_id = data.get("task_id") or data.get("id") or data.get("batch_id", "")

            if not task_id:
                return ""

            for _ in range(_MAX_POLLS):
                await asyncio.sleep(_POLL_INTERVAL)
                status_resp = await client.get(
                    f"{self._base_url}/tasks/{task_id}",
                    headers=headers,
                )
                status_data = status_resp.json()
                status = status_data.get("status", "")

                if status in ("done", "completed", "success"):
                    return self._extract_markdown_from_result(status_data, client)
                if status in ("failed", "error"):
                    error_msg = status_data.get("error", "unknown error")
                    logger.error("MinerU task %s failed: %s", task_id, error_msg)
                    return ""

            return ""

    async def _parse_via_legacy_api(self, file_path: Path) -> str:
        import httpx

        headers = {}
        if self._api_key and self._api_key != "local":
            headers["Authorization"] = f"Bearer {self._api_key}"

        async with httpx.AsyncClient(timeout=120) as client:
            with open(file_path, "rb") as f:
                resp = await client.post(
                    f"{self._base_url}/file-urls/batch",
                    headers=headers,
                    files=[("files", (file_path.name, f))],
                )
            resp.raise_for_status()
            data = resp.json()
            batch_id = data.get("batch_id", "")

            for _ in range(_MAX_POLLS):
                await asyncio.sleep(_POLL_INTERVAL)
                status_resp = await client.get(
                    f"{self._base_url}/file-urls/batch/{batch_id}",
                    headers=headers,
                )
                status_data = status_resp.json()
                if status_data.get("status") == "done":
                    content_url = ""
                    for item in status_data.get("results", []):
                        if item.get("file_name", "").endswith(".md"):
                            content_url = item.get("url", "")
                            break
                    if content_url:
                        content_resp = await client.get(content_url)
                        return content_resp.text
                    break
                if status_data.get("status") == "failed":
                    logger.error("MinerU batch %s failed", batch_id)
                    break

        return "[MinerU: timeout or no markdown result]"

    def _extract_markdown_from_result(self, status_data: dict, client) -> str:
        results = status_data.get("results", [])
        if isinstance(results, list):
            for item in results:
                if isinstance(item, dict):
                    url = item.get("url", "") or item.get("full_zip_url", "")
                    if url and item.get("file_name", "").endswith(".md"):
                        resp = client.get(url)
                        return resp.text

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