"""
AIArb 文件脱敏功能模块 (Redaction)

功能：敏感实体识别 → 脱敏策略 → 脱敏渲染输出 → 质量评测 → 反向还原

导入方式：from aiarb.redaction.pipeline import RedactionPipeline
          from aiarb.redaction.agent import redact_text, redact_file, restore_text
"""
from .detector import RedactionDetector, SensitiveEntity
from .policy import (
    RedactionPolicyEngine,
    RedactionMode,
    RedactionStrengthLevel,
    RedactionMapping,
    RedactionRule,
)
from .renderer import RedactionRenderer
from .renderer_pdf import PDFRedactionRenderer
from .pipeline import RedactionPipeline
from .restorer import RedactionRestorer

__all__ = [
    "RedactionDetector",
    "SensitiveEntity",
    "RedactionPolicyEngine",
    "RedactionMode",
    "RedactionStrengthLevel",
    "RedactionMapping",
    "RedactionRule",
    "RedactionRenderer",
    "PDFRedactionRenderer",
    "RedactionPipeline",
    "RedactionRestorer",
]
