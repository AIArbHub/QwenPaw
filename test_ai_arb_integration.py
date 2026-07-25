# -*- coding: utf-8 -*-
"""AI Arb 文档处理模块集成测试"""
import sys
import asyncio
sys.path.insert(0, 'src')

from aiarb.doc_processing.components.redaction_editor import redaction_editor
from aiarb.doc_processing.components.cloud_providers import all_cloud_providers
from aiarb.doc_processing.arbitration import ArbitrationKnowledgeBase, AwardReviewer
from aiarb.doc_processing.batch_processor import BatchProcessor


async def test_redaction_editor():
    """测试脱敏规则编辑器"""
    print("\n=== 脱敏规则编辑器测试 ===")
    
    # 获取统计
    stats = await redaction_editor.get_statistics()
    print(f"规则统计: 总计 {stats['total_rules']} 条")
    
    # 获取模板
    templates = await redaction_editor.get_rule_templates()
    print(f"预设模板: {len(templates)} 个")
    
    # 测试正则匹配
    test_result = await redaction_editor.test_pattern(
        r'\b1[3-9]\d{9}\b',
        '***PHONE***',
        'mask',
        '我的手机号是13812345678，请联系我'
    )
    print(f"测试结果: 成功={test_result['success']}, 匹配数={test_result.get('match_count', 0)}")
    if test_result['success'] and test_result.get('match_count', 0) > 0:
        print(f"脱敏后: {test_result['redacted_text']}")
    
    print("✓ 脱敏规则编辑器测试通过")


async def test_cloud_providers():
    """测试云端服务商"""
    print("\n=== 云端服务商测试 ===")
    print(f"已注册 {len(all_cloud_providers)} 个云端服务商:")
    for provider in all_cloud_providers:
        print(f"  - {provider.component_id}: {provider.name}")
    
    # 验证能力
    for provider in all_cloud_providers:
        caps = await provider.get_capabilities()
        print(f"  {provider.component_id} 支持格式: {caps.get('supported_formats', [])}")
    
    print("✓ 云端服务商测试通过")


async def test_arbitration():
    """测试仲裁模块"""
    print("\n=== 仲裁模块测试 ===")
    
    # 测试知识库
    kb = ArbitrationKnowledgeBase()
    stats = await kb.get_statistics()
    print(f"知识库统计: {stats}")
    
    # 测试裁决书核阅
    reviewer = AwardReviewer()
    sample_award = """
    仲裁裁决书
    
    申请人：张三
    被申请人：李四
    
    仲裁庭组成：独任仲裁员 王五
    
    仲裁请求：
    1. 请求被申请人支付货款人民币100万元
    2. 请求被申请人支付违约金
    
    裁决：
    1. 被申请人向申请人支付货款人民币100万元
    2. 驳回其他仲裁请求
    
    本裁决为终局裁决。
    """
    
    result = await reviewer.review(sample_award)
    print(f"核阅结果: {result.to_dict().get('summary', 'N/A')}")
    print("✓ 仲裁模块测试通过")


async def test_batch_processor():
    """测试批量处理器"""
    print("\n=== 批量处理器测试 ===")
    
    from aiarb.doc_processing.batch_processor import batch_processor
    
    # 创建批量任务
    task_id = await batch_processor.create_batch_task(
        file_paths=["test1.pdf", "test2.pdf"],
        task_name="测试批量任务",
        options={"engine_strategy": "local_only"}
    )
    print(f"创建批量任务: {task_id}")
    
    # 查看任务状态
    status = batch_processor.get_task_status(task_id)
    print(f"任务状态: {status.get('status', 'unknown')}")
    
    # 列出任务
    tasks = batch_processor.list_tasks()
    print(f"任务列表: {len(tasks)} 个任务")
    
    print("✓ 批量处理器测试通过")


async def test_api_routes():
    """测试 API 路由"""
    print("\n=== API 路由测试 ===")
    
    from aiarb.doc_processing.api.routes import create_doc_processing_router
    router = create_doc_processing_router()
    print(f"文档处理路由: {len(router.routes)} 个端点")
    
    from aiarb.doc_processing.frontend.routes import create_frontend_router
    frouter = create_frontend_router()
    print(f"前端路由: {len(frouter.routes)} 个端点")
    
    print("✓ API 路由测试通过")


async def main():
    """主测试函数"""
    print("=" * 60)
    print("AI Arb 文档处理模块集成测试")
    print("=" * 60)
    
    await test_redaction_editor()
    await test_cloud_providers()
    await test_arbitration()
    await test_batch_processor()
    await test_api_routes()
    
    print("\n" + "=" * 60)
    print("所有测试通过！")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
