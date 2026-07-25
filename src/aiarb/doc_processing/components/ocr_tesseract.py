# -*- coding: utf-8 -*-
"""
Tesseract OCR组件 - 轻量OCR实现
基于系统Tesseract引擎的超轻量OCR方案
"""

from typing import Dict, Any, Optional, List
import asyncio
import pytesseract
import pdf2image
from PIL import Image
import tempfile
import os
from pathlib import Path

from .component_manager import LocalComponent
from . import ParseResult
from ...utils.logging import logger


class TesseractOCRComponent(LocalComponent):
    """Tesseract OCR轻量组件"""
    
    def __init__(self):
        super().__init__(
            component_id="ocr_tesseract",
            name="Tesseract OCR轻量识别",
            description="基于系统Tesseract引擎的超轻量OCR文字识别，支持多语言和PDF扫描件",
            install_size_mb=50.0
        )
        
        self.required_packages = ["pytesseract", "Pillow", "pdf2image"]
        self.required_system_deps = ["tesseract-ocr"]
        
        # 语言包配置
        self.supported_languages = {
            "chi_sim": "简体中文",
            "chi_tra": "繁体中文", 
            "eng": "英语",
            "fra": "法语",
            "deu": "德语",
            "jpn": "日语",
            "kor": "韩语"
        }
        
        # 默认语言
        self.default_language = "eng+chi_sim"
    
    async def initialize(self, manager) -> bool:
        """初始化组件"""
        try:
            # 检查Python依赖
            if not await self._check_python_dependencies():
                return False
            
            # 检查系统依赖
            if not await self._check_system_dependencies():
                return False
            
            self.is_installed = True
            self.is_enabled = True
            
            # 测试OCR功能
            if not await self._test_ocr_functionality():
                logger.warning("Tesseract OCR功能测试失败")
                return False
            
            logger.info("Tesseract OCR组件初始化成功")
            return True
            
        except Exception as e:
            logger.error(f"Tesseract OCR组件初始化失败: {e}")
            return False
    
    async def _check_python_dependencies(self) -> bool:
        """检查Python依赖包"""
        try:
            import pytesseract
            from PIL import Image
            import pdf2image
            return True
        except ImportError as e:
            logger.error(f"缺少Python依赖: {e}")
            return False
    
    async def _check_system_dependencies(self) -> bool:
        """检查系统依赖"""
        try:
            # 检查tesseract可执行文件
            import subprocess
            result = subprocess.run(
                ["tesseract", "--version"],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0:
                logger.debug(f"Tesseract版本: {result.stdout.strip()}")
                return True
            else:
                logger.error("Tesseract系统依赖检查失败")
                return False
                
        except (subprocess.SubprocessError, FileNotFoundError, TimeoutError) as e:
            logger.error(f"Tesseract未安装或路径配置错误: {e}")
            return False
    
    async def _test_ocr_functionality(self) -> bool:
        """测试OCR功能"""
        try:
            # 创建简单的测试图片
            from PIL import Image, ImageDraw, ImageFont
            
            # 创建白底黑字的简单图片
            img = Image.new('RGB', (200, 50), color='white')
            draw = ImageDraw.Draw(img)
            
            # 绘制简单文本（如果系统有字体）
            try:
                draw.text((10, 20), "Test 123", fill='black')
            except Exception:
                # 字体不可用，直接进行简单测试
                pass
            
            # 临时文件测试
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                img.save(tmp.name)
                
                try:
                    text = pytesseract.image_to_string(
                        tmp.name,
                        lang=self.default_language
                    )
                    logger.debug(f"OCR测试结果: {repr(text)}")
                    return True
                finally:
                    os.unlink(tmp.name)
                    
        except Exception as e:
            logger.error(f"OCR功能测试失败: {e}")
            return False
    
    async def parse_document(
        self, 
        file_path: str, 
        options: Dict[str, Any] = None
    ) -> 'ParseResult':
        """OCR解析文档"""
        
        options = options or {}
        
        # 获取配置选项
        language = options.get("language", self.default_language)
        dpi = options.get("dpi", 300)
        pages = options.get("pages", None)  # PDF指定页面
        
        try:
            file_path_obj = Path(file_path)
            
            if not file_path_obj.exists():
                raise FileNotFoundError(f"文件不存在: {file_path}")
            
            # 根据文件类型处理
            if file_path_obj.suffix.lower() == '.pdf':
                return await self._parse_pdf_with_ocr(
                    file_path, language, dpi, pages
                )
            else:
                # 图片文件直接OCR
                return await self._parse_image_with_ocr(file_path, language)
                
        except Exception as e:
            logger.error(f"Tesseract OCR解析失败: {e}")
            raise
    
    async def _parse_pdf_with_ocr(
        self, 
        pdf_path: str, 
        language: str, 
        dpi: int,
        pages: Optional[List[int]]
    ) -> 'ParseResult':
        """使用OCR解析PDF"""
        
        try:
            # 将PDF转换为图片
            def convert_pdf_to_images():
                try:
                    # 尝试使用poppler
                    images = pdf2image.convert_from_path(
                        pdf_path,
                        dpi=dpi,
                        first_page=pages[0] if pages else None,
                        last_page=pages[-1] if pages else None,
                        poppler_path=None  # 使用系统默认路径
                    )
                    return images
                except Exception as e:
                    logger.warning(f"pdf2image转换失败，尝试替代方法: {e}")
                    # 这里可以实现PDFium等替代方案
                    raise
            
            # 异步执行转换
            images = await asyncio.get_event_loop().run_in_executor(
                None, convert_pdf_to_images
            )
            
            # 对每张图片进行OCR
            text_parts = []
            
            for page_num, image in enumerate(images, 1):
                def ocr_single_image(img):
                    return pytesseract.image_to_string(img, lang=language)
                
                page_text = await asyncio.get_event_loop().run_in_executor(
                    None, ocr_single_image, image
                )
                
                if page_text.strip():
                    text_parts.append(f"=== 第{page_num}页 OCR结果 ===\n{page_text.strip()}")
                else:
                    text_parts.append(f"=== 第{page_num}页 OCR结果 ===\n(未识别到文本)")
            
            full_text = "\n\n".join(text_parts)
            
            # 生成Markdown格式
            markdown = f"# PDF OCR识别结果\n\n{full_text}"
            
            return ParseResult(
                text=full_text,
                markdown=markdown,
                engine_info={
                    "engine": "tesseract_ocr_pdf",
                    "page_count": len(images),
                    "language": language,
                    "dpi": dpi,
                    "is_cloud": False,
                    "cost": 0.0,
                    "ocr_accuracy": "medium"  # OCR准确率评估
                },
                metadata={
                    "file_type": "pdf_ocr",
                    "language": language,
                    "dpi": dpi,
                    "page_count": len(images)
                }
            )
            
        except Exception as e:
            logger.error(f"PDF OCR解析失败: {e}")
            raise
    
    async def _parse_image_with_ocr(
        self, 
        image_path: str, 
        language: str
    ) -> 'ParseResult':
        """OCR解析图片"""
        
        try:
            # 打开图片并预处理
            def load_and_preprocess_image():
                from PIL import Image, ImageEnhance, ImageFilter
                
                # 打开图片
                img = Image.open(image_path)
                
                # 转换为RGB
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # 图像预处理增强
                # 增加对比度
                enhancer = ImageEnhance.Contrast(img)
                img = enhancer.enhance(1.5)
                
                # 锐化
                enhancer = ImageEnhance.Sharpness(img)
                img = enhancer.enhance(2.0)
                
                # 转换为灰度图再转回RGB（有助于OCR）
                img = img.convert('L').convert('RGB')
                
                return img
            
            processed_image = await asyncio.get_event_loop().run_in_executor(
                None, load_and_preprocess_image
            )
            
            # 执行OCR
            def perform_ocr(img):
                # 获取OCR详细信息
                data = pytesseract.image_to_data(
                    img, 
                    lang=language, 
                    output_type=pytesseract.Output.DICT
                )
                return data
            
            ocr_data = await asyncio.get_event_loop().run_in_executor(
                None, perform_ocr, processed_image
            )
            
            # 提取文本和统计信息
            text_parts = []
            confidence_scores = []
            
            for i, text in enumerate(ocr_data['text']):
                if text.strip() and ocr_data['conf'][i] > 0:
                    text_parts.append(text)
                    confidence_scores.append(ocr_data['conf'][i])
            
            full_text = " ".join(text_parts) if text_parts else ""
            avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0
            
            # 生成Markdown格式
            markdown = full_text
            
            return ParseResult(
                text=full_text,
                markdown=markdown,
                engine_info={
                    "engine": "tesseract_ocr_image",
                    "language": language,
                    "avg_confidence": avg_confidence,
                    "word_count": len(text_parts),
                    "is_cloud": False,
                    "cost": 0.0,
                    "ocr_accuracy": "high" if avg_confidence > 80 else "medium"
                },
                metadata={
                    "file_type": "image_ocr",  
                    "language": language,
                    "confidence_scores": confidence_scores,
                    "avg_confidence": avg_confidence
                }
            )
            
        except Exception as e:
            logger.error(f"图片OCR解析失败: {e}")
            raise
    
    async def check_dependencies(self) -> bool:
        """检查所有依赖"""
        python_deps = await self._check_python_dependencies()
        system_deps = await self._check_system_dependencies()
        
        return python_deps and system_deps
    
    async def get_capabilities(self) -> Dict[str, Any]:
        """获取组件能力描述"""
        return {
            "supported_formats": [
                "pdf", "png", "jpg", "jpeg", "bmp", "tiff"
            ],
            "features": [
                "ocr_text_extraction",
                "multi_language_support", 
                "pdf_scanned_document_processing",
                "image_preprocessing",
                "confidence_scoring"
            ],
            "languages": self.supported_languages,
            "limitations": [
                "依赖系统Tesseract安装",
                "需要相应的语言包",
                "对低质量图片效果有限",
                "表格识别能力有限"
            ],
            "performance": {
                "speed": "medium",
                "accuracy": "high",
                "memory_usage": "low",
                "cpu_intensive": True
            },
            "quality_metrics": {
                "handwritten_text": "not_supported",
                "printed_text": "excellent",
                "low_resolution": "moderate",
                "rotated_text": "good"
            }
        }

    async def _install_system_dependencies(self) -> bool:
        """安装系统依赖（提供指导）"""
        
        system = os.name
        
        if system == 'nt':  # Windows
            instructions = [
                "1. 访问 https://github.com/UB-Mannheim/tesseract/wiki",
                "2. 下载并安装最新的Tesseract安装程序",
                "3. 安装时选择所需语言包（包括中文简体）",
                "4. 确保将Tesseract添加到系统PATH环境变量",
                "5. 重启应用使配置生效"
            ]
        else:  # macOS/Linux
            instructions = [
                "macOS: brew install tesseract tesseract-lang",
                "Ubuntu/Debian: sudo apt-get install tesseract-ocr libtesseract-dev libleptonica-dev",
                "CentOS/RHEL: sudo yum install tesseract tesseract-langpack-chi_sim",
                "安装后重启应用使配置生效"
            ]
        
        logger.info("Tesseract系统依赖安装指导:")
        for instruction in instructions:
            logger.info(f"  {instruction}")
        
        return False  # 系统依赖需要手动安装