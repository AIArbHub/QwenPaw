# -*- coding: utf-8 -*-
"""
AI Arb 批量文档处理器
支持多文件并发处理、进度跟踪和结果聚合
"""

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional, Callable
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, field

from ..utils.logging import logger


class BatchTaskStatus(Enum):
    """批量任务状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIALLY_COMPLETED = "partially_completed"
    CANCELLED = "cancelled"


@dataclass
class BatchItem:
    """批量处理条目"""
    item_id: str
    file_path: str
    status: str = "pending"
    progress: float = 0.0
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None


@dataclass
class BatchTask:
    """批量处理任务"""
    task_id: str
    task_name: str
    items: List[BatchItem] = field(default_factory=list)
    status: BatchTaskStatus = BatchTaskStatus.PENDING
    progress: float = 0.0
    created_at: str = ""
    completed_at: Optional[str] = None
    options: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_name": self.task_name,
            "status": self.status.value,
            "progress": self.progress,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "total_items": len(self.items),
            "completed_items": len([i for i in self.items if i.status == "completed"]),
            "failed_items": len([i for i in self.items if i.status == "failed"]),
            "pending_items": len([i for i in self.items if i.status == "pending"]),
            "items": [
                {
                    "item_id": i.item_id,
                    "file_path": i.file_path,
                    "status": i.status,
                    "progress": i.progress,
                    "error": i.error
                }
                for i in self.items
            ],
            "error": self.error
        }


class BatchProcessor:
    """
    批量文档处理器
    支持并发处理多个文档，实时进度跟踪
    """

    def __init__(self, max_concurrent: int = 3):
        self.max_concurrent = max_concurrent
        self._tasks: Dict[str, BatchTask] = {}
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._subscribers: Dict[str, List[Callable]] = {}

    async def create_batch_task(
        self,
        file_paths: List[str],
        task_name: str = "批量处理",
        options: Dict[str, Any] = None
    ) -> str:
        """创建批量处理任务"""
        task_id = f"batch_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"
        
        items = [
            BatchItem(
                item_id=f"{task_id}_item_{i}",
                file_path=fp
            )
            for i, fp in enumerate(file_paths)
        ]
        
        task = BatchTask(
            task_id=task_id,
            task_name=task_name,
            items=items,
            created_at=datetime.now().isoformat(),
            options=options or {}
        )
        
        self._tasks[task_id] = task
        logger.info(f"创建批量任务: {task_id}, 包含 {len(items)} 个文件")
        
        return task_id

    async def start_batch_task(
        self,
        task_id: str,
        parse_func: Callable[[str, Dict[str, Any]], Any]
    ) -> bool:
        """启动批量处理任务"""
        task = self._tasks.get(task_id)
        if not task:
            return False
        
        task.status = BatchTaskStatus.RUNNING
        
        async def process_item(item: BatchItem):
            """处理单个文件"""
            async with self._semaphore:
                item.status = "running"
                item.start_time = datetime.now().isoformat()
                self._notify(task_id)
                
                try:
                    # 验证文件存在
                    if not Path(item.file_path).exists():
                        raise FileNotFoundError(f"文件不存在: {item.file_path}")
                    
                    # 执行解析
                    item.progress = 30.0
                    self._notify(task_id)
                    
                    result = await parse_func(item.file_path, task.options)
                    
                    item.result = result.to_dict() if hasattr(result, 'to_dict') else result
                    item.progress = 100.0
                    item.status = "completed"
                    item.end_time = datetime.now().isoformat()
                    
                    logger.info(f"批量项完成: {item.item_id}")
                    
                except Exception as e:
                    item.status = "failed"
                    item.error = str(e)
                    item.end_time = datetime.now().isoformat()
                    logger.error(f"批量项失败: {item.item_id} - {e}")
                
                self._notify(task_id)
        
        # 并发处理所有文件
        tasks = [process_item(item) for item in task.items]
        await asyncio.gather(*tasks)
        
        # 更新任务状态
        completed = len([i for i in task.items if i.status == "completed"])
        failed = len([i for i in task.items if i.status == "failed"])
        
        if failed == 0:
            task.status = BatchTaskStatus.COMPLETED
        elif completed > 0:
            task.status = BatchTaskStatus.PARTIALLY_COMPLETED
        else:
            task.status = BatchTaskStatus.FAILED
        
        task.progress = (completed / len(task.items)) * 100
        task.completed_at = datetime.now().isoformat()
        self._notify(task_id)
        
        logger.info(f"批量任务完成: {task_id}, 成功 {completed}, 失败 {failed}")
        return True

    async def cancel_batch_task(self, task_id: str) -> bool:
        """取消批量任务"""
        task = self._tasks.get(task_id)
        if not task:
            return False
        
        task.status = BatchTaskStatus.CANCELLED
        task.completed_at = datetime.now().isoformat()
        
        # 标记所有未完成项为已取消
        for item in task.items:
            if item.status in ("pending", "running"):
                item.status = "cancelled"
        
        self._notify(task_id)
        return True

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务状态"""
        task = self._tasks.get(task_id)
        if not task:
            return None
        
        task.progress = (
            len([i for i in task.items if i.status == "completed"]) / 
            max(len(task.items), 1)
        ) * 100
        
        return task.to_dict()

    def get_task_result(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务结果"""
        task = self._tasks.get(task_id)
        if not task:
            return None
        
        results = []
        for item in task.items:
            if item.result:
                results.append({
                    "file_path": item.file_path,
                    "file_name": Path(item.file_path).name,
                    "status": item.status,
                    "result": item.result,
                    "error": item.error
                })
        
        return {
            "task_id": task_id,
            "status": task.status.value,
            "total_files": len(task.items),
            "processed_files": len(results),
            "results": results
        }

    def list_tasks(self, status: Optional[BatchTaskStatus] = None) -> List[Dict[str, Any]]:
        """列出所有批量任务"""
        tasks = list(self._tasks.values())
        if status:
            tasks = [t for t in tasks if t.status == status]
        
        # 按创建时间倒序
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        return [t.to_dict() for t in tasks]

    def subscribe(self, task_id: str, callback: Callable[[str, Dict], None]):
        """订阅任务进度更新"""
        if task_id not in self._subscribers:
            self._subscribers[task_id] = []
        self._subscribers[task_id].append(callback)

    def unsubscribe(self, task_id: str, callback: Callable):
        """取消订阅"""
        if task_id in self._subscribers:
            try:
                self._subscribers[task_id].remove(callback)
            except ValueError:
                pass

    def _notify(self, task_id: str):
        """通知订阅者"""
        status = self.get_task_status(task_id)
        if not status:
            return
        
        callbacks = self._subscribers.get(task_id, [])
        for callback in callbacks:
            try:
                callback(task_id, status)
            except Exception as e:
                logger.error(f"批量任务通知失败: {e}")

    async def export_results(
        self,
        task_id: str,
        output_dir: str,
        format: str = "json"
    ) -> str:
        """导出批量处理结果"""
        task = self._tasks.get(task_id)
        if not task:
            raise ValueError(f"任务不存在: {task_id}")
        
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        if format == "json":
            export_file = output_path / f"{task_id}_results.json"
            results = self.get_task_result(task_id)
            with open(export_file, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
        
        elif format == "txt":
            export_file = output_path / f"{task_id}_results.txt"
            results = self.get_task_result(task_id)
            
            lines = [
                f"AI Arb 批量处理报告",
                f"任务ID: {task_id}",
                f"任务名称: {task.task_name}",
                f"创建时间: {task.created_at}",
                f"完成时间: {task.completed_at or '进行中'}",
                f"总文件数: {results['total_files']}",
                f"已处理: {results['processed_files']}",
                "=" * 60,
                ""
            ]
            
            for r in results["results"]:
                lines.append(f"文件: {r['file_name']}")
                lines.append(f"状态: {r['status']}")
                if r.get("error"):
                    lines.append(f"错误: {r['error']}")
                if r.get("result", {}).get("text"):
                    lines.append(f"内容预览: {r['result']['text'][:200]}...")
                lines.append("-" * 40)
            
            with open(export_file, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
        
        else:
            raise ValueError(f"不支持的导出格式: {format}")
        
        logger.info(f"结果已导出: {export_file}")
        return str(export_file)


# 全局批量处理器实例
batch_processor = BatchProcessor(max_concurrent=3)
