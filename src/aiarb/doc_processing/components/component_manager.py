# -*- coding: utf-8 -*-
"""
文档处理组件管理器 - 核心管理逻辑
"""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, Optional, List, Type
import importlib.util
import pkg_resources

from ..utils.system_info import SystemInfoDetector
from ...utils.logging import logger


class ComponentManager:
    """
    文档处理组件管理器
    负责组件的注册、安装、卸载、状态检测和环境评估
    """
    
    def __init__(self):
        self._components: Dict[str, 'DocProcessingComponent'] = {}
        self._system_info = SystemInfoDetector()
        self._components_dir = Path(__file__).parent
        self.models_dir = Path.home() / ".ai_arb" / "models"
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self._installation_progress: Dict[str, float] = {}
        self._installation_logs: Dict[str, List[str]] = {}
        self._last_error: Dict[str, str] = {}
    
    async def initialize(self) -> bool:
        """初始化组件管理器"""
        try:
            # 加载系统信息
            await self._system_info.detect()
            
            # 自动发现并注册内置组件
            await self._discover_builtin_components()
            
            # 从配置加载用户组件
            await self._load_user_components()
            
            logger.info("文档处理组件管理器初始化完成")
            return True
            
        except Exception as e:
            logger.error(f"组件管理器初始化失败: {e}")
            return False
    
    async def _discover_builtin_components(self):
        """自动发现内置组件"""
        # 每个组件独立 try-catch，避免一个失败导致全部跳过

        # 基础解析组件
        try:
            from .built_in import BasicParserComponent
            await self.register_component(BasicParserComponent())
        except Exception as e:
            logger.warning(f"注册基础解析组件失败: {e}")

        # Tesseract OCR组件
        try:
            from .ocr_tesseract import TesseractOCRComponent
            await self.register_component(TesseractOCRComponent())
        except Exception as e:
            logger.warning(f"注册Tesseract OCR组件失败: {e}")

        # PaddleOCR组件
        try:
            from .ocr_paddle import paddle_ocr_component
            await self.register_component(paddle_ocr_component)
        except Exception as e:
            logger.warning(f"注册PaddleOCR组件失败: {e}")

        # MinerU本地组件
        try:
            from .mineru_local import mineru_local_component
            await self.register_component(mineru_local_component)
        except Exception as e:
            logger.warning(f"注册MinerU本地组件失败: {e}")

        # MinerU云端组件
        try:
            from .mineru_cloud import mineru_cloud_component
            await self.register_component(mineru_cloud_component)
        except Exception as e:
            logger.warning(f"注册MinerU云端组件失败: {e}")

        # 脱敏组件
        try:
            from .redaction import RedactionComponent
            await self.register_component(RedactionComponent())
        except Exception as e:
            logger.warning(f"注册脱敏组件失败: {e}")

        # 更多云端OCR服务商
        try:
            from .cloud_providers import all_cloud_providers
            for provider in all_cloud_providers:
                await self.register_component(provider)
        except Exception as e:
            logger.warning(f"注册云端OCR服务商失败: {e}")

        logger.info(f"发现并注册了 {len(self._components)} 个内置组件")
    
    async def _load_user_components(self):
        """加载用户自定义组件"""
        # TODO: 实现用户组件加载逻辑
        pass
    
    async def register_component(self, component: 'DocProcessingComponent') -> bool:
        """注册组件"""
        try:
            component_id = component.component_id
            if component_id in self._components:
                logger.warning(f"组件 {component_id} 已存在，跳过注册")
                return False
            
            self._components[component_id] = component
            logger.info(f"成功注册组件: {component_id}")
            return True
            
        except Exception as e:
            logger.error(f"注册组件失败: {e}")
            return False
    
    async def install_component(self, component_id: str, **kwargs) -> bool:
        """安装指定组件"""
        from . import LocalComponent, CloudComponent
        
        if component_id not in self._components:
            logger.error(f"组件 {component_id} 不存在")
            return False
        
        component = self._components[component_id]
        
        # 重置进度和日志
        self._installation_progress[component_id] = 0.0
        self._installation_logs[component_id] = []
        
        try:
            # 检查环境兼容性
            if isinstance(component, LocalComponent):
                compatibility = await self._check_component_compatibility(component)
                if not compatibility["compatible"]:
                    logger.error(f"组件 {component_id} 环境不兼容: {compatibility['reason']}")
                    self._last_error[component_id] = compatibility["reason"]
                    return False
            
            # 执行安装
            if isinstance(component, LocalComponent):
                success = await self._install_local_component(component, **kwargs)
            else:
                success = await self._install_cloud_component(component, **kwargs)
            
            if success:
                logger.info(f"组件 {component_id} 安装成功")
            else:
                logger.error(f"组件 {component_id} 安装失败")
            
            return success
            
        except Exception as e:
            logger.error(f"安装组件 {component_id} 时发生异常: {e}")
            self._last_error[component_id] = str(e)
            return False
        finally:
            # 清理进度
            if component_id in self._installation_progress:
                del self._installation_progress[component_id]
    
    def get_last_error(self, component_id: str) -> str:
        """获取最后一次安装失败的错误信息"""
        return self._last_error.get(component_id, "")
    
    async def _check_component_compatibility(self, component: 'LocalComponent') -> Dict[str, Any]:
        """检查组件环境兼容性"""
        system_info = self._system_info.get_info()
        
        # 如果系统信息为空，跳过兼容性检查（不阻塞安装）
        if not system_info:
            logger.warning("系统信息未检测，跳过兼容性检查")
            return {"compatible": True, "reason": ""}
        
        # 检查内存
        min_memory_mb = component.metadata.get("min_memory_mb", 0)
        total_memory_mb = system_info.get("total_memory_mb", 0)
        if total_memory_mb and total_memory_mb < min_memory_mb:
            return {
                "compatible": False,
                "reason": f"内存不足，需要 {min_memory_mb}MB，当前 {total_memory_mb}MB"
            }
        
        # 检查磁盘空间
        free_disk_mb = system_info.get("free_disk_mb", 0)
        if free_disk_mb and component.install_size_mb and free_disk_mb < component.install_size_mb * 2:
            return {
                "compatible": False, 
                "reason": f"磁盘空间不足，需要 {component.install_size_mb * 2}MB"
            }
        
        # 检查操作系统兼容性
        platform_val = system_info.get("platform", "")
        # Normalize platform names: sys.platform returns 'win32' but components list 'windows'
        platform_normalized = {
            "win32": "windows",
            "darwin": "darwin",
            "linux": "linux",
        }.get(platform_val, platform_val)
        supported_platforms = component.metadata.get("supported_platforms", ["windows", "darwin", "linux"])
        if platform_normalized and platform_normalized not in supported_platforms:
            return {
                "compatible": False,
                "reason": f"不支持的操作系统: {platform_val}"
            }
        
        return {"compatible": True, "reason": ""}
    
    async def _install_local_component(self, component: 'LocalComponent', **kwargs) -> bool:
        """安装本地组件"""
        try:
            # 1. 检查Python依赖
            await self._update_progress(component.component_id, 10.0, "检查依赖...")
            if not await component.check_dependencies():
                await self._update_progress(component.component_id, 20.0, "依赖检查失败")
                self._last_error[component.component_id] = "依赖检查失败，请确保所需 Python 包和系统依赖已安装"
                return False
            
            # 2. 安装Python包
            if component.required_packages:
                await self._update_progress(component.component_id, 30.0, "安装Python依赖包...")
                success = await self._install_python_packages(component.required_packages)
                if not success:
                    self._last_error[component.component_id] = f"Python 包安装失败: {', '.join(component.required_packages)}"
                    return False
            
            # 3. 安装系统依赖
            if component.required_system_deps:
                await self._update_progress(component.component_id, 60.0, "安装系统依赖...")
                success = await component._install_system_dependencies()
                if not success:
                    self._last_error[component.component_id] = f"系统依赖安装失败: {', '.join(component.required_system_deps)}"
                    return False
            
            # 4. 初始化组件
            await self._update_progress(component.component_id, 90.0, "初始化组件...")
            success = await component.initialize(self)
            if not success:
                self._last_error[component.component_id] = "组件初始化失败"
                return False
            
            # 5. 更新状态
            await self._update_progress(component.component_id, 100.0, "安装完成")
            component.is_installed = True
            
            return True
            
        except Exception as e:
            logger.error(f"安装本地组件 {component.name} 失败: {e}")
            self._last_error[component.component_id] = str(e)
            return False
    
    async def _install_cloud_component(self, component: 'CloudComponent', **kwargs) -> bool:
        """安装云端组件"""
        try:
            api_key = kwargs.get("api_key")
            if not api_key:
                api_key = getattr(component, "api_key", None)
            
            if not api_key:
                logger.error(f"云端组件 {component.name} 需要API密钥")
                self._last_error[component.component_id] = "缺少 API 密钥，请先配置 API 密钥"
                return False
            
            await self._update_progress(component.component_id, 50.0, "配置云端连接...")
            success = await component.configure(api_key)
            if not success:
                self._last_error[component.component_id] = "云端连接配置失败，请检查 API 密钥是否正确"
                return False
            
            component.is_installed = True
            await self._update_progress(component.component_id, 100.0, "配置完成")
            
            return True
            
        except Exception as e:
            logger.error(f"配置云端组件 {component.name} 失败: {e}")
            self._last_error[component.component_id] = str(e)
            return False
    
    async def _install_python_packages(self, packages: List[str]) -> bool:
        """使用pip安装Python包"""
        try:
            for i, package in enumerate(packages):
                cmd = [sys.executable, "-m", "pip", "install", "--quiet", package]
                result = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                
                stdout, stderr = await result.communicate()
                
                if result.returncode != 0:
                    error_msg = stderr.decode() if stderr else "未知错误"
                    logger.error(f"安装包 {package} 失败: {error_msg}")
                    return False
                
                logger.debug(f"成功安装包: {package}")
            
            return True
            
        except Exception as e:
            logger.error(f"安装Python包时发生异常: {e}")
            return False
    
    async def uninstall_component(self, component_id: str) -> bool:
        """卸载组件"""
        from . import LocalComponent
        
        if component_id not in self._components:
            logger.error(f"组件 {component_id} 不存在")
            return False
        
        component = self._components[component_id]
        
        try:
            if isinstance(component, LocalComponent):
                success = await component.uninstall()
            else:
                success = await component.uninstall()
            
            if success:
                component.is_installed = False
                logger.info(f"组件 {component_id} 卸载成功")
            
            return success
            
        except Exception as e:
            logger.error(f"卸载组件 {component_id} 失败: {e}")
            return False
    
    async def get_recommended_components(self) -> Dict[str, Any]:
        """根据环境获取推荐的组件安装方案"""
        system_info = self._system_info.get_info()
        recommendations = {
            "light": [],  # 轻量版
            "standard": [],  # 标准版  
            "full": []  # 完整版
        }
        
        # 基础解析总是推荐
        recommendations["light"].append("basic_parser")
        recommendations["standard"].append("basic_parser")
        recommendations["full"].append("basic_parser")
        
        # 根据内存推荐OCR组件
        total_memory_mb = system_info.get("total_memory_mb", 0)
        if total_memory_mb >= 8000:
            recommendations["full"].append("ocr_paddle")
            recommendations["standard"].append("ocr_tesseract")
        elif total_memory_mb >= 4000:
            recommendations["standard"].append("ocr_tesseract")
            recommendations["light"].append("ocr_tesseract")
        else:
            # 内存不足时推荐云端OCR
            recommendations["standard"].append("mineru_cloud")
            recommendations["full"].append("mineru_cloud")
        
        # 高级解析根据存储推荐
        if system_info["free_disk_mb"] >= 10000:  # 10GB
            recommendations["full"].append("advanced_mineru_local")
        else:
            recommendations["standard"].append("advanced_mineru_cloud")
            recommendations["full"].append("advanced_mineru_cloud")
        
        # 脱敏组件
        recommendations["standard"].append("redaction_local")
        recommendations["full"].append("redaction_local")
        
        return recommendations
    
    async def _update_progress(self, component_id: str, progress: float, status: str):
        """更新安装进度"""
        self._installation_progress[component_id] = progress
        if component_id not in self._installation_logs:
            self._installation_logs[component_id] = []
        self._installation_logs[component_id].append(f"{progress:.1f}%: {status}")
        
        logger.debug(f"组件 {component_id} 安装进度: {progress:.1f}% - {status}")
    
    def get_installation_progress(self, component_id: str) -> Optional[Dict[str, Any]]:
        """获取安装进度"""
        if component_id not in self._installation_progress:
            return None
        
        return {
            "component_id": component_id,
            "progress": self._installation_progress[component_id],
            "logs": self._installation_logs.get(component_id, [])[-10:]  # 最近10条日志
        }
    
    def list_components(self) -> List[Dict[str, Any]]:
        """列出所有组件"""
        return [component.get_status() for component in self._components.values()]
    
    def get_component(self, component_id: str) -> Optional['DocProcessingComponent']:
        """获取指定组件"""
        return self._components.get(component_id)
    
    def get_installed_components(self) -> List['DocProcessingComponent']:
        """获取已安装的组件"""
        return [c for c in self._components.values() if c.is_installed]
    
    async def test_cloud_connection(self, component_id: str, api_key: str) -> Dict[str, Any]:
        """测试云端连接"""
        from . import CloudComponent
        
        component = self.get_component(component_id)
        if not component or not isinstance(component, CloudComponent):
            return {"success": False, "error": "组件不存在或不是云端组件"}
        
        try:
            # 临时配置测试
            temp_success = await component.configure(api_key)
            if temp_success:
                return {"success": True, "message": "连接测试成功"}
            else:
                return {"success": False, "error": "连接测试失败"}
        except Exception as e:
            return {"success": False, "error": f"连接测试异常: {str(e)}"}
    
    async def get_environment_report(self) -> Dict[str, Any]:
        """获取环境检测报告"""
        system_info = self._system_info.get_info()
        return {
            "system_info": system_info,
            "recommendations": await self.get_recommended_components(),
            "installed_components": len(self.get_installed_components()),
            "total_components": len(self._components)
        }


# 全局组件管理器实例
_component_manager: Optional[ComponentManager] = None


def get_component_manager() -> ComponentManager:
    """获取全局组件管理器实例"""
    global _component_manager
    if _component_manager is None:
        _component_manager = ComponentManager()
    return _component_manager


async def init_component_manager() -> ComponentManager:
    """初始化全局组件管理器"""
    global _component_manager
    _component_manager = ComponentManager()
    await _component_manager.initialize()
    return _component_manager