# -*- coding: utf-8 -*-
"""
文档处理前端模块 - 纯静态HTML+JavaScript实现
"""

import os
from pathlib import Path

# 前端资源目录
FRONTEND_DIR = Path(__file__).parent
STATIC_DIR = FRONTEND_DIR / "static"

# 确保静态文件目录存在
if not STATIC_DIR.exists():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)

# 导出前端路由创建函数
from .routes import create_frontend_router

__all__ = ['create_frontend_router', 'FRONTEND_DIR', 'STATIC_DIR']