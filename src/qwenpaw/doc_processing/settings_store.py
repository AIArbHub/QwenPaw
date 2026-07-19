# -*- coding: utf-8 -*-
"""
AI Arb 设置持久化存储模块
将设置保存到本地 JSON 文件 (~/.ai_arb/settings.json)
实现本地优先、无需数据库的配置持久化
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

from ..utils.logging import logger


class SettingsStore:
    """
    设置持久化存储
    保存到 ~/.ai_arb/settings.json
    支持嵌套配置、默认值回退、原子写入
    """

    DEFAULT_SETTINGS = {
        # 引擎配置
        "default_strategy": "local_only",
        "default_cloud_engine": "mineru_cloud",
        "max_concurrent_tasks": 10,
        "cache_results": True,
        "cache_timeout": 3600,
        # 处理选项
        "processing": {
            "parse_strategy": "local-first",
            "quality_profile": "balanced",
            "enable_cache": True,
            "smart_retry": True,
            "ocr_engine": "tesseract",
            "ocr_language": "chi_sim+eng",
            "image_enhancement": True,
            "detect_tables": True,
            "auto_ocr": False,
            "enable_redaction": False,
            "output_format": "text",
            "advanced_features": False,
            "auto_confirm_cloud": False,
        },
        # 隐私安全
        "privacy": {
            "auto_redaction": True,
            "redaction_level": "standard",
            "local_encryption": True,
            "network_encryption": True,
            "cloud_processing": True,
            "auto_purge_data": True,
            "data_retention": "1m",
        },
        # 文件管理
        "file_management": {
            "default_output_dir": "./output/documents",
            "max_file_size": 50,
            "create_backup": True,
            "keep_history": True,
        },
        # 界面偏好
        "ui": {
            "language": "zh-CN",
            "theme_mode": "auto",
            "auto_save": True,
            "detailed_logging": True,
        },
        # API 密钥配置（加密存储 - 实际部署应加密）
        "api_keys": {
            "mineru": {"api_key": "", "endpoint": "https://api.mineru.com"},
            "baidu_ocr": {"api_key": "", "secret_key": ""},
            "tencent_ocr": {"secret_id": "", "secret_key": ""},
            "aliyun_ocr": {"access_key_id": "", "access_key_secret": ""},
        },
        # 元数据
        "_meta": {
            "created_at": None,
            "updated_at": None,
            "version": "1.0.0",
        }
    }

    def __init__(self, config_dir: Optional[str] = None):
        """初始化设置存储"""
        if config_dir:
            self.config_dir = Path(config_dir)
        else:
            self.config_dir = Path.home() / ".ai_arb"
        
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.settings_file = self.config_dir / "settings.json"
        self._settings: Dict[str, Any] = {}
        self._load()

    def _load(self):
        """从文件加载设置"""
        if self.settings_file.exists():
            try:
                with open(self.settings_file, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    # 合并默认值和加载的值（深度合并）
                    self._settings = self._deep_merge(
                        self._get_defaults(), loaded
                    )
                    logger.info("设置已从本地文件加载")
            except Exception as e:
                logger.warning(f"加载设置文件失败，使用默认值: {e}")
                self._settings = self._get_defaults()
        else:
            logger.info("设置文件不存在，使用默认值")
            self._settings = self._get_defaults()
            self._save()

    def _save(self):
        """保存设置到文件（原子写入）"""
        try:
            # 更新元数据
            now = datetime.now().isoformat()
            if not self._settings.get("_meta", {}).get("created_at"):
                self._settings.setdefault("_meta", {})["created_at"] = now
            self._settings.setdefault("_meta", {})["updated_at"] = now

            # 原子写入：先写临时文件，再重命名
            tmp_file = self.settings_file.with_suffix(".json.tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(self._settings, f, ensure_ascii=False, indent=2)
            
            # Windows 上 os.replace 是原子的
            os.replace(str(tmp_file), str(self.settings_file))
            logger.info("设置已保存到本地文件")
        except Exception as e:
            logger.error(f"保存设置文件失败: {e}")
            # 清理临时文件
            tmp_file = self.settings_file.with_suffix(".json.tmp")
            if tmp_file.exists():
                try:
                    tmp_file.unlink()
                except Exception:
                    pass

    def _get_defaults(self) -> Dict[str, Any]:
        """获取默认设置的深拷贝"""
        import copy
        return copy.deepcopy(self.DEFAULT_SETTINGS)

    def _deep_merge(self, base: Dict, override: Dict) -> Dict:
        """深度合并两个字典"""
        result = dict(base)
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    def get_all(self) -> Dict[str, Any]:
        """获取所有设置"""
        return dict(self._settings)

    def get(self, key: str, default: Any = None) -> Any:
        """获取单个设置项"""
        keys = key.split(".")
        value = self._settings
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
            else:
                return default
            if value is None:
                return default
        return value

    def set(self, key: str, value: Any):
        """设置单个配置项"""
        keys = key.split(".")
        d = self._settings
        for k in keys[:-1]:
            if k not in d or not isinstance(d[k], dict):
                d[k] = {}
            d = d[k]
        d[keys[-1]] = value

    def update(self, updates: Dict[str, Any]):
        """批量更新设置"""
        self._settings = self._deep_merge(self._settings, updates)
        self._save()

    def update_section(self, section: str, data: Dict[str, Any]):
        """更新某个配置段"""
        if section not in self._settings or not isinstance(self._settings[section], dict):
            self._settings[section] = {}
        self._settings[section].update(data)
        self._save()

    def reset_to_defaults(self):
        """重置为默认设置"""
        self._settings = self._get_defaults()
        self._save()
        logger.info("设置已重置为默认值")

    def get_api_key(self, provider: str) -> Dict[str, Any]:
        """获取指定服务商的 API 密钥配置"""
        return self._settings.get("api_keys", {}).get(provider, {})

    def set_api_key(self, provider: str, key_data: Dict[str, Any]):
        """设置指定服务商的 API 密钥配置"""
        if "api_keys" not in self._settings:
            self._settings["api_keys"] = {}
        self._settings["api_keys"][provider] = key_data
        self._save()

    def get_processing_config(self) -> Dict[str, Any]:
        """获取处理配置"""
        return self._settings.get("processing", {})

    def get_privacy_config(self) -> Dict[str, Any]:
        """获取隐私配置"""
        return self._settings.get("privacy", {})

    def get_file_management_config(self) -> Dict[str, Any]:
        """获取文件管理配置"""
        return self._settings.get("file_management", {})

    def get_ui_config(self) -> Dict[str, Any]:
        """获取界面配置"""
        return self._settings.get("ui", {})


# 全局设置存储实例
_settings_store: Optional[SettingsStore] = None


def get_settings_store() -> SettingsStore:
    """获取全局设置存储实例"""
    global _settings_store
    if _settings_store is None:
        _settings_store = SettingsStore()
    return _settings_store
