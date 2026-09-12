#!/usr/bin/env python3
"""
AIArb 文件脱敏功能 (Redaction Agent)

涵盖：敏感实体检测 → 策略脱敏 → 渲染输出 → 质量评测 → 反向还原

用法：
  python -m aiarb.redaction.agent text <文本> [--policy external_client]
  python -m aiarb.redaction.agent file <file_path> [--policy ...]
  python -m aiarb.redaction.agent pdf <pdf_path> <ldir_path>
  python -m aiarb.redaction.agent batch <dir_path>
  python -m aiarb.redaction.agent detect <file_path>
  python -m aiarb.redaction.agent eval <result.json> <ground_truth.json>
  python -m aiarb.redaction.agent restore <mapping.enc> <file_or_text>
  python -m aiarb.redaction.agent list-entities
  python -m aiarb.redaction.agent list-policies
"""

import sys
import json
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


# ============================================================
# 1. 核心脱敏操作
# ============================================================

def redact_text(text: str, policy: str = "external_client",
                entity_types: list = None, custom_rules: dict = None,
                strength_level: str = None) -> dict:
    """
    对文本执行脱敏。

    Args:
        text: 待脱敏文本
        policy: 脱敏策略 external_client / internal_legal_analysis / public_release
        entity_types: 指定实体类型列表（默认检测所有）
        custom_rules: 自定义规则
        strength_level: 强度级别 L1/L2/L3/L4，优先于 policy

    Returns:
        dict: redacted_text, mappings, entity_count, review_items
    """
    from .pipeline import RedactionPipeline

    pipeline = RedactionPipeline()
    result = pipeline.process_text(
        text=text,
        policy_name=policy,
        entity_types=entity_types,
        custom_rules=custom_rules,
        strength_level=strength_level,
    )
    return _serialize_mappings(result)


# ============================================================
# 1.5 Agent 增强脱敏（标准规则 + LLM 深度语义复核）
# ============================================================

AGENT_REDACTION_SYSTEM_PROMPT = """你是一个法律文档脱敏专家。你的任务是对已经经过规则引擎初步脱敏的文本进行**深度语义复核和增强**。

## 核心原则
1. **一致性优先**：同一主体（人名、公司名、机构名）的所有称谓必须映射到同一个 Token
2. **上下文理解**：利用法律文书语境判断某些模糊文本是否为敏感信息
3. **不遗漏**：规则引擎可能漏掉的敏感信息（如隐含的地址、非标准格式的电话等）
4. **不过度脱敏**：公开的法律规范标题、仲裁机构名称、法条引用不应脱敏

## 输入格式
你会收到：
- 原始文本
- 规则引擎的脱敏结果（含 mappings 列表）
- 脱敏后的文本

## 输出要求
返回严格 JSON 格式：
```json
{
  "additional_entities": [
    {
      "original": "原始敏感文本",
      "entity_type": "实体类型",
      "suggested_replacement": "建议替换为",
      "reason": "发现原因"
    }
  ],
  "over_redactions": [
    {
      "redacted_text": "被错误脱敏的文本",
      "reason": "不应脱敏的原因",
      "suggested_restore": "建议还原为"
    }
  ],
  "consistency_issues": [
    {
      "issue": "问题描述",
      "suggestion": "修复建议"
    }
  ],
  "summary": "总体评价和建议"
}
```

如果没有问题需要修正，返回 `{"additional_entities": [], "over_redactions": [], "consistency_issues": [], "summary": "..."}`。
"""


async def agent_enhanced_redact(
    text: str,
    policy: str = "external_client",
    entity_types: list = None,
    custom_rules: dict = None,
    strength_level: str = None,
    provider_id: str = None,
    model_id: str = None,
) -> dict:
    """Agent 增强脱敏：先执行标准规则脱敏，再调用 LLM 做深度语义复核。

    这是 aiarb 多 Agent 架构中的「Agent 增强模式」：
    - Phase 1: 规则引擎快速脱敏（RedactionPipeline）
    - Phase 2: LLM 深度语义复核（发现遗漏、检测过度脱敏、校验一致性）
    - Phase 3: 合并结果，输出最终脱敏文本

    Args:
        text: 待脱敏文本
        policy: 脱敏策略
        entity_types: 指定实体类型列表
        custom_rules: 自定义规则
        strength_level: 强度级别
        provider_id: 可选，指定 Provider ID（从 aiarb 配置读取）
        model_id: 可选，指定模型 ID（从 aiarb 配置读取）

    Returns:
        dict: 包含 redacted_text, mappings, agent_review 等字段
    """
    import asyncio

    # --- Phase 1: 标准规则脱敏 ---
    rule_result = redact_text(
        text=text,
        policy=policy,
        entity_types=entity_types,
        custom_rules=custom_rules,
        strength_level=strength_level,
    )

    # 如果规则引擎没有检测到任何实体，直接返回（无需 Agent 复核）
    if rule_result.get("entity_count", 0) == 0 and len(text) < 100:
        return {**rule_result, "agent_mode": "skipped_short_text"}

    # --- Phase 2: LLM 深度语义复核 ---
    agent_review = None
    try:
        from ..agents.model_factory import create_model_and_formatter_async

        # If user specified a specific provider/model, use it; otherwise use global default
        model = None
        if provider_id or model_id:
            from ..providers.provider_manager import ProviderManager

            mgr = ProviderManager.get_instance()

            # If only model_id is given (no provider), try to find it in active models
            if not provider_id and model_id:
                active_slot = mgr.get_active_model()
                if active_slot and active_slot.model == model_id:
                    provider_id = active_slot.provider_id

            if provider_id and model_id:
                # Create model for the specified provider/model combination
                model, _ = await create_model_and_formatter_async(
                    provider_id=provider_id,
                    model_id=model_id,
                )
                logger.info(
                    "Agent enhanced redaction using user-specified model: %s/%s",
                    provider_id,
                    model_id,
                )

        if model is None:
            # Fallback to global default model
            model, _ = await create_model_and_formatter_async()

        if model is None:
            # 模型不可用，降级为纯规则模式
            return {**rule_result, "agent_mode": "model_unavailable"}

        from agentscope.message import Msg, TextBlock

        messages = [
            Msg(
                name="system",
                role="system",
                content=[TextBlock(type="text", text=AGENT_REDACTION_SYSTEM_PROMPT)],
            ),
            Msg(
                name="user",
                role="user",
                content=[
                    TextBlock(
                        type="text",
                        text=f"""请对以下脱敏结果进行深度语义复核：

## 原始文本（前 3000 字符）
{text[:3000]}

## 规则引擎脱敏结果
- 脱敏后文本：{rule_result.get('redacted_text', '')[:2000]}
- 检测到实体数：{rule_result.get('entity_count', 0)}
- Mappings 摘要：{[
    {'type': m.get('entity_type'), 'orig': m.get('original', '')[:30], 'redacted': m.get('redacted', '')[:30]}
    for m in (rule_result.get('mappings') or [])[:20]
]}""",
                    )
                ],
            ),
        ]

        response = await model(messages)

        # 提取响应文本
        review_text = ""
        if hasattr(response, "__aiter__"):
            async for chunk in response:
                if hasattr(chunk, "text"):
                    review_text += chunk.text
                elif isinstance(chunk, str):
                    review_text += chunk
        else:
            review_text = getattr(response, "text", str(response))

        # 尝试解析 JSON
        import json
        import re

        json_match = re.search(r'\{[\s\S]*\}', review_text)
        if json_match:
            try:
                agent_review = json.loads(json_match.group())
            except json.JSONDecodeError:
                agent_review = {"raw_response": review_text, "parse_error": True}
        else:
            agent_review = {"raw_response": review_text, "parse_error": False}

    except Exception as e:
        logger.warning("Agent enhanced redaction LLM call failed: %s", exc_info=e)
        agent_review = {"error": str(e), "mode": "fallback_to_rules"}

    # --- Phase 3: 合并结果 ---
    result = {
        **rule_result,
        "agent_mode": "enhanced",
        "agent_review": agent_review,
    }

    # 如果 Agent 发现了额外实体，标记但不自动应用（由用户决定）
    if isinstance(agent_review, dict) and agent_review.get("additional_entities"):
        result["agent_suggestions"] = agent_review["additional_entities"]
        result["has_agent_suggestions"] = True

    return result


def _serialize_mappings(result: dict) -> dict:
    """将脱敏结果中的 dataclass mappings 转为可 JSON 序列化的 dict 列表"""
    if "mappings" in result and result["mappings"]:
        result["mappings"] = [
            {
                "entity_id": m.entity_id,
                "entity_type": m.entity_type,
                "original": m.original,
                "redacted": m.redacted,
                "mode": str(m.mode),
                "start": m.start,
                "end": m.end,
                "page_number": m.page_number,
                "confidence": m.confidence,
                "cluster_id": m.cluster_id,
                "alias_of": m.alias_of,
            }
            for m in result["mappings"]
        ]
    return result


def _get_available_ocr_engines() -> list[str]:
    """Check which OCR engines are available (for error messages)."""
    available = []
    try:
        from ..document.ocr import OCREngine, load_default_ocr_config
        ocr = OCREngine(load_default_ocr_config())
        available = ocr.available_engines()
    except Exception:
        pass
    return available if available else ["(none)"]


def _extract_docx_text(path: Path) -> str | None:
    """Extract plain text from a .docx file.

    Tries python-docx first (preserves paragraph structure, tables).
    Falls back to stdlib zipfile + regex parsing of word/document.xml.
    """
    # Strategy 1: python-docx (preferred — preserves paragraph structure)
    try:
        import docx  # type: ignore[import-untyped]

        doc = docx.Document(str(path))
        paragraphs: list[str] = []

        # Extract paragraphs
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                paragraphs.append(text)

        # Extract table cell text
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    text = cell.text.strip()
                    if text:
                        paragraphs.append(text)

        content = "\n\n".join(paragraphs)
        if content.strip():
            return content
    except ImportError:
        logger.debug("python-docx not installed, falling back to stdlib extraction")
    except Exception as e:
        logger.warning("python-docx extraction failed for %s: %s", path, e)

    # Strategy 2: stdlib zipfile fallback (no external deps)
    try:
        import re
        import zipfile

        with zipfile.ZipFile(str(path)) as zf:
            try:
                xml = zf.read("word/document.xml").decode("utf-8")
            except KeyError:
                return None

        # Extract text from <w:t>...</w:t> elements
        texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", xml, re.DOTALL)
        if not texts:
            return None

        joined = "\n".join(t.strip() for t in texts if t.strip())
        # Basic XML entity unescaping
        joined = (
            joined.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&apos;", "'")
        )
        return joined if joined.strip() else None
    except Exception as e:
        logger.warning("stdlib docx extraction failed for %s: %s", path, e)
        return None


def _extract_html_text(raw: bytes) -> str:
    """Extract plain text from HTML bytes, stripping tags.

    Tries BeautifulSoup if available, falls back to stdlib regex.
    """
    # Detect encoding
    encoding = "utf-8"
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        encoding = "gbk"
    html = raw.decode(encoding, errors="replace")

    # Strategy 1: BeautifulSoup (if available)
    try:
        from bs4 import BeautifulSoup  # type: ignore[import-untyped]

        soup = BeautifulSoup(html, "html.parser")
        # Remove script and style elements
        for tag in soup(["script", "style"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        if text.strip():
            return text
    except ImportError:
        pass
    except Exception as e:
        logger.warning("BeautifulSoup HTML extraction failed: %s", e)

    # Strategy 2: stdlib regex fallback
    import re

    # Remove script and style blocks
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Convert <br> and <p> tags to newlines
    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    html = re.sub(r"</p>", "\n\n", html, flags=re.IGNORECASE)
    html = re.sub(r"<p[^>]*>", "", html, flags=re.IGNORECASE)
    # Remove all remaining tags
    text = re.sub(r"<[^>]+>", "", html)
    # Unescape HTML entities
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    # Collapse excessive blank lines
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)


def redact_file(file_path: str, policy: str = "external_client",
                entity_types: list = None,
                custom_rules: dict = None,
                strength_level: str = None,
                enable_ocr: bool = True) -> dict:
    """
    对文件执行脱敏（支持先 OCR 再脱敏的完整链路）。

    支持：
        .txt / .md / .markdown → 纯文本脱敏
        .pdf（有文本层）→ 提取文本后脱敏
        .pdf（扫描件）→ 自动 OCR 后再脱敏（需配置 OCR 引擎）
        .docx / .doc → python-docx 或 stdlib zipfile 提取文本后脱敏
        .html / .htm → BeautifulSoup 或 regex 提取文本后脱敏

    Args:
        file_path: 文件路径
        policy: 脱敏策略
        entity_types: 指定实体类型
        custom_rules: 自定义规则覆盖
        strength_level: 强度级别 L1/L2/L3/L4
        enable_ocr: 是否对扫描页自动执行 OCR（默认 True）

    Returns:
        dict: redacted_text, mappings, entity_count, review_items, output_files
    """
    path = Path(file_path)
    if not path.exists():
        return {"success": False, "error": f"文件不存在: {file_path}"}

    from .pipeline import RedactionPipeline

    pipeline = RedactionPipeline()
    suffix = path.suffix.lower()

    # --- PDF 脱敏（支持 OCR 集成） ---
    if suffix == ".pdf":
        try:
            import fitz
            doc = fitz.open(str(path))
            texts = []
            scanned_page_indices = []
            ocr_performed = False

            for p_idx, p in enumerate(doc):
                page_text = p.get_text("text").strip()
                if not page_text:
                    # Check if this page has images (likely a scan)
                    images = p.get_images(full=True)
                    if len(images) > 0:
                        scanned_page_indices.append(p_idx)
                texts.append(page_text)

            text = "\n\n".join(texts)

            # If scanned pages detected and OCR enabled, try OCR first
            if scanned_page_indices and enable_ocr and len(text.strip()) < 100:
                logger.info(
                    "PDF has %d scanned pages, attempting OCR...",
                    len(scanned_page_indices),
                )
                try:
                    from ..document.ocr import OCREngine, load_default_ocr_config

                    ocr_config = load_default_ocr_config()
                    ocr_engine = OCREngine(ocr_config)

                    # OCR only the scanned pages
                    ocr_results = ocr_engine.ocr_pdf_scanned_pages_only(
                        path,
                        existing_pages=[],  # We'll do full re-extraction
                        dpi=ocr_config.dpi,
                    )

                    if ocr_results and any(r.text.strip() for r in ocr_results):
                        # Rebuild text with OCR results replacing empty pages
                        for i, t in enumerate(texts):
                            if not t.strip() and i in scanned_page_indices:
                                # Find matching OCR result
                                ocr_match = next(
                                    (r for r in ocr_results if r.page_number == i + 1),
                                    None,
                                )
                                if ocr_match and ocr_match.text.strip():
                                    texts[i] = ocr_match.text
                                    ocr_performed = True

                        text = "\n\n".join(t.strip() or "[OCR 提取失败]" for t in texts)
                        logger.info("OCR completed successfully for %d pages", len(ocr_results))
                    else:
                        logger.warning("OCR returned no usable results")
                except Exception as ocr_exc:
                    logger.warning("OCR failed, falling back to text-only: %s", ocr_exc)

            # Final check: if still no usable text after OCR attempt
            if scanned_page_indices and len(text.strip()) < 50 and not ocr_performed:
                return {
                    "success": False,
                    "error": (
                        f"该 PDF 包含 {len(scanned_page_indices)} 个扫描/图片页，无法提取文字。"
                        "\n建议操作："
                        "\n1. 安装 OCR 引擎：pip install paddlepaddle paddleocr"
                        "\n2. 或在设置中配置云端 OCR API Key"
                        "\n3. 或使用其他工具将扫描件转为可搜索 PDF 后再脱敏"
                    ),
                    "error_code": "SCANNED_PDF_NEEDS_OCR",
                    "scanned_pages": len(scanned_page_indices),
                    "ocr_engines_available": _get_available_ocr_engines(),
                }

        except Exception as e:
            return {"success": False, "error": f"PDF 文本提取失败: {e}"}

        result = pipeline.process_text(
            text=text,
            policy_name=policy,
            entity_types=entity_types,
            custom_rules=custom_rules,
            strength_level=strength_level,
        )

        if result.get("mappings"):
            try:
                from .renderer_pdf import PDFRedactionRenderer
                pdf_renderer = PDFRedactionRenderer()

                pdf_result = pdf_renderer.redact_from_mappings(
                    pdf_path=str(path),
                    mappings=result["mappings"],
                    output_path=str(path.parent / f"{path.stem}.redacted.pdf"),
                )
                result["pdf_redaction"] = pdf_result
            except Exception as e:
                result["pdf_redaction_error"] = str(e)

        return _serialize_mappings(result)

    # --- DOCX 文件脱敏 ---
    if suffix in (".docx", ".doc"):
        content = _extract_docx_text(path)
        if content is None:
            return {
                "success": False,
                "error": (
                    "DOCX 文件文本提取失败。可能原因：文件损坏、受密码保护，或未安装 python-docx。"
                    "\n建议：pip install python-docx"
                ),
            }
    # --- HTML 文件脱敏 ---
    elif suffix in (".html", ".htm"):
        try:
            raw = path.read_bytes()
            content = _extract_html_text(raw)
        except Exception as e:
            return {"success": False, "error": f"HTML 文件读取失败: {e}"}
    # --- 纯文本文件脱敏 ---
    else:
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            content = path.read_text(encoding="gbk", errors="replace")

    result = pipeline.process_text(
        text=content,
        policy_name=policy,
        entity_types=entity_types,
        custom_rules=custom_rules,
        strength_level=strength_level,
    )

    output_path = path.parent / f"{path.stem}.redacted.md"
    output_path.write_text(result.get("redacted_text", ""), encoding="utf-8")
    result["output_file"] = str(output_path)

    mapping_path = path.parent / f"{path.stem}.mapping.enc"
    try:
        from .renderer import RedactionRenderer
        renderer = RedactionRenderer()
        renderer.generate_mapping_file(
            result.get("mappings", []),
            str(mapping_path),
            encrypt=False,
            cluster_table=result.get("cluster_table", []),
        )
        result["mapping_file"] = str(mapping_path)
    except Exception as e:
        result["mapping_file_error"] = str(e)

    return _serialize_mappings(result)


def redact_from_ldir(ldir_path: str, policy: str = "external_client",
                     entity_types: list = None,
                     custom_rules: dict = None,
                     strength_level: str = None) -> dict:
    """基于已有的 LDIR 文件执行脱敏（复用 Intake 的文本提取结果）。

    与 redact_file() 不同，此函数不重新从原始文件提取文本，
    而是直接读取 LDIR 中的结构化文本和坐标信息。
    这避免了重复的 PDF 文本提取，且能利用 LDIR 的 bbox 信息做精确涂黑。

    Args:
        ldir_path: LDIR JSON 文件路径 (*.ldir.json)
        policy: 脱敏策略
        entity_types: 指定实体类型列表
        custom_rules: 自定义规则覆盖
        strength_level: 强度级别

    Returns:
        dict: redacted_text, mappings, entity_count, ldir_source
    """
    from .pipeline import RedactionPipeline
    from ..document.ldir import LDIRDocument

    ldir_file = Path(ldir_path)
    if not ldir_file.exists():
        return {"success": False, "error": f"LDIR 文件不存在: {ldir_path}"}

    # 加载 LDIR
    try:
        ldir = LDIRDocument.load(str(ldir_file))
    except Exception as e:
        return {"success": False, "error": f"LDIR 加载失败: {e}"}

    # 从 LDIR 提取全文本
    full_text = ldir.full_text()
    if not full_text.strip():
        return {"success": False, "error": "LDIR 中无文本内容，可能是扫描件未 OCR"}

    pipeline = RedactionPipeline()
    result = pipeline.process_text(
        text=full_text,
        policy_name=policy,
        entity_types=entity_types,
        custom_rules=custom_rules,
        strength_level=strength_level,
    )

    result["ldir_source"] = str(ldir_path)
    result["doc_id"] = ldir.doc_id
    result["doc_type"] = getattr(ldir, 'doc_type', None)
    result["page_count"] = len(ldir.pages)

    return _serialize_mappings(result)


def redact_pdf(pdf_path: str, ldir_path: str = None,
               mappings: list = None, output_path: str = None,
               remove_text_layer: bool = False) -> dict:
    """对 PDF 执行坐标级脱敏（基于 LDIR 坐标涂黑）。"""
    from .renderer_pdf import PDFRedactionRenderer

    renderer = PDFRedactionRenderer()

    if mappings:
        result = renderer.redact_from_mappings(
            pdf_path=pdf_path,
            mappings=mappings,
            output_path=output_path or str(Path(pdf_path).parent / f"{Path(pdf_path).stem}.redacted.pdf"),
        )
    elif ldir_path:
        result = renderer.redact(
            pdf_path=pdf_path,
            ldir_path=ldir_path,
            output_path=output_path or str(Path(pdf_path).parent / f"{Path(pdf_path).stem}.redacted.pdf"),
            remove_text_layer=remove_text_layer,
        )
    else:
        return {"success": False, "error": "需要提供 ldir_path 或 mappings"}

    return result


def batch_redact(directory: str, policy: str = "external_client",
                 entity_types: list = None,
                 custom_rules: dict = None,
                 strength_level: str = None) -> list:
    """批量脱敏目录下所有可脱敏文件。

    Args:
        directory: 目录路径
        policy: 脱敏策略
        entity_types: 指定实体类型
        custom_rules: 自定义规则
        strength_level: 强度级别 L1/L2/L3/L4

    Returns:
        list: 每个文件的脱敏结果
    """
    dir_path = Path(directory)
    if not dir_path.exists():
        return [{"success": False, "error": f"目录不存在: {directory}"}]

    supported = {".txt", ".md", ".markdown", ".html", ".htm", ".pdf", ".docx", ".doc"}
    results = []
    for f in sorted(dir_path.iterdir()):
        if f.is_file() and f.suffix.lower() in supported:
            result = redact_file(str(f), policy, entity_types, custom_rules, strength_level)
            result["file"] = str(f)
            results.append(result)

    # 汇总统计
    total_entities = sum(r.get("entity_count", 0) for r in results if r.get("success"))
    success_count = sum(1 for r in results if r.get("success"))
    fail_count = len(results) - success_count

    return {
        "success": True,
        "count": len(results),
        "success_count": success_count,
        "fail_count": fail_count,
        "total_entity_count": total_entities,
        "results": results,
    }


# ============================================================
# 2. 敏感实体检测
# ============================================================

def detect_entities(text: str = None, file_path: str = None) -> dict:
    """检测文本中的敏感实体"""
    from .detector import RedactionDetector

    if file_path:
        path = Path(file_path)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            text = path.read_text(encoding="gbk", errors="replace")

    detector = RedactionDetector()
    entities = detector.detect(text or "")

    return {
        "success": True,
        "entity_count": len(entities),
        "entities": [
            {
                "type": e.entity_type,
                "text": e.text,
                "start": e.start,
                "end": e.end,
                "confidence": e.confidence,
            }
            for e in entities
        ],
    }


# ============================================================
# 3. 脱敏反向还原
# ============================================================

def restore_text(mapping_path: str, text: str) -> dict:
    """基于 mapping 文件将脱敏后的文本还原为原始名称。"""
    from .restorer import RedactionRestorer

    restorer = RedactionRestorer(mapping_path)
    return restorer.restore_text(text)


def restore_file(mapping_path: str, input_path: str,
                 output_path: str = None) -> dict:
    """基于 mapping 文件还原文件内容。"""
    from .restorer import RedactionRestorer

    restorer = RedactionRestorer(mapping_path)
    if not output_path:
        p = Path(input_path)
        output_path = str(p.parent / f"{p.stem}.restored.md")
    return restorer.restore_file(input_path, output_path)


# ============================================================
# 4. 脱敏质量评测
# ============================================================

def evaluate_redaction(redacted_result: dict, ground_truth_entities: list) -> dict:
    """评测脱敏质量。"""
    redacted_text = redacted_result.get("redacted_text", "")
    mapping = redacted_result.get("mappings", [])
    mapping_dict = {m.get("original", ""): m.get("redacted", "") for m in mapping}

    missed = sum(1 for e in ground_truth_entities if e in redacted_text)
    fnr = missed / len(ground_truth_entities) if ground_truth_entities else 0

    consistent = True
    value_to_key = {}
    for orig, redacted in mapping_dict.items():
        if redacted in value_to_key and value_to_key[redacted] != orig:
            consistent = False
        value_to_key[redacted] = orig

    score = (1 - fnr) * 0.6 + 0.2 + (0.2 if consistent else 0.0)

    return {
        "success": True,
        "eval_name": "redaction_quality",
        "passed": fnr < 0.05 and consistent,
        "score": round(score * 100, 2),
        "metrics": {
            "false_negative_rate": round(fnr, 4),
            "false_positive_rate": 0.0,
            "consistency": consistent,
            "missed_entities": missed,
            "total_ground_truth": len(ground_truth_entities),
        },
        "warnings": [f"漏检 {missed} 个实体"] if missed > 0 else [],
    }


# ============================================================
# 5. 信息查询
# ============================================================

SUPPORTED_ENTITY_TYPES = [
    ("person_name", "人名", "自然人姓名（NER 预留）"),
    ("id_number", "身份证号", "15/18位身份证号"),
    ("phone_number", "手机号", "中国大陆手机号/固话"),
    ("email", "邮箱地址", "电子邮件地址"),
    ("address", "地址", "详细地址"),
    ("bank_account", "银行卡号", "银行卡号（16-19位）"),
    ("company_name", "公司名", "公司/企业/事务所等主体名称"),
    ("license_plate", "车牌号", "中国大陆车牌号"),
    ("case_number", "案号", "法院/仲裁案件编号"),
    ("wechat_id", "微信号", "微信号"),
    ("alipay_id", "支付宝账号", "支付宝账号"),
    ("ip_address", "IP地址", "IPv4 地址"),
    ("party_alias", "当事人代称", "甲方/乙方/该公司/其等代词"),
    # 仲裁特有实体类型
    ("arbitrator_name", "仲裁员姓名", "仲裁员/独任仲裁员姓名"),
    ("lawyer_name", "代理人姓名", "律师/代理人姓名"),
    ("witness_name", "证人姓名", "证人姓名"),
    ("amount", "金额", "金额数字（可保留或泛化）"),
    ("date", "日期", "日期（可保留或偏移）"),
    ("evidence_id", "证据编号", "证据编号（通常保留）"),
]

SUPPORTED_POLICIES = [
    ("external_client", "对外发送", "Mask 敏感信息，保留部分可读性"),
    ("internal_legal_analysis", "内部法律分析", "语义化 Token（如北京某米科技有限公司），可还原"),
    ("public_release", "公开发布", "Full Mask，不可逆"),
]

SUPPORTED_STRENGTH_LEVELS = [
    ("L1", "高度脱敏", "FULL_MASK + SHIELD + GENERALIZE"),
    ("L2", "中度脱敏", "PARTIAL_MASK + SHIELD"),
    ("L3", "轻度脱敏", "TOKENIZE + 加密映射可还原"),
    ("L4", "名义脱敏", "RANDOMIZE + DATE_SHIFT"),
]

REDACTION_MODES = [
    ("MASK", "张某, 138****5678", "掩码替换：保留姓氏/前缀"),
    ("REPLACE", "当事人甲, A公司", "角色替换：不可识别 + 语义关联"),
    ("TOKENIZE", "北京某米科技有限公司", "语义化 Token：可还原"),
    ("FULL_MASK", "████████", "完全遮盖"),
    ("PARTIAL_MASK", "138****5678", "部分保留"),
    ("KEEP", "原样保留", "不脱敏（如金额/日期）"),
    ("CONFIGURABLE", "[需配置]", "需人工复核"),
    # LegalWork A5 新增策略
    ("GENERALIZE", "某科技公司", "泛化：具体值→类别描述"),
    ("SHIELD", "[已屏蔽: 8字]", "屏蔽：删除整段并标注"),
    ("RANDOMIZE", "某讯科技", "随机置换：同类池随机选取"),
    ("DATE_SHIFT", "2024年3月12日", "日期偏移：±N天随机"),
]


def list_entities():
    return {"success": True, "entity_types": [
        {"id": e[0], "name": e[1], "description": e[2]} for e in SUPPORTED_ENTITY_TYPES
    ]}


def list_policies():
    return {"success": True, "policies": [
        {"id": p[0], "name": p[1], "description": p[2]} for p in SUPPORTED_POLICIES
    ]}


def list_strength_levels():
    return {"success": True, "strength_levels": [
        {"id": s[0], "name": s[1], "description": s[2]} for s in SUPPORTED_STRENGTH_LEVELS
    ]}


def list_modes():
    return {"success": True, "modes": [
        {"id": m[0], "example": m[1], "description": m[2]} for m in REDACTION_MODES
    ]}


# ============================================================
# 6. CLI 入口
# ============================================================

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command == "text":
        if len(sys.argv) < 3:
            print("用法: python -m aiarb.redaction.agent text <文本> [--policy <policy>]")
            sys.exit(1)
        text = sys.argv[2]
        policy = "external_client"
        if "--policy" in sys.argv:
            idx = sys.argv.index("--policy")
            policy = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else policy
        result = redact_text(text, policy)

    elif command == "file":
        if len(sys.argv) < 3:
            print("用法: python -m aiarb.redaction.agent file <file_path> [--policy <policy>]")
            sys.exit(1)
        policy = "external_client"
        if "--policy" in sys.argv:
            idx = sys.argv.index("--policy")
            policy = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else policy
        result = redact_file(sys.argv[2], policy)

    elif command == "pdf":
        if len(sys.argv) < 4:
            print("用法: python -m aiarb.redaction.agent pdf <pdf_path> <ldir_path> [--output <path>]")
            sys.exit(1)
        output = None
        if "--output" in sys.argv:
            idx = sys.argv.index("--output")
            output = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None
        result = redact_pdf(sys.argv[2], sys.argv[3], output_path=output)

    elif command == "batch":
        if len(sys.argv) < 3:
            print("用法: python -m aiarb.redaction.agent batch <dir_path> [--policy <policy>]")
            sys.exit(1)
        policy = "external_client"
        if "--policy" in sys.argv:
            idx = sys.argv.index("--policy")
            policy = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else policy
        results = batch_redact(sys.argv[2], policy)
        result = {"success": True, "count": len(results), "results": results}

    elif command == "detect":
        if len(sys.argv) < 3:
            print("用法: python -m aiarb.redaction.agent detect <file_path>")
            sys.exit(1)
        result = detect_entities(file_path=sys.argv[2])

    elif command == "eval":
        if len(sys.argv) < 4:
            print("用法: python -m aiarb.redaction.agent eval <result.json> <ground_truth.json>")
            sys.exit(1)
        with open(sys.argv[2]) as f:
            redacted_result = json.load(f)
        with open(sys.argv[3]) as f:
            ground_truth = json.load(f)
        result = evaluate_redaction(redacted_result, ground_truth.get("entities", ground_truth))

    elif command == "restore":
        if len(sys.argv) < 4:
            print("用法: python -m aiarb.redaction.agent restore <mapping.enc> <file_or_text> [--output <path>]")
            sys.exit(1)
        mapping_path = sys.argv[2]
        input_arg = sys.argv[3]
        output = None
        if "--output" in sys.argv:
            idx = sys.argv.index("--output")
            output = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None

        if Path(input_arg).exists() and Path(input_arg).is_file():
            result = restore_file(mapping_path, input_arg, output)
        else:
            result = restore_text(mapping_path, input_arg)
            if output:
                Path(output).write_text(result.get("restored_text", ""), encoding="utf-8")
                result["output_path"] = output

    elif command == "list-entities":
        result = list_entities()
    elif command == "list-policies":
        result = list_policies()
    elif command == "list-modes":
        result = list_modes()

    else:
        print(f"未知命令: {command}")
        print(__doc__)
        sys.exit(1)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
