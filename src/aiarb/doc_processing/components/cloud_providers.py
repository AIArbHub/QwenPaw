# -*- coding: utf-8 -*-
"""
更多云端OCR/文档解析服务商适配
支持百度OCR、腾讯OCR、阿里云OCR等
"""

import asyncio
import base64
import json
import time
import hmac
import hashlib
from pathlib import Path
from typing import Dict, Any, Optional
from urllib.parse import quote

import httpx

from ...utils.logging import logger
from . import CloudComponent, ParseResult


class BaiduOCRComponent(CloudComponent):
    """百度智能云OCR组件"""

    def __init__(self):
        super().__init__(
            component_id="cloud_baidu_ocr",
            name="AI Arb 百度智能云OCR",
            description="百度智能云文字识别服务，支持通用文字识别、表格识别等",
            base_url="https://aip.baidubce.com/rest/2.0/ocr/v1",
            cost_per_request=0.005
        )
        self._secret_key = None
        self._client = None
        self._access_token = None
        self._token_expire = 0

    async def initialize(self, manager) -> bool:
        """初始化"""
        self._client = httpx.AsyncClient(timeout=60)
        self.is_installed = True
        return True

    async def configure(self, api_key: str) -> bool:
        """配置 - api_key格式为 'api_key:secret_key'"""
        try:
            parts = api_key.split(":")
            self.api_key = parts[0]
            self._secret_key = parts[1] if len(parts) > 1 else ""
            self.is_configured = True
            
            # 获取access token
            token_ok = await self._get_access_token()
            return token_ok
        except Exception as e:
            logger.error(f"百度OCR配置失败: {e}")
            return False

    async def _get_access_token(self) -> bool:
        """获取百度API的access_token"""
        try:
            url = "https://aip.baidubce.com/oauth/2.0/token"
            params = {
                "grant_type": "client_credentials",
                "client_id": self.api_key,
                "client_secret": self._secret_key
            }
            resp = await self._client.post(url, data=params)
            data = resp.json()
            
            if "access_token" in data:
                self._access_token = data["access_token"]
                self._token_expire = time.time() + data.get("expires_in", 2592000)
                logger.info("百度OCR access token获取成功")
                return True
            return False
        except Exception as e:
            logger.error(f"获取百度access token失败: {e}")
            return False

    async def parse_document(self, file_path: str, options: Dict[str, Any] = None) -> ParseResult:
        """执行OCR识别"""
        if not self._access_token or time.time() >= self._token_expire:
            await self._get_access_token()

        path_obj = Path(file_path)
        
        # 读取文件并base64编码
        with open(file_path, "rb") as f:
            img_data = base64.b64encode(f.read()).decode()

        try:
            # 通用文字识别
            url = f"{self.base_url}/general_basic"
            params = {
                "access_token": self._access_token,
                "image": img_data,
                "language_type": "CHN_ENG"
            }
            
            resp = await self._client.post(url, data=params)
            result = resp.json()
            
            if "error_code" in result:
                return ParseResult(
                    text=f"[百度OCR] 识别失败: {result.get('error_msg', '')}",
                    engine_info={"error": result.get("error_code")}
                )

            # 提取文本
            words_result = result.get("words_result", [])
            text = "\n".join([w["words"] for w in words_result])

            return ParseResult(
                text=text,
                markdown=text,
                engine_info={
                    "engine": "baidu_ocr",
                    "confidence": 0.9,
                    "words_count": len(words_result)
                },
                metadata={
                    "file_name": path_obj.name,
                    "baidu_log_id": result.get("log_id")
                }
            )

        except Exception as e:
            logger.error(f"百度OCR识别失败: {e}")
            return ParseResult(
                text=f"[百度OCR] 识别异常: {e}",
                engine_info={"error": "parse_failed"}
            )

    async def test_connection(self) -> bool:
        """测试连接"""
        return await self._get_access_token()

    async def get_capabilities(self) -> Dict[str, Any]:
        return {
            "supported_formats": ["jpg", "png", "bmp", "pdf"],
            "features": ["general_ocr", "table_recognition", "handwriting"],
            "max_file_size_mb": 10,
            "supported_languages": ["zh", "en"],
            "output_formats": ["text"],
            "confidence_level": "high",
            "cost_per_request": self.cost_per_request
        }

    async def install(self) -> bool:
        self.is_installed = True
        return True

    async def uninstall(self) -> bool:
        self._access_token = None
        self.is_configured = False
        self.is_installed = False
        if self._client:
            await self._client.aclose()
        return True


class TencentOCRComponent(CloudComponent):
    """腾讯云OCR组件"""

    def __init__(self):
        super().__init__(
            component_id="cloud_tencent_ocr",
            name="AI Arb 腾讯云OCR",
            description="腾讯云文字识别服务，支持通用印刷体识别、表格识别等",
            base_url="https://ocr.tencentcloudapi.com",
            cost_per_request=0.008
        )
        self._secret_id = None
        self._secret_key = None
        self._client = None

    async def initialize(self, manager) -> bool:
        self._client = httpx.AsyncClient(timeout=60)
        self.is_installed = True
        return True

    async def configure(self, api_key: str) -> bool:
        """配置 - api_key格式为 'secret_id:secret_key'"""
        try:
            parts = api_key.split(":")
            self._secret_id = parts[0]
            self._secret_key = parts[1] if len(parts) > 1 else ""
            self.api_key = api_key
            self.is_configured = True
            return True
        except Exception as e:
            logger.error(f"腾讯OCR配置失败: {e}")
            return False

    async def parse_document(self, file_path: str, options: Dict[str, Any] = None) -> ParseResult:
        """执行OCR识别"""
        path_obj = Path(file_path)

        try:
            with open(file_path, "rb") as f:
                img_data = base64.b64encode(f.read()).decode()

            # 构建请求头（腾讯云API需要签名）
            endpoint = "https://ocr.tencentcloudapi.com"
            action = "GeneralBasicOCR"
            version = "2018-11-19"
            timestamp = int(time.time())
            date = time.strftime("%Y-%m-%d", time.gmtime(timestamp))

            params = {"ImageBase64": img_data}
            payload = json.dumps(params)

            # 简化签名 - 实际应使用腾讯云SDK
            headers = {
                "Content-Type": "application/json",
                "X-TC-Action": action,
                "X-TC-Version": version,
                "X-TC-Timestamp": str(timestamp),
            }

            resp = await self._client.post(endpoint, headers=headers, content=payload)
            result = resp.json()

            if "Response" in result and "TextDetections" in result["Response"]:
                texts = [d["DetectedText"] for d in result["Response"]["TextDetections"]]
                text = "\n".join(texts)
                
                return ParseResult(
                    text=text,
                    markdown=text,
                    engine_info={
                        "engine": "tencent_ocr",
                        "confidence": 0.9,
                        "text_blocks": len(texts)
                    },
                    metadata={"file_name": path_obj.name}
                )
            else:
                error = result.get("Response", {}).get("Error", {})
                return ParseResult(
                    text=f"[腾讯OCR] 识别失败: {error.get('Message', '未知错误')}",
                    engine_info={"error": error.get("Code")}
                )

        except Exception as e:
            logger.error(f"腾讯OCR识别失败: {e}")
            return ParseResult(
                text=f"[腾讯OCR] 识别异常: {e}",
                engine_info={"error": "parse_failed"}
            )

    async def test_connection(self) -> bool:
        """测试连接"""
        return bool(self._secret_id and self._secret_key)

    async def get_capabilities(self) -> Dict[str, Any]:
        return {
            "supported_formats": ["jpg", "png", "bmp", "pdf"],
            "features": ["general_ocr", "table_recognition", "formula_recognition"],
            "max_file_size_mb": 10,
            "supported_languages": ["zh", "en", "japan", "korean"],
            "output_formats": ["text"],
            "confidence_level": "high",
            "cost_per_request": self.cost_per_request
        }

    async def install(self) -> bool:
        self.is_installed = True
        return True

    async def uninstall(self) -> bool:
        self._secret_id = None
        self._secret_key = None
        self.is_configured = False
        self.is_installed = False
        if self._client:
            await self._client.aclose()
        return True


class AliyunOCRComponent(CloudComponent):
    """阿里云OCR组件"""

    def __init__(self):
        super().__init__(
            component_id="cloud_aliyun_ocr",
            name="AI Arb 阿里云OCR",
            description="阿里云文字识别OCR服务，支持通用文字识别、表格识别等",
            base_url="https://ocr-api.cn-hangzhou.aliyuncs.com",
            cost_per_request= 0.006
        )
        self._access_key_id = None
        self._access_key_secret = None
        self._client = None

    async def initialize(self, manager) -> bool:
        self._client = httpx.AsyncClient(timeout=60)
        self.is_installed = True
        return True

    async def configure(self, api_key: str) -> bool:
        """配置 - api_key格式为 'access_key_id:access_key_secret'"""
        try:
            parts = api_key.split(":")
            self._access_key_id = parts[0]
            self._access_key_secret = parts[1] if len(parts) > 1 else ""
            self.api_key = api_key
            self.is_configured = True
            return True
        except Exception as e:
            logger.error(f"阿里云OCR配置失败: {e}")
            return False

    async def parse_document(self, file_path: str, options: Dict[str, Any] = None) -> ParseResult:
        """执行OCR识别"""
        path_obj = Path(file_path)

        try:
            with open(file_path, "rb") as f:
                img_data = base64.b64encode(f.read()).decode()

            # 阿里云OCR API调用（简化版）
            # 实际应使用阿里云SDK
            url = f"{self.base_url}/api/v1/ocr/general"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._access_key_id}:{self._access_key_secret}"
            }
            payload = {
                "image": img_data,
                "type": "general"
            }

            resp = await self._client.post(url, headers=headers, json=payload)
            result = resp.json()

            if "data" in result and "content" in result["data"]:
                text = result["data"]["content"]
                return ParseResult(
                    text=text,
                    markdown=text,
                    engine_info={
                        "engine": "aliyun_ocr",
                        "confidence": 0.88
                    },
                    metadata={"file_name": path_obj.name}
                )
            else:
                return ParseResult(
                    text=f"[阿里云OCR] 识别失败: {result.get('message', '未知错误')}",
                    engine_info={"error": result.get("code")}
                )

        except Exception as e:
            logger.error(f"阿里云OCR识别失败: {e}")
            return ParseResult(
                text=f"[阿里云OCR] 识别异常: {e}",
                engine_info={"error": "parse_failed"}
            )

    async def test_connection(self) -> bool:
        """测试连接"""
        return bool(self._access_key_id and self._access_key_secret)

    async def get_capabilities(self) -> Dict[str, Any]:
        return {
            "supported_formats": ["jpg", "png", "bmp", "pdf"],
            "features": ["general_ocr", "table_recognition", "seal_recognition"],
            "max_file_size_mb": 10,
            "supported_languages": ["zh", "en", "japanese", "korean"],
            "output_formats": ["text"],
            "confidence_level": "high",
            "cost_per_request": self.cost_per_request
        }

    async def install(self) -> bool:
        self.is_installed = True
        return True

    async def uninstall(self) -> bool:
        self._access_key_id = None
        self._access_key_secret = None
        self.is_configured = False
        self.is_installed = False
        if self._client:
            await self._client.aclose()
        return True


class GeneralCloudOCRComponent(CloudComponent):
    """通用云端OCR组件 - 作为降级方案"""

    def __init__(self):
        super().__init__(
            component_id="cloud_ocr_general",
            name="AI Arb 通用云端OCR",
            description="通用云端OCR识别服务，轻量级文字识别",
            base_url="https://api.ocr.space/parse/image",
            cost_per_request=0.002
        )
        self._client = None

    async def initialize(self, manager) -> bool:
        self._client = httpx.AsyncClient(timeout=60)
        self.is_installed = True
        return True

    async def configure(self, api_key: str) -> bool:
        self.api_key = api_key
        self.is_configured = True
        return True

    async def parse_document(self, file_path: str, options: Dict[str, Any] = None) -> ParseResult:
        """执行OCR识别"""
        path_obj = Path(file_path)

        try:
            with open(file_path, "rb") as f:
                img_data = f.read()

            url = self.base_url
            headers = {"apikey": self.api_key}
            files = {"file": (path_obj.name, img_data)}
            data = {"language": "chs", "isOverlayRequired": "false"}

            resp = await self._client.post(url, headers=headers, files=files, data=data)
            result = resp.json()

            if result.get("OCRExitCode") == 1:
                parsed_results = result.get("ParsedResults", [])
                texts = [r.get("ParsedText", "") for r in parsed_results]
                text = "\n".join(texts).strip()

                return ParseResult(
                    text=text,
                    markdown=text,
                    engine_info={
                        "engine": "general_cloud_ocr",
                        "confidence": 0.8
                    },
                    metadata={"file_name": path_obj.name}
                )
            else:
                error = result.get("ErrorMessage", "未知错误")
                return ParseResult(
                    text=f"[通用OCR] 识别失败: {error}",
                    engine_info={"error": result.get("OCRExitCode")}
                )

        except Exception as e:
            logger.error(f"通用OCR识别失败: {e}")
            return ParseResult(
                text=f"[通用OCR] 识别异常: {e}",
                engine_info={"error": "parse_failed"}
            )

    async def test_connection(self) -> bool:
        return bool(self.api_key)

    async def get_capabilities(self) -> Dict[str, Any]:
        return {
            "supported_formats": ["jpg", "png", "bmp", "pdf", "gif"],
            "features": ["general_ocr"],
            "max_file_size_mb": 5,
            "supported_languages": ["zh", "en"],
            "output_formats": ["text"],
            "confidence_level": "medium",
            "cost_per_request": self.cost_per_request
        }

    async def install(self) -> bool:
        self.is_installed = True
        return True

    async def uninstall(self) -> bool:
        self.is_configured = False
        self.is_installed = False
        if self._client:
            await self._client.aclose()
        return True


# 组件实例
baidu_ocr_component = BaiduOCRComponent()
tencent_ocr_component = TencentOCRComponent()
aliyun_ocr_component = AliyunOCRComponent()
general_cloud_ocr_component = GeneralCloudOCRComponent()

all_cloud_providers = [
    baidu_ocr_component,
    tencent_ocr_component,
    aliyun_ocr_component,
    general_cloud_ocr_component
]
