#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional, Callable, List
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from threading import Thread, Lock
import uuid

# 配置日志
logger = logging.getLogger(__name__)


class ProgressStatus(Enum):
    """进度状态枚举"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ProgressInfo:
    """进度信息数据类"""
    task_id: str
    task_name: str
    status: ProgressStatus
    progress: float  # 0-100
    current_step: str
    total_steps: int
    completed_steps: int
    message: str
    timestamp: str
    details: Dict[str, Any]
    error_message: Optional[str] = None
    estimated_time_remaining: Optional[int] = None  # seconds
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        data = asdict(self)
        data['status'] = self.status.value
        return data


class ProgressTracker:
    """
    进度跟踪器
    
    负责跟踪任务进度的变化，并提供实时推送功能
    支持WebSocket和轮询两种方式
    """
    
    def __init__(self):
        """初始化进度跟踪器"""
        self.tasks: Dict[str, ProgressInfo] = {}
        self.subscribers: Dict[str, List[Callable]] = {}
        self.lock = Lock()
        self.running = False
        
    def create_task(self, 
                   task_name: str, 
                   total_steps: int = 1,
                   initial_details: Optional[Dict[str, Any]] = None) -> str:
        """
        创建新的跟踪任务
        
        Args:
            task_name: 任务名称
            total_steps: 总步骤数
            initial_details: 初始详情
            
        Returns:
            str: 任务ID
        """
        task_id = str(uuid.uuid4())
        
        progress_info = ProgressInfo(
            task_id=task_id,
            task_name=task_name,
            status=ProgressStatus.PENDING,
            progress=0.0,
            current_step="准备中",
            total_steps=total_steps,
            completed_steps=0,
            message="任务已创建",
            timestamp=datetime.now().isoformat(),
            details=initial_details or {},
            estimated_time_remaining=0
        )
        
        with self.lock:
            self.tasks[task_id] = progress_info
            
        logger.info(f"创建进度跟踪任务: {task_id} - {task_name}")
        self._notify_subscribers(task_id, progress_info)
        
        return task_id
    
    def update_progress(self,
                       task_id: str,
                       progress: Optional[float] = None,
                       status: Optional[ProgressStatus] = None,
                       current_step: Optional[str] = None,
                       message: Optional[str] = None,
                       completed_steps: Optional[int] = None,
                       details: Optional[Dict[str, Any]] = None,
                       estimated_time: Optional[int] = None,
                       error_message: Optional[str] = None) -> bool:
        """
        更新任务进度
        
        Args:
            task_id: 任务ID
            progress: 进度百分比 (0-100)
            status: 任务状态
            current_step: 当前步骤描述
            message: 进度消息
            completed_steps: 已完成步骤数
            details: 详细信息
            estimated_time: 预估剩余时间（秒）
            error_message: 错误消息
            
        Returns:
            bool: 更新成功返回True，否则返回False
        """
        with self.lock:
            if task_id not in self.tasks:
                logger.warning(f"任务不存在: {task_id}")
                return False
            
            task = self.tasks[task_id]
            
            # 保存之前的状态用于比较
            old_progress = task.progress
            old_status = task.status
            
            # 更新字段
            if progress is not None:
                task.progress = max(0.0, min(100.0, float(progress)))
            if status is not None:
                task.status = status
            if current_step is not None:
                task.current_step = current_step
            if message is not None:
                task.message = message
            if completed_steps is not None:
                task.completed_steps = completed_steps
            if details is not None:
                task.details.update(details)
            if estimated_time is not None:
                task.estimated_time_remaining = estimated_time
            if error_message is not None:
                task.error_message = error_message
                
            # 更新进度百分比（如果没有直接指定，根据完成步骤计算）
            if progress is None and task.total_steps > 0:
                task.progress = (task.completed_steps / task.total_steps) * 100
            
            task.timestamp = datetime.now().isoformat()
            
            # 检查是否有实际变化
            has_changes = (
                old_progress != task.progress or
                old_status != task.status or
                message is not None or
                details is not None
            )
            
        if has_changes:
            logger.debug(f"更新任务进度: {task_id} - {task.progress}%")
            self._notify_subscribers(task_id, task)
            
        return True
    
    def get_task(self, task_id: str) -> Optional[ProgressInfo]:
        """
        获取任务进度信息
        
        Args:
            task_id: 任务ID
            
        Returns:
            Optional[ProgressInfo]: 任务进度信息，不存在返回None
        """
        with self.lock:
            return self.tasks.get(task_id)
    
    def list_tasks(self, status: Optional[ProgressStatus] = None) -> List[ProgressInfo]:
        """
        列出所有任务
        
        Args:
            status: 过滤状态，None表示返回所有
            
        Returns:
            List[ProgressInfo]: 任务列表
        """
        with self.lock:
            tasks = list(self.tasks.values())
            
        if status:
            tasks = [t for t in tasks if t.status == status]
            
        return tasks
    
    def complete_task(self, task_id: str, message: str = "任务完成", details: Optional[Dict[str, Any]] = None) -> bool:
        """
        标记任务为完成
        
        Args:
            task_id: 任务ID
            message: 完成消息
            details: 详细信息
            
        Returns:
            bool: 成功返回True，否则返回False
        """
        return self.update_progress(
            task_id=task_id,
            status=ProgressStatus.COMPLETED,
            progress=100.0,
            current_step="完成",
            message=message,
            completed_steps=self.get_task(task_id).total_steps if self.get_task(task_id) else 1,
            estimated_time=0,
            details=details
        )
    
    def fail_task(self, task_id: str, error_message: str, details: Optional[Dict[str, Any]] = None) -> bool:
        """
        标记任务为失败
        
        Args:
            task_id: 任务ID
            error_message: 错误消息
            details: 详细信息
            
        Returns:
            bool: 成功返回True，否则返回False
        """
        return self.update_progress(
            task_id=task_id,
            status=ProgressStatus.FAILED,
            message="任务失败",
            error_message=error_message,
            details=details
        )
    
    def cancel_task(self, task_id: str, message: str = "任务已取消") -> bool:
        """
        取消任务
        
        Args:
            task_id: 任务ID
            message: 取消消息
            
        Returns:
            bool: 成功返回True，否则返回False
        """
        return self.update_progress(
            task_id=task_id,
            status=ProgressStatus.CANCELLED,
            current_step="已取消",
            message=message,
            estimated_time=0
        )
    
    def delete_task(self, task_id: str) -> bool:
        """
        删除任务
        
        Args:
            task_id: 任务ID
            
        Returns:
            bool: 成功返回True，否则返回False
        """
        with self.lock:
            if task_id in self.tasks:
                del self.tasks[task_id]
                logger.info(f"删除进度跟踪任务: {task_id}")
                return True
            return False
    
    def subscribe(self, task_id: str, callback: Callable[[str, ProgressInfo], None]) -> bool:
        """
        订阅任务进度更新
        
        Args:
            task_id: 任务ID
            callback: 回调函数，参数为(task_id, progress_info)
            
        Returns:
            bool: 成功返回True，否则返回False
        """
        with self.lock:
            if task_id not in self.subscribers:
                self.subscribers[task_id] = []
            
            self.subscribers[task_id].append(callback)
            logger.debug(f"添加进度订阅: {task_id}")
            return True
    
    def unsubscribe(self, task_id: str, callback: Callable) -> bool:
        """
        取消订阅任务进度
        
        Args:
            task_id: 任务ID
            callback: 回调函数
            
        Returns:
            bool: 成功返回True，否则返回False
        """
        with self.lock:
            if task_id in self.subscribers:
                try:
                    self.subscribers[task_id].remove(callback)
                    if not self.subscribers[task_id]:
                        del self.subscribers[task_id]
                    return True
                except ValueError:
                    pass
        return False
    
    def _notify_subscribers(self, task_id: str, progress_info: ProgressInfo):
        """
        通知订阅者进度更新
        
        Args:
            task_id: 任务ID
            progress_info: 进度信息
        """
        subscribers = self.subscribers.get(task_id, [])
        
        for callback in subscribers:
            try:
                callback(task_id, progress_info)
            except Exception as e:
                logger.error(f"订阅回调执行失败 (task_id={task_id}): {e}")


class InstallationProgressManager:
    """
    安装进度管理器
    
    提供完整的组件安装进度跟踪功能，支持实时增量推送
    """
    
    def __init__(self):
        """初始化安装进度管理器"""
        self.tracker = ProgressTracker()
        self.installation_steps = [
            "准备安装",
            "检查系统环境",
            "下载组件",
            "验证依赖",
            "安装依赖",
            "配置组件",
            "启动测试",
            "完成安装"
        ]
    
    def start_installation(self, 
                          component_name: str,
                          component_version: str = "latest",
                          custom_steps: Optional[List[str]] = None,
                          metadata: Optional[Dict[str, Any]] = None) -> str:
        """
        开始安装组件
        
        Args:
            component_name: 组件名称
            component_version: 组件版本
            custom_steps: 自定义步骤
            metadata: 元数据
            
        Returns:
            str: 安装任务ID
        """
        steps = custom_steps or self.installation_steps
        
        # 创建安装任务
        metadata = metadata or {}
        metadata.update({
            'component_name': component_name,
            'component_version': component_version,
            'installation_type': 'component',
            'total_size': 'unknown',
            'requires_network': True,
            'admin_required': False
        })
        
        task_id = self.tracker.create_task(
            task_name=f"安装组件: {component_name}",
            total_steps=len(steps),
            initial_details=metadata
        )
        
        # 立即开始安装
        Thread(target=self._run_installation, args=(task_id, component_name, component_version, steps), daemon=True).start()
        
        return task_id
    
    def _run_installation(self, task_id: str, component_name: str, component_version: str, steps: List[str]):
        """
        执行安装过程
        
        Args:
            task_id: 任务ID
            component_name: 组件名称
            component_version: 组件版本
            steps: 安装步骤
        """
        try:
            # 更新为运行状态
            self.tracker.update_progress(
                task_id=task_id,
                status=ProgressStatus.RUNNING,
                current_step=steps[0],
                message="开始安装流程"
            )
            
            start_time = time.time()
            
            for i, step in enumerate(steps):
                # 检查是否被取消
                current_task = self.tracker.get_task(task_id)
                if current_task and current_task.status == ProgressStatus.CANCELLED:
                    logger.info(f"安装任务被取消: {task_id}")
                    return
                
                # 更新当前步骤
                self.tracker.update_progress(
                    task_id=task_id,
                    current_step=step,
                    completed_steps=i,
                    progress=(i / len(steps)) * 100,
                    message=f"正在执行: {step}",
                    estimated_time=self._estimate_remaining_time(start_time, i, len(steps))
                )
                
                # 模拟执行步骤（在实际应用中，这里是真实的安装逻辑）
                success = self._execute_installation_step(step, component_name, component_version)
                
                if not success:
                    raise Exception(f"步骤失败: {step}")
                
                # 模拟步骤耗时
                step_duration = self._get_step_duration(step)
                time.sleep(step_duration)
                
                # 更新步骤进度
                progress = ((i + 1) / len(steps)) * 100
                
                # 报告子进度
                if "下载" in step or "安装" in step:
                    self._report_sub_progress(task_id, step, progress)
            
            # 完成安装
            self.tracker.complete_task(
                task_id=task_id,
                message=f"{component_name} 安装完成",
                details={}
            )
            
        except Exception as e:
            logger.error(f"安装失败: {task_id} - {e}")
            self.tracker.fail_task(
                task_id=task_id,
                error_message=str(e),
                details={'error_type': type(e).__name__}
            )
    
    def _execute_installation_step(self, step: str, component_name: str, component_version: str) -> bool:
        """
        执行单个安装步骤
        
        Args:
            step: 步骤名称
            component_name: 组件名称
            component_version: 组件版本
            
        Returns:
            bool: 执行成功返回True，否则返回False
        """
        logger.info(f"执行安装步骤: {step} (组件: {component_name})")
        
        try:
            # 这里应该包含真实的组件安装逻辑
            # 例如：检查环境、下载安装包、安装依赖、配置组件等
            
            if step == "准备安装":
                # 准备工作
                return self._prepare_installation(component_name)
                
            elif step == "检查系统环境":
                # 检查系统要求
                return self._check_system_requirements(component_name)
                
            elif step == "下载组件":
                # 下载组件包
                return self._download_component(component_name, component_version)
                
            elif step == "验证依赖":
                # 验证依赖
                return self._validate_dependencies(component_name)
                
            elif step == "安装依赖":
                # 安装依赖
                return self._install_dependencies(component_name)
                
            elif step == "配置组件":
                # 配置组件
                return self._configure_component(component_name)
                
            elif step == "启动测试":
                # 测试组件
                return self._test_component(component_name)
                
            elif step == "完成安装":
                # 完成安装
                return self._finalize_installation(component_name)
                
            else:
                # 自定义步骤
                return self._execute_custom_step(step, component_name)
                
        except Exception as e:
            logger.error(f"步骤执行失败 [{step}]: {e}")
            return False
    
    def _prepare_installation(self, component_name: str) -> bool:
        """准备安装"""
        # 创建必要的目录、检查权限等
        return True
    
    def _check_system_requirements(self, component_name: str) -> bool:
        """检查系统要求"""
        # 检查Python版本、磁盘空间、网络连接等
        return True
    
    def _download_component(self, component_name: str, component_version: str) -> bool:
        """下载组件"""
        # 从包管理器或网络下载组件
        return True
    
    def _validate_dependencies(self, component_name: str) -> bool:
        """验证依赖"""
        # 检查并验证组件依赖
        return True
    
    def _install_dependencies(self, component_name: str) -> bool:
        """安装依赖"""
        # 安装所需的依赖包
        return True
    
    def _configure_component(self, component_name: str) -> bool:
        """配置组件"""
        # 生成配置文件、设置默认配置等
        return True
    
    def _test_component(self, component_name: str) -> bool:
        """测试组件"""
        # 运行组件测试确保能正常工作
        return True
    
    def _finalize_installation(self, component_name: str) -> bool:
        """完成安装"""
        # 注册组件、更新索引等
        return True
    
    def _execute_custom_step(self, step: str, component_name: str) -> bool:
        """执行自定义步骤"""
        # 执行用户定义的安装步骤
        return True
    
    def _get_step_duration(self, step: str) -> float:
        """
        获取步骤模拟耗时
        
        Args:
            step: 步骤名称
            
        Returns:
            float: 耗时（秒）
        """
        # 根据步骤重要性分配不同的模拟耗时
        durations = {
            "准备安装": 0.5,
            "检查系统环境": 1.0,
            "下载组件": 3.0,
            "验证依赖": 1.5,
            "安装依赖": 2.0,
            "配置组件": 1.0,
            "启动测试": 1.5,
            "完成安装": 0.5
        }
        return durations.get(step, 1.0)
    
    def _estimate_remaining_time(self, start_time: float, current_step: int, total_steps: int) -> int:
        """
        估算剩余时间
        
        Args:
            start_time: 开始时间
            current_step: 当前步骤
            total_steps: 总步骤数
            
        Returns:
            int: 预估剩余时间（秒）
        """
        if current_step == 0:
            return 0
            
        elapsed_time = time.time() - start_time
        avg_time_per_step = elapsed_time / current_step
        remaining_steps = total_steps - current_step
        estimated_remaining = avg_time_per_step * remaining_steps
        
        return max(0, int(estimated_remaining))
    
    def _report_sub_progress(self, task_id: str, step: str, main_progress: float):
        """
        报告子进度
        
        Args:
            task_id: 任务ID
            step: 步骤名称
            main_progress: 主进度
        """
        # 为耗时步骤报告更细粒度的子进度
        if "下载" in step:
            # 模拟下载进度
            for i in range(10, 100, 10):
                self.tracker.update_progress(
                    task_id=task_id,
                    progress=main_progress - 0.5 + (i / 100),
                    message=f"{step} - {i}%"
                )
                time.sleep(0.2)
        elif "验证" in step or "安装" in step:
            # 模拟处理进度
            for i in range(25, 100, 25):
                self.tracker.update_progress(
                    task_id=task_id,
                    progress=main_progress - 0.5 + (i / 100),
                    message=f"{step} - {i}%"
                )
                time.sleep(0.1)
    
    def get_installation_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        获取安装状态
        
        Args:
            task_id: 任务ID
            
        Returns:
            Optional[Dict[str, Any]]: 安装状态信息
        """
        task = self.tracker.get_task(task_id)
        if not task:
            return None
            
        return {
            'task_id': task_id,
            'component_name': task.details.get('component_name', 'unknown'),
            'status': task.status.value,
            'progress': task.progress,
            'current_step': task.current_step,
            'message': task.message,
            'completed_steps': task.completed_steps,
            'total_steps': task.total_steps,
            'estimated_time': task.estimated_time_remaining,
            'timestamp': task.timestamp,
            'error_message': task.error_message
        }
    
    def cancel_installation(self, task_id: str) -> bool:
        """
        取消安装
        
        Args:
            task_id: 任务ID
            
        Returns:
            bool: 成功返回True，否则返回False
        """
        return self.tracker.cancel_task(task_id)
    
    def monitor_installation(self, 
                           task_id: str, 
                           callback: Callable[[str, Dict[str, Any]], None],
                           poll_interval: float = 1.0) -> Thread:
        """
        监控安装进度
        
        Args:
            task_id: 任务ID
            callback: 回调函数
            poll_interval: 轮询间隔
            
        Returns:
            Thread: 监控线程
        """
        def monitoring_loop():
            while True:
                status = self.get_installation_status(task_id)
                if status:
                    callback(task_id, status)
                    
                    # 如果任务完成，停止监控
                    if status['status'] in ['completed', 'failed', 'cancelled']:
                        break
                        
                time.sleep(poll_interval)
        
        thread = Thread(target=monitoring_loop, daemon=True)
        thread.start()
        
        return thread


# 全局进度管理器实例
progress_manager = ProgressTracker()
installation_manager = InstallationProgressManager()


if __name__ == "__main__":
    # 测试进度跟踪
    def progress_callback(task_id, progress_info):
        print(f"任务 {task_id}: {progress_info.progress}% - {progress_info.current_step}")
    
    # 创建测试任务
    task_id = progress_manager.create_task("测试任务", total_steps=5)
    progress_manager.subscribe(task_id, progress_callback)
    
    # 模拟进度更新
    progress_manager.update_progress(task_id, progress=20, current_step="步骤1", message="正在处理...")
    time.sleep(1)
    
    progress_manager.update_progress(task_id, progress=40, current_step="步骤2", message="继续处理...")
    time.sleep(1)
    
    progress_manager.update_progress(task_id, progress=60, current_step="步骤3", message="几乎完成...")
    time.sleep(1)
    
    progress_manager.complete_task(task_id, "测试完成")
    
    print(f"最终状态: {progress_manager.get_task(task_id).to_dict()}")
