# -*- coding: utf-8 -*-
"""MinerU云端组件 - 完整API对接"""

import asyncio
import io
import logging
import zipfile
from pathlib import Path
from typing import Dict, Any, Optional

import httpx

from ...utils.logging import logger
from . import CloudComponent, ParseResult


class MinerUCloudAuthError(Exception):
    """MinerU API认证错误"""
    pass


class MinerUCloudComponent(CloudComponent):
    """MinerU云端高级解析组件 - 完整实现"""
    
    def __init__(self):
        super().__init__(
            component_id="advanced_mineru_cloud",
            name="AI Arb MinerU云端解析",
            description="基于MinerU云端API的高级文档解析服务，支持PDF结构化解析、OCR识别和表格提取",
            base_url="https://mineru.net/api/v4",
            cost_per_request=0.1
        )
        
        # 配置参数
        self.model_version = "vlm"
        self.enable_formula = True
        self.enable_table = True
        self.language = "ch"
        self.poll_interval = 5
        self.max_polls = 120
        self.upload_base_timeout = 120
        self.upload_per_10mb = 30
        
        # HTTP客户端配置
        self._client = None
    
    async def configure(self, api_key: str) -> bool:
        """配置MinerU云端组件API密钥"""
        try:
            self.api_key = api_key
            self.is_configured = True
            
            # 初始化HTTP客户端
            if not self._client:
                self._client = httpx.AsyncClient(
                    timeout=300,
                    follow_redirects=True
                )
            
            # 测试连接
            connection_ok = await self.test_connection()
            if connection_ok:
                logger.info("MinerU云端组件配置验证成功")
                return True
            else:
                logger.warning("MinerU云端组件配置验证失败")
                return False
                
        except Exception as e:
            logger.error(f"MinerU云端组件配置失败: {e}")
            return False
    
    async def initialize(self, manager) -> bool:
        """初始化组件"""
        try:
            # 创建HTTP客户端
            self._client = httpx.AsyncClient(
                timeout=300,
                follow_redirects=True
            )
            
            self.is_installed = True
            logger.info("MinerU云端组件初始化完成")
            return True
            
        except Exception as e:
            logger.error(f"MinerU云端组件初始化失败: {e}")
            return False
    
    async def parse_document(
        self, 
        file_path: str, 
        options: Dict[str, Any] = None
    ) -> ParseResult:
        """解析文档 - 完整的MinerU云端API调用"""
        if not self.is_configured:
            return ParseResult(
                text="[MinerU云端解析失败] 组件未配置，请先设置API密钥",
                engine_info={"error": "not_configured"}
            )
        
        if not self._client:
            return ParseResult(
                text="[MinerU云端解析失败] HTTP客户端未初始化",
                engine_info={"error": "client_not_initialized"}
            )
        
        options = options or {}
        file_path_obj = Path(file_path)
        
        try:
            # 检查文件是否存在
            if not file_path_obj.exists():
                return ParseResult(
                    text=f"[MinerU云端解析失败] 文件不存在: {file_path}",
                    engine_info={"error": "file_not_found"}
                )
            
            # 获取文件大小
            file_size_mb = file_path_obj.stat().st_size / (1024 * 1024)
            upload_timeout = self.upload_base_timeout + int(file_size_mb / 10) * self.upload_per_10mb
            
            logger.info(f"开始MinerU云端解析: {file_path_obj.name} ({file_size_mb:.1f}MB)")
            
            # 调用云端API
            result_text = await self._call_mineru_api(file_path_obj, upload_timeout)
            
            # 创建解析结果
            return ParseResult(
                text=result_text,
                markdown=result_text,
                engine_info={
                    "engine": "mineru_cloud",
                    "file_name": file_path_obj.name,
                    "file_size_mb": file_size_mb,
                    "cost_estimate": self.cost_per_request,
                    "confidence": 0.95,
                    "metadata": {
                        "model_version": self.model_version,
                        "enable_formula": self.enable_formula,
                        "enable_table": self.enable_table,
                        "language": self.language
                    }
                }
            )
            
        except MinerUCloudAuthError as e:
            logger.error(f"MinerU API认证失败: {e}")
            return ParseResult(
                text="[MinerU云端解析失败] API密钥认证失败，请检查密钥是否正确或是否已过期",
                engine_info={"error": "auth_failed"}
            )
            
        except Exception as e:
            logger.error(f"MinerU云端解析异常: {e}")
            return ParseResult(
                text=f"[MinerU云端解析失败] {str(e)}",
                engine_info={"error": "parse_failed", "error_detail": str(e)}
            )
    
    async def _call_mineru_api(self, file_path: Path, timeout: int) -> str:
        """调用MinerU云端API的完整流程"""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        
        # Step 1: 申请上传URL
        logger.info(f"请求上传URL: {file_path.name}")
        upload_data = await self._request_upload_url(headers, file_path.name)
        
        batch_id = upload_data["batch_id"]
        upload_url = upload_data["upload_url"]
        
        # Step 2: 上传文件
        logger.info(f"上传文件 (batch_id={batch_id})")
        await self._upload_file(upload_url, file_path)
        
        # Step 3: 轮询任务状态
        logger.info(f"轮询任务状态 (batch_id={batch_id})")
        result_url = await self._poll_task_status(headers, batch_id)
        
        # Step 4: 下载结果
        logger.info(f"下载解析结果: {result_url[:100]}")
        return await self._download_result(result_url)
    
    async def _request_upload_url(self, headers: Dict[str, str], filename: str) -> Dict[str, Any]:
        """申请上传URL"""
        payload = {
            "files": [
                {
                    "name": filename, 
                    "data_id": "ai_arb", 
                    "is_ocr": True
                }
            ],
            "model_version": self.model_version,
            "enable_formula": self.enable_formula,
            "enable_table": self.enable_table,
            "language": self.language,
        }
        
        try:
            resp = await self._client.post(
                f"{self.base_url}/file-urls/batch",
                headers=headers,
                json=payload
            )
            
            if resp.status_code == 401:
                raise MinerUCloudAuthError(f"401: {resp.text[:200]}")
            
            resp.raise_for_status()
            data = resp.json()
            
            if data.get("code") != 0:
                error_msg = data.get("msg", "unknown error")
                raise Exception(f"申请上传URL失败: {error_msg}")
            
            result = data.get("data", {})
            if not result.get("file_urls"):
                raise Exception("未获取到上传URL")
            
            return {
                "batch_id": result["batch_id"],
                "upload_url": result["file_urls"][0]
            }
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise MinerUCloudAuthError(f"401: {e.response.text[:200]}")
            raise
    
    async def _upload_file(self, upload_url: str, file_path: Path) -> None:
        """上传文件到预签名URL"""
        with open(file_path, "rb") as f:
            file_data = f.read()
        
        # 使用PUT方法上传
        put_resp = await self._client.put(upload_url, content=file_data)
        
        if put_resp.status_code not in (200, 201):
            raise Exception(f"文件上传失败 - HTTP {put_resp.status_code}: {put_resp.text[:200]}")
        
        logger.info(f"文件上传成功: {file_path.name}")
    
    async def _poll_task_status(self, headers: Dict[str, str], batch_id: str) -> str:
        """轮询任务状态直到完成"""
        for i in range(self.max_polls):
            await asyncio.sleep(self.poll_interval)
            
            try:
                status_resp = await self._client.get(
                    f"{self.base_url}/extract-results/batch/{batch_id}",
                    headers=headers
                )
                
                if status_resp.status_code == 401:
                    raise MinerUCloudAuthError(f"401: {status_resp.text[:200]}")
                
                status_resp.raise_for_status()
                status_data = status_resp.json()
                
                if status_data.get("code") != 0:
                    logger.warning(f"状态查询失败: {status_data}")
                    continue
                
                extract_results = status_data.get("data", {}).get("extract_result", [])
                if not extract_results:
                    continue
                
                result_item = extract_results[0]
                state = result_item.get("state", "")
                
                if state == "done":
                    full_zip_url = result_item.get("full_zip_url", "")
                    if not full_zip_url:
                        raise Exception("解析完成但未返回下载地址")
                    return full_zip_url
                    
                elif state in ("failed", "error"):
                    err_msg = result_item.get("err_msg", "unknown error")
                    raise Exception(f"解析任务失败: {err_msg}")
                
                logger.debug(f"轮询中... state={state} ({i + 1}/{self.max_polls})")
                
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    raise MinerUCloudAuthError(f"401: {e.response.text[:200]}")
                logger.warning(f"轮询请求失败: {e}")
                continue
        
        raise Exception("解析超时，请稍后重试")
    
    async def _download_result(self, zip_url: str) -> str:
        """下载并提取解析结果"""
        zip_resp = await self._client.get(zip_url, timeout=300)
        zip_resp.raise_for_status()
        
        return self._extract_markdown_from_zip(zip_resp.content)
    
    def _extract_markdown_from_zip(self, zip_data: bytes) -> str:
        """从ZIP文件中提取markdown内容"""
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
                # 查找.md文件
                md_files = [n for n in zf.namelist() if n.endswith(".md")]
                
                if md_files:
                    # 优先选择full.md或第一个.md文件
                    md_name = next((n for n in md_files if "full" in n.lower()), md_files[0])
                    content = zf.read(md_name).decode("utf-8", errors="replace")
                    logger.info(f"从ZIP中提取了 {md_name} ({len(content)} 字符)")
                    return content
                
                # 没有.md文件，尝试查找其他文本内容
                logger.warning(f"ZIP中没有.md文件，文件列表: {zf.namelist()}")
                
                # 尝试提取任何文本文件
                for filename in zf.namelist():
                    if filename.endswith((".txt", ".json", "")):
                        try:
                            content = zf.read(filename).decode("utf-8", errors="replace")
                            if len(content) > 100:  # 有一定长度的文本内容
                                logger.info(f"提取了替代文件 {filename}")
                                return content
                        except Exception:
                            continue
                
                return "[MinerU解析结果] 未找到可提取的文本内容"
                
        except Exception as e:
            logger.error(f"ZIP解压失败: {e}")
            return f"[MinerU解析结果] ZIP解压失败: {e}"
    
    async def test_connection(self) -> bool:
        """测试MinerU API连接"""
        if not self.api_key:
            logger.warning("API密钥未设置")
            return False
        
        try:
            if not self._client:
                self._client = httpx.AsyncClient(timeout=30)
            
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            }
            
            # 简单的连接测试
            test_payload = {
                "files": [{"name": "test.pdf", "data_id": "test"}], 
                "model_version": "vlm"
            }
            
            resp = await self._client.post(
                f"{self.base_url}/file-urls/batch",
                headers=headers,
                json=test_payload
            )
            
            if resp.status_code == 401:
                logger.error("API密钥认证失败")
                return False
            elif resp.status_code == 200:
                data = resp.json()
                if data.get("code") == 0:
                    logger.info("MinerU API连接测试成功")
                    return True
                else:
                    error_msg = data.get("msg", "未知错误")
                    logger.error(f"API连接测试失败: {error_msg}")
                    return False
            else:
                logger.error(f"API连接测试HTTP错误: {resp.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"MinerU API连接测试异常: {e}")
            return False
    
    async def get_capabilities(self) -> Dict[str, Any]:
        """获取组件能力描述"""
        return {
            "supported_formats": ["pdf", "docx", "pptx"],
            "features": [
                "cloud_advanced_parsing",
                "ocr_recognition", 
                "formula_extraction",
                "table_extraction",
                "structured_output"
            ],
            "max_file_size_mb": 200,
            "supported_languages": ["zh", "en", "mixed"],
            "output_formats": ["text", "markdown", "html"],
            "confidence_level": "high",
            "estimated_cost_per_mb": self.cost_per_request / 10,
            "privacy_level": "cloud_processed",
            "processing_time_estimate": "30-300 seconds"
        }
    
    async def install(self) -> bool:
        """云端组件"安装"实际上是配置检查"""
        try:
            if self.api_key and await self.test_connection():
                self.is_installed = True
                logger.info("MinerU云端组件配置验证成功")
                return True
            else:
                logger.warning("MinerU云端组件API密钥无效或未设置")
                self.is_installed = True  # 云端组件总是可以"安装"，但需要配置
                return True
                
        except Exception as e:
            logger.error(f"MinerU云端组件安装检查失败: {e}")
            return False
    
    async def uninstall(self) -> bool:
        """卸载云端组件"""
        try:
            # 关闭HTTP客户端
            if self._client:
                await self._client.aclose()
                self._client = None
            
            # 重置配置
            self.api_key = None
            self.is_configured = False
            self.is_installed = False
            
            logger.info("MinerU云端组件卸载完成")
            return True
            
        except Exception as e:
            logger.error(f"MinerU云端组件卸载失败: {e}")
            return False
    
    def get_status(self) -> Dict[str, Any]:
        """获取组件状态"""
        status = super().get_status()
        status.update({
            "model_version": self.model_version,
            "enable_formula": self.enable_formula,
            "enable_table": self.enable_table,
            "language": self.language,
            "is_configured": self.is_configured and bool(self.api_key),
            "connection_tested": hasattr(self, '_client') and self._client is not None
        })
        return status


# 组件实例
mineru_cloud_component = MinerUCloudComponent()