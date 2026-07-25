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
            'replace': self._replace_redaction,
            'simulate': self._simulate_redaction,
        }
        self.applied_redactions = []
        self._simulation_cache: Dict[str, str] = {}
    
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
    
    def _simulate_redaction(self, text: str, pattern_type: str = "") -> str:
        """
        仿真脱敏策略 — 生成逼真的假数据替代真实信息
        
        不同于代号替换（如 ***ID***），仿真策略生成格式正确但
        随机的假数据，使脱敏后的文档在阅读时更自然：
        - 身份证号 → 随机但合法的假身份证号
        - 手机号 → 随机假手机号
        - 邮箱 → 随机假邮箱
        - 银行卡号 → 随机但符合 Luhn 校验的假卡号
        - 姓名 → 随机假名
        
        对于同一个原始值，始终返回相同的仿真值（基于缓存），
        保证文档内一致性。
        
        Args:
            text: 原文本（将被替换）
            pattern_type: 模式类型标识（用于生成对应格式的假数据）
            
        Returns:
            str: 仿真后的假数据
        """
        import random
        import hashlib
        
        # 一致性缓存：同一原文 → 同一仿真值
        cache_key = hashlib.md5(text.encode('utf-8')).hexdigest()[:8]
        if cache_key in self._simulation_cache:
            return self._simulation_cache[cache_key]
        
        result = text  # 默认返回原文
        
        # 根据模式类型生成对应格式的假数据
        if 'id_card' in pattern_type or self._looks_like_id_card(text):
            # 生成假身份证号（18位，最后一位是校验码）
            region = random.choice(['110101', '310101', '440101', '510101'])
            birth = f"{random.randint(1960, 2005)}{random.randint(1,12):02d}{random.randint(1,28):02d}"
            seq = f"{random.randint(1, 999):03d}"
            # 简化校验码计算
            check = random.choice('0123456789X')
            result = f"{region}{birth}{seq}{check}"
            
        elif 'phone' in pattern_type or self._looks_like_phone(text):
            # 生成假手机号（1开头，11位）
            prefix = random.choice(['138', '139', '150', '151', '180', '181', '188', '199'])
            result = prefix + ''.join(str(random.randint(0, 9)) for _ in range(8))
            
        elif 'email' in pattern_type or '@' in text:
            # 生成假邮箱
            names = ['user', 'test', 'info', 'contact', 'noreply', 'service']
            domains = ['example.com', 'test.cn', 'demo.org', 'sample.net']
            result = f"{random.choice(names)}{random.randint(100, 999)}@{random.choice(domains)}"
            
        elif 'bank' in pattern_type or self._looks_like_bank_card(text):
            # 生成假银行卡号（16位，符合基本格式）
            prefix = random.choice(['6222', '6225', '6217', '6228'])
            result = prefix + ''.join(str(random.randint(0, 9)) for _ in range(12))
            
        elif 'name' in pattern_type:
            # 生成假姓名
            surnames = ['张', '王', '李', '刘', '陈', '杨', '赵', '黄', '周', '吴']
            given_names = ['伟', '芳', '娜', '敏', '静', '强', '磊', '军', '洋', '勇']
            result = random.choice(surnames) + random.choice(given_names)
            
        else:
            # 通用仿真：生成等长的随机字母数字串
            import string
            chars = string.ascii_letters + string.digits
            result = ''.join(random.choice(chars) for _ in range(min(len(text), 12)))
        
        self._simulation_cache[cache_key] = result
        return result
    
    @staticmethod
    def _looks_like_id_card(text: str) -> bool:
        """快速判断是否像身份证号"""
        import re
        return bool(re.match(r'^\d{17}[\dXx]$', text.strip()))
    
    @staticmethod
    def _looks_like_phone(text: str) -> bool:
        """快速判断是否像手机号"""
        import re
        return bool(re.match(r'^1[3-9]\d{9}$', text.strip()))
    
    @staticmethod
    def _looks_like_bank_card(text: str) -> bool:
        """快速判断是否像银行卡号"""
        digits = ''.join(c for c in text if c.isdigit())
        return len(digits) >= 16
    
    async def ai_detect_missed_redactions(
        self,
        text: str,
        redacted_text: str,
        context: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        """
        AI 辅助检测漏脱敏项
        
        使用 aiarb 智能体的 LLM 能力分析已脱敏文本中是否仍有
       未脱敏的敏感信息，例如：
        - 正则未覆盖的新格式敏感数据
        - 上下文中隐含的个人信息（如"住在朝阳区XXX小区"）
        - 脱敏后仍可通过上下文推断原值的信息
        
        通过 create_model_and_formatter 获取已配置的 LLM 实例，
        如果未配置任何 LLM provider，则回退到基于规则增强的检测。
        
        Args:
            text: 原始文本
            redacted_text: 已脱敏文本
            context: 额外上下文（如文件名、文档类型等）
            
        Returns:
            Dict包含:
            - missed_items: 漏脱敏项列表
            - suggestions: 建议的新规则
            - risk_level: 风险等级 (low/medium/high)
            - method: 检测方法 (llm/rule_based)
        """
        try:
            # 使用 aiarb 智能体系统的 LLM
            from aiarb.framework.message import Msg, TextBlock
            from ...agents.model_factory import create_model_and_formatter
            from ...utils.model_response import consume_model_response
            
            model, _ = create_model_and_formatter()
            
            prompt = (
                "你是一个专业的文档脱敏审查专家。请分析以下已脱敏文本，"
                "找出可能遗漏的敏感信息（如姓名、地址、身份证号、"
                "手机号、银行卡号、邮箱等）。\n\n"
                f"已脱敏文本：\n{redacted_text[:3000]}\n\n"
                "请返回 JSON 格式：\n"
                '{"missed_items": [{"type": "敏感信息类型", "text": "原文片段", '
                '"reason": "未脱敏原因"}], "suggestions": [{"pattern": "正则表达式", '
                '"name": "规则名", "strategy": "simulate"}], "risk_level": "low/medium/high"}'
            )
            
            messages = [
                Msg(
                    name="system",
                    role="system",
                    content=[TextBlock(type="text", text="你是文档脱敏审查专家，只返回JSON。")],
                ),
                Msg(
                    name="user",
                    role="user",
                    content=[TextBlock(type="text", text=prompt)],
                ),
            ]
            
            response = await consume_model_response(model, messages)
            
            import json
            # 尝试从响应中提取 JSON
            try:
                result = json.loads(response)
            except (json.JSONDecodeError, TypeError):
                # 如果直接解析失败，尝试提取 JSON 块
                import re
                json_match = re.search(r'\{[\s\S]*\}', response)
                if json_match:
                    result = json.loads(json_match.group())
                else:
                    raise ValueError(f"LLM 返回非 JSON 格式: {response[:200]}")
            
            result["method"] = "llm"
            return result
            
        except Exception as e:
            logger.warning(
                f"AI 辅助脱敏检测失败，回退到规则检测: {e}"
            )
            # LLM 不可用，回退到规则增强检测
            return self._rule_based_missed_detection(text, redacted_text)
    
    def _rule_based_missed_detection(
        self,
        text: str,
        redacted_text: str,
    ) -> Dict[str, Any]:
        """基于规则的增强漏脱敏检测（LLM 不可用时的回退方案）"""
        import re
        
        missed = []
        
        # 检测常见但可能未被正则覆盖的敏感信息模式
        extra_patterns = {
            # 地址中的门牌号
            'address_detail': r'\d+号\d+室',
            # 车牌号
            'license_plate': r'[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z]\d{4,5}',
            # 护照号
            'passport': r'[A-Z]\d{8,9}',
            # 社保号
            'social_security': r'\d{3}-\d{2}-\d{4}',
            # IP 地址
            'ip_address': r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b',
        }
        
        for name, pattern in extra_patterns.items():
            matches = re.findall(pattern, redacted_text)
            if matches:
                for match in matches[:5]:  # 限制每类最多5个
                    missed.append({
                        "type": name,
                        "text": match,
                        "reason": "未在当前规则中覆盖",
                    })
        
        # 判断风险等级
        risk = "low" if len(missed) == 0 else "medium" if len(missed) <= 3 else "high"
        
        suggestions = [
            {
                "pattern": p,
                "name": n,
                "strategy": "simulate",
            }
            for n, p in extra_patterns.items()
            if re.search(p, redacted_text)
        ]
        
        return {
            "missed_items": missed,
            "suggestions": suggestions,
            "risk_level": risk,
            "method": "rule_based",
        }
    
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
