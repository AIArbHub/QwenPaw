# -*- coding: utf-8 -*-
"""Migration script: import case-type-guide SQLite data into aiarb.

Reads the source database at ``D:/Project/case-type-guide/data/case_types.db``
and writes arbitration-adapted records into the aiarb case framework database.

Arbitration terminology substitutions applied:
  原告 → 申请人
  被告 → 被申请人
  plaintiff → applicant
  defendant → respondent
  裁判/判决 → 裁决
  庭审 → 开庭/仲裁程序
  合议庭 → 仲裁庭
  法院 → 仲裁机构（where appropriate）

Usage::

    python scripts/migrate_case_type_guide.py
    python scripts/migrate_case_type_guide.py --source /path/to/case_types.db
    python scripts/migrate_case_type_guide.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from pathlib import Path
from typing import Any

# Add project root to Python path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from aiarb.agents.tools.case_framework_db import (  # noqa: E402
    CaseFrameworkDB,
    FRAMEWORK_PARTS,
    PARTY_TYPE_MAP,
)

logger = logging.getLogger("migrate_case_type_guide")

DEFAULT_SOURCE_DB = Path("D:/Project/case-type-guide/data/case_types.db")

# Arbitration terminology substitution rules
TERM_SUBSTITUTIONS: list[tuple[str, str]] = [
    ("原告", "申请人"),
    ("被告", "被申请人"),
    ("裁判", "裁决"),
    ("判决", "裁决"),
    ("庭审", "开庭"),
    ("合议庭", "仲裁庭"),
    ("人民法院", "仲裁机构"),
    ("民事判决", "仲裁裁决"),
    ("一审", ""),
    ("二审", ""),
    ("上诉", "申请撤销"),
    ("上诉人", "申请人"),
    ("被上诉人", "被申请人"),
    ("执行异议", "仲裁程序异议"),
    ("审判长", "首席仲裁员"),
    ("审判员", "仲裁员"),
    ("书记员", "仲裁秘书"),
    ("plaintiff", "applicant"),
    ("defendant", "respondent"),
    ("judgment", "award"),
    ("court", "tribunal"),
]


def apply_arb_adaptation(text: str) -> str:
    """Apply arbitration terminology substitutions to a text string."""
    if not text:
        return text
    result = text
    for old, new in TERM_SUBSTITUTIONS:
        result = result.replace(old, new)
    return result


def map_party_type(party: str) -> str:
    """Map court party type to arbitration party type."""
    return PARTY_TYPE_MAP.get(party, party)


def _row_get(row: sqlite3.Row, key: str, default: Any = None) -> Any:
    """Safe accessor for sqlite3.Row that mimics dict.get()."""
    try:
        return row[key]
    except (IndexError, KeyError):
        return default


def migrate_case_types(
    src_conn: sqlite3.Connection,
    dst_db: CaseFrameworkDB,
    dry_run: bool = False,
) -> int:
    """Migrate the case_types table."""
    src_conn.row_factory = sqlite3.Row
    cursor = src_conn.execute("SELECT * FROM case_types ORDER BY case_id")
    rows = cursor.fetchall()
    count = 0

    if dry_run:
        for row in rows:
            logger.info("[DRY-RUN] case_type: id=%s name=%s", row["case_id"], row["case_name"])
        return len(rows)

    dst_conn = sqlite3.connect(str(dst_db.db_path))
    try:
        for row in rows:
            keywords_str = row["keywords"] or "[]"
            try:
                keywords = json.loads(keywords_str)
            except (json.JSONDecodeError, TypeError):
                keywords = [k.strip() for k in keywords_str.split(",") if k.strip()]

            description = apply_arb_adaptation(row["description"] or "")
            case_name = row["case_name"] or ""

            dst_conn.execute(
                """INSERT OR REPLACE INTO case_types
                   (case_id, case_name, category, keywords, description,
                    procedure_type, core_legal_basis, source_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    row["case_id"],
                    case_name,
                    _row_get(row, "category", "core") or "core",
                    json.dumps(keywords, ensure_ascii=False),
                    description,
                    _row_get(row, "procedure_type", "民事"),
                    apply_arb_adaptation(_row_get(row, "core_legal_basis", "") or ""),
                    "migrated",
                ),
            )
            count += 1
        dst_conn.commit()
    finally:
        dst_conn.close()
    logger.info("Migrated %d case types", count)
    return count


def migrate_frameworks(
    src_conn: sqlite3.Connection,
    dst_db: CaseFrameworkDB,
    dry_run: bool = False,
) -> int:
    """Migrate the case_frameworks table."""
    src_conn.row_factory = sqlite3.Row
    cursor = src_conn.execute("SELECT * FROM case_frameworks ORDER BY framework_id")
    rows = cursor.fetchall()
    count = 0

    if dry_run:
        for row in rows:
            logger.info("[DRY-RUN] framework: id=%s case=%s part=%s",
                        row["framework_id"], row["case_id"], row["part_number"])
        return len(rows)

    dst_conn = sqlite3.connect(str(dst_db.db_path))
    try:
        for row in rows:
            part_number = row["part_number"]
            part_name = FRAMEWORK_PARTS.get(part_number, row["part_name"])
            if part_number == 3:
                part_name = "申请人请求的审查"
            elif part_number == 4:
                part_name = "被申请人抗辩的审查"

            dst_conn.execute(
                """INSERT OR REPLACE INTO case_frameworks
                   (framework_id, case_id, part_number, part_name,
                    part_content, parent_id, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    row["framework_id"],
                    row["case_id"],
                    part_number,
                    part_name,
                    apply_arb_adaptation(row["part_content"] or ""),
                    _row_get(row, "parent_id", None),
                    _row_get(row, "sort_order", None),
                ),
            )
            count += 1
        dst_conn.commit()
    finally:
        dst_conn.close()
    logger.info("Migrated %d framework parts", count)
    return count


def migrate_review_points(
    src_conn: sqlite3.Connection,
    dst_db: CaseFrameworkDB,
    dry_run: bool = False,
) -> int:
    """Migrate the review_points table."""
    src_conn.row_factory = sqlite3.Row
    cursor = src_conn.execute("SELECT * FROM review_points ORDER BY point_id")
    rows = cursor.fetchall()
    count = 0

    if dry_run:
        for row in rows:
            logger.info("[DRY-RUN] review_point: id=%s case=%s name=%s",
                        row["point_id"], row["case_id"], row["point_name"])
        return len(rows)

    dst_conn = sqlite3.connect(str(dst_db.db_path))
    try:
        for row in rows:
            point_type = apply_arb_adaptation(row["point_type"] or "")
            review_content = apply_arb_adaptation(row["review_content"] or "")
            attention = apply_arb_adaptation(row["attention_points"] or "")
            legal_basis = apply_arb_adaptation(row["legal_basis"] or "")
            typical = apply_arb_adaptation(_row_get(row, "typical_cases", "") or "")

            dst_conn.execute(
                """INSERT OR REPLACE INTO review_points
                   (point_id, case_id, framework_id, point_name, point_type,
                    review_content, attention_points, legal_basis,
                    typical_cases, is_core, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    row["point_id"],
                    row["case_id"],
                    row["framework_id"],
                    row["point_name"],
                    point_type,
                    review_content,
                    attention,
                    legal_basis,
                    typical,
                    _row_get(row, "is_core", 0),
                    _row_get(row, "sort_order", None),
                ),
            )
            count += 1
        dst_conn.commit()
    finally:
        dst_conn.close()
    logger.info("Migrated %d review points", count)
    return count


def migrate_evidence(
    src_conn: sqlite3.Connection,
    dst_db: CaseFrameworkDB,
    dry_run: bool = False,
) -> int:
    """Migrate the evidence_checklists table."""
    src_conn.row_factory = sqlite3.Row
    cursor = src_conn.execute("SELECT * FROM evidence_checklists ORDER BY evidence_id")
    rows = cursor.fetchall()
    count = 0

    if dry_run:
        for row in rows:
            logger.info("[DRY-RUN] evidence: id=%s case=%s party=%s name=%s",
                        row["evidence_id"], row["case_id"],
                        row["party_type"], row["evidence_name"])
        return len(rows)

    dst_conn = sqlite3.connect(str(dst_db.db_path))
    try:
        for row in rows:
            arb_party = map_party_type(row["party_type"] or "")
            dst_conn.execute(
                """INSERT OR REPLACE INTO evidence_checklists
                   (evidence_id, case_id, point_id, party_type,
                    evidence_name, evidence_type, necessity_level,
                    description, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    row["evidence_id"],
                    row["case_id"],
                    row["point_id"],
                    arb_party,
                    row["evidence_name"],
                    _row_get(row, "evidence_type", None),
                    _row_get(row, "necessity_level", None),
                    apply_arb_adaptation(_row_get(row, "description", "") or ""),
                    _row_get(row, "sort_order", row["evidence_id"]),
                ),
            )
            count += 1
        dst_conn.commit()
    finally:
        dst_conn.close()
    logger.info("Migrated %d evidence items", count)
    return count


def migrate_reinforcement(
    src_conn: sqlite3.Connection,
    dst_db: CaseFrameworkDB,
    dry_run: bool = False,
) -> int:
    """Migrate the reinforcement_templates table."""
    src_conn.row_factory = sqlite3.Row
    cursor = src_conn.execute("SELECT * FROM reinforcement_templates ORDER BY template_id")
    rows = cursor.fetchall()
    count = 0

    if dry_run:
        for row in rows:
            logger.info("[DRY-RUN] reinforcement: id=%s case=%s",
                        row["template_id"], row["case_id"])
        return len(rows)

    dst_conn = sqlite3.connect(str(dst_db.db_path))
    try:
        for row in rows:
            dst_conn.execute(
                """INSERT OR REPLACE INTO reinforcement_templates
                   (template_id, case_id, point_id, gap_type,
                    gap_description, reinforcement_advice,
                    priority, difficulty, time_required)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    row["template_id"],
                    row["case_id"],
                    row["point_id"],
                    row["gap_type"],
                    apply_arb_adaptation(_row_get(row, "gap_description", "") or ""),
                    apply_arb_adaptation(_row_get(row, "reinforcement_advice", "") or ""),
                    _row_get(row, "priority", None),
                    _row_get(row, "difficulty", None),
                    _row_get(row, "time_required", None),
                ),
            )
            count += 1
        dst_conn.commit()
    finally:
        dst_conn.close()
    logger.info("Migrated %d reinforcement templates", count)
    return count


def run_migration(source_db: Path, dry_run: bool = False) -> dict[str, int]:
    """Run the full migration pipeline.

    Returns a dict of per-table row counts migrated.
    """
    if not source_db.exists():
        logger.error("Source database not found: %s", source_db)
        return {}

    logger.info("Source database: %s", source_db)

    dst_db = CaseFrameworkDB()
    dst_db._ensure_initialized()
    logger.info("Destination database: %s", dst_db.db_path)

    src_conn = sqlite3.connect(str(source_db))
    try:
        stats = {
            "case_types": migrate_case_types(src_conn, dst_db, dry_run),
            "frameworks": migrate_frameworks(src_conn, dst_db, dry_run),
            "review_points": migrate_review_points(src_conn, dst_db, dry_run),
            "evidence": migrate_evidence(src_conn, dst_db, dry_run),
            "reinforcement": migrate_reinforcement(src_conn, dst_db, dry_run),
        }
    finally:
        src_conn.close()

    if not dry_run:
        final_stats = dst_db.get_statistics()
        logger.info("Final database statistics: %s", final_stats)

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate case-type-guide data to aiarb case framework DB"
    )
    parser.add_argument(
        "--source", type=Path, default=DEFAULT_SOURCE_DB,
        help="Path to source case_types.db",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be migrated without writing",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Enable verbose logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    stats = run_migration(args.source, args.dry_run)

    print("\n" + "=" * 60)
    print("Migration Summary")
    print("=" * 60)
    for table, count in stats.items():
        print(f"  {table:30s}: {count:5d} records")
    print(f"  {'TOTAL':30s}: {sum(stats.values()):5d} records")
    print("=" * 60)

    if args.dry_run:
        print("\n(DRY RUN — no data was written)")


if __name__ == "__main__":
    main()
