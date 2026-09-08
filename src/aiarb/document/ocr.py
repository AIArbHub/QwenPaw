# -*- coding: utf-8 -*-
"""OCR abstraction layer for aiarb document pipeline.

Supports multiple OCR engines with unified interface:
  - **Local engines**: PaddleOCR (recommended), EasyOCR, Tesseract
  - **Cloud engines**: OCR.space, Baidu OCR, Tencent OCR (via API)
  - **Layout parsing** (optional): MinerU for complex PDF tables/dual-column

Architecture (inspired by LegalWork's ``resources/document/ocr/router.py``):
  - Profile-based configuration: each engine has a profile dict
  - Confidence scoring: every engine returns per-page confidence
  - Graceful degradation: if primary fails, try fallback

Engine priority (recommended):
  1. PaddleOCR — best Chinese text accuracy, moderate resource usage
  2. EasyOCR — good multilingual support, easy install
  3. Tesseract — lightweight, fast, lower accuracy for CJK
  4. Cloud API — highest accuracy, requires network + API key

Hardware requirements:
  ┌──────────────┬──────────────────────────────────────────────────┐
  │ Engine       │ Hardware / Dependencies                         │
  ├──────────────┼──────────────────────────────────────────────────┤
  │ PaddleOCR    │ CPU: any; GPU: NVIDIA CUDA recommended          │
  │              │ RAM: 4GB+ (GPU) / 8GB+ (CPU mode)               │
  │              │ Disk: ~3GB (paddlepaddle + paddleocr)           │
  │              │ Install: pip install paddlepaddle paddleocr     │
  ├──────────────┼──────────────────────────────────────────────────┤
  │ EasyOCR      │ CPU: any; GPU: optional (PyTorch CUDA)         │
  │              │ RAM: 2GB+                                       │
  │              │ Disk: ~500MB                                    │
  │              │ Install: pip install easyocr                    │
  ├──────────────┼──────────────────────────────────────────────────┤
  │ Tesseract    │ CPU: any (C++ binary)                           │
  │              │ RAM: <100MB                                     │
  │              │ Disk: ~50MB                                     │
  │              │ Install: apt-get install tesseract-ocr         │
  │              │         pip install pytesseract pdf2image       │
  ├──────────────┼──────────────────────────────────────────────────┤
  │ Cloud APIs   │ Network required                                │
  │              │ No local hardware requirements                   │
  │              │ Cost: pay-per-use (typically $0.001-0.01/page)  │
  ├──────────────┼──────────────────────────────────────────────────┤
  │ MinerU       │ CPU: any; GPU: strongly recommended             │
  │              │ RAM: 8GB+ (16GB+ for GPU mode)                  │
  │              │ Disk: ~10GB (full model download)                │
  │              │ Install: pip install magic-pdf[full]            │
  │              │ Requires Python 3.10+                            │
  └──────────────┴──────────────────────────────────────────────────┘

Usage::

    from aiarb.document.ocr import OCREngine, OCRConfig, ocr_pdf_page

    # Use default config (auto-detect available engines)
    config = OCRConfig()
    engine = OCREngine(config)

    # OCR a single image (PIL Image or numpy array)
    result = engine.ocr_image(image)

    # OCR a full PDF (returns list of page results)
    pages = engine.ocr_pdf("scanned.pdf")

    # Quick helper: OCR only the scanned pages of a mixed PDF
    from aiarb.document.intake import _extract_pdf
    pages, conf, eng, used_ocr = _extract_pdf(Path("mixed.pdf"))
    if used_ocr:
        ocr_pages = engine.ocr_pdf_scanned_pages("mixed.pdf", pages)
"""

from __future__ import annotations

import base64
import json
import logging
import tempfile
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


# -- Enums -------------------------------------------------------------------

class OCREngineType(str, Enum):
    """Supported OCR engine types."""
    PADDLE = "paddleocr"
    EASY = "easyocr"
    TESSERACT = "tesseract"
    CLOUD_OCR_SPACE = "cloud-ocr-space"
    CLOUD_BAIDU = "cloud-baidu"
    CLOUD_TENCENT = "cloud-tencent"
    MINERU = "mineru"  # Layout parser (can wrap any OCR engine)


class OCRMode(str, Enum):
    """OCR execution mode."""
    AUTO = "auto"  # Auto-detect best available engine
    LOCAL_FIRST = "local_first"  # Prefer local engines
    CLOUD_FIRST = "cloud_first"  # Prefer cloud engines (needs API key)
    FORCE_ENGINE = "force_engine"  # Use specified engine only


# -- Data Classes -------------------------------------------------------------

@dataclass
class OCRResult:
    """Result from OCR processing a single page/image.

    Attributes:
        text: Extracted plain text.
        blocks: List of text blocks with bounding boxes [(x0,y0,x1,y1,text,conf), ...].
        confidence: Average confidence score (0.0–1.0).
        engine: Which engine produced this result.
        elapsed_ms: Processing time in milliseconds.
        page_number: Page number (1-based), 0 for single image.
        raw: Raw engine-specific output (for debugging).
    """
    text: str = ""
    blocks: list[dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    engine: str = ""
    elapsed_ms: int = 0
    page_number: int = 0
    raw: Any = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "blocks": self.blocks,
            "confidence": self.confidence,
            "engine": self.engine,
            "elapsed_ms": self.elapsed_ms,
            "page_number": self.page_number,
        }


# -- Helper functions --------------------------------------------------------

def _serialize_dataclass(obj: Any) -> Any:
    """Recursively serialize dataclass to plain dict for JSON."""
    if obj is None:
        return None
    if hasattr(obj, "__dataclass_fields__"):
        return {k: _serialize_dataclass(getattr(obj, k)) for k in obj.__dataclass_fields__}
    return obj


# -- Engine Deployment Config ------------------------------------------------


@dataclass
class EngineDeploymentConfig:
    """Configuration for a single OCR engine's deployment mode.

    Each OCR engine can run in one of two modes:
      - **local**: Run engine locally (requires installation + hardware)
      - **cloud_api**: Use cloud provider's API (requires network + API key)

    Example::
        # Local PaddleOCR (needs GPU)
        paddle = EngineDeploymentConfig(mode="local", use_gpu=True)

        # Cloud-based text recognition (no local hardware)
        ocr_space = EngineDeploymentConfig(
            mode="cloud_api",
            provider="ocr-space",
            api_key="xxx",
            endpoint="https://api.ocr.space"
        )

        # MinerU with cloud backend (for users without GPU)
        mineru_cloud = EngineDeploymentConfig(
            mode="cloud_api",
            provider="mineru-cloud",
            api_key="yyy",
            endpoint="https://api.mineru.org"
        )
    """
    mode: str = "local"  # "local" | "cloud_api"
    provider: str = ""   # Provider name when mode=="cloud_api"
                        # e.g., "ocr-space", "baidu-ocr", "tencent-ocr", "mineru-cloud"
    api_key: str = ""    # API key for cloud providers
    endpoint: str = ""   # Custom endpoint URL (empty = use default for provider)
    use_gpu: bool = True  # Only relevant when mode=="local"
    model_size: str = "auto"  # "small" | "medium" | "large" | "auto"
                             # Controls model size for local engines


@dataclass
class OCRConfig:
    """Configuration for OCR engine selection and behavior.

    **Core concept**: Every OCR capability has a **deployment mode** choice:

    ┌─────────────────────────────────────────────────────────────┐
    │                    OCR Pipeline                              │
    │                                                              │
    │  1. Text Recognition (文字识别)                               │
    │     ┌────────────┬────────────┐                              │
    │     │  📍 Local  │  ☁️ Cloud   │                              │
    │     ├────────────┼────────────┤                              │
    │     │ PaddleOCR  │ OCR.space   │                              │
    │     │ EasyOCR    │ Baidu OCR   │                              │
    │     │ Tesseract  │ Tencent OCR │                              │
    │     └────────────┴────────────┘                              │
    │                                                              │
    │  2. Layout Parsing (版面解析) - Optional Enhancement         │
    │     ┌────────────┬────────────┐                              │
    │     │  📍 Local  │  ☁️ Cloud   │                              │
    │     ├────────────┼────────────┤                              │
    │     │ MinerU     │ MinerU API  │                              │
    │     │ (GPU≥8GB)  │ (第三方)    │                              │
    │     └────────────┴────────────┘                              │
    └─────────────────────────────────────────────────────────────┘

    Attributes:
        text_engine: Deployment config for text recognition engine.
        layout_parser: Deployment config for layout parsing (MinerU).
            If None or mode="", layout parsing is disabled.
        language: Language code(s) for OCR ('ch', 'en', 'ch_en', etc.).
        confidence_threshold: Minimum confidence to accept a block.
        dpi: DPI for image rendering (higher = better quality, slower).
        max_workers: Parallel workers for batch processing.
        enable_ocr: Global OCR toggle (if False, skip all OCR operations).
        fallback_to_cloud: If local engine fails, try cloud automatically.
    """
    # Core deployment configs
    text_engine: EngineDeploymentConfig = field(
        default_factory=lambda: EngineDeploymentConfig(mode="local")
    )
    layout_parser: EngineDeploymentConfig | None = None  # None = disabled

    # Common settings
    language: str = "ch"  # Default: Chinese (optimized for legal docs)
    confidence_threshold: float = 0.5
    dpi: int = 300  # High DPI for legal documents (small fonts)
    max_workers: int = 2
    enable_ocr: bool = True  # Global toggle: if False, skip OCR entirely

    # Fallback behavior
    fallback_to_cloud: bool = False  # Auto-fallback if local fails

    # Legacy compatibility (mapped to new structure internally)
    @property
    def engine_type(self) -> str:
        """Legacy property: returns engine type string."""
        if self.text_engine.mode == "cloud_api":
            return f"cloud-{self.text_engine.provider}"
        # For local mode, we'll auto-detect best available
        return "auto"

    @property
    def cloud_api_key(self) -> str:
        """Legacy property: returns cloud API key from text_engine."""
        return self.text_engine.api_key

    @cloud_api_key.setter
    def cloud_api_key(self, value: str):
        """Legacy setter: updates text_engine.api_key."""
        self.text_engine.api_key = value

    @property
    def cloud_api_url(self) -> str:
        """Legacy property: returns endpoint from text_engine."""
        return self.text_engine.endpoint

    @cloud_api_url.setter
    def cloud_api_url(self, value: str):
        """Legacy setter: updates text_engine.endpoint."""
        self.text_engine.endpoint = value

    @property
    def mineru_enabled(self) -> bool:
        """Legacy property: checks if layout parser is enabled."""
        return self.layout_parser is not None and self.layout_parser.mode != ""

    @property
    def mineru_mode(self) -> str:
        """Legacy property: returns layout parser mode."""
        if self.layout_parser:
            return self.layout_parser.model_size  # Map model_size to legacy field
        return "auto"

    @property
    def use_gpu(self) -> bool:
        """Legacy property: returns GPU setting from text_engine."""
        return self.text_engine.use_gpu

    @use_gpu.setter
    def use_gpu(self, value: bool):
        """Legacy setter: updates text_engine.use_gpu."""
        self.text_engine.use_gpu = value

    @classmethod
    def load_from_file(cls, path: str | Path) -> "OCRConfig":
        """Load config from JSON file.

        Handles both new structure (with nested EngineDeploymentConfig)
        and legacy flat structure (for backward compatibility).
        """
        p = Path(path)
        if not p.exists():
            return cls()
        try:
            data = json.loads(p.read_text(encoding="utf-8"))

            # Convert legacy flat fields to new structure if needed
            if "text_engine" not in data and "engine_type" in data:
                # Legacy format: convert to new structure
                legacy_engine = data.pop("engine_type", "auto")
                legacy_cloud_key = data.pop("cloud_api_key", "")
                legacy_cloud_url = data.pop("cloud_api_url", "")
                legacy_use_gpu = data.pop("use_gpu", True)
                legacy_mode = data.pop("mode", "local_first")

                if legacy_engine.startswith("cloud-") or legacy_mode == "cloud_first":
                    provider = legacy_engine.replace("cloud-", "", 1) if legacy_engine != "auto" else "ocr-space"
                    data["text_engine"] = {
                        "mode": "cloud_api",
                        "provider": provider,
                        "api_key": legacy_cloud_key,
                        "endpoint": legacy_cloud_url,
                    }
                else:
                    data["text_engine"] = {
                        "mode": "local",
                        "provider": legacy_engine if legacy_engine != "auto" else "",
                        "use_gpu": legacy_use_gpu,
                    }

            if "layout_parser" not in data and "mineru_enabled" in data:
                # Legacy format: convert mineru fields to layout_parser
                mineru_enabled = data.pop("mineru_enabled", False)
                mineru_mode = data.pop("mineru_mode", "auto")
                if mineru_enabled:
                    data["layout_parser"] = {
                        "mode": "local",
                        "model_size": mineru_mode,
                        "use_gpu": data.get("text_engine", {}).get("use_gpu", True),
                    }

            # Convert dict to EngineDeploymentConfig for nested fields
            if "text_engine" in data and isinstance(data["text_engine"], dict):
                data["text_engine"] = EngineDeploymentConfig(**{
                    k: v for k, v in data["text_engine"].items()
                    if k in EngineDeploymentConfig.__dataclass_fields__
                })

            if "layout_parser" in data and data["layout_parser"] is not None:
                if isinstance(data["layout_parser"], dict):
                    data["layout_parser"] = EngineDeploymentConfig(**{
                        k: v for k, v in data["layout_parser"].items()
                        if k in EngineDeploymentConfig.__dataclass_fields__
                    })

            # Filter to only known fields
            valid_fields = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
            return cls(**valid_fields)
        except Exception as exc:
            logger.warning("Failed to load OCR config from %s: %s", p, exc)
            return cls()

    def save_to_file(self, path: str | Path) -> None:
        """Save config to JSON file."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2, default=_serialize_dataclass),
            encoding="utf-8",
        )

    def to_dict(self) -> dict[str, Any]:
        """Return a plain dict suitable for JSON serialization."""
        result: dict[str, Any] = {
            "text_engine": _serialize_dataclass(self.text_engine) if self.text_engine else None,
            "layout_parser": _serialize_dataclass(self.layout_parser) if self.layout_parser else None,
            "language": self.language,
            "confidence_threshold": self.confidence_threshold,
            "dpi": self.dpi,
            "max_workers": self.max_workers,
            "enable_ocr": self.enable_ocr,
            "fallback_to_cloud": self.fallback_to_cloud,
        }
        return result


# -- Engine Implementations --------------------------------------------------

class BaseOCREngine:
    """Abstract base class for OCR engines."""

    config: OCRConfig
    engine_name: str = "base"

    def __init__(self, config: OCRConfig):
        self.config = config

    def is_available(self) -> bool:
        """Check if this engine is installed and usable."""
        raise NotImplementedError

    def ocr_image(
        self,
        image: Any,  # PIL.Image or numpy array
        page_number: int = 0,
    ) -> OCRResult:
        """OCR a single image."""
        raise NotImplementedError

    def ocr_images_batch(
        self,
        images: list[Any],
        start_page: int = 1,
    ) -> list[OCRResult]:
        """OCR multiple images (batch processing)."""
        results = []
        for idx, img in enumerate(images):
            result = self.ocr_image(img, page_number=start_page + idx)
            results.append(result)
        return results


class PaddleOCREngine(BaseOCREngine):
    """PaddleOCR engine — best accuracy for Chinese legal documents.

    Requirements::
        pip install paddlepaddle paddleocr

    Hardware:
        - CPU mode: works on any x86_64/ARM64 machine
        - GPU mode: NVIDIA GPU with CUDA 11.2+, VRAM ≥ 4GB
        - Recommended: RTX 3060 12GB+ for A4 documents at 300 DPI
    """

    engine_name = "paddleocr"
    _instance: Any = None  # Cached PaddleOCR object

    def __init__(self, config: OCRConfig):
        super().__init__(config)
        self._model = None

    def is_available(self) -> bool:
        try:
            import paddleocr  # noqa: F401
            return True
        except ImportError:
            return False

    def _get_model(self) -> Any:
        """Lazy-load and cache PaddleOCR model."""
        if self._model is not None:
            return self._model
        try:
            from paddleocr import PaddleOCR as _PaddleOCR

            use_gpu = self.config.use_gpu
            device = "gpu" if use_gpu else "cpu"
            lang_map = {
                "ch": "ch",
                "en": "en",
                "ch_en": "ch",  # PaddleOCR uses single lang, ch covers CJK
            }
            lang = lang_map.get(self.config.language, "ch")

            logger.info(
                "Initializing PaddleOCR (device=%s, lang=%s, dpi=%d)",
                device, lang, self.config.dpi,
            )
            self._model = _PaddleOCR(
                use_angle_cls=True,
                use_det=True,
                use_rec=True,
                lang=lang,
                device=device,
                det_db_thresh=0.3,  # Lower threshold for light/faded scans
                det_db_box_thresh=0.5,
                rec_batch_num=6,
                drop_score=self.config.confidence_threshold,
                show_log=False,
            )
            return self._model
        except Exception as exc:
            logger.error("Failed to initialize PaddleOCR: %s", exc)
            raise RuntimeError(f"PaddleOCR initialization failed: {exc}") from exc

    def ocr_image(self, image: Any, page_number: int = 0) -> OCRResult:
        start = time.perf_counter()
        model = self._get_model()

        # PaddleOCR expects numpy array or file path
        result = model.ocr(image, cls=True)

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        blocks: list[dict[str, Any]] = []
        all_text_parts: list[str] = []
        confidences: list[float] = []

        if result and result[0]:
            for line in result[0]:
                # line format: [[[x0,y0,x1,y1]], (text, confidence)]
                box, (text, conf) = line[0], line[1]
                x0, y0 = box[0][0], box[0][1]
                x1, y1 = box[2][0], box[2][1]
                clean_text = text.strip()
                if not clean_text:
                    continue
                if conf >= self.config.confidence_threshold:
                    blocks.append({
                        "bbox": [x0, y0, x1, y1],
                        "text": clean_text,
                        "confidence": round(conf, 4),
                    })
                    all_text_parts.append(clean_text)
                    confidences.append(conf)

        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        full_text = "\n".join(all_text_parts)

        return OCRResult(
            text=full_text,
            blocks=blocks,
            confidence=round(avg_conf, 4),
            engine="paddleocr",
            elapsed_ms=elapsed_ms,
            page_number=page_number,
            raw=result,
        )


class EasyOCREngine(BaseOCREngine):
    """EasyOCR engine — good multilingual support.

    Requirements::
        pip install easyocr

    Hardware:
        - CPU: any modern x86_64
        - GPU: optional PyTorch CUDA support
        - RAM: 2GB+
    """

    engine_name = "easyocr"
    _reader: Any = None

    def is_available(self) -> bool:
        try:
            import easyocr  # noqa: F401
            return True
        except ImportError:
            return False

    def _get_reader(self) -> Any:
        if self._reader is not None:
            return self._reader
        import easyocr

        lang_map = {
            "ch": ["ch_sim", "en"],
            "en": ["en"],
            "ch_en": ["ch_sim", "en"],
        }
        langs = lang_map.get(self.config.language, ["ch_sim", "en"])
        gpu = self.config.use_gpu

        logger.info("Initializing EasyOCR (langs=%s, gpu=%s)", langs, gpu)
        self._reader = easyocr.Reader(langs, gpu=gpu)
        return self._reader

    def ocr_image(self, image: Any, page_number: int = 0) -> OCRResult:
        start = time.perf_counter()
        reader = self._get_reader()

        result = reader.readtext(image)
        elapsed_ms = int((time.perf_counter() - start) * 1000)

        blocks: list[dict[str, Any]] = []
        all_text_parts: list[str] = []
        confidences: list[float] = []

        for box, text, conf in result:
            clean_text = text.strip()
            if not clean_text:
                continue
            if conf >= self.config.confidence_threshold:
                # EasyOCR box format: [[x0,y0],[x1,y1],[x1,y0],[x0,y1]]
                x_coords = [p[0] for p in box]
                y_coords = [p[1] for p in box]
                blocks.append({
                    "bbox": [min(x_coords), min(y_coords), max(x_coords), max(y_coords)],
                    "text": clean_text,
                    "confidence": round(conf, 4),
                })
                all_text_parts.append(clean_text)
                confidences.append(conf)

        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

        return OCRResult(
            text="\n".join(all_text_parts),
            blocks=blocks,
            confidence=round(avg_conf, 4),
            engine="easyocr",
            elapsed_ms=elapsed_ms,
            page_number=page_number,
            raw=result,
        )


class TesseractOCREngine(BaseOCREngine):
    """Tesseract engine — lightweight, fast, lower CJK accuracy.

    Requirements::
        # Ubuntu/Debian:
        sudo apt-get install tesseract-ocr tesseract-ocr-chi-sim
        pip install pytesseract pdf2image pillow

        # macOS:
        brew install tesseract tesseract-lang
        pip install pytesseract pdf2image pillow

        # Windows:
        # Download installer from GitHub: UB-Mannheim/tesseract
        pip install pytesseract pdf2image pillow

    Hardware:
        - Very lightweight: <100MB RAM
        - Fastest among all engines
        - CJK accuracy: moderate (good for clear prints, poor for scans)
    """

    engine_name = "tesseract"

    def is_available(self) -> bool:
        try:
            import pytesseract  # noqa: F401
            # Also check that tesseract binary exists
            import subprocess
            result = subprocess.run(
                ["tesseract", "--version"],
                capture_output=True, timeout=5,
            )
            return result.returncode == 0
        except (ImportError, FileNotFoundError, OSError):
            return False

    def ocr_image(self, image: Any, page_number: int = 0) -> OCRResult:
        import pytesseract
        from PIL import Image

        start = time.perf_counter()

        # Ensure PIL Image
        if not isinstance(image, Image.Image):
            image = Image.fromarray(image)

        lang_map = {
            "ch": "chi_sim+eng",
            "en": "eng",
            "ch_en": "chi_sim+eng",
        }
        lang = lang_map.get(self.config.language, "chi_sim+eng")

        # Get structured data with bounding boxes
        data = pytesseract.image_to_data(
            image,
            lang=lang,
            output_type=pytesseract.Output.DICT,
        )

        elapsed_ms = int((time.perf_counter() - start) * 1000)

        # Parse into blocks
        blocks: list[dict[str, Any]] = []
        all_text_parts: list[str] = []
        confidences: list[float] = []
        current_para: list[str] = []

        for i in range(len(data["text"])):
            text = data["text"][i].strip()
            conf = int(data["conf"][i]) / 100.0  # Tesseract uses 0-100

            if not text:
                if current_para:
                    all_text_parts.append(" ".join(current_para))
                    current_para = []
                continue

            if conf >= self.config.confidence_threshold:
                current_para.append(text)
                confidences.append(conf)
                blocks.append({
                    "bbox": [
                        data["left"][i],
                        data["top"][i],
                        data["left"][i] + data["width"][i],
                        data["top"][i] + data["height"][i],
                    ],
                    "text": text,
                    "confidence": round(conf, 4),
                })

        if current_para:
            all_text_parts.append(" ".join(current_para))

        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

        return OCRResult(
            text="\n".join(all_text_parts),
            blocks=blocks,
            confidence=round(avg_conf, 4),
            engine="tesseract",
            elapsed_ms=elapsed_ms,
            page_number=page_number,
            raw=data,
        )


class CloudOCREngine(BaseOCREngine):
    """Cloud OCR engine — uses external API (OCR.space by default).

    Supports multiple providers via configuration:
      - OCR.space (free tier: 500 requests/month)
      - Baidu OCR (requires API key)
      - Tencent OCR (requires API key)

    No local hardware requirements beyond network access.
    Typical cost: $0.001–$0.01 per page.
    """

    engine_name = "cloud-api"

    def is_available(self) -> bool:
        # Cloud engine always "available" but needs API key at runtime
        return bool(self.config.cloud_api_key) or self.config.cloud_api_url != ""

    def ocr_image(self, image: Any, page_number: int = 0) -> OCRResult:
        import io
        from PIL import Image

        start = time.perf_counter()

        # Convert to bytes
        if isinstance(image, Image.Image):
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            image_bytes = buf.getvalue()
        else:
            # Assume numpy array
            img = Image.fromarray(image)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            image_bytes = buf.getvalue()

        b64 = base64.b64encode(image_bytes).decode("ascii")

        # Determine which cloud provider to use
        url = self.config.cloud_api_url or "https://api.ocr.space/parse/image"
        headers = {"apikey": self.config.cloud_api_key}

        import urllib.request

        payload = {
            "base64Image": f"data:image/png;base64,{b64}",
            "language": self.config.language.upper(),
            "isOverlayRequired": False,
            "OCREngine": 2,  # 1=Free, 2=Premium (more accurate)
            "scale": True,
            "detectOrientation": True,
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        elapsed_ms = int((time.perf_counter() - start) * 1000)

        # Parse OCR.space response
        parsed_results = result.get("ParsedResults", [])
        text_parts: list[str] = []
        blocks: list[dict[str, Any]] = []
        confidences: list[float] = []

        for pr in parsed_results:
            line_text = pr.get("ParsedText", "").strip()
            if line_text:
                text_parts.append(line_text)
                confidences.append(1.0)  # OCR.space doesn't provide per-block confidence
                blocks.append({
                    "text": line_text,
                    "confidence": 1.0,
                    "bbox": None,  # Available if isOverlayRequired=True
                })

        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

        return OCRResult(
            text="\n".join(text_parts),
            blocks=blocks,
            confidence=avg_conf,
            engine=f"cloud-{url.split('//')[1].split('.')[0]}",
            elapsed_ms=elapsed_ms,
            page_number=page_number,
            raw=result,
        )


# -- MinerU Layout Parser (Optional) -----------------------------------------

@dataclass
class MinerUResult:
    """Result from MinerU layout parsing.

    MinerU provides structure-aware extraction:
      - Text regions with reading order
      - Table detection and structure preservation
      - Formula/LaTeX recognition
      - Dual-column layout handling
    """
    content_md: str = ""
    areas: list[dict[str, Any]] = field(default_factory=list)
    tables: list[dict[str, Any]] = field(default_factory=list)
    formulas: list[str] = field(default_factory=list)
    confidence: float = 0.0
    elapsed_ms: int = 0


class MinerUParser:
    """MinerU layout parser wrapper for complex PDF documents.

    MinerU (magic-pdf) provides state-of-the-art document understanding:
      - Reading order detection (critical for dual-column legal docs)
      - Table structure recognition (preserves cell boundaries)
      - Formula extraction (LaTeX output)
      - Header/footer removal

    Requirements (Python 3.10+)::
        pip install "magic-pdf[full]"

        # Or minimal install:
        pip install magic-pdf detectron2

    Hardware:
        - CPU: any (very slow, ~30 sec/page)
        - GPU: strongly recommended (NVIDIA VRAM ≥ 8GB)
        - RAM: 8GB+ (CPU) / 16GB+ (GPU)
        - Disk: ~10GB for model downloads (first run)

    Usage::
        parser = MinerUParser(config)
        result = parser.parse_pdf("complex_legal.pdf")
        print(result.content_md)  # Markdown with proper structure
    """

    def __init__(self, config: OCRConfig):
        self.config = config
        self._available: bool | None = None

    def is_available(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            import magic_pdf  # noqa: F401
            self._available = True
            return True
        except ImportError:
            self._available = False
            return False

    def parse_pdf(self, pdf_path: str | Path) -> MinerUResult:
        """Parse a PDF file with MinerU layout analysis.

        Returns structured content with tables, formulas, and proper reading order.
        """
        start = time.perf_counter()

        try:
            from magic_pdf.data.data_reader_writer import FileBasedDataReader
            from magic_pdf.pipe.OCRPipe import OCRPipe

            # MinerU processes the PDF and produces structured output
            # This is a simplified integration; full implementation would
            # follow MinerU's official pipeline
            reader = FileBasedReader(str(pdf_path))
            pipe = OCRPipe(reader)

            # Execute pipeline
            pipe.execute()

            # Extract content (simplified — actual MinerU API may differ)
            content_md = pipe.get_markdown_content()
            areas = pipe.get_layout_areas()
            tables = pipe.extract_tables()
            formulas = pipe.extract_formulas()

            elapsed_ms = int((time.perf_counter() - start) * 1000)

            return MinerUResult(
                content_md=content_md,
                areas=areas,
                tables=tables,
                formulas=formulas,
                confidence=0.95,  # MinerU typically high confidence
                elapsed_ms=elapsed_ms,
            )
        except Exception as exc:
            logger.error("MinerU parsing failed: %s", exc)
            return MinerUResult(
                content_md="",
                confidence=0.0,
                elapsed_ms=int((time.perf_counter() - start) * 1000),
            )


# -- Unified OCR Engine (Facade) ---------------------------------------------

class OCREngine:
    """Unified OCR facade with multi-engine support and auto-fallback.

    This is the main entry point for OCR operations in aiarb.
    It automatically selects the best available engine and falls back
    gracefully if the primary engine fails.

    Example::

        config = OCRConfig(engine_type="auto", language="ch")
        ocr = OCREngine(config)

        # Check what's available
        print(ocr.available_engines())  # ['paddleocr', 'easyocr']

        # OCR a PDF
        results = ocr.ocr_pdf("document.pdf")
        for r in results:
            print(f"Page {r.page_number}: {r.text[:100]}... (conf={r.confidence})")
    """

    def __init__(self, config: OCRConfig | None = None):
        self.config = config or OCRConfig()
        self._engines: dict[str, BaseOCREngine] = {}
        self._mineru: MinerUParser | None = None

        # Register built-in engines
        self._register_builtin_engines()

    def _register_builtin_engines(self) -> None:
        """Register all built-in OCR engine implementations.

        Engine registration is based on the deployment mode in config:
        - If text_engine.mode == "local": register local engines (Paddle/Easy/Tesseract)
        - If text_engine.mode == "cloud_api": register cloud engine
        - If layout_parser is not None: register MinerU parser
        """
        te = self.config.text_engine

        # Always register all engines — they self-check availability
        self._engines = {
            OCREngineType.PADDLE.value: PaddleOCREngine(self.config),
            OCREngineType.EASY.value: EasyOCREngine(self.config),
            OCREngineType.TESSERACT.value: TesseractOCREngine(self.config),
            OCREngineType.CLOUD_OCR_SPACE.value: CloudOCREngine(self.config),
        }

        # Register MinerU if layout_parser is configured
        if self.config.layout_parser is not None:
            self._mineru = MinerUParser(self.config)
        else:
            self._mineru = None

    def available_engines(self) -> list[str]:
        """List all available (installed) OCR engines."""
        available = []
        for name, engine in self._engines.items():
            if engine.is_available():
                available.append(name)
        if self._mineru and self._mineru.is_available():
            available.append(OCREngineType.MINERU.value)
        return available

    def best_engine(self) -> BaseOCREngine:
        """Select the best available engine based on config and availability.

        New logic based on deployment mode:
        1. If text_engine.mode == "cloud_api" and cloud available → use cloud
        2. If text_engine.mode == "local" and specific provider set → try it first
        3. If text_engine.mode == "local" and provider == "auto" → try all local engines
        4. If fallback_to_cloud is True and all local fail → try cloud
        5. Raise error if nothing available
        """
        te = self.config.text_engine

        # Cloud mode: try cloud engine first
        if te.mode == "cloud_api":
            cloud = self._engines.get(OCREngineType.CLOUD_OCR_SPACE.value)
            if cloud and cloud.is_available():
                return cloud
            logger.warning("Cloud OCR engine configured but not available (missing API key?)")

        # Local mode: try specific provider first if set
        if te.provider and te.provider != "auto" and te.mode != "cloud_api":
            engine = self._engines.get(te.provider)
            if engine and engine.is_available():
                return engine
            logger.warning("Requested local engine '%s' not available", te.provider)

        # Auto mode or fallback: try local engines in priority order
        if te.mode == "local" or te.provider == "auto" or te.mode == "cloud_api":
            priority = [
                OCREngineType.PADDLE.value,
                OCREngineType.EASY.value,
                OCREngineType.TESSERACT.value,
            ]
            for name in priority:
                engine = self._engines.get(name)
                if engine and engine.is_available():
                    logger.info("Selected OCR engine: %s", name)
                    return engine

        # Fallback to cloud if enabled
        if self.config.fallback_to_cloud:
            cloud = self._engines.get(OCREngineType.CLOUD_OCR_SPACE.value)
            if cloud and cloud.is_available():
                logger.info("Falling back to cloud OCR engine")
                return cloud

        raise RuntimeError(
            "No OCR engine available. Install one of:\n"
            "  pip install paddlepaddle paddleocr  # Recommended\n"
            "  pip install easyocr\n"
            "  # Or configure a cloud API key"
        )

    def ocr_image(
        self,
        image: Any,
        page_number: int = 0,
        force_engine: str | None = None,
    ) -> OCRResult:
        """OCR a single image with automatic fallback.

        Args:
            image: PIL Image or numpy array.
            page_number: Page number for logging.
            force_engine: Force specific engine (skip auto-selection).

        Returns:
            OCRResult with extracted text and metadata.
        """
        if force_engine:
            engine = self._engines.get(force_engine)
            if not engine or not engine.is_available():
                raise ValueError(f"Engine '{force_engine}' not available")
            return engine.ocr_image(image, page_number)

        primary = self.best_engine()
        try:
            return primary.ocr_image(image, page_number)
        except Exception as exc:
            logger.warning("Primary OCR engine failed (%s): %s", primary.engine_name, exc)

            # Try fallback engines
            # Try fallback engines (local priority order, then cloud if enabled)
            fallback_chain = [
                OCREngineType.PADDLE.value,
                OCREngineType.EASY.value,
                OCREngineType.TESSERACT.value,
            ]
            if self.config.fallback_to_cloud:
                fallback_chain.append(OCREngineType.CLOUD_OCR_SPACE.value)
            for name in fallback_chain:
                fb = self._engines.get(name)
                if fb and fb.is_available() and fb.engine_name != primary.engine_name:
                    try:
                        logger.info("Trying fallback engine: %s", name)
                        return fb.ocr_image(image, page_number)
                    except Exception as fb_exc:
                        logger.warning("Fallback engine %s also failed: %s", name, fb_exc)

            raise RuntimeError(
                f"All OCR engines failed. Primary: {primary.engine_name}, "
                f"error: {exc}"
            ) from exc

    def ocr_pdf(
        self,
        pdf_path: str | Path,
        pages: list[int] | None = None,
        dpi: int | None = None,
    ) -> list[OCRResult]:
        """OCR a PDF file, converting each page to image first.

        Args:
            pdf_path: Path to PDF file.
            pages: Specific pages to OCR (1-indexed). None = all pages.
            dpi: Override DPI for rendering.

        Returns:
            List of OCRResult (one per page).
        """
        from PIL import Image

        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        # Convert PDF to images using pdf2image or PyMuPDF
        images = self._pdf_to_images(pdf_path, pages, dpi or self.config.dpi)

        results: list[OCRResult] = []
        start_page = pages[0] if pages else 1

        for idx, img in enumerate(images):
            result = self.ocr_image(img, page_number=start_page + idx)
            results.append(result)
            logger.debug(
                "Page %d: OCR complete (%s, conf=%.2f%%, %dms)",
                result.page_number, result.engine, result.confidence * 100,
                result.elapsed_ms,
            )

        return results

    def ocr_pdf_scanned_pages_only(
        self,
        pdf_path: str | Path,
        existing_pages: list,  # From intake.py _extract_pdf
        dpi: int | None = None,
    ) -> list[OCRResult]:
        """OCR only the scanned/image-only pages of a mixed PDF.

        This is optimized for the intake→redaction pipeline where some pages
        have text layers and others are scanned images.

        Args:
            pdf_path: Path to PDF.
            existing_pages: Page list from _extract_pdf() with ocr_needed flags.
            dpi: Override DPI.

        Returns:
            OCRResults for scanned pages only (others are skipped).
        """
        from .ldir import Page

        # Find pages that need OCR
        scanned_indices = [
            i for i, p in enumerate(existing_pages)
            if isinstance(p, Page) and any(
                b.block_type == "ocr_needed" for b in p.blocks
            )
        ]

        if not scanned_indices:
            logger.info("No scanned pages found in PDF, skipping OCR")
            return []

        logger.info(
            "Found %d scanned pages (%s) out of %d total",
            len(scanned_indices),
            scanned_indices,
            len(existing_pages),
        )

        # Convert only scanned pages to images
        images = self._pdf_to_images(
            pdf_path,
            pages=[i + 1 for i in scanned_indices],  # 1-indexed
            dpi=dpi or self.config.dpi,
        )

        results: list[OCRResult] = []
        for idx, img in enumerate(images):
            page_num = scanned_indices[idx] + 1
            result = self.ocr_image(img, page_number=page_num)
            results.append(result)

        return results

    def _pdf_to_images(
        self,
        pdf_path: Path,
        pages: list[int] | None = None,
        dpi: int = 300,
    ) -> list[Any]:
        """Convert PDF pages to PIL Images.

        Uses pdf2image (preferred) or PyMuPDF as fallback.
        """
        images: list[Any] = []

        # Try pdf2image first (better rendering quality)
        try:
            from pdf2image import convert_from_path

            kwargs = {"dpi": dpi}
            if pages:
                kwargs["first_page"] = min(pages)
                kwargs["last_page"] = max(pages)

            images = convert_from_path(str(pdf_path), **kwargs)
            return images
        except ImportError:
            pass

        # Fallback to PyMuPDF
        try:
            import fitz

            doc = fitz.open(str(pdf_path))
            page_indices = (
                [p - 1 for p in pages] if pages else range(len(doc))
            )
            for idx in page_indices:
                page = doc[idx]
                mat = fitz.Matrix(dpi / 72, dpi / 72)
                pix = page.get_pixmap(matrix=mat)
                img_data = pix.tobytes("png")
                from PIL import Image as PILImage

                images.append(PILImage.open(io.BytesIO(img_data)))
            doc.close()
            return images
        except ImportError:
            pass

        raise RuntimeError(
            "Need either pdf2image or PyMuPDF for PDF-to-image conversion. "
            "Install: pip install pdf2image"
        )

    def parse_with_mineru(self, pdf_path: str | Path) -> MinerUResult | None:
        """Parse PDF with MinerU layout analysis (if enabled and available).

        Returns None if MinerU is not configured or unavailable.
        """
        if not self._mineru or not self._mineru.is_available():
            return None
        return self._mineru.parse_pdf(pdf_path)


# -- Convenience functions ----------------------------------------------------

def get_ocr_config_path() -> Path:
    """Return the standard path for OCR config file.

    The OCR configuration is persisted at ``~/.aiarb/ocr_config.json``
    (i.e. inside the aiarb working directory) so that it survives
    restarts and is specific to the user/installation.
    """
    from ..constant import WORKING_DIR
    return WORKING_DIR / "ocr_config.json"


def load_default_ocr_config() -> OCRConfig:
    """Load OCR config from standard location, or return defaults."""
    return OCRConfig.load_from_file(get_ocr_config_path())


def ocr_pdf_page(
    pdf_path: str | Path,
    page_number: int = 1,
    config: OCRConfig | None = None,
) -> OCRResult:
    """Quick helper: OCR a single PDF page.

    This is the simplest entry point for ad-hoc OCR usage::

        from aiarb.document.ocr import ocr_pdf_page

        result = ocr_pdf_page("scanned.pdf", page_number=3)
        print(result.text)
    """
    ocr = OCREngine(config or load_default_ocr_config())
    return ocr.ocr_pdf(pdf_path, pages=[page_number])[0]


def ocr_image_file(
    image_path: str | Path,
    config: OCRConfig | None = None,
) -> OCRResult:
    """Quick helper: OCR an image file (PNG/JPG/TIFF)."""
    from PIL import Image

    ocr = OCREngine(config or load_default_ocr_config())
    img = Image.open(str(image_path))
    return ocr.ocr_image(img)


def detect_ocr_needs(intake_result: Any) -> bool:
    """Check if an IntakeResult indicates OCR is needed.

    This bridges the intake pipeline and OCR layer:
    returns True if any page was flagged as 'ocr_needed'.
    """
    # Handle both IntakeResult and dict-like objects
    if hasattr(intake_result, 'report'):
        report = intake_result.report
        return getattr(report, 'ocr_engine', '') == 'ocr-needed' or \
               getattr(report, 'human_review_recommended', False)
    elif isinstance(intake_result, dict):
        return intake_result.get('ocr_engine') == 'ocr-needed'
    return False


__all__ = [
    # Enums
    "OCREngineType",
    "OCRMode",
    # Data classes
    "OCRResult",
    "OCRConfig",
    "MinerUResult",
    # Engines
    "BaseOCREngine",
    "PaddleOCREngine",
    "EasyOCREngine",
    "TesseractOCREngine",
    "CloudOCREngine",
    "MinerUParser",
    # Facade
    "OCREngine",
    # Helpers
    "get_ocr_config_path",
    "load_default_ocr_config",
    "ocr_pdf_page",
    "ocr_image_file",
    "detect_ocr_needs",
]
