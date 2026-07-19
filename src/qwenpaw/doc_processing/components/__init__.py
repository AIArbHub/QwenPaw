# -*- coding: utf-8 -*-
"""
文档处理组件系统 - 核心架构
基于AI Arb二次开发的文档处理组件模块
"""

from __future__ import annotations
from typing import Dict, Any, Optional, List, TYPE_CHECKING
from abc import ABC, abstractmethod

if TYPE_CHECKING:
    from .component_manager import ComponentManager

# Import ComponentManager for export
from .component_manager import ComponentManager


class ParseResult:
    """统一解析结果格式 - 本地与云端输出对齐"""
    
    def __init__(
        self,
        text: str = "",
        markdown: str = "",
        html: str = "",
        tables: List[Dict[str, Any]] = None,
        structured_data: Dict[str, Any] = None,
        engine_info: Dict[str, Any] = None,
        metadata: Dict[str, Any] = None,
    ):
        self.text = text
        self.markdown = markdown
        self.html = html
        self.tables = tables or []
        self.structured_data = structured_data or {}
        self.engine_info = engine_info or {}
        self.metadata = metadata or {}
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "text": self.text,
            "markdown": self.markdown,
            "html": self.html,
            "tables": self.tables,
            "structured_data": self.structured_data,
            "engine_info": self.engine_info,
            "metadata": self.metadata,
        }


class DocProcessingComponent(ABC):
    """文档处理组件基类 - 所有组件必须继承此类"""
    
    def __init__(self, component_id: str, name: str, description: str):
        self.component_id = component_id
        self.name = name
        self.description = description
        self.is_installed = False
        self.is_enabled = False
        self.version = "1.0.0"
        self.metadata = {}
    
    @abstractmethod
    async def initialize(self, manager: ComponentManager) -> bool:
        """初始化组件"""
        pass
    
    @abstractmethod
    async def parse_document(
        self, 
        file_path: str, 
        options: Dict[str, Any] = None
    ) -> ParseResult:
        """解析文档 - 核心功能接口"""
        pass
    
    @abstractmethod
    async def get_capabilities(self) -> Dict[str, Any]:
        """获取组件能力描述"""
        pass
    
    @abstractmethod
    async def install(self) -> bool:
        """安装组件"""
        pass
    
    @abstractmethod
    async def uninstall(self) -> bool:
        """卸载组件"""
        pass
    
    def get_status(self) -> Dict[str, Any]:
        """获取组件状态"""
        return {
            "component_id": self.component_id,
            "name": self.name,
            "description": self.description,
            "is_installed": self.is_installed,
            "is_enabled": self.is_enabled,
            "version": self.version,
            "metadata": self.metadata,
        }


class LocalComponent(DocProcessingComponent):
    """本地处理组件基类"""
    
    def __init__(
        self, 
        component_id: str, 
        name: str, 
        description: str,
        install_size_mb: float = 0.0
    ):
        super().__init__(component_id, name, description)
        self.install_size_mb = install_size_mb
        self.required_packages: List[str] = []
        self.required_system_deps: List[str] = []
    
    @abstractmethod
    async def check_dependencies(self) -> bool:
        """检查依赖是否满足"""
        pass
    
    async def install(self) -> bool:
        """安装本地组件"""
        try:
            if not await self.check_dependencies():
                return False
            
            # 安装Python依赖
            if self.required_packages:
                success = await self._install_python_packages()
                if not success:
                    return False
            
            # 安装系统依赖
            if self.required_system_deps:
                success = await self._install_system_dependencies()
                if not success:
                    return False
            
            self.is_installed = True
            return True
            
        except Exception as e:
            from ...utils.logging import logger
            logger.error(f"安装本地组件 {self.name} 失败: {e}")
            return False
    
    async def uninstall(self) -> bool:
        """卸载本地组件"""
        try:
            # 卸载Python包
            success = await self._uninstall_python_packages()
            if not success:
                return False
            
            self.is_installed = False
            return True
            
        except Exception as e:
            from ...utils.logging import logger
            logger.error(f"卸载本地组件 {self.name} 失败: {e}")
            return False
    
    async def _install_python_packages(self) -> bool:
        """安装Python包 - 由组件管理器调用pip"""
        # 具体实现在组件管理器中
        return True
    
    async def _install_system_dependencies(self) -> bool:
        """安装系统依赖"""
        # 子类可重写此方法处理特定系统依赖
        return True
    
    async def _uninstall_python_packages(self) -> bool:
        """卸载Python包"""
        return True


class CloudComponent(DocProcessingComponent):
    """云端处理组件基类"""
    
    def __init__(
        self, 
        component_id: str, 
        name: str, 
        description: str,
        base_url: str,
        cost_per_request: float = 0.0
    ):
        super().__init__(component_id, name, description)
        self.base_url = base_url
        self.cost_per_request = cost_per_request
        self.api_key: Optional[str] = None
        self.is_configured = False
    
    async def configure(self, api_key: str) -> bool:
        """配置云端组件"""
        self.api_key = api_key
        self.is_configured = True
        return await self.test_connection()
    
    @abstractmethod
    async def test_connection(self) -> bool:
        """测试云端连接"""
        pass
    
    async def install(self) -> bool:
        """云端组件"安装"实际上是配置"""
        # 云端组件无需安装，只需要配置
        self.is_installed = True
        return True
    
    async def uninstall(self) -> bool:
        """卸载云端组件"""
        self.api_key = None
        self.is_configured = False
        self.is_installed = False
        return True
    
    def get_status(self) -> Dict[str, Any]:
        """获取云端组件状态"""
        status = super().get_status()
        status.update({
            "base_url": self.base_url,
            "is_configured": self.is_configured,
            "cost_per_request": self.cost_per_request,
        })
        return status


__all__ = [
    'ParseResult',
    'DocProcessingComponent', 
    'LocalComponent',
    'CloudComponent',
    'ComponentManager',
]