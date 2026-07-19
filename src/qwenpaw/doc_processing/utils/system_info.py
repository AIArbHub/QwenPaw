# -*- coding: utf-8 -*-
"""
系统信息检测工具
用于检测硬件配置、操作系统、依赖等环境信息
"""

import os
import sys
import platform
import psutil
from typing import Dict, Any
import subprocess


class SystemInfoDetector:
    """系统信息检测器"""
    
    def __init__(self):
        self._system_info: Dict[str, Any] = {}
    
    async def detect(self) -> Dict[str, Any]:
        """检测系统信息"""
        self._system_info = {
            # 基本信息
            "platform": sys.platform,
            "platform_name": platform.system(),
            "architecture": platform.architecture()[0],
            "machine": platform.machine(),
            "python_version": platform.python_version(),
            
            # 内存信息
            "total_memory_mb": round(psutil.virtual_memory().total / (1024 * 1024)),
            "available_memory_mb": round(psutil.virtual_memory().available / (1024 * 1024)),
            "memory_percent": psutil.virtual_memory().percent,
            
            # 磁盘信息
            "total_disk_mb": round(psutil.disk_usage('/').total / (1024 * 1024)),
            "free_disk_mb": round(psutil.disk_usage('/').free / (1024 * 1024)),
            "disk_percent": psutil.disk_usage('/').percent,
            
            # CPU信息
            "cpu_count": psutil.cpu_count(),
            "cpu_percent": psutil.cpu_percent(interval=1),
            
            # GPU信息
            "gpu_info": self._detect_gpu(),
            
            # 系统级依赖
            "system_deps": await self._detect_system_dependencies()
        }
        
        return self._system_info
    
    def get_info(self) -> Dict[str, Any]:
        """获取系统信息"""
        return self._system_info
    
    def _detect_gpu(self) -> Dict[str, Any]:
        """检测GPU信息"""
        gpu_info = {
            "has_nvidia": False,
            "has_amd": False,
            "has_intel": False,
            "devices": []
        }
        
        try:
            # 检测NVIDIA GPU
            if sys.platform == "win32":
                # Windows平台通过WMI检测
                result = subprocess.run(
                    ["wmic", "path", "win32_VideoController", "get", "name"],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode == 0:
                    output = result.stdout.lower()
                    if "nvidia" in output:
                        gpu_info["has_nvidia"] = True
                    if "amd" in output or "radeon" in output:
                        gpu_info["has_amd"] = True
                    if "intel" in output:
                        gpu_info["has_intel"] = True
                    
                    # 提取设备名称
                    lines = [line.strip() for line in result.stdout.split('\n') if line.strip()]
                    gpu_info["devices"] = lines[1:] if len(lines) > 1 else []
            
            elif sys.platform == "darwin":
                # macOS平台
                result = subprocess.run(
                    ["system_profiler", "SPDisplaysDataType"],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode == 0:
                    output = result.stdout.lower()
                    if "nvidia" in output:
                        gpu_info["has_nvidia"] = True
                    if "amd" in output or "radeon" in output:
                        gpu_info["has_amd"] = True
                    if "intel" in output:
                        gpu_info["has_intel"] = True
            
            else:
                # Linux平台
                # 尝试nvidia-smi
                result = subprocess.run(
                    ["nvidia-smi", "-L"], 
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    gpu_info["has_nvidia"] = True
                    for line in result.stdout.strip().split('\n'):
                        if line.strip():
                            gpu_info["devices"].append(line.strip())
                
                # 尝试lspci检测其他GPU
                result = subprocess.run(
                    ["lspci"], 
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    output = result.stdout.lower()
                    if "amd" in output or "radeon" in output:
                        gpu_info["has_amd"] = True
                    if "intel" in output:
                        gpu_info["has_intel"] = True
        
        except (subprocess.SubprocessError, FileNotFoundError, TimeoutError):
            # 忽略检测错误
            pass
        
        return gpu_info
    
    async def _detect_system_dependencies(self) -> Dict[str, bool]:
        """检测系统级依赖"""
        deps = {
            "tesseract": False,
            "poppler": False,
            "pandoc": False,
        }
        
        try:
            # 检测Tesseract OCR
            result = subprocess.run(
                ["tesseract", "--version"], 
                capture_output=True, text=True, timeout=5
            )
            deps["tesseract"] = result.returncode == 0
        
        except (subprocess.SubprocessError, FileNotFoundError):
            deps["tesseract"] = False
        
        try:
            # 检测Poppler (pdfimages)
            result = subprocess.run(
                ["pdfimages", "-v"], 
                capture_output=True, text=True, timeout=5
            )
            deps["poppler"] = result.returncode == 0
        
        except (subprocess.SubprocessError, FileNotFoundError):
            deps["poppler"] = False
        
        try:
            # 检测Pandoc
            result = subprocess.run(
                ["pandoc", "--version"], 
                capture_output=True, text=True, timeout=5
            )
            deps["pandoc"] = result.returncode == 0
        
        except (subprocess.SubprocessError, FileNotFoundError):
            deps["pandoc"] = False
        
        return deps
    
    def get_hardware_tier(self) -> str:
        """根据硬件配置确定档位"""
        if not self._system_info:
            return "unknown"
        
        memory_mb = self._system_info.get("total_memory_mb", 0)
        cpu_count = self._system_info.get("cpu_count", 0)
        has_gpu = any([
            self._system_info.get("gpu_info", {}).get("has_nvidia", False),
            self._system_info.get("gpu_info", {}).get("has_amd", False),
        ])
        
        if memory_mb >= 16000 and cpu_count >= 8 and has_gpu:
            return "high"
        elif memory_mb >= 8000 and cpu_count >= 4:
            return "medium"
        elif memory_mb >= 4000 and cpu_count >= 2:
            return "low"
        else:
            return "minimal"