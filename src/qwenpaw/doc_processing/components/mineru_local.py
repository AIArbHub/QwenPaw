# -*- coding: utf-8 -*-
"""
MinerU本地高级解析组件
基于MinerU本地API服务进行复杂版面、表格、公式全结构化提取
"""

import asyncio
import io
import json
import zipfile
from pathlib import Path
from typing import Dict, Any, Optional

import httpx

from ...utils.logging import logger
from . import LocalComponent, ParseResult


class MinerULocalComponent(LocalComponent):
    """
    MinerU本地高级解析组件
    通过本地MinerU API服务进行深度结构化文档解析
    支持复杂版面识别、表格提取、公式识别等
    """

    def __init__(self):
        super().__init__(
            component_id="advanced_mineru_local",
            name="AI Arb MinerU本地高级解析",
            description="本地MinerU服务，复杂版面、表格、公式全结构化提取",
            install_size_mb=3500.0
        )
        self.required_packages = ["magic-pdf", "httpx"]
        self._base_url = "http://localhost:8000/api/v4"
        self._api_key = "local"
        self._client: Optional[httpx.AsyncClient] = None

        self.metadata = {
            "min_memory_mb": 8192,
            "min_disk_mb": 10000,
            "supported_platforms": ["windows", "darwin", "linux"],
            "gpu_recommended": True,
            "features": ["layout_analysis", "table_extraction", "formula_recognition", "ocr"]
        }

    async def check_dependencies(self) -> bool:
        """检查依赖"""
        try:
            import importlib
            # 检查magic-pdf
            spec = importlib.util.find_spec("magic_pdf")
            if spec is None:
                logger.warning("magic_pdf未安装")
                return False
            # 检查httpx
            spec2 = importlib.util.find_spec("httpx")
            if spec2 is None:
                logger.warning("httpx未安装")
                return False
            logger.info("MinerU本地组件依赖检查通过")
            return True
        except Exception as e:
            logger.warning(f"依赖检查失败: {e}")
            return False

    async def initialize(self, manager) -> bool:
        """初始化组件"""
        try:
            self._client = httpx.AsyncClient(
                timeout=600,
                follow_redirects=True
            )

            # 检查本地MinerU服务是否可用
            service_ok = await self._check_service_available()

            if service_ok:
                self.is_installed = True
                logger.info("MinerU本地组件初始化完成，服务可用")
            else:
                logger.warning("MinerU本地服务不可用，组件已注册但需要先部署服务")
                self.is_installed = False

            return service_ok

        except Exception as e:
            logger.error(f"MinerU本地组件初始化失败: {e}")
            return False

    async def _check_service_available(self) -> bool:
        """检查本地MinerU服务是否可用"""
        try:
            if not self._client:
                return False

            # 尝试连接本地API
            resp = await self._client.get(
                f"{self._base_url}/tasks",
                timeout=5
            )
            return resp.status_code in (200, 404, 405)  # 只要能连接上即可

        except Exception:
            return False

    async def parse_document(
        self,
        file_path: str,
        options: Dict[str, Any] = None
    ) -> ParseResult:
        """执行MinerU本地解析"""
        options = options or {}
        file_path_obj = Path(file_path)

        if not file_path_obj.exists():
            return ParseResult(
                text=f"[MinerU本地] 文件不存在: {file_path}",
                engine_info={"error": "file_not_found"}
            )

        if not self._client:
            return ParseResult(
                text="[MinerU本地] HTTP客户端未初始化",
                engine_info={"error": "client_not_initialized"}
            )

        # 检查服务是否可用
        if not await self._check_service_available():
            return ParseResult(
                text="[MinerU本地] 本地MinerU服务不可用，请先部署服务",
                engine_info={"error": "service_unavailable"}
            )

        try:
            file_size_mb = file_path_obj.stat().st_size / (1024 * 1024)
            logger.info(f"开始MinerU本地解析: {file_path_obj.name} ({file_size_mb:.1f}MB)")

            result_text = await self._call_local_api(file_path_obj, options)

            return ParseResult(
                text=result_text,
                markdown=result_text,
                engine_info={
                    "engine": "mineru_local",
                    "file_name": file_path_obj.name,
                    "file_size_mb": file_size_mb,
                    "confidence": 0.95,
                    "backend": options.get("backend", "pipeline"),
                    "effort": options.get("effort", "medium")
                },
                metadata={
                    "local_processed": True,
                    "privacy_level": "full_local",
                    "no_data_external": True
                }
            )

        except Exception as e:
            logger.error(f"MinerU本地解析异常: {e}")
            return ParseResult(
                text=f"[MinerU本地] 解析失败: {e}",
                engine_info={"error": "parse_failed", "detail": str(e)}
            )

    async def _call_local_api(self, file_path: Path, options: Dict[str, Any]) -> str:
        """调用本地MinerU API"""
        headers = {}
        if self._api_key and self._api_key != "local":
            headers["Authorization"] = f"Bearer {self._api_key}"

        backend = options.get("backend", "pipeline")
        effort = options.get("effort", "medium")

        # Step 1: 上传文件并创建任务
        logger.info(f"上传文件到本地MinerU服务: {file_path.name}")

        with open(file_path, "rb") as f:
            form_data = {
                "backend": backend,
                "effort": effort,
            }
            resp = await self._client.post(
                f"{self._base_url}/tasks",
                headers=headers,
                files=[("files", (file_path.name, f))],
                data=form_data
            )

        if resp.status_code == 401:
            raise Exception("API密钥认证失败")
        resp.raise_for_status()

        data = resp.json()
        task_id = data.get("task_id") or data.get("id") or data.get("batch_id", "")

        if not task_id:
            raise Exception("未获取到任务ID")

        logger.info(f"MinerU本地任务已创建 (id={task_id})，轮询中...")

        # Step 2: 轮询任务状态
        result = await self._poll_local_task(headers, task_id)
        return result

    async def _poll_local_task(self, headers: Dict[str, str], task_id: str) -> str:
        """轮询本地任务状态"""
        poll_interval = 5
        max_polls = 120

        for i in range(max_polls):
            await asyncio.sleep(poll_interval)

            try:
                status_resp = await self._client.get(
                    f"{self._base_url}/tasks/{task_id}",
                    headers=headers
                )
                status_resp.raise_for_status()
                status_data = status_resp.json()

                status = status_data.get("status", "")

                if status in ("done", "completed", "success"):
                    return await self._extract_local_result(status_data)

                if status in ("failed", "error"):
                    error_msg = status_data.get("error", "unknown error")
                    raise Exception(f"任务失败: {error_msg}")

                logger.debug(f"MinerU本地轮询中... status={status} ({i+1}/{max_polls})")

            except Exception as e:
                logger.warning(f"轮询请求失败: {e}")
                continue

        raise Exception("解析超时，请稍后重试")

    async def _extract_local_result(self, status_data: Dict) -> str:
        """从本地结果中提取内容"""
        results = status_data.get("results", [])

        if isinstance(results, list):
            for item in results:
                if isinstance(item, dict):
                    url = item.get("url", "") or item.get("full_zip_url", "")

                    # 如果有.md文件URL
                    if url and item.get("file_name", "").endswith(".md"):
                        resp = await self._client.get(url)
                        return resp.text

                    # 如果是ZIP文件
                    if url and (url.endswith(".zip") or "zip" in url):
                        resp = await self._client.get(url)
                        return self._extract_markdown_from_zip(resp.content)

        # 直接内容
        content_url = status_data.get("content_url", "")
        if content_url:
            resp = await self._client.get(content_url)
            return resp.text

        markdown_content = status_data.get("markdown", "") or status_data.get("content", "")
        if markdown_content:
            return markdown_content

        # 尝试获取full_zip_url
        zip_url = status_data.get("full_zip_url", "")
        if zip_url:
            resp = await self._client.get(zip_url)
            return self._extract_markdown_from_zip(resp.content)

        return "[MinerU本地] 未找到可提取的解析结果"

    def _extract_markdown_from_zip(self, zip_data: bytes) -> str:
        """从ZIP中提取Markdown"""
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
                md_files = [n for n in zf.namelist() if n.endswith(".md")]

                if md_files:
                    md_name = next((n for n in md_files if "full" in n.lower()), md_files[0])
                    content = zf.read(md_name).decode("utf-8", errors="replace")
                    logger.info(f"从ZIP提取 {md_name} ({len(content)} 字符)")
                    return content

                # 尝试提取其他文本
                for filename in zf.namelist():
                    if filename.endswith((".txt", ".json")):
                        try:
                            content = zf.read(filename).decode("utf-8", errors="replace")
                            if len(content) > 100:
                                return content
                        except Exception:
                            continue

                return "[MinerU本地] ZIP中未找到文本内容"

        except Exception as e:
            logger.error(f"ZIP解压失败: {e}")
            return f"[MinerU本地] ZIP解压失败: {e}"

    async def get_capabilities(self) -> Dict[str, Any]:
        """获取组件能力"""
        return {
            "supported_formats": ["pdf", "docx", "pptx"],
            "features": [
                "advanced_structured_extraction",
                "layout_analysis",
                "table_extraction",
                "formula_recognition",
                "ocr",
                "full_local_processing",
                "privacy_first"
            ],
            "max_file_size_mb": 200,
            "supported_languages": ["zh", "en", "mixed"],
            "output_formats": ["text", "markdown", "html", "json"],
            "confidence_level": "high",
            "min_memory_mb": 8192,
            "min_disk_mb": 10000,
            "gpu_recommended": True,
            "privacy_level": "full_local"
        }

    async def install(self) -> bool:
        """安装组件"""
        try:
            if not await self.check_dependencies():
                return False

            self._client = httpx.AsyncClient(timeout=600)

            service_ok = await self._check_service_available()
            if service_ok:
                self.is_installed = True
                logger.info("MinerU本地服务可用，组件安装成功")
                return True
            else:
                logger.warning("MinerU本地服务不可用。请先部署MinerU本地服务")
                return False

        except Exception as e:
            logger.error(f"MinerU本地组件安装失败: {e}")
            return False

    async def uninstall(self) -> bool:
        """卸载组件"""
        try:
            if self._client:
                await self._client.aclose()
                self._client = None

            self.is_installed = False
            logger.info("MinerU本地组件已卸载")
            return True

        except Exception as e:
            logger.error(f"卸载失败: {e}")
            return False

    def get_status(self) -> Dict[str, Any]:
        """获取状态"""
        status = super().get_status()
        status.update({
            "base_url": self._base_url,
            "service_available": self._client is not None,
            "privacy_level": "full_local"
        })
        return status


# 组件实例
mineru_local_component = MinerULocalComponent()
