from __future__ import annotations

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# 不缓存，每次都重新检测，因为用户可能在运行中安装 paddleocr
_PADDLEOCR_AVAILABLE: bool | None = None


def _check_paddleocr() -> bool:
    global _PADDLEOCR_AVAILABLE
    try:
        import paddleocr  # noqa: F401
        version = getattr(paddleocr, "__version__", "unknown")
        logger.debug("PaddleOCR imported successfully (version=%s)", version)
        _PADDLEOCR_AVAILABLE = True
    except ImportError as e:
        logger.warning(
            "PaddleOCR not installed: %s. Install with: pip install paddleocr paddlepaddle",
            e,
        )
        _PADDLEOCR_AVAILABLE = False
    except Exception as e:
        logger.warning("PaddleOCR import error: %s: %s", type(e).__name__, e)
        _PADDLEOCR_AVAILABLE = False
    return _PADDLEOCR_AVAILABLE


class PaddleOCRParser:
    def __init__(self, lang: str = "ch", use_gpu: bool | None = None):
        self._lang = lang
        self._use_gpu = use_gpu
        self._ocr = None

    @property
    def available(self) -> bool:
        return _check_paddleocr()

    def _get_ocr(self):
        if self._ocr is None and self._check_paddleocr():
            try:
                from paddleocr import PaddleOCR

                kwargs: dict = {
                    "lang": self._lang,
                }

                # 检测 PaddleOCR 版本，选择对应初始化方式
                import paddleocr as _pocr
                _version = getattr(_pocr, "__version__", "0.0.0")
                _major = int(_version.split(".")[0]) if _version else 0

                if _major >= 3:
                    # PaddleOCR 3.x: 使用 device 参数
                    if self._use_gpu:
                        kwargs["device"] = "gpu"
                    else:
                        kwargs["device"] = "cpu"
                    self._ocr = PaddleOCR(**kwargs)
                    logger.info("PaddleOCR 3.x initialized (device=%s)", kwargs.get("device", "default"))
                else:
                    # PaddleOCR 2.x: 使用 show_log / use_gpu 参数
                    kwargs["show_log"] = False
                    if self._use_gpu is not None:
                        kwargs["use_gpu"] = self._use_gpu
                    self._ocr = PaddleOCR(**kwargs)
                    logger.info("PaddleOCR 2.x initialized (use_gpu=%s)", kwargs.get("use_gpu"))
            except Exception as e:
                logger.error("Failed to initialize PaddleOCR: %s: %s", type(e).__name__, e)
                return None
        return self._ocr

    async def parse(self, file_path: Path) -> str:
        if not self.available:
            return ""

        try:
            ocr = self._get_ocr()
            if ocr is None:
                return ""

            ext = file_path.suffix.lower()
            if ext == ".pdf":
                return await self._parse_pdf(ocr, file_path)
            elif ext in {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}:
                return await self._parse_image(ocr, file_path)
            else:
                logger.warning("PaddleOCR: unsupported file type %s", ext)
                return ""
        except Exception as exc:
            logger.error("PaddleOCR failed for %s: %s", file_path, exc)
            return ""

    def _detect_paddleocr_major_version(self) -> int:
        """Detect and cache PaddleOCR major version."""
        if not hasattr(self, "_cached_major_version"):
            try:
                import paddleocr as _pocr
                _version = getattr(_pocr, "__version__", "0.0.0")
                self._cached_major_version = int(_version.split(".")[0]) if _version else 0
            except Exception:
                self._cached_major_version = 0
        return self._cached_major_version

    async def _parse_image(self, ocr, file_path: Path) -> str:
        try:
            major_ver = self._detect_paddleocr_major_version()

            if major_ver >= 3:
                # PaddleOCR 3.x:
                # - predict() 是主 API
                # - ocr() 是 predict() 的包装，不支持 cls 参数
                # - Windows + oneDNN 有 NotImplementedError bug
                # - macOS/Linux 上 predict() 正常工作
                result = await self._run_ocr_3x(ocr, file_path)
            else:
                # PaddleOCR 2.x: ocr(cls=True) 是主 API
                result = await self._run_ocr_2x(ocr, file_path)

            if not result:
                logger.warning("PaddleOCR: empty result for %s", file_path.name)
                return ""

            logger.debug(
                "PaddleOCR: result type=%s, len=%s for %s",
                type(result).__name__,
                len(result) if hasattr(result, "__len__") else "N/A",
                file_path.name,
            )

            text = self._extract_text(result)
            if not text.strip():
                logger.warning(
                    "PaddleOCR: _extract_text returned empty for %s (raw result type: %s)",
                    file_path.name,
                    type(result).__name__,
                )
            return text
        except Exception as e:
            logger.error("PaddleOCR image parse error for %s: %s: %s", file_path.name, type(e).__name__, e)
            return ""

    async def _run_ocr_2x(self, ocr, file_path: Path):
        """PaddleOCR 2.x: 使用 ocr(cls=True) 方法。"""
        logger.info("PaddleOCR 2.x: using ocr(cls=True) for %s", file_path.name)
        return await asyncio.to_thread(ocr.ocr, str(file_path), cls=True)

    async def _run_ocr_3x(self, ocr, file_path: Path):
        """PaddleOCR 3.x: 使用 predict() 方法，Windows 上有 oneDNN bug 需要回退处理。"""
        import platform

        # macOS/Linux: predict() 正常工作
        # Windows: predict() 可能因 oneDNN bug 抛出 NotImplementedError
        logger.info("PaddleOCR 3.x: using predict() for %s", file_path.name)
        try:
            result = await asyncio.to_thread(ocr.predict, str(file_path))
            # predict() 返回生成器，需要转为 list
            if hasattr(result, "__aiter__") or hasattr(result, "__iter__"):
                if not isinstance(result, list):
                    result = list(result)
            return result
        except NotImplementedError as e:
            if platform.system() == "Windows":
                logger.error(
                    "PaddleOCR 3.x predict() failed on Windows (oneDNN bug): %s. "
                    "Recommend: reinstall with paddleocr==2.9.1 + paddlepaddle==2.6.2",
                    e,
                )
            else:
                logger.error("PaddleOCR 3.x predict() failed: %s", e)
            return None

    async def _parse_pdf(self, ocr, file_path: Path) -> str:
        try:
            import fitz
        except ImportError:
            logger.warning("PyMuPDF not installed, cannot convert PDF to images for OCR")
            return ""

        doc = await asyncio.to_thread(fitz.open, str(file_path))
        all_text_parts: list[str] = []

        for page_num in range(len(doc)):
            page = doc[page_num]
            pix = await asyncio.to_thread(page.get_pixmap, dpi=200)
            img_bytes = pix.tobytes("png")

            import tempfile
            import os

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp.write(img_bytes)
                tmp_path = Path(tmp.name)

            try:
                major_ver = self._detect_paddleocr_major_version()
                if major_ver >= 3:
                    result = await asyncio.to_thread(ocr.predict, str(tmp_path))
                    if hasattr(result, "__iter__") and not isinstance(result, list):
                        result = list(result)
                else:
                    result = await asyncio.to_thread(ocr.ocr, str(tmp_path), cls=True)
                page_text = self._extract_text(result)
                if page_text.strip():
                    all_text_parts.append(f"--- 第{page_num + 1}页 ---\n{page_text}")
            finally:
                tmp_path.unlink(missing_ok=True)

        doc.close()
        return "\n\n".join(all_text_parts)

    @staticmethod
    def _extract_text(result) -> str:
        if not result:
            return ""
        texts: list[str] = []

        # PaddleOCR 3.x 返回格式:
        #   result 是 list of OCRResult 对象
        #   每个 OCRResult 可能有 rec_texts 属性（dict-like）
        #   也可能通过 [] 访问得到 dict
        # PaddleOCR 2.x 返回格式:
        #   result 是 list of list of [bbox, (text, confidence)]

        if not isinstance(result, (list, tuple)):
            # 可能是单个 OCRResult 对象
            result = [result]

        for page in result:
            if page is None:
                continue

            # 尝试 3.x 格式: dict-like with 'rec_texts'
            page_dict = None
            if isinstance(page, dict):
                page_dict = page
            elif hasattr(page, "keys") and callable(page.keys):
                # OCRResult 对象可能支持 dict-like 接口
                try:
                    page_dict = dict(page)
                except Exception:
                    pass
            elif hasattr(page, "__getitem__") and not isinstance(page, (list, tuple, str)):
                # 尝试将 OCRResult 当作 dict 访问
                try:
                    if "rec_texts" in page:
                        page_dict = page
                except Exception:
                    pass

            if page_dict is not None and "rec_texts" in page_dict:
                rec_texts = page_dict["rec_texts"]
                if isinstance(rec_texts, (list, tuple)):
                    texts.extend(str(t) for t in rec_texts)
                else:
                    texts.append(str(rec_texts))
                continue

            # 尝试 3.x 格式: OCRResult 对象的 rec_texts 属性
            if hasattr(page, "rec_texts"):
                rec_texts = page.rec_texts
                if isinstance(rec_texts, (list, tuple)):
                    texts.extend(str(t) for t in rec_texts)
                else:
                    texts.append(str(rec_texts))
                continue

            # 尝试 2.x 格式: list of [bbox, (text, confidence)]
            if isinstance(page, (list, tuple)):
                for line in page:
                    if line is None:
                        continue
                    if isinstance(line, (list, tuple)) and len(line) >= 2:
                        text_part = line[1]
                        if isinstance(text_part, (list, tuple)) and len(text_part) >= 1:
                            texts.append(str(text_part[0]))
                        else:
                            texts.append(str(text_part))

        return "\n".join(texts)