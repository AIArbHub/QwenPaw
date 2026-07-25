#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MinerU云端 API 完整对接测试
验证组件管理器、路由调度和云端API调用的集成
"""

import asyncio
import unittest
from unittest.mock import Mock, patch, AsyncMock
from pathlib import Path

from src.aiarb.doc_processing.components.component_manager import ComponentManager, init_component_manager
from src.aiarb.doc_processing.components.mineru_cloud import MinerUCloudComponent, MinerUCloudAuthError
from src.aiarb.doc_processing.routing import RoutingScheduler, EngineStrategy, DocumentType
from src.aiarb.doc_processing.progress import InstallationProgressManager, ProgressStatus


class TestMinerUCloudIntegration(unittest.TestCase):
    """MinerU云端集成测试"""
    
    def setUp(self):
        """测试设置"""
        self.component_manager = None
        self.routing_scheduler = None
        self.mineru_component = None
    
    async def asyncSetUp(self):
        """异步设置"""
        # 初始化组件管理器
        self.component_manager = await init_component_manager()
        
        # 获取MinerU组件
        self.mineru_component = self.component_manager.get_component("advanced_mineru_cloud")
        
        # 初始化路由调度器
        self.routing_scheduler = RoutingScheduler(self.component_manager)
    
    def tearDown(self):
        """清理"""
        if self.component_manager:
            # 清理测试组件
            pass
    
    async def test_mineru_cloud_component_initialization(self):
        """测试MinerU云端组件初始化"""
        await self.asyncSetUp()
        
        # 验证组件存在
        self.assertIsNotNone(self.mineru_component)
        self.assertEqual(self.mineru_component.component_id, "advanced_mineru_cloud")
        self.assertEqual(self.mineru_component.name, "AI Arb MinerU云端解析")
        
        # 验证初始状态
        status = self.mineru_component.get_status()
        self.assertFalse(status["is_configured"])
        self.assertEqual(status["base_url"], "https://mineru.net/api/v4")
        
        print("✓ MinerU云端组件初始化测试通过")
    
    async def test_mineru_cloud_connection_test(self):
        """测试MinerU云端连接测试功能"""
        await self.asyncSetUp()
        
        # 测试未配置API密钥的情况
        result = await self.mineru_component.test_connection()
        self.assertFalse(result)
        
        # 使用模拟API密钥测试
        test_api_key = "test_api_key_12345"
        
        with patch.object(self.mineru_component, '_client') as mock_client:
            # 模拟成功的API响应
            mock_response = AsyncMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"code": 0}
            mock_client.post.return_value = mock_response
            
            # 配置组件
            self.mineru_component.api_key = test_api_key
            self.mineru_component._client = mock_client
            
            # 测试连接
            result = await self.mineru_component.test_connection()
            self.assertTrue(result)
            
            # 验证API调用
            mock_client.post.assert_called_once()
        
        print("✓ MinerU云端连接测试通过")
    
    async def test_mineru_cloud_document_parsing(self):
        """测试MinerU云端文档解析功能"""
        await self.asyncSetUp()
        
        # 创建测试文件
        test_file = Path("test_document.pdf")
        test_file.write_text("%PDF-1.4\ntest content")  # 简单PDF内容
        
        try:
            # 配置组件
            self.mineru_component.api_key = "test_api_key"
            self.mineru_component.is_configured = True
            
            with patch.object(self.mineru_component, '_client') as mock_client:
                # 模拟API调用链
                
                # 1. 上传URL申请响应
                upload_response = AsyncMock()
                upload_response.status_code = 200
                upload_response.json.return_value = {
                    "code": 0,
                    "data": {
                        "batch_id": "test_batch_123",
                        "file_urls": ["https://test.com/upload"]
                    }
                }
                
                # 2. 文件上传响应
                put_response = AsyncMock()
                put_response.status_code = 200
                
                # 3. 状态查询响应（轮询过程）
                status_response = AsyncMock()
                status_response.status_code = 200
                status_response.json.return_value = {
                    "code": 0,
                    "data": {
                        "extract_result": [
                            {
                                "state": "done",
                                "full_zip_url": "https://test.com/result.zip"
                            }
                        ]
                    }
                }
                
                # 4. 结果下载响应
                zip_response = AsyncMock()
                zip_response.status_code = 200
                zip_response.content = self._create_test_zip()
                
                # 配置模拟客户端
                mock_client.post.return_value = upload_response
                mock_client.put.return_value = put_response
                mock_client.get.side_effect = [status_response, zip_response]
                
                # 执行解析
                result = await self.mineru_component.parse_document(str(test_file))
                
                # 验证结果
                self.assertIsNotNone(result)
                self.assertIn("test document content", result.text)
                self.assertEqual(result.engine_info["engine"], "mineru_cloud")
                
                # 验证API调用顺序
                self.assertEqual(mock_client.post.call_count, 1)
                self.assertEqual(mock_client.put.call_count, 1)
                self.assertEqual(mock_client.get.call_count, 2)
                
        finally:
            # 清理测试文件
            if test_file.exists():
                test_file.unlink()
        
        print("✓ MinerU云端文档解析测试通过")
    
    async def test_routing_scheduler_with_mineru_cloud(self):
        """测试路由调度器与MinerU云端的集成"""
        await self.asyncSetUp()
        
        # 配置组件为已安装状态
        self.mineru_component.is_installed = True
        self.mineru_component.is_configured = True
        
        # 测试不同路由策略
        test_cases = [
            {
                "strategy": EngineStrategy.CLOUD_ONLY,
                "document_type": DocumentType.NATIVE_ELECTRONIC,
                "expected_engine": "advanced_mineru_cloud"
            },
            {
                "strategy": EngineStrategy.HYBRID,
                "document_type": DocumentType.SCANNED_DOCUMENT,
                "expected_engine": "advanced_mineru_cloud"
            }
        ]
        
        for case in test_cases:
            await self.routing_scheduler.set_strategy(case["strategy"])
            
            result = await self.routing_scheduler.route_document(
                file_path="test.pdf",
                document_type=case["document_type"]
            )
            
            self.assertEqual(result["engine_id"], case["expected_engine"])
            self.assertEqual(result["engine_type"], "cloud")
            self.assertGreaterEqual(result["confidence"], 0.9)
        
        print("✓ 路由调度器与MinerU云端的集成测试通过")
    
    async def test_installation_progress_tracking(self):
        """测试安装进度跟踪功能"""
        # 创建安装进度管理器
        install_manager = InstallationProgressManager()
        
        # 开始MinerU云端组件安装
        task_id = install_manager.start_installation(
            component_name="MinerU云端解析",
            component_version="latest",
            metadata={"test": True}
        )
        
        # 检查初始状态
        status = install_manager.get_installation_status(task_id)
        self.assertIsNotNone(status)
        self.assertEqual(status["component_name"], "MinerU云端解析")
        self.assertEqual(status["status"], "running")
        
        # 等待安装完成（模拟）
        await asyncio.sleep(10)  # 给安装线程一些时间
        
        # 检查完成状态
        final_status = install_manager.get_installation_status(task_id)
        self.assertEqual(final_status["status"], "completed")
        self.assertEqual(final_status["progress"], 100.0)
        
        print("✓ 安装进度跟踪功能测试通过")
    
    def _create_test_zip(self):
        """创建测试ZIP文件"""
        import zipfile
        import io
        
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w') as zf:
            zf.writestr("full.md", "# Test Document\n\nThis is test document content.")
            zf.writestr("metadata.json", '{"pages": 1, "language": "en"}')
        
        return zip_buffer.getvalue()
    
    async def run_async_test(self, test_method):
        """运行异步测试"""
        try:
            await test_method()
        except Exception as e:
            print(f"测试失败: {e}")
            raise
    
    def test_all_integration(self):
        """运行所有集成测试"""
        async def run_all():
            print("开始MinerU云端API完整对接集成测试...")
            
            await self.run_async_test(self.test_mineru_cloud_component_initialization)
            await self.run_async_test(self.test_mineru_cloud_connection_test)
            await self.run_async_test(self.test_mineru_cloud_document_parsing)
            await self.run_async_test(self.test_routing_scheduler_with_mineru_cloud)
            await self.run_async_test(self.test_installation_progress_tracking)
            
            print("\n✅ 所有MinerU云端API集成测试通过！")
            print("✅ 完整对接功能验证成功！")
        
        asyncio.run(run_all())


if __name__ == "__main__":
    # 运行集成测试
    test_suite = TestMinerUCloudIntegration()
    test_suite.test_all_integration()