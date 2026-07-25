# -*- coding: utf-8 -*-
"""
AI Arb 自定义脱敏规则编辑器
支持创建、编辑、测试和管理自定义脱敏规则
"""

import json
import re
import os
import hashlib
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum

from ...utils.logging import logger


class RuleType(Enum):
    """规则类型"""
    REGEX = "regex"
    KEYWORD = "keyword"
    PATTERN = "pattern"


class StrategyType(Enum):
    """脱敏策略"""
    MASK = "mask"          # 掩码 (***REDACTED***)
    HASH = "hash"          # 哈希
    REPLACE = "replace"    # 替换为指定文本
    DELETE = "delete"      # 删除
    PARTIAL_MASK = "partial_mask"  # 部分掩码


@dataclass
class RedactionRule:
    """脱敏规则"""
    rule_id: str
    name: str
    description: str = ""
    rule_type: str = "regex"
    pattern: str = ""
    replacement: str = "***REDACTED***"
    strategy: str = "mask"
    enabled: bool = True
    priority: int = 0  # 优先级，数字越大优先级越高
    tags: List[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    test_samples: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "name": self.name,
            "description": self.description,
            "rule_type": self.rule_type,
            "pattern": self.pattern,
            "replacement": self.replacement,
            "strategy": self.strategy,
            "enabled": self.enabled,
            "priority": self.priority,
            "tags": self.tags,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "test_samples": self.test_samples
        }


class RedactionRuleEditor:
    """
    自定义脱敏规则编辑器
    提供规则的创建、编辑、测试、导入导出等功能
    """

    # 预设规则模板
    PRESET_TEMPLATES = {
        "id_card": {
            "name": "身份证号码",
            "pattern": r"\b\d{18}\b|\b\d{17}X\b|\b\d{15}\b",
            "replacement": "***ID***",
            "strategy": "mask",
            "description": "匹配15位或18位身份证号码"
        },
        "phone": {
            "name": "手机号码",
            "pattern": r"\b1[3-9]\d{9}\b",
            "replacement": "***PHONE***",
            "strategy": "mask",
            "description": "匹配中国大陆手机号码"
        },
        "email": {
            "name": "电子邮箱",
            "pattern": r"\b[\w.-]+@[\w.-]+\.\w+\b",
            "replacement": "***EMAIL***",
            "strategy": "mask",
            "description": "匹配电子邮箱地址"
        },
        "bank_card": {
            "name": "银行卡号",
            "pattern": r"\b\d{16,19}\b",
            "replacement": "***BANK***",
            "strategy": "partial_mask",
            "description": "匹配16-19位银行卡号"
        },
        "passport": {
            "name": "护照号码",
            "pattern": r"\b[A-Z]\d{8}\b|\b[A-Z]{2}\d{7}\b",
            "replacement": "***PASSPORT***",
            "strategy": "mask",
            "description": "匹配中国护照号码"
        },
        "license_plate": {
            "name": "车牌号码",
            "pattern": r"[\u4e00-\u9fa5][A-Z][A-HJ-NP-Z0-9]{5}",
            "replacement": "***PLATE***",
            "strategy": "mask",
            "description": "匹配中国车牌号码"
        },
        "address": {
            "name": "详细地址",
            "pattern": r"[\u4e00-\u9fa5]{2,}(省|市|区|县|镇|乡|村|路|街|号|室|楼|栋|单元)",
            "replacement": "***ADDR***",
            "strategy": "partial_mask",
            "description": "匹配中文地址信息"
        },
        "ipv4": {
            "name": "IP地址",
            "pattern": r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
            "replacement": "***IP***",
            "strategy": "mask",
            "description": "匹配IPv4地址"
        },
        "company_name": {
            "name": "公司名称",
            "pattern": r"[\u4e00-\u9fa5]{2,}(有限公司|股份有限公司|有限责任公司|集团|合伙企业)",
            "replacement": "***COMPANY***",
            "strategy": "mask",
            "description": "匹配公司名称"
        },
        "contract_number": {
            "name": "合同编号",
            "pattern": r"(合同编号|合同号)[：:]\s*[\w-]+",
            "replacement": "***CONTRACT***",
            "strategy": "mask",
            "description": "匹配合同编号"
        }
    }

    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = Path(storage_dir) if storage_dir else Path.home() / ".ai_arb" / "redaction_rules"
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._rules: Dict[str, RedactionRule] = {}
        self._load_rules()

    def _load_rules(self):
        """从磁盘加载规则"""
        rules_file = self.storage_dir / "rules.json"
        if rules_file.exists():
            try:
                with open(rules_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for rule_data in data.get("rules", []):
                        rule = RedactionRule(
                            rule_id=rule_data["rule_id"],
                            name=rule_data["name"],
                            description=rule_data.get("description", ""),
                            rule_type=rule_data.get("rule_type", "regex"),
                            pattern=rule_data.get("pattern", ""),
                            replacement=rule_data.get("replacement", "***REDACTED***"),
                            strategy=rule_data.get("strategy", "mask"),
                            enabled=rule_data.get("enabled", True),
                            priority=rule_data.get("priority", 0),
                            tags=rule_data.get("tags", []),
                            created_at=rule_data.get("created_at", ""),
                            updated_at=rule_data.get("updated_at", ""),
                            test_samples=rule_data.get("test_samples", [])
                        )
                        self._rules[rule.rule_id] = rule
                logger.info(f"加载了 {len(self._rules)} 条脱敏规则")
            except Exception as e:
                logger.warning(f"加载脱敏规则失败: {e}")

    def _save_rules(self):
        """保存规则到磁盘"""
        rules_file = self.storage_dir / "rules.json"
        try:
            data = {
                "rules": [r.to_dict() for r in self._rules.values()]
            }
            with open(rules_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存脱敏规则失败: {e}")

    async def create_rule(
        self,
        name: str,
        pattern: str,
        replacement: str = "***REDACTED***",
        strategy: str = "mask",
        description: str = "",
        tags: List[str] = None,
        test_samples: List[str] = None
    ) -> str:
        """创建新规则"""
        rule_id = f"rule_{datetime.now().strftime('%Y%m%d%H%M%S')}_{len(self._rules)}"
        now = datetime.now().isoformat()

        rule = RedactionRule(
            rule_id=rule_id,
            name=name,
            description=description,
            pattern=pattern,
            replacement=replacement,
            strategy=strategy,
            tags=tags or [],
            created_at=now,
            updated_at=now,
            test_samples=test_samples or []
        )

        self._rules[rule_id] = rule
        self._save_rules()
        logger.info(f"创建脱敏规则: {rule_id} - {name}")
        return rule_id

    async def update_rule(self, rule_id: str, **kwargs) -> bool:
        """更新规则"""
        rule = self._rules.get(rule_id)
        if not rule:
            return False

        for key, value in kwargs.items():
            if hasattr(rule, key):
                setattr(rule, key, value)

        rule.updated_at = datetime.now().isoformat()
        self._save_rules()
        return True

    async def delete_rule(self, rule_id: str) -> bool:
        """删除规则"""
        if rule_id in self._rules:
            del self._rules[rule_id]
            self._save_rules()
            return True
        return False

    async def enable_rule(self, rule_id: str) -> bool:
        """启用规则"""
        return await self.update_rule(rule_id, enabled=True)

    async def disable_rule(self, rule_id: str) -> bool:
        """禁用规则"""
        return await self.update_rule(rule_id, enabled=False)

    async def list_rules(self, tag: Optional[str] = None, enabled_only: bool = False) -> List[Dict[str, Any]]:
        """列出所有规则"""
        rules = list(self._rules.values())
        
        if tag:
            rules = [r for r in rules if tag in r.tags]
        
        if enabled_only:
            rules = [r for r in rules if r.enabled]
        
        # 按优先级排序
        rules.sort(key=lambda r: r.priority, reverse=True)
        return [r.to_dict() for r in rules]

    async def test_rule(self, rule_id: str, test_text: str) -> Dict[str, Any]:
        """测试规则效果"""
        rule = self._rules.get(rule_id)
        if not rule:
            return {"error": "规则不存在"}

        return self._test_pattern(rule.pattern, rule.replacement, rule.strategy, test_text)

    async def test_pattern(
        self,
        pattern: str,
        replacement: str,
        strategy: str,
        test_text: str
    ) -> Dict[str, Any]:
        """测试自定义模式"""
        return self._test_pattern(pattern, replacement, strategy, test_text)

    def _test_pattern(self, pattern: str, replacement: str, strategy: str, test_text: str) -> Dict[str, Any]:
        """测试模式匹配效果"""
        try:
            matches = list(re.finditer(pattern, test_text))
            match_count = len(matches)
            
            # 应用脱敏
            redacted_text = test_text
            matched_items = []
            
            for match in matches:
                original = match.group()
                masked = self._apply_strategy(original, replacement, strategy)
                matched_items.append({
                    "original": original,
                    "redacted": masked,
                    "position": [match.start(), match.end()]
                })
            
            # 重新替换（从后往前避免偏移）
            redacted_text = test_text
            for item in reversed(matched_items):
                start, end = item["position"]
                redacted_text = redacted_text[:start] + item["redacted"] + redacted_text[end:]

            return {
                "success": True,
                "match_count": match_count,
                "matched_items": matched_items,
                "original_text": test_text,
                "redacted_text": redacted_text,
                "pattern": pattern,
                "strategy": strategy
            }

        except re.error as e:
            return {
                "success": False,
                "error": f"正则表达式错误: {e}"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def _apply_strategy(self, text: str, replacement: str, strategy: str) -> str:
        """应用脱敏策略"""
        if strategy == "mask":
            return replacement
        elif strategy == "hash":
            return hashlib.md5(text.encode()).hexdigest()[:16]
        elif strategy == "replace":
            return replacement
        elif strategy == "delete":
            return ""
        elif strategy == "partial_mask":
            # 保留首尾，中间掩码
            if len(text) <= 4:
                return replacement
            return text[:2] + "*" * (len(text) - 4) + text[-2:]
        else:
            return replacement

    async def import_preset(self, preset_name: str) -> Optional[str]:
        """导入预设规则"""
        if preset_name not in self.PRESET_TEMPLATES:
            return None

        template = self.PRESET_TEMPLATES[preset_name]
        rule_id = await self.create_rule(
            name=template["name"],
            pattern=template["pattern"],
            replacement=template["replacement"],
            strategy=template["strategy"],
            description=template["description"],
            tags=["preset"]
        )
        return rule_id

    async def import_all_presets(self) -> List[str]:
        """导入所有预设规则"""
        rule_ids = []
        for name in self.PRESET_TEMPLATES:
            rule_id = await self.import_preset(name)
            if rule_id:
                rule_ids.append(rule_id)
        logger.info(f"导入了 {len(rule_ids)} 条预设规则")
        return rule_ids

    async def export_rules(self, format: str = "json") -> str:
        """导出规则"""
        if format == "json":
            data = {
                "exported_at": datetime.now().isoformat(),
                "rule_count": len(self._rules),
                "rules": [r.to_dict() for r in self._rules.values()]
            }
            return json.dumps(data, ensure_ascii=False, indent=2)
        else:
            raise ValueError(f"不支持的导出格式: {format}")

    async def import_rules(self, rules_json: str, overwrite: bool = False) -> int:
        """导入规则"""
        try:
            data = json.loads(rules_json)
            rules = data.get("rules", [])
            imported = 0

            for rule_data in rules:
                rule_id = rule_data["rule_id"]
                
                if rule_id in self._rules and not overwrite:
                    continue

                rule = RedactionRule(
                    rule_id=rule_id,
                    name=rule_data["name"],
                    description=rule_data.get("description", ""),
                    pattern=rule_data.get("pattern", ""),
                    replacement=rule_data.get("replacement", "***REDACTED***"),
                    strategy=rule_data.get("strategy", "mask"),
                    enabled=rule_data.get("enabled", True),
                    priority=rule_data.get("priority", 0),
                    tags=rule_data.get("tags", []),
                    created_at=rule_data.get("created_at", ""),
                    updated_at=rule_data.get("updated_at", ""),
                    test_samples=rule_data.get("test_samples", [])
                )
                self._rules[rule_id] = rule
                imported += 1

            self._save_rules()
            logger.info(f"导入了 {imported} 条脱敏规则")
            return imported

        except Exception as e:
            logger.error(f"导入规则失败: {e}")
            return 0

    async def get_rule_templates(self) -> List[Dict[str, Any]]:
        """获取预设模板列表"""
        return [
            {
                "key": key,
                **template
            }
            for key, template in self.PRESET_TEMPLATES.items()
        ]

    async def validate_pattern(self, pattern: str) -> Dict[str, Any]:
        """验证正则表达式"""
        try:
            compiled = re.compile(pattern)
            return {
                "valid": True,
                "pattern": pattern,
                "message": "正则表达式有效"
            }
        except re.error as e:
            return {
                "valid": False,
                "pattern": pattern,
                "message": f"正则表达式错误: {e}"
            }

    async def get_statistics(self) -> Dict[str, Any]:
        """获取规则统计"""
        enabled = len([r for r in self._rules.values() if r.enabled])
        disabled = len([r for r in self._rules.values() if not r.enabled])
        
        strategy_counts = {}
        for rule in self._rules.values():
            strategy_counts[rule.strategy] = strategy_counts.get(rule.strategy, 0) + 1

        tag_counts = {}
        for rule in self._rules.values():
            for tag in rule.tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

        return {
            "total_rules": len(self._rules),
            "enabled_rules": enabled,
            "disabled_rules": disabled,
            "by_strategy": strategy_counts,
            "by_tag": tag_counts,
            "storage_dir": str(self.storage_dir)
        }


# 全局规则编辑器实例
redaction_editor = RedactionRuleEditor()
