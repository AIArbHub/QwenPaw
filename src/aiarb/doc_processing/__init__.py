# -*- coding: utf-8 -*-
"""
AI Arb文档处理组件模块 - DocSDK统一接口层
"""

from __future__ import annotations
from typing import Dict, Any, Optional
import asyncio

from .components import ComponentManager, ParseResult
from .routing import RoutingScheduler, EngineStrategy, DocumentType
from .api.routes import create_doc_processing_router
from .batch_processor import BatchProcessor, batch_processor
from ..utils.logging import logger


class DocParser:
    """
    文档解析统一接口 - DocSDK
    面向AI Arb场景的智能文档处理
    """
    
    _instance = None
    _initialized = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.component_manager: Optional[ComponentManager] = None
        self.routing_scheduler: Optional[RoutingScheduler] = None
        self._processing_tasks: Dict[str, asyncio.Task] = {}
        
        # 全局配置
        self.config = {
            "default_strategy": EngineStrategy.LOCAL_ONLY.value,
            "default_cloud_engine": "mineru_cloud",
            "max_concurrent_tasks": 10,
            "cache_results": True,
            "cache_timeout": 3600,
        }
    
    async def initialize(self) -> bool:
        """初始化DocSDK"""
        try:
            # 初始化组件管理器
            self.component_manager = ComponentManager()
            await self.component_manager.initialize()
            
            # 初始化路由调度器
            self.routing_scheduler = RoutingScheduler(self.component_manager)
            
            logger.info("DocSDK初始化成功")
            self._initialized = True
            return True
            
        except Exception as e:
            logger.error(f"DocSDK初始化失败: {e}")
            return False
    
    @classmethod
    async def parse(
        cls,
        file_path: str,
        auto_ocr: bool = False,
        enable_redaction: bool = False,
        engine_strategy: str = None,
        **kwargs
    ) -> ParseResult:
        """
        解析文档 - 主要API接口
        
        Args:
            file_path: 文件路径
            auto_ocr: 是否自动OCR处理扫描件
            enable_redaction: 是否启用敏感信息脱敏
            engine_strategy: 引擎策略 (local_only/hybrid/cloud_only)
            **kwargs: 其他选项
            
        Returns:
            ParseResult: 解析结果
        """
        instance = cls()
        if not instance._initialized:
            await instance.initialize()
        
        # 构建选项
        options = kwargs.copy()
        options.update({
            "auto_ocr": auto_ocr,
            "enable_redaction": enable_redaction,
            "engine_strategy": engine_strategy or instance.config["default_strategy"],
        })
        
        # 执行解析
        result = await instance._parse_document_with_routing(file_path, options)
        
        return result
    
    async def _parse_document_with_routing(
        self,
        file_path: str,
        options: Dict[str, Any]
    ) -> ParseResult:
        """带路由的文档解析"""
        try:
            # 1. 检查并发限制
            await self._check_concurrent_limit()
            
            # 2. 路由决策
            routing_result = await self.routing_scheduler.route_document(file_path, None, options)
            
            # 3. 检查是否需要用户确认（云端处理）
            if routing_result.get("requires_confirmation", False):
                if not options.get("auto_confirm_cloud", False):
                    raise RuntimeError(
                        f"需要云端处理但需用户确认。引擎: {routing_result['engine_id']}, "
                        f"预估费用: {routing_result.get('estimated_cost', '未知')}"
                    )
            
            # 4. 获取引擎组件
            engine_id = routing_result["engine_id"]
            component = self.component_manager.get_component(engine_id)
            
            if not component:
                raise RuntimeError(f"引擎组件不存在: {engine_id}")
            
            if not component.is_installed:
                # 建议安装
                suggestions = routing_result.get("suggest_install", [])
                if suggestions:
                    # 自动安装第一个建议的组件
                    install_success = await self.component_manager.install_component(suggestions[0])
                    if not install_success:
                        raise RuntimeError(f"建议组件安装失败: {suggestions[0]}")
                    
                    # 重新获取组件
                    component = self.component_manager.get_component(suggestions[0])
                else:
                    raise RuntimeError(f"必需引擎未安装: {engine_id}")
            
            # 5. 执行解析任务
            task_id = f"task_{id(file_path)}_{asyncio.get_running_loop().time()}"
            task = asyncio.create_task(
                self._execute_parse_task(task_id, component, file_path, routing_result, options)
            )
            
            self._processing_tasks[task_id] = task
            
            try:
                result = await task
                return result
            finally:
                # 清理任务
                if task_id in self._processing_tasks:
                    del self._processing_tasks[task_id]
            
        except Exception as e:
            logger.error(f"文档解析失败: {e}")
            raise
    
    async def _execute_parse_task(
        self,
        task_id: str,
        component,
        file_path: str,
        routing_result: Dict[str, Any],
        options: Dict[str, Any]
    ) -> ParseResult:
        """执行具体解析任务"""
        
        try:
            # 调用组件解析
            result = await component.parse_document(file_path, options)
            
            # 添加路由信息
            result.engine_info.update({
                "routing_reason": routing_result.get("reason", ""),
                "routing_confidence": routing_result.get("confidence", 0.0),
                "document_type": routing_result.get("document_type", "unknown"),
            })
            
            # 处理敏感信息脱敏
            if options.get("enable_redaction", False):
                result = await self._apply_redaction(result, file_path)
            
            # 缓存结果
            if self.config["cache_results"]:
                await self._cache_result(file_path, result)
            
            return result
            
        except Exception as e:
            logger.error(f"任务 {task_id} 执行失败: {e}")
            raise
    
    async def _apply_redaction(
        self, 
        result: ParseResult, 
        file_path: str
    ) -> ParseResult:
        """应用敏感信息脱敏"""
        try:
            redaction_component = self.component_manager.get_component("redaction_local")
            if redaction_component and redaction_component.is_installed:
                # 构建脱敏选项
                redaction_options = {
                    "text": result.text,
                    "markdown": result.markdown,
                    "file_path": file_path
                }
                
                # 调用脱敏处理
                redaction_result = await redaction_component.parse_document(
                    file_path, 
                    redaction_options
                )
                
                # 更新结果
                result.text = redaction_result.text
                result.markdown = redaction_result.markdown
                result.metadata["redacted"] = True
            
            return result
            
        except Exception as e:
            logger.warning(f"敏感信息脱敏失败: {e}")
            return result
    
    async def _cache_result(self, file_path: str, result: ParseResult):
        """缓存结果"""
        # TODO: 实现结果缓存机制
        pass
    
    async def _check_concurrent_limit(self):
        """检查并发限制"""
        max_concurrent = self.config.get("max_concurrent_tasks", 10)
        current_count = len(self._processing_tasks)
        
        if current_count >= max_concurrent:
            # 等待一个任务完成
            if self._processing_tasks:
                await asyncio.wait(
                    list(self._processing_tasks.values()),
                    return_when=asyncio.FIRST_COMPLETED
                )
    
    @classmethod
    async def get_environment_report(cls) -> Dict[str, Any]:
        """获取环境报告"""
        instance = cls()
        if not instance._initialized:
            await instance.initialize()
        
        return await instance.component_manager.get_environment_report()
    
    @classmethod
    async def list_components(cls) -> Dict[str, Any]:
        """列出所有组件"""
        instance = cls()
        if not instance._initialized:
            await instance.initialize()
        
        return {
            "components": instance.component_manager.list_components(),
            "strategy": instance.config["default_strategy"],
            "concurrent_tasks": len(instance._processing_tasks),
        }
    
    @classmethod
    async def install_component(cls, component_id: str, **kwargs) -> Dict[str, Any]:
        """安装组件"""
        instance = cls()
        if not instance._initialized:
            await instance.initialize()
        
        success = await instance.component_manager.install_component(component_id, **kwargs)
        
        return {
            "success": success,
            "component_id": component_id
        }
    
    @classmethod
    async def uninstall_component(cls, component_id: str) -> Dict[str, Any]:
        """卸载组件"""
        instance = cls()
        if not instance._initialized:
            await instance.initialize()
        
        success = await instance.component_manager.uninstall_component(component_id)
        
        return {
            "success": success,
            "component_id": component_id
        }
    
    @classmethod
    async def test_cloud_connection(cls, component_id: str, api_key: str) -> Dict[str, Any]:
        """测试云端连接"""
        instance = cls()
        if not instance._initialized:
            await instance.initialize()
        
        return await instance.component_manager.test_cloud_connection(component_id, api_key)
    
    @classmethod
    async def get_installation_progress(cls, component_id: str) -> Optional[Dict[str, Any]]:
        """获取安装进度"""
        instance = cls()
        if not instance._initialized:
            await instance.initialize()
        
        return instance.component_manager.get_installation_progress(component_id)


# 简化的函数式接口 - 面向AI Arb场景
async def parse_document(
    file_path: str,
    auto_ocr: bool = False,
    enable_redaction: bool = False,
    engine_strategy: str = "local_only",
    **kwargs
) -> ParseResult:
    """
    快速文档解析接口
    """
    return await DocParser.parse(
        file_path,
        auto_ocr=auto_ocr,
        enable_redaction=enable_redaction,
        engine_strategy=engine_strategy,
        **kwargs
    )


async def get_doc_environment_info() -> Dict[str, Any]:
    """获取文档处理环境信息"""
    return await DocParser.get_environment_report()


async def install_doc_component(component_id: str, **kwargs) -> Dict[str, Any]:
    """安装文档处理组件"""
    return await DocParser.install_component(component_id, **kwargs)


async def list_doc_components() -> Dict[str, Any]:
    """列出文档处理组件"""
    return await DocParser.list_components()


# 导出主要类
__all__ = [
    'DocParser',
    'ParseResult',
    'EngineStrategy',
    'DocumentType',
    # 便捷函数
    'parse_document',
    'get_doc_environment_info',
    'install_doc_component',
    'list_doc_components',
    # 批量处理
    'BatchProcessor',
    'batch_processor',
]