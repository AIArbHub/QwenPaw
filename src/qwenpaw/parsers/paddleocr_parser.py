from __future__ import annotations

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# 不缓存，每次都重新检测，因为用户可能在运行中安装 paddleocr
_PADDLEOCR_AVAILABLE: bool | None = None
_LAST_CHECK_HASH: str | None = None


def _check_paddleocr() -> bool:
    global _PADDLEOCR_AVAILABLE
    # 每次都重新检测，不缓存
    try:
        import paddleocr  # noqa: F401
        _PADDLEOCR_AVAILABLE = True
    except ImportError:
        _PADDLEOCR_AVAILABLE = False
    except Exception as e:
        logger.warning("PaddleOCR import error: %s", e)
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
                # PaddleOCR 3.x 不再支持 show_log 参数
                # PaddleOCR 2.x 使用 use_gpu，3.x 使用 device
                try:
                    # 尝试 3.x API
                    if self._use_gpu:
                        kwargs["device"] = "gpu"
                    self._ocr = PaddleOCR(**kwargs)
                except TypeError:
                    # 回退到 2.x API
                    kwargs.pop("device", None)
                    kwargs["show_log"] = False
                    if self._use_gpu is not None:
                        kwargs["use_gpu"] = self._use_gpu
                    self._ocr = PaddleOCR(**kwargs)
            except Exception as e:
                logger.error("Failed to initialize PaddleOCR: %s", e)
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

    async def _parse_image(self, ocr, file_path: Path) -> str:
        try:
            # PaddleOCR 3.x 使用 predict 而非 ocr
            if hasattr(ocr, "predict"):
                result = await asyncio.to_thread(ocr.predict, str(file_path))
            else:
                result = await asyncio.to_thread(ocr.ocr, str(file_path), cls=True)
            return self._extract_text(result)
        except Exception as e:
            logger.error("PaddleOCR image parse error: %s", e)
            return ""

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
                if hasattr(ocr, "predict"):
                    result = await asyncio.to_thread(ocr.predict, str(tmp_path))
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

        # PaddleOCR 3.x 返回格式不同，需要兼容处理
        # 3.x: result 是 list of dict，包含 rec_texts
        # 2.x: result 是 list of list of [bbox, (text, confidence)]
        if isinstance(result, list):
            for page in result:
                if page is None:
                    continue
                # 3.x 格式: dict with 'rec_texts'
                if isinstance(page, dict) and "rec_texts" in page:
                    texts.extend(page["rec_texts"])
                # 2.x 格式: list of [bbox, (text, confidence)]
                elif isinstance(page, list):
                    for line in page:
                        if line and len(line) >= 2:
                            texts.append(line[1][0] if isinstance(line[1], (list, tuple)) else str(line[1]))
        return "\n".join(texts)
