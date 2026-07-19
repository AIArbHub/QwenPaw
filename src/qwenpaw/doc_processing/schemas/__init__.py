# -*- coding: utf-8 -*-
"""
文档处理API数据模型
"""

from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field
from datetime import datetime


class ParseRequest(BaseModel):
    """解析请求模型"""
    file_path: str = Field(..., description="文件路径")
    auto_ocr: bool = Field(False, description="是否自动OCR")
    enable_redaction: bool = Field(False, description="是否启用脱敏")
    engine_strategy: str = Field("hybrid", description="引擎策略")
    output_format: str = Field("text", description="输出格式")
    advanced_features: bool = Field(False, description="高级特性")
    auto_confirm_cloud: bool = Field(False, description="自动确认云端处理")
    options: Dict[str, Any] = Field(default_factory=dict, description="其他选项")


class ParseResponse(BaseModel):
    """解析响应模型"""
    success: bool = Field(..., description="是否成功")
    task_id: Optional[str] = Field(None, description="任务ID")
    result: Optional[Dict[str, Any]] = Field(None, description="解析结果")
    error: Optional[str] = Field(None, description="错误信息")
    routing_info: Optional[Dict[str, Any]] = Field(None, description="路由信息")


class TaskStatusResponse(BaseModel):
    """任务状态响应"""
    task_id: str = Field(..., description="任务ID")
    status: str = Field(..., description="任务状态")
    progress: float = Field(0.0, description="进度百分比")
    result: Optional[Dict[str, Any]] = Field(None, description="结果")
    error: Optional[str] = Field(None, description="错误信息")


class ComponentInfo(BaseModel):
    """组件信息模型"""
    component_id: str = Field(..., description="组件ID")
    name: str = Field(..., description="组件名称")
    description: str = Field(..., description="组件描述")
    component_type: str = Field(..., description="组件类型")
    is_installed: bool = Field(..., description="是否已安装")
    is_enabled: bool = Field(..., description="是否已启用")
    version: str = Field("1.0.0", description="版本号")
    install_size_mb: Optional[float] = Field(None, description="安装大小(MB)")
    required_packages: List[str] = Field(default_factory=list, description="依赖包")
    capabilities: Dict[str, Any] = Field(default_factory=dict, description="能力描述")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")


class ComponentInstallRequest(BaseModel):
    """组件安装请求"""
    component_id: str = Field(..., description="组件ID")
    tier: Optional[str] = Field("standard", description="安装档位")
    api_key: Optional[str] = Field(None, description="云端组件API密钥")


class ComponentInstallResponse(BaseModel):
    """组件安装响应"""
    success: bool = Field(..., description="是否成功")
    component_id: str = Field(..., description="组件ID")
    message: Optional[str] = Field(None, description="消息")
    error: Optional[str] = Field(None, description="错误信息")


class CloudConfigRequest(BaseModel):
    """云端配置请求"""
    component_id: str = Field(..., description="组件ID")
    api_key: str = Field(..., description="API密钥")
    base_url: Optional[str] = Field(None, description="基础URL")


class CloudTestResponse(BaseModel):
    """云端连接测试响应"""
    success: bool = Field(..., description="是否成功")
    message: Optional[str] = Field(None, description="消息")
    error: Optional[str] = Field(None, description="错误信息")
    latency: Optional[float] = Field(None, description="延迟(ms)")


class SystemInfo(BaseModel):
    """系统信息模型"""
    platform: str = Field(..., description="操作系统")
    platform_name: str = Field(..., description="平台名称")
    architecture: str = Field(..., description="架构")
    python_version: str = Field(..., description="Python版本")
    total_memory_mb: int = Field(..., description="总内存(MB)")
    available_memory_mb: int = Field(..., description="可用内存(MB)")
    total_disk_mb: int = Field(..., description="总磁盘(MB)")
    free_disk_mb: int = Field(..., description="可用磁盘(MB)")
    cpu_count: int = Field(..., description="CPU核心数")
    gpu_info: Dict[str, Any] = Field(..., description="GPU信息")
    system_deps: Dict[str, bool] = Field(..., description="系统依赖")


class EnvironmentReport(BaseModel):
    """环境报告模型"""
    system_info: SystemInfo = Field(..., description="系统信息")
    hardware_tier: str = Field(..., description="硬件档位")
    recommendations: Dict[str, List[str]] = Field(..., description="推荐组件")
    installed_components: int = Field(..., description="已安装组件数")
    total_components: int = Field(..., description="总组件数")


class ConfigRequest(BaseModel):
    """配置请求模型"""
    default_strategy: Optional[str] = Field(None, description="默认策略")
    default_cloud_engine: Optional[str] = Field(None, description="默认云端引擎")
    max_concurrent_tasks: Optional[int] = Field(None, description="最大并发任务数")
    cache_results: Optional[bool] = Field(None, description="是否缓存结果")


class ConfigResponse(BaseModel):
    """配置响应模型"""
    success: bool = Field(..., description="是否成功")
    config: Dict[str, Any] = Field(..., description="当前配置")
    error: Optional[str] = Field(None, description="错误信息")


__all__ = [
    'ParseRequest',
    'ParseResponse', 
    'TaskStatusResponse',
    'ComponentInfo',
    'ComponentInstallRequest',
    'ComponentInstallResponse',
    'CloudConfigRequest',
    'CloudTestResponse',
    'SystemInfo',
    'EnvironmentReport',
    'ConfigRequest',
    'ConfigResponse',
]