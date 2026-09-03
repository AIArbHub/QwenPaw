# -*- coding: utf-8 -*-
"""进程级单例注册表：管理群聊 HITL（Human-in-the-Loop）中挂起的 Future。

数据结构
========
``group_id → {member_id: asyncio.Future[Optional[str]]}``

工作流程
========
1. ``runtime.py`` 在控制点1/2创建 Future，调用 ``set_pending_future`` 注册。
2. ``api.py`` 的 inject 端点调用 ``resolve_pending_future`` 解析 Future，
   传入人工输入的文本。
3. 轮次结束或中断时，``runtime.py`` 调用 ``cleanup_group`` / 
   ``cancel_pending_future`` 清理残留 Future。

设计约束
========
本模块**故意不依赖** FastAPI 或 models.py，因此 ``runtime.py`` 和 
``api.py`` 都可以安全导入它，不会产生循环引用。

单进程假设
========
当前部署使用单个 asyncio worker。如果未来引入多 worker，
需要将此注册表迁移到共享存储（如 Redis）。
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_pending_registry: dict[str, dict[str, asyncio.Future[Optional[str]]]] = {}


def get_pending_future(
    group_id: str,
    member_id: str,
) -> Optional[asyncio.Future[Optional[str]]]:
    """返回指定成员的活跃 pending Future（如有）。"""
    group_map = _pending_registry.get(group_id)
    if group_map is None:
        return None
    return group_map.get(member_id)


def set_pending_future(
    group_id: str,
    member_id: str,
    future: asyncio.Future[Optional[str]],
) -> None:
    """注册一个 Future，供 inject API 后续解析。"""
    if group_id not in _pending_registry:
        _pending_registry[group_id] = {}
    _pending_registry[group_id][member_id] = future


def resolve_pending_future(
    group_id: str,
    member_id: str,
    text: str,
) -> bool:
    """用给定文本解析指定成员的 pending Future。

    返回 True 表示找到并解析了 Future；返回 False 表示未找到
    （轮次可能已经结束——调用方应将文本写入下一轮的上下文）。
    """
    group_map = _pending_registry.get(group_id)
    if group_map is None:
        return False
    future = group_map.get(member_id)
    if future is None or future.done():
        return False
    future.set_result(text)
    del group_map[member_id]
    if not group_map:
        del _pending_registry[group_id]
    return True


def cancel_pending_future(group_id: str, member_id: str) -> None:
    """取消指定成员的 pending Future（用于中断或超时场景）。"""
    group_map = _pending_registry.get(group_id)
    if group_map is None:
        return
    future = group_map.pop(member_id, None)
    if future is not None and not future.done():
        future.cancel()
    if not group_map:
        del _pending_registry[group_id]


def cleanup_group(group_id: str) -> None:
    """清除指定群组的所有 pending Future（用于轮次结束）。"""
    group_map = _pending_registry.pop(group_id, None)
    if group_map is None:
        return
    for future in group_map.values():
        if not future.done():
            future.cancel()
