# -*- coding: utf-8 -*-
"""Case framework database for structured case-type analysis.

This module provides a SQLite-backed knowledge base that mirrors the
"six-stage trial framework" methodology from the Shanghai Court Guide,
adapted for arbitration practice in aiarb.

Five core tables:
  - case_types:           case type definitions with keywords
  - case_frameworks:      six-stage framework parts per case type
  - review_points:        detailed review checkpoints
  - evidence_checklists:  evidence lists per party (applicant/respondent)
  - reinforcement_templates: gap-filling advice templates

The database file lives in the global knowledge base directory so it
is seeded from the packaged corpus and user-editable.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any, Optional

from ...knowledge import get_global_knowledge_base_dir, get_packaged_knowledge_base_dir

logger = logging.getLogger(__name__)

_DB_FILENAME = "case_frameworks.db"

_SCHEMA_SQL = """
-- ── 1. 案件类型表 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_types (
    case_id        INTEGER PRIMARY KEY,
    case_name      TEXT    NOT NULL,
    category       TEXT    NOT NULL DEFAULT 'core',   -- core/procedure/intl/litigation
    keywords       TEXT    NOT NULL,                  -- JSON array string
    description    TEXT,
    procedure_type TEXT,                               -- civil/commercial/administrative
    core_legal_basis TEXT,
    applicable_rules  TEXT,                             -- JSON array: arbitration rules
    source_type       TEXT    DEFAULT 'curated',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 2. 六段式框架表 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_frameworks (
    framework_id  INTEGER PRIMARY KEY,
    case_id       INTEGER NOT NULL,
    part_number   INTEGER NOT NULL,   -- 1=总体概述 2=立案审查 3=申请人请求审查 4=被申请人抗辩审查 5=要件事实审查 6=知识图谱
    part_name     TEXT    NOT NULL,
    part_content  TEXT,
    parent_id     INTEGER,
    sort_order    INTEGER,
    FOREIGN KEY (case_id) REFERENCES case_types(case_id)
);

-- ── 3. 审查要点表 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_points (
    point_id          INTEGER PRIMARY KEY,
    case_id           INTEGER NOT NULL,
    framework_id      INTEGER NOT NULL,
    point_name        TEXT    NOT NULL,
    point_type        TEXT    NOT NULL,
    review_content    TEXT,
    attention_points  TEXT,
    legal_basis       TEXT,
    typical_cases     TEXT,
    is_core           BOOLEAN DEFAULT 0,
    sort_order        INTEGER,
    FOREIGN KEY (case_id) REFERENCES case_types(case_id),
    FOREIGN KEY (framework_id) REFERENCES case_frameworks(framework_id)
);

-- ── 4. 证据清单表（仲裁化适配） ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evidence_checklists (
    evidence_id     INTEGER PRIMARY KEY,
    case_id         INTEGER NOT NULL,
    point_id        INTEGER NOT NULL,
    party_type      TEXT    NOT NULL,   -- applicant/respondent/neutral
    evidence_name   TEXT    NOT NULL,
    evidence_type   TEXT,               -- 书证/物证/电子数据/证人证言等
    necessity_level TEXT,               -- 必需/重要/辅助
    description     TEXT,
    sort_order      INTEGER,
    FOREIGN KEY (case_id) REFERENCES case_types(case_id),
    FOREIGN KEY (point_id) REFERENCES review_points(point_id)
);

-- ── 5. 补强建议模板表 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reinforcement_templates (
    template_id           INTEGER PRIMARY KEY,
    case_id               INTEGER NOT NULL,
    point_id              INTEGER NOT NULL,
    gap_type              TEXT    NOT NULL,
    gap_description       TEXT,
    reinforcement_advice  TEXT,
    priority              INTEGER,    -- 1(最高)~5(最低)
    difficulty            TEXT,        -- 简单/中等/困难
    time_required         TEXT,
    FOREIGN KEY (case_id) REFERENCES case_types(case_id),
    FOREIGN KEY (point_id) REFERENCES review_points(point_id)
);

-- ── 索引 ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_case_types_keywords ON case_types(keywords);
CREATE INDEX IF NOT EXISTS idx_case_types_category  ON case_types(category);
CREATE INDEX IF NOT EXISTS idx_frameworks_case      ON case_frameworks(case_id);
CREATE INDEX IF NOT EXISTS idx_review_points_case   ON review_points(case_id);
CREATE INDEX IF NOT EXISTS idx_review_points_fw     ON review_points(framework_id);
CREATE INDEX IF NOT EXISTS idx_review_points_core    ON review_points(case_id, is_core);
CREATE INDEX IF NOT EXISTS idx_evidence_case_party  ON evidence_checklists(case_id, party_type);
CREATE INDEX IF NOT EXISTS idx_reinforcement_case    ON reinforcement_templates(case_id);
"""

# ── Six-stage framework part names (arbitration-adapted) ──────────────
FRAMEWORK_PARTS = {
    1: "总体情况概述",
    2: "立案审查",
    3: "申请人请求的审查",
    4: "被申请人抗辩的审查",
    5: "要件事实审查和裁判规则",
    6: "知识图谱",
}

# ── Party type mapping: court → arbitration ───────────────────────────
PARTY_TYPE_MAP = {
    "plaintiff": "applicant",
    "defendant": "respondent",
    "applicant": "applicant",
    "respondent": "respondent",
    "neutral": "neutral",
}

# ── Keyword index for high-frequency case types (extended from case-type-guide) ──
HIGH_FREQUENCY_KEYWORDS: dict[str, list[str]] = {
    "民间借贷": [
        "借款", "借贷", "欠条", "借条", "还款", "利息", "本金",
        "出借人", "借款人", "砍头息", "LPR", "利率上限", "逾期还款",
        "民间借贷", "自然人借款", "借款合同", "借据", "收条",
        "转账记录", "利息约定", "复利", "利滚利",
    ],
    "买卖合同": [
        "买卖", "购销", "交付", "质量异议", "验收", "货款",
        "违约交货", "瑕疵", "退货", "合同解除", "标的物",
        "买受人", "出卖人", "交付义务", "风险转移", "所有权保留",
    ],
    "建设工程": [
        "建设工程", "施工合同", "工程款", "工期", "竣工验收",
        "优先受偿权", "工程变更", "签证", "决算", "结算",
        "发包人", "承包人", "实际施工人", "挂靠", "违法分包",
        "工期顺延", "逾期竣工", "工程质量", "保修期",
    ],
    "股权转让": [
        "股权转让", "股权变更", "工商登记", "出资义务",
        "股东资格", "隐名股东", "代持", "优先购买权",
        "股权转让协议", "对价", "违约转让", "回购",
    ],
    "房屋租赁": [
        "租赁", "房租", "承租人", "出租人", "转租",
        "租期", "解除租赁", "押金", "优先承租权", "买卖不破租赁",
    ],
    "承揽合同": [
        "承揽", "加工", "定作", "修理", "测试",
        "定作人", "承揽人", "质量", "交付成果", "报酬",
    ],
    "离婚纠纷": [
        "离婚", "婚姻", "夫妻共同财产", "抚养权", "赡养",
        "感情破裂", "家暴", "出轨", "分居", "协议离婚",
        "诉讼离婚", "财产分割", "债务分担", "子女抚养",
    ],
    "劳动争议": [
        "劳动", "劳动合同", "解除", "赔偿金", "经济补偿",
        "工伤", "社保", "加班费", "工资", "未签合同",
        "违法解除", "竞业限制", "试用期", "调岗",
    ],
    "民间借贷纠纷": [
        "借款", "借贷", "欠条", "借条", "还款", "利息", "本金",
        "出借人", "借款人", "砍头息", "LPR", "利率上限",
    ],
    "侵权责任": [
        "侵权", "损害赔偿", "过错", "因果关系", "损害",
        "人身损害", "财产损害", "精神损害", "安全保障义务",
    ],
    "医疗损害责任": [
        "医疗", "诊疗", "医疗事故", "医疗过错", "损害后果",
        "因果关系", "鉴定", "医疗纠纷", "知情同意",
    ],
    "名誉权": [
        "名誉", "侮辱", "诽谤", "社会评价", "精神损害",
        "赔礼道歉", "恢复名誉", "消除影响",
    ],
    "商标权侵权": [
        "商标", "侵权", "混淆", "近似", "驰名商标",
        "假冒", "注册商标", "商标专用权",
    ],
    "著作权侵权": [
        "著作权", "版权", "侵权", "复制", "发行",
        "信息网络传播", "改编", "署名权",
    ],
    "保险合同": [
        "保险", "理赔", "保险金", "免赔", "保险事故",
        "投保人", "被保险人", "受益人", "保险标的",
    ],
}

# ── Case type list from Shanghai Court Guide (8册46类) ─────────────────
CASE_TYPE_LIST = [
    {"册": "1", "类别": "商", "类型": "融资租赁合同"},
    {"册": "1", "类别": "商", "类型": "股权转让"},
    {"册": "1", "类别": "民", "类型": "机动车交通事故"},
    {"册": "1", "类别": "商", "类型": "外观设计专利侵权"},
    {"册": "1", "类别": "商", "类型": "金融借款合同"},
    {"册": "2", "类别": "民", "类型": "民间借贷"},
    {"册": "2", "类别": "商", "类型": "侵害商标权"},
    {"册": "2", "类别": "商", "类型": "海上货物运输合同"},
    {"册": "2", "类别": "商", "类型": "信用卡纠纷"},
    {"册": "2", "类别": "民", "类型": "民事再审案件审查程序"},
    {"册": "3", "类别": "商", "类型": "财产保险合同"},
    {"册": "3", "类别": "商", "类型": "破产案件"},
    {"册": "3", "类别": "民", "类型": "买卖合同"},
    {"册": "3", "类别": "刑", "类型": "贪污贿赂"},
    {"册": "3", "类别": "刑", "类型": "涉众型非法集资"},
    {"册": "4", "类别": "民", "类型": "房屋租赁合同"},
    {"册": "4", "类别": "民", "类型": "承揽合同"},
    {"册": "4", "类别": "商", "类型": "著作权侵权"},
    {"册": "4", "类别": "商", "类型": "船舶碰撞"},
    {"册": "4", "类别": "商", "类型": "保理合同"},
    {"册": "4", "类别": "民", "类型": "执行程序中涉及参与分配"},
    {"册": "5", "类别": "民", "类型": "民商事管辖权异议"},
    {"册": "5", "类别": "民", "类型": "医疗损害责任纠纷"},
    {"册": "5", "类别": "民", "类型": "离婚纠纷"},
    {"册": "5", "类别": "商", "类型": "特许经营合同"},
    {"册": "5", "类别": "商", "类型": "票据追索权"},
    {"册": "6", "类别": "民", "类型": "继承"},
    {"册": "6", "类别": "商", "类型": "独立保函"},
    {"册": "6", "类别": "商", "类型": "建设工程施工合同"},
    {"册": "7", "类别": "民", "类型": "名誉权"},
    {"册": "7", "类别": "商", "类型": "股权代持"},
    {"册": "7", "类别": "商", "类型": "人身保险合同"},
    {"册": "7", "类别": "执", "类型": "执行程序中不动产处置案件"},
    {"册": "8", "类别": "立案", "类型": "民商事案件立案审查"},
    {"册": "8", "类别": "商", "类型": "证券虚假陈述责任"},
    {"册": "8", "类别": "其他", "类型": "仲裁司法审查"},
    {"册": "8", "类别": "商", "类型": "侵害商业秘密纠纷"},
]


class CaseFrameworkDB:
    """Thread-safe SQLite accessor for the case framework database.

    The database is created on first access (lazy init) at the global
    knowledge base directory. All public methods are safe to call from
    any thread; each call opens a short-lived connection.
    """

    _lock = threading.Lock()

    def __init__(self, db_path: Optional[Path] = None) -> None:
        if db_path is not None:
            self._db_path = Path(db_path)
        else:
            self._db_path = self._resolve_db_path()
        self._initialized = False

    # ── Path resolution ─────────────────────────────────────────────────

    @staticmethod
    def _resolve_db_path() -> Path:
        """Resolve the database path under the global knowledge base."""
        global_dir = get_global_knowledge_base_dir()
        global_dir.mkdir(parents=True, exist_ok=True)
        return global_dir / _DB_FILENAME

    @property
    def db_path(self) -> Path:
        return self._db_path

    # ── Initialization ──────────────────────────────────────────────────

    def _ensure_initialized(self) -> None:
        """Create the database and seed base case types on first access."""
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(self._db_path))
            try:
                conn.executescript(_SCHEMA_SQL)
                self._seed_case_types(conn)
                conn.commit()
            finally:
                conn.close()
            self._initialized = True
            logger.info("Case framework DB initialized at %s", self._db_path)

    def _seed_case_types(self, conn: sqlite3.Connection) -> None:
        """Insert base case type records if the table is empty."""
        cursor = conn.execute("SELECT COUNT(*) FROM case_types")
        if cursor.fetchone()[0] > 0:
            return
        for idx, entry in enumerate(CASE_TYPE_LIST, start=1):
            case_name = entry["类型"]
            keywords = HIGH_FREQUENCY_KEYWORDS.get(case_name, [case_name])
            conn.execute(
                """INSERT INTO case_types
                   (case_id, case_name, category, keywords, description, procedure_type)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    idx,
                    case_name,
                    entry.get("类别", "core"),
                    json.dumps(keywords, ensure_ascii=False),
                    f"{case_name}（来源：上海法院类案办案要件指南第{entry.get('册', '?')}册）",
                    "民事" if entry.get("类别") == "民" else "商事",
                ),
            )

    # ── Public query methods ────────────────────────────────────────────

    def get_all_case_types(self) -> list[dict[str, Any]]:
        """Return all registered case types."""
        self._ensure_initialized()
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.execute("SELECT * FROM case_types ORDER BY case_id")
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_case_type(self, case_id: int) -> Optional[dict[str, Any]]:
        """Return a single case type by ID."""
        self._ensure_initialized()
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.execute(
                "SELECT * FROM case_types WHERE case_id = ?", (case_id,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_case_type_by_name(self, case_name: str) -> Optional[dict[str, Any]]:
        """Return a single case type by name (fuzzy match)."""
        self._ensure_initialized()
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.execute(
                "SELECT * FROM case_types WHERE case_name LIKE ? ORDER BY case_id LIMIT 1",
                (f"%{case_name}%",),
            )
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_frameworks(self, case_id: int) -> list[dict[str, Any]]:
        """Return all framework parts for a case type."""
        self._ensure_initialized()
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.execute(
                "SELECT * FROM case_frameworks WHERE case_id = ? ORDER BY part_number",
                (case_id,),
            )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_review_points(
        self, case_id: int, framework_id: Optional[int] = None
    ) -> list[dict[str, Any]]:
        """Return review points for a case, optionally filtered by framework part."""
        self._ensure_initialized()
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            if framework_id is not None:
                cursor = conn.execute(
                    """SELECT * FROM review_points
                       WHERE case_id = ? AND framework_id = ?
                       ORDER BY sort_order, point_id""",
                    (case_id, framework_id),
                )
            else:
                cursor = conn.execute(
                    """SELECT * FROM review_points
                       WHERE case_id = ?
                       ORDER BY framework_id, sort_order, point_id""",
                    (case_id,),
                )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_core_review_points(self, case_id: int) -> list[dict[str, Any]]:
        """Return only core (is_core=1) review points for a case."""
        self._ensure_initialized()
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.execute(
                """SELECT * FROM review_points
                   WHERE case_id = ? AND is_core = 1
                   ORDER BY framework_id, sort_order""",
                (case_id,),
            )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_evidence_checklist(
        self, case_id: int, party_type: str
    ) -> list[dict[str, Any]]:
        """Return evidence checklist items for a given party.

        ``party_type`` accepts both court terminology (plaintiff/defendant)
        and arbitration terminology (applicant/respondent); the mapping
        is handled internally.
        """
        self._ensure_initialized()
        arb_party = PARTY_TYPE_MAP.get(party_type, party_type)
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.execute(
                """SELECT * FROM evidence_checklists
                   WHERE case_id = ? AND party_type = ?
                   ORDER BY sort_order, evidence_id""",
                (case_id, arb_party),
            )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_reinforcement_templates(
        self, case_id: int, point_id: Optional[int] = None
    ) -> list[dict[str, Any]]:
        """Return reinforcement advice templates for a case / point."""
        self._ensure_initialized()
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            if point_id is not None:
                cursor = conn.execute(
                    """SELECT * FROM reinforcement_templates
                       WHERE case_id = ? AND point_id = ?
                       ORDER BY priority""",
                    (case_id, point_id),
                )
            else:
                cursor = conn.execute(
                    """SELECT * FROM reinforcement_templates
                       WHERE case_id = ?
                       ORDER BY priority""",
                    (case_id,),
                )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def identify_case_type(self, query: str, top_k: int = 3) -> list[dict[str, Any]]:
        """Identify case types by keyword matching.

        Returns a list of dicts sorted by score (highest first):
          ``{case_id, case_name, score, matched_keywords, description}``
        """
        self._ensure_initialized()
        all_types = self.get_all_case_types()
        results: list[dict[str, Any]] = []

        query_lower = query.lower()
        for ct in all_types:
            keywords = json.loads(ct.get("keywords", "[]"))
            matched = [kw for kw in keywords if kw.lower() in query_lower]
            if matched:
                score = len(matched) / max(len(keywords), 1)
                results.append({
                    "case_id": ct["case_id"],
                    "case_name": ct["case_name"],
                    "score": round(score, 4),
                    "matched_keywords": matched,
                    "description": ct.get("description", ""),
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def get_statistics(self) -> dict[str, int]:
        """Return row counts for each table."""
        self._ensure_initialized()
        conn = sqlite3.connect(str(self._db_path))
        try:
            stats: dict[str, int] = {}
            for table in (
                "case_types", "case_frameworks", "review_points",
                "evidence_checklists", "reinforcement_templates",
            ):
                cursor = conn.execute(f"SELECT COUNT(*) FROM {table}")
                stats[table] = cursor.fetchone()[0]
            return stats
        finally:
            conn.close()


# ── Singleton accessor ─────────────────────────────────────────────────

_global_db: Optional[CaseFrameworkDB] = None
_global_lock = threading.Lock()


def get_case_framework_db() -> CaseFrameworkDB:
    """Return the global CaseFrameworkDB singleton."""
    global _global_db
    if _global_db is not None:
        return _global_db
    with _global_lock:
        if _global_db is None:
            _global_db = CaseFrameworkDB()
        return _global_db


__all__ = [
    "CaseFrameworkDB",
    "FRAMEWORK_PARTS",
    "PARTY_TYPE_MAP",
    "HIGH_FREQUENCY_KEYWORDS",
    "CASE_TYPE_LIST",
    "get_case_framework_db",
]
