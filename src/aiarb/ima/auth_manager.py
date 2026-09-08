# -*- coding: utf-8 -*-
"""IMA 认证管理器 — 扫码登录与登录态持久化。

流程：
1. 前端调用 ``POST /ima/auth/qrcode`` 获取二维码 URL 和 session_id
2. 前端轮询 ``GET /ima/auth/status/{session_id}`` 检查扫码状态
3. 扫码确认后，后端获取 access_token 并持久化到 ``~/.aiarb/ima/token.json``
4. 后续 IMA API 调用自动携带已保存的 token
5. ``DELETE /ima/auth`` 清除登录态
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# IMA QR login 基础地址
_IMA_QR_BASE = "https://open.imabot.qq.com"

# 认证状态文件
_TOKEN_FILENAME = "ima_token.json"


def _token_file() -> Path:
    """返回 token 持久化文件路径。"""
    from ..constant import WORKING_DIR

    token_dir = WORKING_DIR / "ima"
    token_dir.mkdir(parents=True, exist_ok=True)
    return token_dir / _TOKEN_FILENAME


class IMAAuthManager:
    """IMA 扫码登录与登录态管理。"""

    def __init__(self) -> None:
        self._token: dict[str, Any] | None = None
        self._poll_sessions: dict[str, dict[str, Any]] = {}
        self._load_token()

    # ----------------------------------------------------------------- token

    def _load_token(self) -> None:
        """从磁盘加载已保存的 token。"""
        path = _token_file()
        if not path.is_file():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("access_token"):
                self._token = data
                logger.debug("IMA token loaded from %s", path)
        except Exception:
            logger.warning("Failed to load IMA token", exc_info=True)

    def _save_token(self, token: dict[str, Any]) -> None:
        """持久化 token 到磁盘。"""
        path = _token_file()
        try:
            path.write_text(
                json.dumps(token, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self._token = token
            logger.info("IMA token saved to %s", path)
        except Exception:
            logger.error("Failed to save IMA token", exc_info=True)

    def get_access_token(self) -> str | None:
        """返回当前有效的 access_token，无则返回 None。

        注意：此方法是同步的，不会执行异步 token 刷新。
        如果 token 已过期，返回 None 让上层降级处理。
        """
        if not self._token:
            return None
        token = self._token.get("access_token", "")
        expires_at = float(self._token.get("expires_at", 0))
        if expires_at > 0 and expires_at <= time.time():
            # token 已过期，不在此处执行异步刷新
            return None
        return token if token else None

    def is_authenticated(self) -> bool:
        """检查是否已登录且 token 有效。"""
        return self.get_access_token() is not None

    def has_token(self) -> bool:
        """检查是否有已保存的 token（可能已过期）。"""
        return self._token is not None

    def clear_token(self) -> None:
        """清除登录态。"""
        self._token = None
        path = _token_file()
        try:
            if path.is_file():
                path.unlink()
        except Exception:
            logger.warning("Failed to delete IMA token file", exc_info=True)

    # ------------------------------------------------------------ QR login

    async def start_qr_login(self) -> dict[str, str]:
        """发起扫码登录，返回二维码 URL 和 session_id。

        Returns:
            ``{"qrcode_url": ..., "session_id": ...}``
        """
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{_IMA_QR_BASE}/v1/auth/qr/create",
                json={"platform": "web"},
            )
            resp.raise_for_status()
            data = resp.json()

        session_id = str(data.get("session_id", ""))
        qrcode_url = str(data.get("qrcode_url", ""))

        if not session_id or not qrcode_url:
            raise RuntimeError("IMA QR login: invalid response")

        self._poll_sessions[session_id] = {
            "status": "pending",
            "created_at": time.time(),
        }
        return {"qrcode_url": qrcode_url, "session_id": session_id}

    async def poll_login_status(
        self,
        session_id: str,
    ) -> dict[str, Any]:
        """轮询扫码登录状态。

        Returns:
            ``{"status": "pending"|"scanned"|"confirmed"|"expired",
               "access_token"?: str}``
        """
        session = self._poll_sessions.get(session_id)
        if not session:
            return {"status": "expired", "message": "Unknown session"}

        # 已确认的 session 直接返回
        if session.get("status") == "confirmed":
            token = self.get_access_token()
            return {
                "status": "confirmed",
                "access_token": token or "",
            }

        # 超时（5 分钟）
        if time.time() - session.get("created_at", 0) > 300:
            session["status"] = "expired"
            return {"status": "expired", "message": "Login timeout"}

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{_IMA_QR_BASE}/v1/auth/qr/status",
                params={"session_id": session_id},
            )
            resp.raise_for_status()
            data = resp.json()

        status = str(data.get("status", "pending"))

        if status == "confirmed":
            access_token = str(data.get("access_token", ""))
            refresh_token = str(data.get("refresh_token", ""))
            expires_in = int(data.get("expires_in", 7200))
            if access_token:
                token_data = {
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                    "expires_at": time.time() + expires_in,
                }
                self._save_token(token_data)
                session["status"] = "confirmed"
                return {
                    "status": "confirmed",
                    "access_token": access_token,
                }

        session["status"] = status
        return {"status": status}

    async def _refresh_token(self, refresh_token: str) -> str | None:
        """使用 refresh_token 刷新 access_token。"""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{_IMA_QR_BASE}/v1/auth/token/refresh",
                    json={"refresh_token": refresh_token},
                )
                resp.raise_for_status()
                data = resp.json()
            access_token = str(data.get("access_token", ""))
            if access_token:
                expires_in = int(data.get("expires_in", 7200))
                self._save_token(
                    {
                        "access_token": access_token,
                        "refresh_token": refresh_token,
                        "expires_at": time.time() + expires_in,
                    },
                )
                return access_token
        except Exception:
            logger.warning("Failed to refresh IMA token", exc_info=True)
        return None


# 全局单例
_auth_manager: IMAAuthManager | None = None


def get_auth_manager() -> IMAAuthManager:
    """返回全局 IMA 认证管理器单例。"""
    global _auth_manager
    if _auth_manager is None:
        _auth_manager = IMAAuthManager()
    return _auth_manager
