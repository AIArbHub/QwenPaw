# -*- coding: utf-8 -*-
"""AwardStore — SQLite-backed persistence for arbitration awards and review rules.

Extends the moot module with award generation, review reports, and
user-customizable review rules. Supports all arbitration institutions
(not just BAC/北仲).
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_AWARD_SCHEMA = """\
CREATE TABLE IF NOT EXISTS moot_awards (
    award_id          TEXT PRIMARY KEY,
    case_id           TEXT NOT NULL UNIQUE,
    template_type     TEXT NOT NULL DEFAULT 'domestic',
    institution_name  TEXT NOT NULL DEFAULT '',
    content           TEXT NOT NULL DEFAULT '',
    sections          TEXT NOT NULL DEFAULT '[]',
    generated_at      REAL NOT NULL,
    updated_at        REAL NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS moot_review_reports (
    report_id           TEXT PRIMARY KEY,
    award_id            TEXT NOT NULL,
    case_id             TEXT NOT NULL,
    case_name           TEXT NOT NULL DEFAULT '',
    template_type       TEXT NOT NULL DEFAULT 'domestic',
    institution_name    TEXT NOT NULL DEFAULT '',
    total_issues        INTEGER NOT NULL DEFAULT 0,
    must_fix_count      INTEGER NOT NULL DEFAULT 0,
    suggest_fix_count   INTEGER NOT NULL DEFAULT 0,
    issues_by_category  TEXT NOT NULL DEFAULT '{}',
    issues              TEXT NOT NULL DEFAULT '[]',
    reviewed_at         REAL NOT NULL,
    rule_version        TEXT NOT NULL DEFAULT '1.0'
);

CREATE TABLE IF NOT EXISTS moot_review_rules (
    rule_id                     TEXT PRIMARY KEY,
    name                        TEXT NOT NULL,
    category                    TEXT NOT NULL,
    sub_category                TEXT NOT NULL DEFAULT '',
    description                 TEXT NOT NULL DEFAULT '',
    severity                    TEXT NOT NULL DEFAULT 'must_fix',
    detection_logic             TEXT NOT NULL DEFAULT '',
    suggestion_template         TEXT NOT NULL DEFAULT '',
    is_builtin                  INTEGER NOT NULL DEFAULT 0,
    is_active                   INTEGER NOT NULL DEFAULT 1,
    applicable_template_types   TEXT NOT NULL DEFAULT '["domestic","international"]',
    created_at                  REAL NOT NULL,
    updated_at                  REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_awards_case ON moot_awards(case_id);
CREATE INDEX IF NOT EXISTS idx_review_reports_case ON moot_review_reports(case_id);
CREATE INDEX IF NOT EXISTS idx_review_rules_category ON moot_review_rules(category);
"""

# ── Built-in review rules ──────────────────────────────────────────────────

_BUILTIN_RULES: List[Dict[str, Any]] = [
    {
        "name": "标题格式规范",
        "category": "format",
        "sub_category": "标题格式",
        "description": "裁决书标题需包含仲裁机构名称，居中排列",
        "severity": "must_fix",
        "detection_logic": "提取标题文本，校验是否包含仲裁机构名称及居中对齐",
        "suggestion_template": "调整标题为「{institution_name}裁决书」，居中对齐",
    },
    {
        "name": "正文字体规范",
        "category": "format",
        "sub_category": "字体字号",
        "description": "正文一般使用宋体小四号，标题使用黑体",
        "severity": "must_fix",
        "detection_logic": "提取文本格式，校验字体和字号",
        "suggestion_template": "将{position}字体改为{correct_font}，字号改为{correct_size}",
    },
    {
        "name": "错别字检测",
        "category": "text",
        "sub_category": "错别字",
        "description": "裁决书不得有错别字",
        "severity": "must_fix",
        "detection_logic": "文本比对，匹配错别字库",
        "suggestion_template": "将「{wrong_text}」改为「{correct_text}」",
    },
    {
        "name": "法律条款引用完整性",
        "category": "law",
        "sub_category": "条款引用",
        "description": "引用法律条款需含完整名称+条款号（如《仲裁法》第51条）",
        "severity": "must_fix",
        "detection_logic": "提取法律依据模块文本，匹配条款库，校验完整性",
        "suggestion_template": "补充条款完整名称/条款号：{correct_citation}",
    },
    {
        "name": "漏裁检测",
        "category": "law",
        "sub_category": "漏裁",
        "description": "裁决主文需覆盖仲裁申请书全部请求项",
        "severity": "must_fix",
        "detection_logic": "比对仲裁申请书请求项与裁决主文，检查是否全覆盖",
        "suggestion_template": "补充裁决主文中缺失的请求项：{missing_claim}",
    },
    {
        "name": "超裁检测",
        "category": "law",
        "sub_category": "超裁",
        "description": "裁决主文不得包含仲裁申请书未提及的请求项",
        "severity": "must_fix",
        "detection_logic": "比对仲裁申请书请求项与裁决主文，检查是否有新增项",
        "suggestion_template": "删除裁决主文中超出仲裁请求的内容：{excess_content}",
    },
    {
        "name": "仲裁请求一致性",
        "category": "content",
        "sub_category": "仲裁请求",
        "description": "裁决书「仲裁请求」需与申请书/庭审笔录一致",
        "severity": "must_fix",
        "detection_logic": "比对裁决书与案件材料中仲裁请求文本相似度",
        "suggestion_template": "修正为申请书/庭审笔录中的内容",
    },
    {
        "name": "证据材料列举完整",
        "category": "content",
        "sub_category": "证据材料",
        "description": "证据编号/名称需与证据清单/庭审笔录完全匹配",
        "severity": "must_fix",
        "detection_logic": "比对裁决书与案件材料中证据清单，检查是否一致",
        "suggestion_template": "修正证据列举为证据清单中的内容",
    },
    {
        "name": "事实认定有证据支持",
        "category": "content",
        "sub_category": "事实认定",
        "description": "基本事实认定需有证据支持",
        "severity": "must_fix",
        "detection_logic": "检查事实认定部分是否引用证据，证据是否在证据清单中",
        "suggestion_template": "补充事实认定的证据支持",
    },
    {
        "name": "仲裁庭意见回应争议点",
        "category": "content",
        "sub_category": "仲裁庭意见",
        "description": "仲裁庭意见需充分回应当事人的主要争议点",
        "severity": "suggest_fix",
        "detection_logic": "分析仲裁庭意见是否覆盖当事人主要争议点",
        "suggestion_template": "补充对争议点{missing_point}的回应",
    },
    {
        "name": "费用计算准确",
        "category": "law",
        "sub_category": "费用计算",
        "description": "仲裁费、鉴定费等费用金额需准确",
        "severity": "must_fix",
        "detection_logic": "提取费用金额，与案件数据比对",
        "suggestion_template": "修正费用金额为{correct_amount}",
    },
    {
        "name": "表述风格正式",
        "category": "expression",
        "sub_category": "表述风格",
        "description": "表述风格需正式、客观、中立",
        "severity": "suggest_fix",
        "detection_logic": "分析文本表述风格是否符合要求",
        "suggestion_template": "调整表述风格，使其更加正式、客观、中立",
    },
    {
        "name": "术语统一",
        "category": "text",
        "sub_category": "术语统一",
        "description": "法律术语需统一使用",
        "severity": "must_fix",
        "detection_logic": "术语检测，匹配术语库",
        "suggestion_template": "将「{inconsistent_term}」统一为「{standard_term}」",
    },
    {
        "name": "裁决主文可执行性",
        "category": "law",
        "sub_category": "可执行性",
        "description": "裁决主文内容需满足确定、可执行的要求",
        "severity": "must_fix",
        "detection_logic": "分析裁决主文是否明确、具体、可执行",
        "suggestion_template": "优化裁决主文表述，使其更加明确、可执行",
    },
]


class AwardStore:
    """SQLite-backed storage for awards, review reports, and review rules."""

    _instance: Optional[AwardStore] = None

    @classmethod
    def get_instance(cls, db_dir: Optional[Path] = None) -> AwardStore:
        if cls._instance is None:
            if db_dir is not None:
                resolved_dir = Path(db_dir)
            else:
                from ..constant import WORKING_DIR
                resolved_dir = WORKING_DIR / "moot"
            cls._instance = cls(resolved_dir / "moot.db")
        return cls._instance

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self._db_path),
            check_same_thread=False,
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.executescript(_AWARD_SCHEMA)
        self._conn.commit()
        self._lock = threading.Lock()
        self._seed_builtin_rules()

    def _seed_builtin_rules(self) -> None:
        """Insert built-in rules if they don't exist yet."""
        with self._lock:
            existing = self._conn.execute(
                "SELECT COUNT(*) as cnt FROM moot_review_rules WHERE is_builtin = 1"
            ).fetchone()
            if existing["cnt"] > 0:
                return
            now = time.time()
            for rule in _BUILTIN_RULES:
                rule_id = f"builtin_{uuid.uuid4().hex[:8]}"
                self._conn.execute(
                    """INSERT INTO moot_review_rules
                    (rule_id, name, category, sub_category, description, severity,
                     detection_logic, suggestion_template, is_builtin, is_active,
                     applicable_template_types, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)""",
                    (
                        rule_id,
                        rule["name"],
                        rule["category"],
                        rule["sub_category"],
                        rule["description"],
                        rule["severity"],
                        rule["detection_logic"],
                        rule["suggestion_template"],
                        json.dumps(["domestic", "international"]),
                        now,
                        now,
                    ),
                )
            self._conn.commit()

    # ── Award CRUD ──────────────────────────────────────────────────────────

    def get_award(self, case_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM moot_awards WHERE case_id = ?",
                (case_id,),
            ).fetchone()
            if row is None:
                return None
            return self._row_to_award(row)

    def save_award(
        self,
        case_id: str,
        template_type: str,
        institution_name: str,
        content: str,
        sections: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            existing = self._conn.execute(
                "SELECT award_id, version FROM moot_awards WHERE case_id = ?",
                (case_id,),
            ).fetchone()
            if existing:
                new_version = existing["version"] + 1
                self._conn.execute(
                    """UPDATE moot_awards SET
                    template_type = ?, institution_name = ?, content = ?,
                    sections = ?, updated_at = ?, version = ?
                    WHERE case_id = ?""",
                    (
                        template_type,
                        institution_name,
                        content,
                        json.dumps(sections, ensure_ascii=False),
                        now,
                        new_version,
                        case_id,
                    ),
                )
                award_id = existing["award_id"]
            else:
                award_id = uuid.uuid4().hex[:12]
                self._conn.execute(
                    """INSERT INTO moot_awards
                    (award_id, case_id, template_type, institution_name, content,
                     sections, generated_at, updated_at, version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)""",
                    (
                        award_id,
                        case_id,
                        template_type,
                        institution_name,
                        content,
                        json.dumps(sections, ensure_ascii=False),
                        now,
                        now,
                    ),
                )
            self._conn.commit()
            return self._row_to_award(
                self._conn.execute(
                    "SELECT * FROM moot_awards WHERE award_id = ?",
                    (award_id,),
                ).fetchone()
            )

    def update_award_content(self, case_id: str, content: str) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            row = self._conn.execute(
                "SELECT award_id, version, sections FROM moot_awards WHERE case_id = ?",
                (case_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Award not found")
            new_version = row["version"] + 1
            self._conn.execute(
                """UPDATE moot_awards SET content = ?, updated_at = ?, version = ?
                WHERE case_id = ?""",
                (content, now, new_version, case_id),
            )
            self._conn.commit()
            return self._row_to_award(
                self._conn.execute(
                    "SELECT * FROM moot_awards WHERE award_id = ?",
                    (row["award_id"],),
                ).fetchone()
            )

    # ── Review report CRUD ──────────────────────────────────────────────────

    def get_review_report(self, case_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM moot_review_reports WHERE case_id = ? ORDER BY reviewed_at DESC LIMIT 1",
                (case_id,),
            ).fetchone()
            if row is None:
                return None
            return self._row_to_report(row)

    def save_review_report(self, report: Dict[str, Any]) -> Dict[str, Any]:
        report_id = uuid.uuid4().hex[:12]
        now = time.time()
        with self._lock:
            self._conn.execute(
                """INSERT INTO moot_review_reports
                (report_id, award_id, case_id, case_name, template_type,
                 institution_name, total_issues, must_fix_count, suggest_fix_count,
                 issues_by_category, issues, reviewed_at, rule_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    report_id,
                    report.get("award_id", ""),
                    report.get("case_id", ""),
                    report.get("case_name", ""),
                    report.get("template_type", "domestic"),
                    report.get("institution_name", ""),
                    report.get("total_issues", 0),
                    report.get("must_fix_count", 0),
                    report.get("suggest_fix_count", 0),
                    json.dumps(report.get("issues_by_category", {}), ensure_ascii=False),
                    json.dumps(report.get("issues", []), ensure_ascii=False),
                    now,
                    "1.0",
                ),
            )
            self._conn.commit()
            return self._row_to_report(
                self._conn.execute(
                    "SELECT * FROM moot_review_reports WHERE report_id = ?",
                    (report_id,),
                ).fetchone()
            )

    # ── Review rules CRUD ───────────────────────────────────────────────────

    def list_review_rules(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM moot_review_rules ORDER BY is_builtin DESC, category, created_at"
            ).fetchall()
            return [self._row_to_rule(r) for r in rows]

    def list_active_review_rules(
        self, template_type: str = "domestic"
    ) -> List[Dict[str, Any]]:
        all_rules = self.list_review_rules()
        return [
            r
            for r in all_rules
            if r["is_active"] and template_type in r["applicable_template_types"]
        ]

    def create_review_rule(self, params: Dict[str, Any]) -> Dict[str, Any]:
        rule_id = f"custom_{uuid.uuid4().hex[:8]}"
        now = time.time()
        applicable = params.get("applicable_template_types", ["domestic", "international"])
        with self._lock:
            self._conn.execute(
                """INSERT INTO moot_review_rules
                (rule_id, name, category, sub_category, description, severity,
                 detection_logic, suggestion_template, is_builtin, is_active,
                 applicable_template_types, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)""",
                (
                    rule_id,
                    params["name"],
                    params["category"],
                    params.get("sub_category", ""),
                    params.get("description", ""),
                    params.get("severity", "must_fix"),
                    params.get("detection_logic", ""),
                    params.get("suggestion_template", ""),
                    1 if params.get("is_active", True) else 0,
                    json.dumps(applicable, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            self._conn.commit()
            return self._row_to_rule(
                self._conn.execute(
                    "SELECT * FROM moot_review_rules WHERE rule_id = ?",
                    (rule_id,),
                ).fetchone()
            )

    def update_review_rule(
        self, rule_id: str, params: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            existing = self._conn.execute(
                "SELECT * FROM moot_review_rules WHERE rule_id = ?",
                (rule_id,),
            ).fetchone()
            if existing is None:
                return None
            updates = []
            values = []
            for field in [
                "name",
                "category",
                "sub_category",
                "description",
                "severity",
                "detection_logic",
                "suggestion_template",
            ]:
                if field in params:
                    updates.append(f"{field} = ?")
                    values.append(params[field])
            if "is_active" in params:
                updates.append("is_active = ?")
                values.append(1 if params["is_active"] else 0)
            if "applicable_template_types" in params:
                updates.append("applicable_template_types = ?")
                values.append(json.dumps(params["applicable_template_types"], ensure_ascii=False))
            updates.append("updated_at = ?")
            values.append(now)
            values.append(rule_id)
            self._conn.execute(
                f"UPDATE moot_review_rules SET {', '.join(updates)} WHERE rule_id = ?",
                values,
            )
            self._conn.commit()
            return self._row_to_rule(
                self._conn.execute(
                    "SELECT * FROM moot_review_rules WHERE rule_id = ?",
                    (rule_id,),
                ).fetchone()
            )

    def delete_review_rule(self, rule_id: str) -> bool:
        with self._lock:
            existing = self._conn.execute(
                "SELECT is_builtin FROM moot_review_rules WHERE rule_id = ?",
                (rule_id,),
            ).fetchone()
            if existing is None:
                return False
            if existing["is_builtin"]:
                # Don't delete built-in rules, just deactivate
                self._conn.execute(
                    "UPDATE moot_review_rules SET is_active = 0, updated_at = ? WHERE rule_id = ?",
                    (time.time(), rule_id),
                )
            else:
                self._conn.execute(
                    "DELETE FROM moot_review_rules WHERE rule_id = ?",
                    (rule_id,),
                )
            self._conn.commit()
            return True

    # ── Row converters ──────────────────────────────────────────────────────

    @staticmethod
    def _row_to_award(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "award_id": row["award_id"],
            "case_id": row["case_id"],
            "template_type": row["template_type"],
            "institution_name": row["institution_name"],
            "content": row["content"],
            "sections": json.loads(row["sections"]),
            "generated_at": row["generated_at"],
            "updated_at": row["updated_at"],
            "version": row["version"],
        }

    @staticmethod
    def _row_to_report(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "report_id": row["report_id"],
            "award_id": row["award_id"],
            "case_id": row["case_id"],
            "case_name": row["case_name"],
            "template_type": row["template_type"],
            "institution_name": row["institution_name"],
            "total_issues": row["total_issues"],
            "must_fix_count": row["must_fix_count"],
            "suggest_fix_count": row["suggest_fix_count"],
            "issues_by_category": json.loads(row["issues_by_category"]),
            "issues": json.loads(row["issues"]),
            "reviewed_at": row["reviewed_at"],
            "rule_version": row["rule_version"],
        }

    @staticmethod
    def _row_to_rule(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "rule_id": row["rule_id"],
            "name": row["name"],
            "category": row["category"],
            "sub_category": row["sub_category"],
            "description": row["description"],
            "severity": row["severity"],
            "detection_logic": row["detection_logic"],
            "suggestion_template": row["suggestion_template"],
            "is_builtin": bool(row["is_builtin"]),
            "is_active": bool(row["is_active"]),
            "applicable_template_types": json.loads(row["applicable_template_types"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
