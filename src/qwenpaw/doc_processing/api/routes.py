# -*- coding: utf-8 -*-
"""
文档处理API路由 - 集成到AI Arb的FastAPI应用
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Response
from fastapi.responses import JSONResponse, FileResponse

from ..schemas import (
    ParseRequest, ParseResponse, TaskStatusResponse,
    ComponentInfo, ComponentInstallRequest, ComponentInstallResponse,
    CloudConfigRequest, CloudTestResponse, EnvironmentReport,
    ConfigRequest, ConfigResponse
)
from ...utils.logging import logger


def create_doc_processing_router() -> APIRouter:
    """创建文档处理路由"""
    
    router = APIRouter(prefix="/doc", tags=["document_processing"])
    
    # 全局任务存储
    processing_tasks: Dict[str, Dict[str, Any]] = {}

    # 获取设置存储实例
    def get_settings_store():
        from ..settings_store import get_settings_store
        return get_settings_store()
    
    async def get_doc_parser():
        """获取DocParser实例"""
        from .. import DocParser
        doc_parser = DocParser()
        if doc_parser.component_manager is None:
            await doc_parser.initialize()
        return doc_parser
    
    @router.post("/parse", response_model=ParseResponse)
    async def parse_document(
        background_tasks: BackgroundTasks,
        file_path: str = Form(...),
        auto_ocr: bool = Form(False),
        enable_redaction: bool = Form(False), 
        engine_strategy: str = Form("local_only"),
        output_format: str = Form("text"),
        advanced_features: bool = Form(False),
        auto_confirm_cloud: bool = Form(False),
        doc_parser: DocParser = Depends(get_doc_parser)
    ):
        """
        提交文档解析任务
        """
        try:
            # 验证文件存在
            if not Path(file_path).exists():
                raise HTTPException(status_code=404, detail=f"文件不存在: {file_path}")
            
            # 创建任务ID
            task_id = str(uuid.uuid4())
            
            # 存储任务信息
            processing_tasks[task_id] = {
                "task_id": task_id,
                "status": "queuing",
                "created_at": datetime.now(),
                "file_path": file_path,
                "progress": 0.0,
                "result": None,
                "error": None,
                "routing_info": None
            }
            
            # 启动解析任务
            async def parse_task():
                try:
                    processing_tasks[task_id]["status"] = "processing"
                    processing_tasks[task_id]["progress"] = 10.0
                    
                    # 路由决策
                    routing_scheduler = doc_parser.routing_scheduler
                    routing_result = await routing_scheduler.route_document(
                        file_path,
                        document_type=None,
                        options={
                            "auto_ocr": auto_ocr,
                            "enable_redaction": enable_redaction,
                            "engine_strategy": engine_strategy,
                            "output_format": output_format,
                            "advanced_features": advanced_features,
                            "auto_confirm_cloud": auto_confirm_cloud
                        }
                    )
                    
                    processing_tasks[task_id]["routing_info"] = routing_result
                    processing_tasks[task_id]["progress"] = 30.0
                    
                    # 检查是否需要确认云端处理
                    if routing_result.get("requires_confirmation", False):
                        if not auto_confirm_cloud:
                            processing_tasks[task_id]["status"] = "requires_confirmation"
                            processing_tasks[task_id]["progress"] = 0.0
                            processing_tasks[task_id]["error"] = (
                                f"需要云端处理但需用户确认。引擎: {routing_result['engine_id']}, "
                                f"预估费用: {routing_result.get('estimated_cost', '未知')}"
                            )
                            return
                    
                    # 执行解析
                    component = doc_parser.component_manager.get_component(routing_result["engine_id"])
                    
                    if not component or not component.is_installed:
                        # 尝试安装建议的组件
                        suggestions = routing_result.get("suggest_install", [])
                        if not suggestions:
                            raise RuntimeError(f"引擎未安装且无替代方案: {routing_result['engine_id']}")
                        
                        install_result = await doc_parser.install_component(suggestions[0])
                        if not install_result["success"]:
                            raise RuntimeError(f"无法安装所需组件: {suggestions[0]}")
                        
                        component = doc_parser.component_manager.get_component(suggestions[0])
                    
                    processing_tasks[task_id]["progress"] = 50.0
                    
                    # 执行解析
                    result = await component.parse_document(file_path, {
                        "auto_ocr": auto_ocr,
                        "enable_redaction": enable_redaction,
                        "output_format": output_format,
                        "advanced_features": advanced_features
                    })
                    
                    processing_tasks[task_id]["progress"] = 90.0
                    processing_tasks[task_id]["result"] = result.to_dict()
                    processing_tasks[task_id]["status"] = "completed"
                    processing_tasks[task_id]["progress"] = 100.0
                    
                except Exception as e:
                    processing_tasks[task_id]["status"] = "failed"
                    processing_tasks[task_id]["error"] = str(e)
                    logger.error(f"文档解析任务失败: {task_id}, 错误: {e}")
            
            # 添加到后台任务
            background_tasks.add_task(parse_task)
            
            return ParseResponse(
                success=True,
                task_id=task_id,
                result=None,
                routing_info=processing_tasks[task_id].get("routing_info")
            )
            
        except Exception as e:
            logger.error(f"创建解析任务失败: {e}")
            raise HTTPException(status_code=500, detail=f"创建解析任务失败: {str(e)}")
    
    @router.get("/status/{task_id}", response_model=TaskStatusResponse)
    async def get_task_status(task_id: str):
        """查询任务状态"""
        if task_id not in processing_tasks:
            raise HTTPException(status_code=404, detail="任务不存在")
        
        task_info = processing_tasks[task_id]
        return TaskStatusResponse(
            task_id=task_id,
            status=task_info["status"],
            progress=task_info["progress"],
            result=task_info.get("result"),
            error=task_info.get("error")
        )
    
    @router.get("/result/{task_id}", response_model=ParseResponse)
    async def get_parse_result(task_id: str):
        """获取解析结果"""
        if task_id not in processing_tasks:
            raise HTTPException(status_code=404, detail="任务不存在")
        
        task_info = processing_tasks[task_id]
        
        if task_info["status"] != "completed":
            raise HTTPException(status_code=400, detail=f"任务未完成，当前状态: {task_info['status']}")
        
        return ParseResponse(
            success=True,
            task_id=task_id,
            result=task_info["result"],
            routing_info=task_info.get("routing_info")
        )
    
    @router.get("/download/{task_id}/{format}")
    async def download_result(task_id: str, format: str):
        """下载解析结果"""
        if task_id not in processing_tasks:
            raise HTTPException(status_code=404, detail="任务不存在")
        
        task_info = processing_tasks[task_id]
        if task_info["status"] != "completed" or not task_info.get("result"):
            raise HTTPException(status_code=400, detail="结果不可用")
        
        result = task_info["result"]
        
        # 根据格式返回结果
        if format == "text" and "text" in result:
            content = result["text"].encode('utf-8')
            media_type = "text/plain"
            filename = f"result_{task_id}.txt"
        elif format == "markdown" and "markdown" in result:
            content = result["markdown"].encode('utf-8')
            media_type = "text/markdown"
            filename = f"result_{task_id}.md"
        else:
            raise HTTPException(status_code=400, detail=f"不支持的格式: {format}")
        
        return Response(
            content=content,
            media_type=media_type,
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
    
    @router.get("/components", response_model=Dict[str, Any])
    async def list_components(doc_parser: DocParser = Depends(get_doc_parser)):
        """列出所有组件"""
        try:
            components_info = doc_parser.component_manager.list_components()
            
            # 转换为响应模型
            component_list = []
            for comp_data in components_info:
                component_list.append(ComponentInfo(
                    component_id=comp_data["component_id"],
                    name=comp_data["name"],
                    description=comp_data["description"],
                    component_type="cloud" if comp_data.get("base_url") else "local",
                    is_installed=comp_data["is_installed"],
                    is_enabled=comp_data["is_enabled"],
                    version=comp_data.get("version", "1.0.0"),
                    install_size_mb=comp_data.get("install_size_mb"),
                    required_packages=comp_data.get("required_packages", []),
                    capabilities={},  # TODO: 从实际组件获取
                    metadata=comp_data.get("metadata", {})
                ))
            
            return {
                "components": component_list,
                "total": len(component_list),
                "installed": len([c for c in component_list if c.is_installed])
            }
            
        except Exception as e:
            logger.error(f"列出组件失败: {e}")
            raise HTTPException(status_code=500, detail=f"列出组件失败: {str(e)}")
    
    @router.post("/components/install", response_model=ComponentInstallResponse)
    async def install_component(
        request: ComponentInstallRequest,
        doc_parser: DocParser = Depends(get_doc_parser)
    ):
        """安装组件"""
        try:
            kwargs = {}
            if request.tier:
                kwargs["tier"] = request.tier
            if request.api_key:
                kwargs["api_key"] = request.api_key
            
            success = await doc_parser.install_component(request.component_id, **kwargs)
            
            return ComponentInstallResponse(
                success=success,
                component_id=request.component_id,
                message="安装成功" if success else "安装失败"
            )
            
        except Exception as e:
            logger.error(f"安装组件失败: {e}")
            return ComponentInstallResponse(
                success=False,
                component_id=request.component_id,
                error=str(e)
            )
    
    @router.delete("/components/uninstall/{component_id}", response_model=ComponentInstallResponse)
    async def uninstall_component(
        component_id: str,
        doc_parser: DocParser = Depends(get_doc_parser)
    ):
        """卸载组件"""
        try:
            success = await doc_parser.uninstall_component(component_id)
            
            return ComponentInstallResponse(
                success=success,
                component_id=component_id,
                message="卸载成功" if success else "卸载失败"
            )
            
        except Exception as e:
            logger.error(f"卸载组件失败: {e}")
            return ComponentInstallResponse(
                success=False,
                component_id=component_id,
                error=str(e)
            )
    
    @router.post("/components/config", response_model=ComponentInstallResponse)
    async def configure_cloud_component(request: CloudConfigRequest):
        """配置云端组件"""
        try:
            from .. import DocParser
            doc_parser = DocParser()
            if doc_parser.component_manager is None:
                await doc_parser.initialize()
            
            component = doc_parser.component_manager.get_component(request.component_id)
            if not component:
                return ComponentInstallResponse(
                    success=False,
                    component_id=request.component_id,
                    error=f"组件不存在: {request.component_id}"
                )
            
            # 配置组件
            if hasattr(component, 'configure'):
                success = await component.configure(request.api_key)
                return ComponentInstallResponse(
                    success=success,
                    component_id=request.component_id,
                    message="配置成功" if success else "配置失败"
                )
            else:
                return ComponentInstallResponse(
                    success=False,
                    component_id=request.component_id,
                    error="该组件不支持配置"
                )
                
        except Exception as e:
            logger.error(f"配置云端组件失败: {e}")
            return ComponentInstallResponse(
                success=False,
                component_id=request.component_id,
                error=str(e)
            )
    
    @router.post("/components/test", response_model=CloudTestResponse)
    async def test_cloud_connection(request: CloudConfigRequest):
        """测试云端连接 - 特别支持MinerU云端测试"""
        try:
            from .. import DocParser
            doc_parser = DocParser()
            if doc_parser.component_manager is None:
                await doc_parser.initialize()

            # 支持MinerU云端的特殊测试逻辑
            if request.component_id == "advanced_mineru_cloud":
                # 使用专门的MinerU测试方法
                component = doc_parser.component_manager.get_component(request.component_id)
                if component and hasattr(component, 'test_connection'):
                    # 临时配置测试
                    original_api_key = getattr(component, 'api_key', None)
                    try:
                        component.api_key = request.api_key
                        test_result = await component.test_connection()
                        return CloudTestResponse(
                            success=test_result,
                            message="MinerU云端连接测试成功" if test_result else "连接测试失败",
                            error=None
                        )
                    finally:
                        # 恢复原始配置
                        component.api_key = original_api_key
                else:
                    return CloudTestResponse(
                        success=False,
                        message="",
                        error="MinerU云端组件不可用"
                    )
            else:
                # 其他云端组件的标准测试
                result = await doc_parser.test_cloud_connection(request.component_id, request.api_key)

                return CloudTestResponse(
                    success=result["success"],
                    message=result.get("message"),
                    error=result.get("error")
                )
            
        except Exception as e:
            logger.error(f"云端连接测试失败: {e}")
            return CloudTestResponse(
                success=False,
                message="",
                error=f"云端连接测试异常: {str(e)}"
            )
    
    @router.get("/system/env-report", response_model=EnvironmentReport)
    async def get_environment_report():
        """获取环境检测报告"""
        try:
            from .. import DocParser
            doc_parser = DocParser()
            if doc_parser.component_manager is None:
                await doc_parser.initialize()
            
            report = await doc_parser.get_environment_report()
            
            # 转换为响应模型
            system_info = report["system_info"]
            return EnvironmentReport(
                system_info=SystemInfo(**system_info),
                hardware_tier=system_info.get("hardware_tier", "unknown"),
                recommendations=report["recommendations"],
                installed_components=report["installed_components"],
                total_components=report["total_components"]
            )
            
        except Exception as e:
            logger.error(f"获取环境报告失败: {e}")
            raise HTTPException(status_code=500, detail=f"获取环境报告失败: {str(e)}")
    
    @router.get("/config")
    async def get_config():
        """获取当前配置（持久化存储）"""
        try:
            store = get_settings_store()
            return {"success": True, "config": store.get_all()}
        except Exception as e:
            logger.error(f"获取配置失败: {e}")
            return {"success": False, "config": {}, "error": str(e)}

    @router.put("/config")
    async def update_config(request: Dict[str, Any]):
        """更新配置（持久化保存到本地文件）"""
        try:
            store = get_settings_store()
            store.update(request)
            logger.info("配置已更新并持久化保存")
            return {"success": True, "config": store.get_all()}
        except Exception as e:
            logger.error(f"更新配置失败: {e}")
            return {"success": False, "config": {}, "error": str(e)}

    @router.post("/config/reset")
    async def reset_config():
        """重置配置为默认值"""
        try:
            store = get_settings_store()
            store.reset_to_defaults()
            logger.info("配置已重置为默认值")
            return {"success": True, "config": store.get_all()}
        except Exception as e:
            logger.error(f"重置配置失败: {e}")
            return {"success": False, "config": {}, "error": str(e)}

    @router.get("/settings")
    async def get_all_settings():
        """获取完整设置（包括处理、隐私、文件管理、界面等所有配置）"""
        try:
            store = get_settings_store()
            return {"success": True, "settings": store.get_all()}
        except Exception as e:
            logger.error(f"获取设置失败: {e}")
            return {"success": False, "settings": {}, "error": str(e)}

    @router.put("/settings")
    async def update_all_settings(request: Dict[str, Any]):
        """更新完整设置（持久化保存到本地文件）"""
        try:
            store = get_settings_store()
            store.update(request)
            logger.info("设置已更新并持久化保存")
            return {"success": True, "settings": store.get_all()}
        except Exception as e:
            logger.error(f"更新设置失败: {e}")
            return {"success": False, "settings": {}, "error": str(e)}

    @router.post("/settings/section/{section}")
    async def update_settings_section(section: str, request: Dict[str, Any]):
        """更新特定配置段（如 processing、privacy、ui 等）"""
        try:
            store = get_settings_store()
            store.update_section(section, request)
            logger.info(f"配置段 {section} 已更新")
            return {"success": True, "section": section, "data": store.get(section)}
        except Exception as e:
            logger.error(f"更新配置段失败: {e}")
            return {"success": False, "error": str(e)}
    
    # ─── 历史记录 API ──────────────────────────────────────────

    @router.get("/history")
    async def list_history(limit: int = 50, offset: int = 0, status: Optional[str] = None):
        """获取处理历史记录列表"""
        try:
            tasks = []
            for task_id, task_info in processing_tasks.items():
                if status and task_info.get("status") != status:
                    continue

                created_at = task_info.get("created_at")
                if isinstance(created_at, datetime):
                    created_at_str = created_at.isoformat()
                else:
                    created_at_str = str(created_at) if created_at else ""

                file_path = task_info.get("file_path", "")
                file_name = file_path.replace("\\", "/").split("/")[-1] if file_path else ""

                ext = file_name.rsplit(".", 1)[-1].upper() if "." in file_name else "UNKNOWN"

                # 计算耗时
                duration_str = ""
                if task_info.get("status") == "completed" and created_at:
                    try:
                        if isinstance(created_at, datetime):
                            duration = (datetime.now() - created_at).total_seconds()
                            duration_str = f"{duration:.1f}s"
                    except Exception:
                        pass

                tasks.append({
                    "id": task_id,
                    "task_id": task_id,
                    "file_name": file_name,
                    "file_path": file_path,
                    "file_type": ext,
                    "file_size": None,
                    "status": task_info.get("status", "unknown"),
                    "progress": task_info.get("progress", 0.0),
                    "created_at": created_at_str,
                    "duration": duration_str,
                    "error": task_info.get("error"),
                    "result_available": task_info.get("result") is not None,
                    "routing_info": task_info.get("routing_info"),
                })

            tasks.sort(key=lambda x: x.get("created_at", ""), reverse=True)

            total = len(tasks)
            paged = tasks[offset: offset + limit]

            # 统计
            success_count = len([t for t in tasks if t["status"] == "completed"])
            failed_count = len([t for t in tasks if t["status"] == "failed"])
            pending_count = len([t for t in tasks if t["status"] in ("processing", "queuing")])
            today_count = len([t for t in tasks if t["created_at"].startswith(datetime.now().strftime("%Y-%m-%d"))]) if tasks else 0

            return {
                "records": paged,
                "total": total,
                "offset": offset,
                "limit": limit,
                "statistics": {
                    "total": total,
                    "success": success_count,
                    "failed": failed_count,
                    "pending": pending_count,
                    "today": today_count,
                    "success_rate": round(success_count / total * 100, 1) if total > 0 else 0,
                }
            }
        except Exception as e:
            logger.error(f"获取历史记录失败: {e}")
            raise HTTPException(status_code=500, detail=f"获取历史记录失败: {str(e)}")

    @router.delete("/history/{task_id}")
    async def delete_history_record(task_id: str):
        """删除历史记录"""
        if task_id not in processing_tasks:
            raise HTTPException(status_code=404, detail="记录不存在")

        try:
            del processing_tasks[task_id]
            logger.info(f"历史记录已删除: {task_id}")
            return {"success": True, "task_id": task_id}
        except Exception as e:
            logger.error(f"删除历史记录失败: {e}")
            return {"success": False, "error": str(e)}

    @router.get("/history/{task_id}/detail")
    async def get_history_detail(task_id: str):
        """获取历史记录详情"""
        if task_id not in processing_tasks:
            raise HTTPException(status_code=404, detail="记录不存在")

        task_info = processing_tasks[task_id]
        return {
            "task_id": task_id,
            "status": task_info.get("status"),
            "progress": task_info.get("progress", 0.0),
            "file_path": task_info.get("file_path", ""),
            "error": task_info.get("error"),
            "result": task_info.get("result"),
            "routing_info": task_info.get("routing_info"),
            "created_at": task_info.get("created_at").isoformat() if isinstance(task_info.get("created_at"), datetime) else "",
        }

    @router.post("/history/export")
    async def export_history(request: Dict[str, Any]):
        """导出历史记录"""
        try:
            fmt = request.get("format", "json")
            records = []
            for task_id, task_info in processing_tasks.items():
                records.append({
                    "task_id": task_id,
                    "file_path": task_info.get("file_path", ""),
                    "status": task_info.get("status"),
                    "progress": task_info.get("progress"),
                    "created_at": task_info.get("created_at").isoformat() if isinstance(task_info.get("created_at"), datetime) else "",
                    "error": task_info.get("error"),
                })

            if fmt == "json":
                content = json.dumps({"records": records, "exported_at": datetime.now().isoformat()}, ensure_ascii=False, indent=2)
                return Response(
                    content=content.encode("utf-8"),
                    media_type="application/json",
                    headers={"Content-Disposition": f"attachment; filename=history_{datetime.now().strftime('%Y%m%d')}.json"}
                )
            elif fmt == "csv":
                import csv
                import io
                output = io.StringIO()
                writer = csv.writer(output)
                writer.writerow(["task_id", "file_path", "status", "progress", "created_at", "error"])
                for r in records:
                    writer.writerow([r["task_id"], r["file_path"], r["status"], r["progress"], r["created_at"], r.get("error", "")])
                return Response(
                    content=output.getvalue().encode("utf-8-sig"),
                    media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=history_{datetime.now().strftime('%Y%m%d')}.csv"}
                )
            else:
                raise HTTPException(status_code=400, detail=f"不支持的格式: {fmt}")
        except Exception as e:
            logger.error(f"导出历史记录失败: {e}")
            raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")

    # ─── 脱敏规则编辑器 API ──────────────────────────────────────
    
    @router.get("/redaction/rules")
    async def list_redaction_rules():
        """列出脱敏规则"""
        from ..components.redaction_editor import redaction_editor
        rules = await redaction_editor.list_rules()
        stats = await redaction_editor.get_statistics()
        return {"rules": rules, "statistics": stats}
    
    @router.post("/redaction/rules")
    async def create_redaction_rule(request: Dict[str, Any]):
        """创建脱敏规则"""
        from ..components.redaction_editor import redaction_editor
        rule_id = await redaction_editor.create_rule(
            name=request["name"],
            pattern=request["pattern"],
            replacement=request.get("replacement", "***REDACTED***"),
            strategy=request.get("strategy", "mask"),
            description=request.get("description", ""),
            tags=request.get("tags", [])
        )
        return {"success": True, "rule_id": rule_id}
    
    @router.get("/redaction/rules/{rule_id}")
    async def get_redaction_rule(rule_id: str):
        """获取单个脱敏规则"""
        from ..components.redaction_editor import redaction_editor
        rules = await redaction_editor.list_rules()
        rule = next((r for r in rules if r["rule_id"] == rule_id), None)
        if not rule:
            raise HTTPException(status_code=404, detail="规则不存在")
        return rule
    
    @router.put("/redaction/rules/{rule_id}")
    async def update_redaction_rule(rule_id: str, request: Dict[str, Any]):
        """更新脱敏规则"""
        from ..components.redaction_editor import redaction_editor
        success = await redaction_editor.update_rule(rule_id, **request)
        return {"success": success}
    
    @router.delete("/redaction/rules/{rule_id}")
    async def delete_redaction_rule(rule_id: str):
        """删除脱敏规则"""
        from ..components.redaction_editor import redaction_editor
        success = await redaction_editor.delete_rule(rule_id)
        return {"success": success}
    
    @router.post("/redaction/rules/{rule_id}/toggle")
    async def toggle_redaction_rule(rule_id: str, request: Dict[str, Any]):
        """启用/禁用脱敏规则"""
        from ..components.redaction_editor import redaction_editor
        enabled = request.get("enabled", True)
        success = await redaction_editor.update_rule(rule_id, enabled=enabled)
        return {"success": success}
    
    @router.post("/redaction/test")
    async def test_redaction_pattern(request: Dict[str, Any]):
        """测试脱敏规则"""
        from ..components.redaction_editor import redaction_editor
        result = await redaction_editor.test_pattern(
            pattern=request["pattern"],
            replacement=request.get("replacement", "***REDACTED***"),
            strategy=request.get("strategy", "mask"),
            test_text=request["test_text"]
        )
        return result
    
    @router.post("/redaction/import-presets")
    async def import_redaction_presets():
        """导入所有预设脱敏规则"""
        from ..components.redaction_editor import redaction_editor
        rule_ids = await redaction_editor.import_all_presets()
        return {"success": True, "imported": len(rule_ids), "rule_ids": rule_ids}
    
    @router.get("/redaction/templates")
    async def get_redaction_templates():
        """获取预设模板列表"""
        from ..components.redaction_editor import redaction_editor
        templates = await redaction_editor.get_rule_templates()
        return {"templates": templates}
    
    @router.get("/redaction/statistics")
    async def get_redaction_statistics():
        """获取脱敏规则统计"""
        from ..components.redaction_editor import redaction_editor
        return await redaction_editor.get_statistics()
    
    # ─── 批量处理 API ──────────────────────────────────────────
    
    @router.post("/batch/create")
    async def create_batch_task(request: Dict[str, Any]):
        """创建批量处理任务"""
        from ..batch_processor import batch_processor
        task_id = await batch_processor.create_batch_task(
            file_paths=request["file_paths"],
            task_name=request.get("task_name", "批量处理"),
            options=request.get("options", {})
        )
        return {"task_id": task_id, "total_files": len(request["file_paths"])}
    
    @router.post("/batch/{task_id}/start")
    async def start_batch_task(task_id: str, doc_parser: DocParser = Depends(get_doc_parser)):
        """启动批量处理任务"""
        from ..batch_processor import batch_processor
        
        async def parse_func(file_path: str, options: Dict[str, Any]):
            return await doc_parser._parse_document_with_routing(file_path, options)
        
        success = await batch_processor.start_batch_task(task_id, parse_func)
        return {"success": success, "task_id": task_id}
    
    @router.get("/batch/{task_id}/status")
    async def get_batch_status(task_id: str):
        """获取批量任务状态"""
        from ..batch_processor import batch_processor
        status = batch_processor.get_task_status(task_id)
        if not status:
            raise HTTPException(status_code=404, detail="任务不存在")
        return status
    
    @router.get("/batch/{task_id}/result")
    async def get_batch_result(task_id: str):
        """获取批量任务结果"""
        from ..batch_processor import batch_processor
        result = batch_processor.get_task_result(task_id)
        if not result:
            raise HTTPException(status_code=404, detail="任务不存在")
        return result
    
    @router.post("/batch/{task_id}/cancel")
    async def cancel_batch_task(task_id: str):
        """取消批量任务"""
        from ..batch_processor import batch_processor
        success = await batch_processor.cancel_batch_task(task_id)
        return {"success": success}
    
    @router.get("/batch/list")
    async def list_batch_tasks(status: Optional[str] = None):
        """列出批量任务"""
        from ..batch_processor import batch_processor, BatchTaskStatus
        task_status = None
        if status:
            try:
                task_status = BatchTaskStatus(status)
            except ValueError:
                pass
        return {"tasks": batch_processor.list_tasks(task_status)}
    
    @router.post("/batch/{task_id}/export")
    async def export_batch_result(task_id: str, request: Dict[str, Any]):
        """导出批量处理结果"""
        from ..batch_processor import batch_processor
        export_path = await batch_processor.export_results(
            task_id,
            request.get("output_dir", "./exports"),
            request.get("format", "json")
        )
        return {"success": True, "export_path": export_path}
    
    # ─── 仲裁场景 API ──────────────────────────────────────────
    
    @router.post("/arbitration/review")
    async def review_award(request: Dict[str, Any]):
        """核阅仲裁裁决书"""
        from ..arbitration import AwardReviewer
        reviewer = AwardReviewer()
        result = await reviewer.review(request["award_text"], request.get("metadata", {}))
        return result.to_dict()
    
    @router.post("/arbitration/review/{review_id}/export")
    async def export_review_report(review_id: str, request: Dict[str, Any]):
        """导出核阅报告"""
        from ..arbitration import AwardReviewer
        reviewer = AwardReviewer()
        # 在实际实现中，review_id需要从存储中恢复
        # 这里简化处理
        report = await reviewer.export_review_report(request.get("result"))
        return {"report": report}
    
    @router.get("/arbitration/knowledge/search")
    async def search_knowledge(
        q: str = "",
        entry_type: Optional[str] = None,
        tags: Optional[str] = None,
        limit: int = 10
    ):
        """搜索仲裁知识库"""
        from ..arbitration import ArbitrationKnowledgeBase
        kb = ArbitrationKnowledgeBase()
        tag_list = tags.split(",") if tags else None
        results = await kb.search(q, entry_type, tag_list, limit)
        return {"results": results, "total": len(results)}
    
    @router.post("/arbitration/knowledge/import")
    async def import_knowledge_from_doc(request: Dict[str, Any]):
        """从文档导入知识"""
        from ..arbitration import ArbitrationKnowledgeBase
        kb = ArbitrationKnowledgeBase()
        entry_ids = await kb.import_from_document(
            request["text"],
            request.get("doc_type", "case"),
            request.get("auto_tag", True)
        )
        return {"imported": len(entry_ids), "entry_ids": entry_ids}
    
    @router.get("/arbitration/knowledge/stats")
    async def get_knowledge_stats():
        """获取知识库统计"""
        from ..arbitration import ArbitrationKnowledgeBase
        kb = ArbitrationKnowledgeBase()
        return await kb.get_statistics()
    
    return router