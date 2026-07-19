# -*- coding: utf-8 -*-
"""
智能路由调度器 - 决定文档处理引擎选择
"""

from __future__ import annotations
from typing import Dict, Any, Optional, List
from enum import Enum
import mimetypes
import os
from pathlib import Path

from ...utils.logging import logger


class EngineStrategy(Enum):
    """引擎策略枚举"""
    LOCAL_ONLY = "local_only"  # 仅本地模式（默认，隐私优先）
    HYBRID = "hybrid"          # 智能混合模式
    CLOUD_ONLY = "cloud_only"  # 仅云端模式


class DocumentType(Enum):
    """文档类型枚举"""
    NATIVE_ELECTRONIC = "native_electronic"  # 原生电子文档
    SCANNED_DOCUMENT = "scanned_document"    # 扫描件
    IMAGE = "image"                          # 图片
    UNKNOWN = "unknown"                      # 未知类型


class RoutingScheduler:
    """
    智能路由调度器
    根据策略、文档类型、组件状态自动选择最佳处理引擎
    """
    
    def __init__(self, component_manager):
        self.component_manager = component_manager
        self.strategy = EngineStrategy.LOCAL_ONLY  # 默认本地优先
        self.default_cloud_engine = "mineru_cloud"  # 默认云端引擎
        
        # 路由缓存，避免重复决策
        self._routing_cache: Dict[str, Dict[str, Any]] = {}
    
    async def set_strategy(self, strategy: EngineStrategy):
        """设置路由策略"""
        self.strategy = strategy
        logger.info(f"路由策略已设置为: {strategy.value}")
    
    async def set_default_cloud_engine(self, engine_id: str):
        """设置默认云端引擎"""
        self.default_cloud_engine = engine_id
        logger.info(f"默认云端引擎已设置为: {engine_id}")
    
    async def route_document(
        self,
        file_path: str,
        document_type: Optional[DocumentType] = None,
        options: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        路由文档处理任务
        返回选择的引擎信息和处理参数
        """
        options = options or {}
        
        # 缓存键
        cache_key = f"{file_path}:{document_type}:{hash(str(options))}"
        if cache_key in self._routing_cache:
            return self._routing_cache[cache_key]
        
        try:
            # 1. 分析文档类型
            if document_type is None:
                document_type = await self._analyze_document_type(file_path)
            
            # 2. 获取策略配置
            user_strategy = options.get("engine_strategy", self.strategy.value)
            try:
                strategy = EngineStrategy(user_strategy)
            except ValueError:
                strategy = self.strategy
            
            # 3. 根据策略和文档类型选择引擎
            routing_result = await self._select_engine(file_path, document_type, strategy, options)
            
            # 4. 缓存结果
            self._routing_cache[cache_key] = routing_result
            
            # 5. 记录路由决策
            await self._log_routing_decision(file_path, document_type, strategy, routing_result)
            
            return routing_result
            
        except Exception as e:
            logger.error(f"文档路由失败: {e}")
            # 降级到基础解析器
            return {
                "engine_id": "basic_parser",
                "engine_type": "local",
                "confidence": 0.5,
                "reason": f"路由异常降级: {str(e)}",
                "options": options
            }
    
    async def _analyze_document_type(self, file_path: str) -> DocumentType:
        """分析文档类型"""
        try:
            file_path_obj = Path(file_path)
            
            # 1. 基于文件扩展名初步判断
            mime_type, _ = mimetypes.guess_type(file_path)
            
            if mime_type:
                if mime_type.startswith('image/'):
                    return DocumentType.IMAGE
                elif mime_type == 'application/pdf':
                    # PDF需要进一步判断是否为扫描件
                    return await self._analyze_pdf_type(file_path)
                elif mime_type in [
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.ms-excel',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                ]:
                    return DocumentType.NATIVE_ELECTRONIC
            
            return DocumentType.UNKNOWN
            
        except Exception as e:
            logger.warning(f"文档类型分析失败，默认为未知类型: {e}")
            return DocumentType.UNKNOWN
    
    async def _analyze_pdf_type(self, file_path: str) -> DocumentType:
        """分析PDF类型（原生电子档 vs 扫描件）"""
        try:
            import fitz  # PyMuPDF
            
            def check_pdf_text():
                """检查PDF是否包含可提取文本"""
                with fitz.open(file_path) as doc:
                    total_text_length = 0
                    page_count = doc.page_count
                    
                    # 检查前几页
                    check_pages = min(3, page_count)
                    
                    for i in range(check_pages):
                        page = doc[i]
                        text = page.get_text()
                        total_text_length += len(text.strip())
                    
                    # 如果有显著文本内容，认为是原生电子档
                    avg_text_per_page = total_text_length / check_pages
                    return avg_text_per_page > 50  # 每页平均50个字符以上
            
            has_text = await asyncio.get_event_loop().run_in_executor(None, check_pdf_text)
            
            if has_text:
                return DocumentType.NATIVE_ELECTRONIC
            else:
                return DocumentType.SCANNED_DOCUMENT
                
        except Exception as e:
            logger.warning(f"PDF类型分析失败，默认为扫描件: {e}")
            return DocumentType.SCANNED_DOCUMENT
    
    async def _select_engine(
        self,
        file_path: str,
        document_type: DocumentType,
        strategy: EngineStrategy,
        options: Dict[str, Any]
    ) -> Dict[str, Any]:
        """选择最佳引擎"""
        
        # 用户强制指定的引擎
        forced_engine = options.get("force_engine")
        if forced_engine:
            return {
                "engine_id": forced_engine,
                "engine_type": "user_forced",
                "confidence": 1.0,
                "reason": "用户强制指定",
                "options": options
            }
        
        installed_components = [c.component_id for c in self.component_manager.get_installed_components()]
        
        if strategy == EngineStrategy.LOCAL_ONLY:
            return await self._select_local_engine(document_type, installed_components, options)
        
        elif strategy == EngineStrategy.HYBRID:
            return await self._select_hybrid_engine(file_path, document_type, installed_components, options)
        
        elif strategy == EngineStrategy.CLOUD_ONLY:
            return await self._select_cloud_engine(document_type, installed_components, options)
        
        else:
            # 默认降级
            return await self._select_local_engine(document_type, installed_components, options)
    
    async def _select_local_engine(
        self,
        document_type: DocumentType,
        installed_components: List[str],
        options: Dict[str, Any]
    ) -> Dict[str, Any]:
        """选择本地引擎"""
        
        # 1. 基础解析器总是可用
        if document_type == DocumentType.NATIVE_ELECTRONIC:
            return {
                "engine_id": "basic_parser",
                "engine_type": "local",
                "confidence": 0.9,
                "reason": "原生电子文档适合基础解析",
                "options": options
            }
        
        # 2. 扫描件需求
        if document_type == DocumentType.SCANNED_DOCUMENT:
            if "ocr_paddle" in installed_components:
                return {
                    "engine_id": "ocr_paddle",
                    "engine_type": "local",
                    "confidence": 0.95,
                    "reason": "高精度OCR已安装",
                    "options": options
                }
            elif "ocr_tesseract" in installed_components:
                return {
                    "engine_id": "ocr_tesseract",
                    "engine_type": "local",
                    "confidence": 0.7,
                    "reason": "轻量OCR可用",
                    "options": options
                }
            else:
                # 无OCR组件，建议安装
                return {
                    "engine_id": "basic_parser", 
                    "engine_type": "local",
                    "confidence": 0.3,
                    "reason": "扫描件需要OCR组件但未安装",
                    "options": options,
                    "suggest_install": ["ocr_tesseract"]
                }
        
        # 3. 图片文档
        if document_type == DocumentType.IMAGE:
            if "ocr_paddle" in installed_components:
                return {
                    "engine_id": "ocr_paddle",
                    "engine_type": "local",
                    "confidence": 0.95,
                    "reason": "图片OCR已安装",
                    "options": options
                }
            elif "ocr_tesseract" in installed_components:
                return {
                    "engine_id": "ocr_tesseract",
                    "engine_type": "local",
                    "confidence": 0.7,
                    "reason": "轻量OCR可用",
                    "options": options
                }
            else:
                return {
                    "engine_id": "basic_parser",
                    "engine_type": "local",
                    "confidence": 0.2,
                    "reason": "图片需要OCR组件但未安装",
                    "options": options,
                    "suggest_install": ["ocr_tesseract"]
                }
        
        # 4. 复杂文档的高级解析
        if options.get("advanced_features", False):
            if "advanced_mineru_local" in installed_components:
                return {
                    "engine_id": "advanced_mineru_local",
                    "engine_type": "local",
                    "confidence": 0.98,
                    "reason": "高级结构化解析已安装",
                    "options": options
                }
        
        # 默认降级到基础解析器
        return {
            "engine_id": "basic_parser",
            "engine_type": "local",
            "confidence": 0.8,
            "reason": "使用基础解析器",
            "options": options
        }
    
    async def _select_hybrid_engine(
        self,
        file_path: str,
        document_type: DocumentType,
        installed_components: List[str],
        options: Dict[str, Any]
    ) -> Dict[str, Any]:
        """选择混合模式引擎"""
        
        # 首先尝试本地引擎选择
        local_result = await self._select_local_engine(document_type, installed_components, options)
        
        # 如果本地引擎置信度足够高，使用本地
        if local_result["confidence"] >= 0.9:
            return local_result
        
        # 本地引擎不足时，考虑云端
        needs_cloud = False
        cloud_reason = ""
        
        if document_type in [DocumentType.SCANNED_DOCUMENT, DocumentType.IMAGE]:
            if not any(ocr in installed_components for ocr in ["ocr_tesseract", "ocr_paddle"]):
                needs_cloud = True
                cloud_reason = "需要OCR但本地组件未安装"
        
        if options.get("advanced_features", False):
            if "advanced_mineru_local" not in installed_components:
                # 检查云端MinerU
                if "advanced_mineru_cloud" in installed_components:
                    needs_cloud = True
                    cloud_reason = "需要高级解析，本地未安装但云端可用"
        
        if needs_cloud and "advanced_mineru_cloud" in installed_components:
            return {
                "engine_id": "advanced_mineru_cloud",
                "engine_type": "cloud",
                "confidence": 0.95,
                "reason": f"云端高级解析: {cloud_reason}",
                "options": options,
                "requires_confirmation": True,  # 需要用户确认
                "estimated_cost": 0.1  # 预估费用
            }
        
        # 回落到本地结果
        return local_result
    
    async def _select_cloud_engine(
        self,
        document_type: DocumentType,
        installed_components: List[str],
        options: Dict[str, Any]
    ) -> Dict[str, Any]:
        """选择云端引擎"""
        
        # 优先MinerU云端
        if "advanced_mineru_cloud" in installed_components:
            return {
                "engine_id": "advanced_mineru_cloud",
                "engine_type": "cloud",
                "confidence": 0.98,
                "reason": "云端高级解析首选",
                "options": options,
                "requires_confirmation": True,
                "estimated_cost": 0.1
            }
        
        # 通用云端OCR
        if "cloud_ocr_general" in installed_components:
            return {
                "engine_id": "cloud_ocr_general",
                "engine_type": "cloud",
                "confidence": 0.9,
                "reason": "通用云端OCR",
                "options": options,
                "requires_confirmation": True,
                "estimated_cost": 0.05
            }
        
        # 无云端组件，降级到本地
        logger.warning("仅云端模式但未安装云端组件，降级到本地处理")
        return await self._select_local_engine(document_type, installed_components, options)
    
    async def _log_routing_decision(
        self,
        file_path: str,
        document_type: DocumentType,
        strategy: EngineStrategy,
        result: Dict[str, Any]
    ):
        """记录路由决策"""
        logger.info(
            f"文档路由: {Path(file_path).name} -> "
            f"类型={document_type.value}, 策略={strategy.value}, "
            f"引擎={result['engine_id']}, 置信度={result['confidence']:.2f}, "
            f"原因={result['reason']}"
        )


__all__ = ['RoutingScheduler', 'EngineStrategy', 'DocumentType']