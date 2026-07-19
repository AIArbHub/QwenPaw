#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import logging
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path

from . import LocalComponent, ParseResult

# 配置日志
logger = logging.getLogger(__name__)


class RedactionComponent(LocalComponent):
    """
    本地脱敏组件 - 正则表达式版本
    
    该组件负责使用预定义的正则表达式模式对文档中的敏感信息进行脱敏处理，
    支持身份证号、手机号、邮箱、银行卡号、姓名等多种敏感信息的自动识别和替换。
    
    主要功能：
    1. 使用正则表达式识别敏感信息
    2. 提供多种脱敏策略（掩码、哈希、替代）
    3. 支持自定义脱敏规则
    4. 保持文档结构完整性
    5. 生成脱敏报告
    """
    
    # 组件元数据
    component_name = "redaction_regex"
    component_version = "1.0.0"
    component_author = "AI Arbitration System Team"
    component_description = "基于正则表达式的本地文档脱敏组件"
    
    # 依赖配置 - 本地组件通常没有外部依赖
    dependencies = []
    optional_dependencies = []
    
    def __init__(self):
        """初始化脱敏组件"""
        super().__init__(
            component_id="redaction_local",
            name="本地脱敏组件",
            description="基于正则表达式的本地文档脱敏处理",
            install_size_mb=0.0
        )
        self.redaction_patterns = self._get_default_patterns()
        self.redaction_strategies = {
            'mask': self._mask_redaction,
            'hash': self._hash_redaction,
            'replace': self._replace_redaction
        }
        self.applied_redactions = []
    
    # ── 抽象方法实现 ──────────────────────────────────────────
    
    async def initialize(self, manager=None) -> bool:
        """初始化组件 - 脱敏组件无需额外安装"""
        self.is_installed = True
        self.is_enabled = True
        return True
    
    async def parse_document(self, file_path: str, options: Dict[str, Any] = None) -> ParseResult:
        """对文档内容执行脱敏处理"""
        options = options or {}
        text = options.get("text", "")
        markdown = options.get("markdown", "")
        
        redacted_text = self._apply_redaction_to_text(text)
        redacted_markdown = self._apply_redaction_to_text(markdown) if markdown else ""
        
        return ParseResult(
            text=redacted_text,
            markdown=redacted_markdown,
            metadata={
                "redacted": True,
                "applied_count": len(self.applied_redactions)
            },
            engine_info={
                "engine": "redaction_local",
                "document_type": "redacted"
            }
        )
    
    async def get_capabilities(self) -> Dict[str, Any]:
        return {
            "supported_formats": ["text", "markdown"],
            "features": ["regex_redaction", "mask", "hash", "replace"]
        }
    
    async def install(self) -> bool:
        self.is_installed = True
        return True
    
    async def uninstall(self) -> bool:
        self.is_installed = False
        return True
    
    async def check_dependencies(self) -> bool:
        return True  # 仅需标准库 re
    
    def _apply_redaction_to_text(self, text: str) -> str:
        """对文本应用所有脱敏规则"""
        if not text:
            return text
        self.applied_redactions = []
        for pattern_name, pattern_info in self.redaction_patterns.items():
            pattern = pattern_info.get('pattern', '')
            replacement = pattern_info.get('replacement', '***REDACTED***')
            strategy_name = pattern_info.get('strategy', 'mask')
            strategy = self.redaction_strategies.get(strategy_name, self._mask_redaction)
            text, count = strategy(text, pattern, replacement)
            if count > 0:
                self.applied_redactions.append({
                    'pattern_name': pattern_name,
                    'count': count
                })
        return text
    
    def _get_default_patterns(self) -> Dict[str, Dict[str, Any]]:
        """
        获取默认的脱敏正则表达式模式
        
        返回:
            Dict[str, Dict[str, Any]]: 脱敏模式字典，包含pattern、replacement等信息
        """
        return {
            # 身份证号码 (支持18位和15位)
            'id_card': {
                'pattern': r'\\b\\d{18}\\b|\\b\\d{17}X\\b|\\b\\d{15}\\b',
                'description': '身份证号',
                'replacement': '***ID***',
                'strategy': 'mask'
            },
            
            # 手机号码 (1开头11位数字)
            'phone': {
                'pattern': r'\\b1[3-9]\\d{9}\\b',
                'description': '手机号码',
                'replacement': '***PHONE***',
                'strategy': 'mask'
            },
            
            # 邮箱地址
            'email': {
                'pattern': r'\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
                'description': '邮箱地址',
                'replacement': '***EMAIL***',
                'strategy': 'mask'
            },
            
            # 银行卡号 (13-19位数字)
            'bank_card': {
                'pattern': r'\\b\\d{13,19}\\b',
                'description': '银行卡号',
                'replacement': '***BANK***',
                'strategy': 'mask'
            },
            
            # 中文姓名 (2-4个中文字符)
            'chinese_name': {
                'pattern': r'\\b[\\u4e00-\\u9fa5]{2,4}\\b',
                'description': '中文姓名',
                'replacement': '**',
                'strategy': 'mask'
            },
            
            # 地址信息 (简单匹配)
            'address': {
                'pattern': r'[\\u4e00-\\u9fa5]+(?:省|市|区|县|镇|街道|路|号)',
                'description': '地址信息',
                'replacement': '***ADDRESS***',
                'strategy': 'mask'
            },
            
            # 组织机构号码 (社会信用统一代码)
            'org_code': {
                'pattern': r'\\b[0-9A-HJ-NPQRTUWXY]{2}\\d{6}[0-9A-HJ-NPQRTUWXY]{10}\\b',
                'description': '组织机构代码',
                'replacement': '***ORG***',
                'strategy': 'mask'
            }
        }
    
    def initialize(self) -> bool:
        """
        初始化脱敏组件
        
        Returns:
            bool: 初始化成功返回True，否则返回False
        """
        try:
            # 检查基础环境
            logger.info("正在初始化脱敏组件...")
            
            # 验证正则表达式模式
            for pattern_name, pattern_info in self.redaction_patterns.items():
                try:
                    re.compile(pattern_info['pattern'])
                except re.error as e:
                    logger.error(f"正则表达式模式 '{pattern_name}' 编译失败: {e}")
                    return False
            
            logger.info("脱敏组件初始化成功")
            return True
            
        except Exception as e:
            logger.error(f"脱敏组件初始化失败: {e}")
            return False
    
    def parse(self, 
              file_path: str, 
              file_type: str = None,
              custom_patterns: Optional[Dict] = None,
              strategy: str = 'mask',
              preserve_structure: bool = True,
              **kwargs) -> ParseResult:
        """
        执行文档脱敏处理
        
        Args:
            file_path: 文件路径
            file_type: 文件类型 (txt, pdf, docx等)
            custom_patterns: 自定义脱敏规则
            strategy: 脱敏策略 (mask/hash/replace)
            preserve_structure: 是否保持文档结构
            **kwargs: 额外参数
            
        Returns:
            ParseResult: 脱敏处理结果
        """
        try:
            # 获取文件信息
            file_path_obj = Path(file_path)
            
            if not file_path_obj.exists():
                return ParseResult(
                    success=False,
                    data=None,
                    error=f"文件不存在: {file_path}",
                    metadata={'file_path': file_path}
                )
            
            # 合并自定义模式
            patterns = self.redaction_patterns.copy()
            if custom_patterns:
                patterns.update(custom_patterns)
            
            # 读取文件内容
            file_content = self._read_file_content(file_path, file_type)
            if file_content is None:
                return ParseResult(
                    success=False,
                    data=None,
                    error=f"无法读取文件内容: {file_path}",
                    metadata={'file_path': file_path, 'file_type': file_type}
                )
            
            # 执行脱敏处理
            redacted_content, redaction_report = self._redact_content(
                file_content, 
                patterns, 
                strategy,
                preserve_structure
            )
            
            # 创建结果
            result_data = {
                'original_content': file_content if kwargs.get('keep_original', False) else None,
                'redacted_content': redacted_content,
                'redaction_report': redaction_report,
                'file_path': file_path,
                'file_type': file_type,
                'preserve_structure': preserve_structure
            }
            
            # 保存脱敏后的文件（如果指定了输出路径）
            output_path = kwargs.get('output_path')
            if output_path:
                self._write_file_content(output_path, redacted_content, file_type)
                result_data['output_path'] = output_path
            
            return ParseResult(
                success=True,
                data=result_data,
                metadata={
                    'file_path': file_path,
                    'file_type': file_type,
                    'redaction_count': len(redaction_report['applied_redactions']),
                    'patterns_used': list(patterns.keys()),
                    'strategy': strategy
                }
            )
            
        except Exception as e:
            logger.error(f"文档脱敏处理失败: {e}", exc_info=True)
            return ParseResult(
                success=False,
                data=None,
                error=f"脱敏处理失败: {e}",
                metadata={'file_path': file_path}
            )
    
    def _read_file_content(self, file_path: str, file_type: str = None) -> Optional[str]:
        """
        读取文件内容
        
        Args:
            file_path: 文件路径
            file_type: 文件类型
            
        Returns:
            Optional[str]: 文件内容，读取失败返回None
        """
        try:
            path_obj = Path(file_path)
            
            if file_type is None:
                file_type = path_obj.suffix.lower()
            
            # 根据文件类型选择读取方式
            if file_type in ['.txt', '.log']:
                with open(file_path, 'r', encoding='utf-8') as f:
                    return f.read()
            
            elif file_type == '.pdf':
                # PDF需要先提取文本，这里返回基础信息
                # 实际应用中应该集成PDF解析
                return f"[PDF内容占位: {file_path}]"
            
            elif file_type == '.docx':
                # DOCX需要先提取文本，这里返回基础信息
                return f"[DOCX内容占位: {file_path}]"
            
            else:
                # 尝试按文本文件读取
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    return f.read()
                    
        except Exception as e:
            logger.error(f"读取文件内容失败: {e}")
            return None
    
    def _redact_content(self, 
                       content: str, 
                       patterns: Dict[str, Dict], 
                       strategy: str,
                       preserve_structure: bool) -> Tuple[str, Dict]:
        """
        对内容进行脱敏处理
        
        Args:
            content: 原始内容
            patterns: 脱敏模式
            strategy: 脱敏策略
            preserve_structure: 是否保持结构
            
        Returns:
            Tuple[str, Dict]: (脱敏后的内容, 脱敏报告)
        """
        redacted_content = content
        applied_redactions = []
        pattern_stats = {}
        
        for pattern_name, pattern_info in patterns.items():
            pattern = pattern_info['pattern']
            description = pattern_info['description']
            base_replacement = pattern_info['replacement']
            pattern_strategy = pattern_info.get('strategy', strategy)
            
            try:
                # 查找所有匹配项
                matches = list(re.finditer(pattern, redacted_content, re.MULTILINE | re.IGNORECASE))
                
                if matches:
                    pattern_count = 0
                    
                    # 逐个处理匹配项
                    for match in matches:
                        matched_text = match.group()
                        start_pos = match.start()
                        end_pos = match.end()
                        
                        # 应用脱敏策略
                        if pattern_strategy in self.redaction_strategies:
                            replacement = self.redaction_strategies[pattern_strategy](matched_text, base_replacement)
                        else:
                            replacement = base_replacement
                        
                        # 记录脱敏信息
                        applied_redactions.append({
                            'pattern': pattern_name,
                            'description': description,
                            'original_text': matched_text if not preserve_structure else matched_text,
                            'replacement': replacement,
                            'position': {'start': start_pos, 'end': end_pos},
                            'strategy': pattern_strategy
                        })
                        
                        pattern_count += 1
                    
                    # 替换处理 - 从后往前替换以保持位置准确
                    for redaction in reversed(applied_redactions[-pattern_count:]):
                        start = redaction['position']['start']
                        end = redaction['position']['end']
                        replacement = redaction['replacement']
                        
                        redacted_content = redacted_content[:start] + replacement + redacted_content[end:]
                        
                        # 调整后续项的位置
                        for other_redaction in applied_redactions[:-pattern_count]:
                            other_start = other_redaction['position']['start']
                            other_end = other_redaction['position']['end']
                            length_diff = len(replacement) - len(redaction['original_text'])
                            
                            if other_start > end:
                                other_redaction['position']['start'] += length_diff
                                other_redaction['position']['end'] += length_diff
                            elif other_start > start and other_end <= end:
                                # 重叠的匹配项需要特殊处理
                                pass
                
                pattern_stats[pattern_name] = len(matches)
                
            except Exception as e:
                logger.error(f"应用脱敏模式 '{pattern_name}' 失败: {e}")
                continue
        
        # 创建脱敏报告
        redaction_report = {
            'total_redactions': len(applied_redactions),
            'pattern_stats': pattern_stats,
            'applied_redactions': applied_redactions,
            'processing_time': None,  # 可以在调用处计算
            'preserved_structure': preserve_structure
        }
        
        return redacted_content, redaction_report
    
    def _mask_redaction(self, text: str, base_replacement: str) -> str:
        """
        掩码脱敏策略
        
        Args:
            text: 原文本
            base_replacement: 基础替换文本
            
        Returns:
            str: 掩码后的文本
        """
        # 对文本进行掩码处理，保留部分字符
        if len(text) <= 2:
            return '*' * len(text)
        elif len(text) <= 4:
            return text[0] + '*' * (len(text) - 2) + text[-1]
        else:
            show_count = min(2, len(text) // 3)
            return text[:show_count] + '*' * (len(text) - 2 * show_count) + text[-show_count:]
    
    def _hash_redaction(self, text: str, base_replacement: str) -> str:
        """
        哈希脱敏策略
        
        Args:
            text: 原文本
            base_replacement: 基础替换文本
            
        Returns:
            str: 哈希后的文本
        """
        try:
            import hashlib
            # 生成MD5哈希
            hash_obj = hashlib.md5(text.encode('utf-8'))
            hash_hex = hash_obj.hexdigest()[:8]
            return f"{base_replacement}_{hash_hex}"
        except Exception:
            # 哈希失败时回退到掩码
            return self._mask_redaction(text, base_replacement)
    
    def _replace_redaction(self, text: str, base_replacement: str) -> str:
        """
        直接替换策略
        
        Args:
            text: 原文本
            base_replacement: 替换文本
            
        Returns:
            str: 替换后的文本
        """
        return base_replacement
    
    def _write_file_content(self, file_path: str, content: str, file_type: str = None) -> bool:
        """
        写入文件内容
        
        Args:
            file_path: 文件路径
            content: 内容
            file_type: 文件类型
            
        Returns:
            bool: 写入成功返回True，否则返回False
        """
        try:
            path_obj = Path(file_path)
            path_obj.parent.mkdir(parents=True, exist_ok=True)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            return True
            
        except Exception as e:
            logger.error(f"写入文件失败: {e}")
            return False
    
    def check_dependencies(self) -> List[str]:
        """
        检查依赖项
        
        Returns:
            List[str]: 缺失的依赖项列表
        """
        missing_dependencies = []
        
        # 本地组件通常没有外部依赖
        # 但这里检查标准库可用性
        try:
            import hashlib
        except ImportError:
            missing_dependencies.append("hashlib")
        
        return missing_dependencies
    
    def get_capabilities(self) -> Dict[str, Any]:
        """
        获取组件能力信息
        
        Returns:
            Dict[str, Any]: 组件能力描述
        """
        return {
            'component_type': 'local',
            'name': self.component_name,
            'version': self.component_version,
            'description': self.component_description,
            'supported_file_types': ['.txt', '.log', '.pdf', '.docx'],  # 理论支持的类型
            'processing_modes': ['mask', 'hash', 'replace'],
            'redaction_patterns': list(self.redaction_patterns.keys()),
            'features': [
                'reg_pattern_matching',
                'multiple_redaction_strategies',
                'custom_pattern_support',
                'structure_preservation',
                'redaction_reporting'
            ],
            'performance_characteristics': {
                'speed': 'high',  # 正则表达式处理速度快
                'memory_usage': 'low',
                'gpu_required': False,
                'network_required': False
            },
            'limitations': [
                'pdf_docx_required_text_extraction',
                'pattern_matching_may_false_positive',
                'chinese_context_awareness_limited'
            ]
        }
    
    @classmethod
    def get_installation_guide(cls) -> Dict[str, str]:
        """
        获取安装指南
        
        Returns:
            Dict[str, str]: 安装指南信息
        """
        return {
            'description': '该组件使用Python标准库，无需额外安装依赖',
            'system_requirements': 'Python 3.7+',
            'installation_steps': [
                '将组件文件放置在组件目录中',
                '在组件管理器中注册组件',
                '初始化组件完成配置'
            ],
            'dependency_notes': '如果需要使用更高级的文本提取功能，建议安装pdfplumber, python-docx等库'
        }


# 创建组件实例
redaction_component = RedactionComponent()

if __name__ == "__main__":
    # 测试代码
    test_file = "test_sample.txt"
    
    # 创建测试文件
    test_content = """
    姓名：张三
    身份证号：110101199001011234
    手机号：13800138000
    邮箱：zhangsan@example.com
    地址：北京市朝阳区建国门外大街1号
    银行卡号：6222022222222222222
    """
    
    with open(test_file, 'w', encoding='utf-8') as f:
        f.write(test_content)
    
    # 测试脱敏组件
    print("测试脱敏组件...")
    result = redaction_component.parse(test_file, strategy='mask')
    
    if result.success:
        print("脱敏成功！")
        print(f"脱敏数量: {result.metadata['redaction_count']}")
        print(f"脱敏后的内容:\\n{result.data['redacted_content']}")
    else:
        print(f"脱敏失败: {result.error}")
    
    # 清理测试文件
    import os
    os.remove(test_file)
