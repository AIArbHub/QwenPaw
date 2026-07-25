# -*- coding: utf-8 -*-
"""
文档处理前端路由 - 纯静态HTML+JavaScript实现
"""

from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from ...utils.logging import logger

STATIC_DIR = Path(__file__).parent / "static"


def create_frontend_router() -> APIRouter:
    """创建前端路由"""
    router = APIRouter(prefix="/doc/ui", tags=["doc_frontend"])

    # 挂载静态文件目录
    router.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @router.get("/", response_class=HTMLResponse)
    async def index():
        """主页 - 重定向到设置页"""
        html_path = STATIC_DIR / "index.html"
        if html_path.exists():
            return FileResponse(str(html_path), media_type="text/html")
        # 如果index不存在，返回一个简单的导航页
        return HTMLResponse(content=_get_nav_page())

    @router.get("/settings", response_class=HTMLResponse)
    async def settings_page():
        """设置页"""
        html_path = STATIC_DIR / "settings.html"
        if html_path.exists():
            return FileResponse(str(html_path), media_type="text/html")
        return HTMLResponse(content="<h1>设置页未找到</h1>", status_code=404)

    @router.get("/history", response_class=HTMLResponse)
    async def history_page():
        """历史记录页"""
        html_path = STATIC_DIR / "history.html"
        if html_path.exists():
            return FileResponse(str(html_path), media_type="text/html")
        return HTMLResponse(content="<h1>历史记录页未找到</h1>", status_code=404)

    @router.get("/components", response_class=HTMLResponse)
    async def components_page():
        """组件管理页"""
        html_path = STATIC_DIR / "components.html"
        if html_path.exists():
            return FileResponse(str(html_path), media_type="text/html")
        return HTMLResponse(content="<h1>组件管理页未找到</h1>", status_code=404)

    @router.get("/redaction", response_class=HTMLResponse)
    async def redaction_page():
        """脱敏规则编辑器页"""
        html_path = STATIC_DIR / "redaction.html"
        if html_path.exists():
            return FileResponse(str(html_path), media_type="text/html")
        return HTMLResponse(content="<h1>脱敏规则编辑器未找到</h1>", status_code=404)

    logger.info("前端路由已创建")
    return router


def _get_nav_page() -> str:
    """生成导航页HTML"""
    return """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Arb 文档处理系统</title>
    <style>
        body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; margin: 0; padding: 40px; }
        .nav-container { max-width: 600px; margin: 0 auto; }
        h1 { color: #2c3e50; text-align: center; }
        .nav-links { display: flex; flex-direction: column; gap: 15px; margin-top: 30px; }
        .nav-link { display: block; padding: 20px; background: white; border-radius: 10px; text-decoration: none; color: #2c3e50; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: all 0.3s; }
        .nav-link:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .nav-link h3 { margin: 0 0 5px 0; color: #3498db; }
        .nav-link p { margin: 0; color: #7f8c8d; font-size: 14px; }
    </style>
</head>
<body>
    <div class="nav-container">
        <h1>AI Arb 文档处理系统</h1>
        <div class="nav-links">
            <a href="/doc/ui/components" class="nav-link">
                <h3>组件管理</h3>
                <p>安装、配置和管理文档处理组件</p>
            </a>
            <a href="/doc/ui/redaction" class="nav-link">
                <h3>脱敏规则</h3>
                <p>自定义脱敏规则编辑器和预设模板</p>
            </a>
            <a href="/doc/ui/settings" class="nav-link">
                <h3>系统设置</h3>
                <p>配置API密钥、处理选项和隐私设置</p>
            </a>
            <a href="/doc/ui/history" class="nav-link">
                <h3>历史记录</h3>
                <p>查看文档处理历史记录</p>
            </a>
        </div>
    </div>
</body>
</html>"""
