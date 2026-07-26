# -*- coding: utf-8 -*-
"""定时任务租约机制 — 借鉴 StaffDeck core/lease.py。

在多实例部署中，确保同一 cron job 不会被多个实例同时执行。

租约机制：
- 每个 job 在执行前尝试获取租约
- 租约有 TTL（默认 30 分钟），超时自动释放
- 租约持有者 ID = 实例 ID + job ID
- 获取失败时跳过执行（已有其他实例在处理）
"""

from __future__ import annotations

import logging
import os
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

# 默认租约 TTL（秒）
DEFAULT_LEASE_TTL_SECONDS = 30 * 60  # 30 分钟
# 获取租约的默认重试间隔（秒）
DEFAULT_RETRY_INTERVAL_SECONDS = 0.5
# 获取租约的最大重试次数
DEFAULT_MAX_RETRIES = 3


def _generate_instance_id() -> str:
    """生成实例 ID。"""
    hostname = socket.gethostname() or "unknown"
    pid = os.getpid()
    return f"{hostname}:{pid}:{uuid.uuid4().hex[:8]}"


class LeaseInfo:
    """租约信息。"""

    def __init__(
        self,
        job_id: str,
        instance_id: str,
        acquired_at: datetime,
        ttl_seconds: int,
    ):
        self.job_id = job_id
        self.instance_id = instance_id
        self.acquired_at = acquired_at
        self.ttl_seconds = ttl_seconds

    @property
    def expires_at(self) -> datetime:
        return self.acquired_at + timedelta(seconds=self.ttl_seconds)

    @property
    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) > self.expires_at

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "instance_id": self.instance_id,
            "acquired_at": self.acquired_at.isoformat(),
            "ttl_seconds": self.ttl_seconds,
            "expires_at": self.expires_at.isoformat(),
            "is_expired": self.is_expired,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "LeaseInfo":
        acquired_at = datetime.fromisoformat(data["acquired_at"])
        if acquired_at.tzinfo is None:
            acquired_at = acquired_at.replace(tzinfo=timezone.utc)
        return cls(
            job_id=data["job_id"],
            instance_id=data["instance_id"],
            acquired_at=acquired_at,
            ttl_seconds=data["ttl_seconds"],
        )


class LeaseGuard:
    """定时任务租约管理器。

    确保同一 cron job 在多实例环境下不会被同时执行。

    使用内存存储租约（单实例场景足够）。
    多实例场景可扩展为 Redis 或数据库存储。
    """

    def __init__(self):
        self._leases: dict[str, LeaseInfo] = {}
        self._instance_id = _generate_instance_id()

    def try_acquire(
        self,
        job_id: str,
        ttl_seconds: int = DEFAULT_LEASE_TTL_SECONDS,
    ) -> bool:
        """尝试获取租约。

        Args:
            job_id: 任务 ID。
            ttl_seconds: 租约 TTL（秒）。

        Returns:
            True 如果获取成功，False 如果已被其他实例持有。
        """
        now = datetime.now(timezone.utc)

        # 检查现有租约
        existing = self._leases.get(job_id)
        if existing:
            if not existing.is_expired:
                if existing.instance_id == self._instance_id:
                    # 同一实例重复获取，刷新 TTL
                    existing.acquired_at = now
                    existing.ttl_seconds = ttl_seconds
                    logger.debug(
                        "租约刷新: job_id=%s instance=%s",
                        job_id,
                        self._instance_id,
                    )
                    return True
                else:
                    logger.debug(
                        "租约被持有: job_id=%s by %s (过期于 %s)",
                        job_id,
                        existing.instance_id,
                        existing.expires_at.isoformat(),
                    )
                    return False
            else:
                # 租约已过期，清除
                logger.debug(
                    "租约已过期: job_id=%s instance=%s",
                    job_id,
                    existing.instance_id,
                )
                del self._leases[job_id]

        # 获取新租约
        lease = LeaseInfo(
            job_id=job_id,
            instance_id=self._instance_id,
            acquired_at=now,
            ttl_seconds=ttl_seconds,
        )
        self._leases[job_id] = lease
        logger.info(
            "租约获取: job_id=%s instance=%s expires_at=%s",
            job_id,
            self._instance_id,
            lease.expires_at.isoformat(),
        )
        return True

    def release(self, job_id: str) -> bool:
        """释放租约。

        Args:
            job_id: 任务 ID。

        Returns:
            True 如果释放成功。
        """
        existing = self._leases.get(job_id)
        if existing:
            if existing.instance_id == self._instance_id:
                del self._leases[job_id]
                logger.info(
                    "租约释放: job_id=%s instance=%s",
                    job_id,
                    self._instance_id,
                )
                return True
            else:
                logger.warning(
                    "租约释放失败（非持有者）: job_id=%s holder=%s",
                    job_id,
                    existing.instance_id,
                )
                return False
        return True  # 无租约，视为已释放

    def renew(
        self,
        job_id: str,
        ttl_seconds: int = DEFAULT_LEASE_TTL_SECONDS,
    ) -> bool:
        """续租。

        Args:
            job_id: 任务 ID。
            ttl_seconds: 新的 TTL（秒）。

        Returns:
            True 如果续租成功。
        """
        existing = self._leases.get(job_id)
        if existing and existing.instance_id == self._instance_id:
            existing.acquired_at = datetime.now(timezone.utc)
            existing.ttl_seconds = ttl_seconds
            logger.debug(
                "租约续租: job_id=%s expires_at=%s",
                job_id,
                existing.expires_at.isoformat(),
            )
            return True
        return False

    def get_lease(self, job_id: str) -> LeaseInfo | None:
        """获取租约信息。"""
        return self._leases.get(job_id)

    def cleanup_expired(self) -> int:
        """清理所有过期租约。

        Returns:
            清理的租约数量。
        """
        expired_keys = [
            job_id
            for job_id, lease in self._leases.items()
            if lease.is_expired
        ]
        for job_id in expired_keys:
            del self._leases[job_id]
        if expired_keys:
            logger.info(
                "清理过期租约: %d 个 (%s)",
                len(expired_keys),
                expired_keys,
            )
        return len(expired_keys)

    @property
    def instance_id(self) -> str:
        """获取当前实例 ID。"""
        return self._instance_id


# 单例
_lease_guard: LeaseGuard | None = None


def get_lease_guard() -> LeaseGuard:
    """获取 LeaseGuard 单例。"""
    global _lease_guard
    if _lease_guard is None:
        _lease_guard = LeaseGuard()
    return _lease_guard
