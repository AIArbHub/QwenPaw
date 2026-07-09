# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://mineru.net/api/v4"
_POLL_INTERVAL = 5
_MAX_POLLS = 60


class MinerUParser:
    def __init__(
        self,
        api_key: str = "",
        base_url: str = _DEFAULT_BASE_URL,
    ):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    @property
    def available(self) -> bool:
        return bool(self._api_key)

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
            async with httpx.AsyncClient(timeout=120) as client:
                with open(file_path, "rb") as f:
                    resp = await client.post(
                        f"{self._base_url}/file-urls/batch",
                        headers={"Authorization": f"Bearer {self._api_key}"},
                        files=[("files", (file_path.name, f))],
                    )
                resp.raise_for_status()
                data = resp.json()
                batch_id = data.get("batch_id", "")

                for _ in range(_MAX_POLLS):
                    await asyncio.sleep(_POLL_INTERVAL)
                    status_resp = await client.get(
                        f"{self._base_url}/file-urls/batch/{batch_id}",
                        headers={"Authorization": f"Bearer {self._api_key}"},
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
        except Exception as exc:
            logger.error("MinerU API failed for %s: %s", file_path, exc)
            return ""