# -*- coding: utf-8 -*-
"""
裁决核阅模块
对仲裁裁决书进行智能审查和核验
"""

import re
import json
from typing import Dict, Any, List, Optional
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum

from ...utils.logging import logger
from .knowledge_base import ArbitrationKnowledgeBase


class ReviewStatus(Enum):
    """核阅状态"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    NEEDS_REVISION = "needs_revision"
    APPROVED = "approved"


class ReviewCheckType(Enum):
    """检查项类型"""
    FORMAT_CHECK = "format_check"        # 格式规范
    CONTENT_CHECK = "content_check"      # 内容完整性
    LOGIC_CHECK = "logic_check"          # 逻辑一致性
    LEGAL_BASIS_CHECK = "legal_basis"   # 法律依据
    CALCULATION_CHECK = "calculation"    # 金额计算
    SIGNATURE_CHECK = "signature"        # 签署信息


@dataclass
class ReviewCheck:
    """核阅检查项"""
    check_type: ReviewCheckType
    check_name: str
    status: str  # passed, failed, warning
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AwardReviewResult:
    """裁决核阅结果"""
    review_id: str
    award_text: str
    status: ReviewStatus
    checks: List[ReviewCheck] = field(default_factory=list)
    summary: str = ""
    risk_level: str = "low"  # low, medium, high
    suggestions: List[str] = field(default_factory=list)
    created_at: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "review_id": self.review_id,
            "status": self.status.value,
            "summary": self.summary,
            "risk_level": self.risk_level,
            "checks": [
                {
                    "type": c.check_type.value,
                    "name": c.check_name,
                    "status": c.status,
                    "message": c.message,
                    "details": c.details
                }
                for c in self.checks
            ],
            "suggestions": self.suggestions,
            "created_at": self.created_at,
            "total_checks": len(self.checks),
            "passed_checks": len([c for c in self.checks if c.status == "passed"]),
            "failed_checks": len([c for c in self.checks if c.status == "failed"]),
            "warning_checks": len([c for c in self.checks if c.status == "warning"]),
        }


class AwardReviewer:
    """
    仲裁裁决书核阅器
    对裁决书进行多维度的智能审查
    """

    def __init__(self, knowledge_base: Optional[ArbitrationKnowledgeBase] = None):
        self.knowledge_base = knowledge_base or ArbitrationKnowledgeBase()
        
        # 裁决书必要要素
        self.required_elements = [
            ("案号", r"案号[：:]\s*[\(\（]?\d{4}[\)\）]?\s*[\u4be0-\u9fff]+\d+号"),
            ("申请人", r"申请人[：:]?\s*[\u4e00-\u9fa5A-Za-z\s]+"),
            ("被申请人", r"被申请人[：:]?\s*[\u4e00-\u9fa5A-Za-z\s]+"),
            ("仲裁请求", r"仲裁请求[：:]"),
            ("争议事实", r"(事实|案情|争议的事实)[：:]"),
            ("仲裁庭意见", r"(仲裁庭意见|仲裁庭认为|本会认为)[：:]"),
            ("裁决内容", r"(裁决如下|裁决[：:])[\s\S]*"),
            ("仲裁费用", r"(仲裁费|案件仲裁费)[\s\S]*[\d,，.]+元"),
        ]

    async def review(self, award_text: str, metadata: Dict[str, Any] = None) -> AwardReviewResult:
        """
        核阅裁决书
        
        Args:
            award_text: 裁决书全文
            metadata: 额外元数据
            
        Returns:
            AwardReviewResult: 核阅结果
        """
        metadata = metadata or {}
        review_id = f"review_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        result = AwardReviewResult(
            review_id=review_id,
            award_text=award_text,
            status=ReviewStatus.IN_PROGRESS,
            created_at=datetime.now().isoformat()
        )
        
        try:
            # 1. 格式规范检查
            result.checks.append(await self._check_format(award_text))
            
            # 2. 内容完整性检查
            result.checks.append(await self._check_content_completeness(award_text))
            
            # 3. 逻辑一致性检查
            result.checks.append(await self._check_logic_consistency(award_text))
            
            # 4. 法律依据检查
            result.checks.append(await self._check_legal_basis(award_text))
            
            # 5. 金额计算检查
            result.checks.append(await self._check_calculations(award_text))
            
            # 6. 签署信息检查
            result.checks.append(await self._check_signatures(award_text))
            
            # 汇总结果
            result.summary = self._generate_summary(result.checks)
            result.risk_level = self._assess_risk(result.checks)
            result.suggestions = self._generate_suggestions(result.checks, award_text)
            result.status = ReviewStatus.COMPLETED
            
            logger.info(f"裁决核阅完成: {review_id}, 风险等级: {result.risk_level}")
            
        except Exception as e:
            logger.error(f"裁决核阅失败: {e}")
            result.status = ReviewStatus.NEEDS_REVISION
            result.summary = f"核阅过程中出现异常: {e}"
            result.risk_level = "high"
            result.suggestions.append("建议人工复核该裁决书")
        
        return result

    async def _check_format(self, text: str) -> ReviewCheck:
        """格式规范检查"""
        issues = []
        
        # 检查是否有标题
        if not re.search(r'(仲裁裁决书|裁决书)', text[:200]):
            issues.append("未找到裁决书标题")
        
        # 检查段落结构
        paragraphs = text.split("\n\n")
        if len(paragraphs) < 5:
            issues.append("裁决书段落结构不完整，建议至少包含5个主要段落")
        
        # 检查结尾
        if not re.search(r'(特此裁决|本裁决为终局裁决|裁决终结)', text[-500:]):
            issues.append("裁决书缺少标准结尾用语")
        
        status = "passed" if not issues else "warning"
        message = "格式规范" if not issues else "; ".join(issues)
        
        return ReviewCheck(
            check_type=ReviewCheckType.FORMAT_CHECK,
            check_name="格式规范检查",
            status=status,
            message=message,
            details={"paragraph_count": len(paragraphs), "text_length": len(text)}
        )

    async def _check_content_completeness(self, text: str) -> ReviewCheck:
        """内容完整性检查"""
        missing_elements = []
        found_elements = []
        
        for element_name, pattern in self.required_elements:
            if re.search(pattern, text):
                found_elements.append(element_name)
            else:
                missing_elements.append(element_name)
        
        if not missing_elements:
            status = "passed"
            message = f"所有必要要素齐全，共{len(found_elements)}项"
        elif len(missing_elements) <= 2:
            status = "warning"
            message = f"缺少要素: {', '.join(missing_elements)}"
        else:
            status = "failed"
            message = f"缺少关键要素: {', '.join(missing_elements)}"
        
        return ReviewCheck(
            check_type=ReviewCheckType.CONTENT_CHECK,
            check_name="内容完整性检查",
            status=status,
            message=message,
            details={
                "found_elements": found_elements,
                "missing_elements": missing_elements,
                "total_required": len(self.required_elements)
            }
        )

    async def _check_logic_consistency(self, text: str) -> ReviewCheck:
        """逻辑一致性检查"""
        issues = []
        
        # 检查申请人与被申请人是否一致引用
        applicant_match = re.search(r'申请人[：:]?\s*([\u4e00-\u9fa5A-Za-z\s]+)', text)
        respondent_match = re.search(r'被申请人[：:]?\s*([\u4e00-\u9fa5A-Za-z\s]+)', text)
        
        if applicant_match and respondent_match:
            applicant = applicant_match.group(1).strip()
            respondent = respondent_match.group(1).strip()
            
            # 检查后续文本中是否引用了相同的当事人
            if applicant and len(applicant) > 2:
                if applicant not in text[500:]:
                    issues.append("申请人在后续段落中未保持一致引用")
            if respondent and len(respondent) > 2:
                if respondent not in text[500:]:
                    issues.append("被申请人在后续段落中未保持一致引用")
        
        # 检查仲裁请求与裁决结果的一致性
        request_section = re.search(r'仲裁请求[：:](.*?)(事实|案情|争议)', text, re.DOTALL)
        ruling_section = re.search(r'(裁决如下|裁决[：:])(.*?)(特此|本裁决|仲裁费)', text, re.DOTALL)
        
        if request_section and ruling_section:
            request_text = request_section.group(1)
            ruling_text = ruling_section.group(2)
            
            # 简单的金额对比
            request_amounts = re.findall(r'[\d,，.]+元', request_text)
            ruling_amounts = re.findall(r'[\d,，.]+元', ruling_text)
            
            if request_amounts and ruling_amounts:
                if len(request_amounts) != len(ruling_amounts):
                    issues.append(f"仲裁请求金额({len(request_amounts)}项)与裁决金额({len(ruling_amounts)}项)数量不匹配")
        
        status = "passed" if not issues else "warning"
        message = "逻辑一致性良好" if not issues else "; ".join(issues)
        
        return ReviewCheck(
            check_type=ReviewCheckType.LOGIC_CHECK,
            check_name="逻辑一致性检查",
            status=status,
            message=message,
            details={"issues_found": len(issues)}
        )

    async def _check_legal_basis(self, text: str) -> ReviewCheck:
        """法律依据检查"""
        # 查找法律条文引用
        law_patterns = [
            r'《[\u4e00-\u9fa5]+法》',
            r'《[\u4e00-\u9fa5]+法》第[\d]+条',
            r'《[\u4e00-\u9fa5]+条例》',
            r'《[\u4e00-\u9fa5]+规定》',
            r'《[\u4e00-\u9fa5]+规则》',
        ]
        
        found_laws = set()
        for pattern in law_patterns:
            matches = re.findall(pattern, text)
            found_laws.update(matches)
        
        if len(found_laws) >= 2:
            status = "passed"
            message = f"引用了 {len(found_laws)} 部法律法规"
        elif len(found_laws) == 1:
            status = "warning"
            message = f"仅引用了 {len(found_laws)} 部法律，建议补充更多法律依据"
        else:
            status = "failed"
            message = "未找到法律条文引用"
        
        return ReviewCheck(
            check_type=ReviewCheckType.LEGAL_BASIS_CHECK,
            check_name="法律依据检查",
            status=status,
            message=message,
            details={"found_laws": list(found_laws)}
        )

    async def _check_calculations(self, text: str) -> ReviewCheck:
        """金额计算检查"""
        # 提取所有金额
        amounts = re.findall(r'([\d,，.]+)\s*元', text)
        
        issues = []
        total_amount = 0
        
        for amount_str in amounts:
            # 清理金额格式
            clean = amount_str.replace(',', '').replace('，', '').replace(' ', '')
            try:
                amount = float(clean)
                total_amount += amount
            except ValueError:
                pass
        
        # 检查是否有明显的计算错误
        if "合计" in text or "总计" in text:
            total_match = re.search(r'(合计|总计)[\s\S]*?([\d,，.]+)\s*元', text)
            if total_match:
                stated_total = total_match.group(2).replace(',', '').replace('，', '')
                try:
                    stated_total_num = float(stated_total)
                    if abs(stated_total_num - total_amount) > 0.01 and total_amount > 0:
                        issues.append(f"金额合计可能不一致: 计算值={total_amount:.2f}元, 声明值={stated_total_num:.2f}元")
                except ValueError:
                    pass
        
        status = "passed" if not issues else "warning"
        message = f"共识别 {len(amounts)} 处金额，总计约 {total_amount:.2f} 元" if not issues else "; ".join(issues)
        
        return ReviewCheck(
            check_type=ReviewCheckType.CALCULATION_CHECK,
            check_name="金额计算检查",
            status=status,
            message=message,
            details={
                "amount_count": len(amounts),
                "total_amount": total_amount,
                "issues": issues
            }
        )

    async def _check_signatures(self, text: str) -> ReviewCheck:
        """签署信息检查"""
        issues = []
        
        # 检查仲裁员签名
        if not re.search(r'(仲裁员|首席仲裁员)', text):
            issues.append("未找到仲裁员信息")
        
        # 检查日期
        date_patterns = [
            r'\d{4}年\d{1,2}月\d{1,2}日',
            r'\d{4}[\-/]\d{1,2}[\-/]\d{1,2}',
            r'\d{4}年\d{1,2}月\d{1,2}日'
        ]
        
        date_found = False
        for pattern in date_patterns:
            if re.search(pattern, text[-300:]):
                date_found = True
                break
        
        if not date_found:
            issues.append("未找到签署日期")
        
        # 检查仲裁委员会
        if not re.search(r'(仲裁委员会|仲裁委)', text):
            issues.append("未找到仲裁委员会名称")
        
        status = "passed" if not issues else "warning"
        message = "签署信息完整" if not issues else "; ".join(issues)
        
        return ReviewCheck(
            check_type=ReviewCheckType.SIGNATURE_CHECK,
            check_name="签署信息检查",
            status=status,
            message=message,
            details={"issues": issues}
        )

    def _generate_summary(self, checks: List[ReviewCheck]) -> str:
        """生成核阅摘要"""
        total = len(checks)
        passed = len([c for c in checks if c.status == "passed"])
        failed = len([c for c in checks if c.status == "failed"])
        warnings = len([c for c in checks if c.status == "warning"])
        
        summary = f"裁决书核阅完成。共检查 {total} 项，通过 {passed} 项"
        if warnings > 0:
            summary += f"，警告 {warnings} 项"
        if failed > 0:
            summary += f"，不合格 {failed} 项"
        summary += "。"
        
        return summary

    def _assess_risk(self, checks: List[ReviewCheck]) -> str:
        """评估风险等级"""
        failed = len([c for c in checks if c.status == "failed"])
        warnings = len([c for c in checks if c.status == "warning"])
        
        if failed >= 2:
            return "high"
        elif failed >= 1 or warnings >= 3:
            return "medium"
        else:
            return "low"

    def _generate_suggestions(self, checks: List[ReviewCheck], text: str) -> List[str]:
        """生成修改建议"""
        suggestions = []
        
        for check in checks:
            if check.status == "failed":
                suggestions.append(f"【{check.check_name}】{check.message} - 建议立即修正")
            elif check.status == "warning":
                suggestions.append(f"【{check.check_name}】{check.message} - 建议关注")
        
        if not suggestions:
            suggestions.append("裁决书整体质量良好，建议保持现有格式和内容标准")
        
        return suggestions

    async def get_review_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        """获取核阅历史（简化版）"""
        # 在实际实现中，这里会从持久化存储加载
        return []

    async def export_review_report(self, result: AwardReviewResult) -> str:
        """导出核阅报告为文本格式"""
        report_lines = [
            "=" * 60,
            "AI Arb 仲裁裁决书核阅报告",
            "=" * 60,
            f"核阅编号: {result.review_id}",
            f"核阅时间: {result.created_at}",
            f"风险等级: {result.risk_level.upper()}",
            "=" * 60,
            "",
            f"摘要: {result.summary}",
            "",
            "-" * 40,
            "检查详情:",
            "-" * 40,
        ]
        
        for check in result.checks:
            status_icon = {"passed": "✓", "failed": "✗", "warning": "⚠"}.get(check.status, "?")
            report_lines.append(f"\n{status_icon} [{check.check_name}]")
            report_lines.append(f"  状态: {check.status}")
            report_lines.append(f"  说明: {check.message}")
        
        report_lines.extend([
            "",
            "-" * 40,
            "修改建议:",
            "-" * 40,
        ])
        
        for i, suggestion in enumerate(result.suggestions, 1):
            report_lines.append(f"{i}. {suggestion}")
        
        report_lines.append("")
        report_lines.append("=" * 60)
        report_lines.append("AI Arb 智能裁决核阅系统 生成")
        report_lines.append("=" * 60)
        
        return "\n".join(report_lines)
