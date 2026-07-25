# -*- coding: utf-8 -*-
"""CasesStore — SQLite-backed persistence for case management features.

Storage: single-file SQLite (~/.aiarb/cases/cases.db), global singleton.
- Structured case info (case_number, parties, etc.)
- File tags (zone, category, custom_tags)
- AI organize results (backup info, organized file mappings)
- AI chat history (omniscient perspective Q&A and document generation)
- Engine configuration persistence
- Processing history records

All CRUD operations are synchronous and protected by a threading.Lock.
WAL mode for concurrent read/write.
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

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS case_structured_info (
    case_id               TEXT PRIMARY KEY,
    case_number           TEXT DEFAULT '',
    arbitration_institution TEXT DEFAULT '',
    dispute_type          TEXT DEFAULT '',
    claim_amount          REAL,
    arbitration_procedure TEXT DEFAULT '普通程序',
    arbitration_rules     TEXT DEFAULT '',
    filing_date           TEXT DEFAULT '',
    hearing_date          TEXT DEFAULT '',
    case_summary          TEXT DEFAULT '',
    parties               TEXT DEFAULT '[]',
    created_at            REAL NOT NULL,
    updated_at            REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS case_parties (
    party_id              TEXT PRIMARY KEY,
    case_id               TEXT NOT NULL,
    party_type            TEXT NOT NULL,
    name                  TEXT NOT NULL,
    legal_representative  TEXT DEFAULT '',
    contact               TEXT DEFAULT '',
    address               TEXT DEFAULT '',
    counsel               TEXT DEFAULT '',
    FOREIGN KEY (case_id) REFERENCES case_structured_info(case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_parties_case ON case_parties(case_id);

CREATE TABLE IF NOT EXISTS case_file_tags (
    tag_id                TEXT PRIMARY KEY,
    case_id               TEXT NOT NULL,
    file_path             TEXT NOT NULL,
    zone                  TEXT DEFAULT 'shared',
    category              TEXT DEFAULT '',
    custom_tags           TEXT DEFAULT '[]',
    description           TEXT DEFAULT '',
    created_at            REAL NOT NULL,
    updated_at            REAL NOT NULL,
    UNIQUE(case_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_file_tags_case ON case_file_tags(case_id);
CREATE INDEX IF NOT EXISTS idx_file_tags_zone ON case_file_tags(case_id, zone);

CREATE TABLE IF NOT EXISTS case_ai_organize_results (
    id                    TEXT PRIMARY KEY,
    case_id               TEXT NOT NULL,
    backup_path           TEXT DEFAULT '',
    organized_files       TEXT DEFAULT '[]',
    summary               TEXT DEFAULT '',
    dry_run               INTEGER DEFAULT 0,
    timestamp             REAL NOT NULL,
    FOREIGN KEY (case_id) REFERENCES case_structured_info(case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_organize_case ON case_ai_organize_results(case_id, timestamp);

CREATE TABLE IF NOT EXISTS case_ai_chat_messages (
    id                    TEXT PRIMARY KEY,
    case_id               TEXT NOT NULL,
    role                  TEXT NOT NULL,
    content               TEXT NOT NULL,
    documents             TEXT DEFAULT '[]',
    timestamp             REAL NOT NULL,
    FOREIGN KEY (case_id) REFERENCES case_structured_info(case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_case ON case_ai_chat_messages(case_id, timestamp);

CREATE TABLE IF NOT EXISTS engine_config (
    key                   TEXT PRIMARY KEY,
    value                 TEXT NOT NULL,
    updated_at            REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS processing_history (
    id                    TEXT PRIMARY KEY,
    file_name             TEXT NOT NULL,
    file_type             TEXT DEFAULT '',
    file_size             INTEGER DEFAULT 0,
    engine_used           TEXT DEFAULT '',
    status                TEXT DEFAULT 'success',
    duration              REAL DEFAULT 0,
    pages                 INTEGER,
    has_images            INTEGER DEFAULT 0,
    has_tables            INTEGER DEFAULT 0,
    preview_content       TEXT DEFAULT '',
    timestamp             REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_time ON processing_history(timestamp DESC);

CREATE TABLE IF NOT EXISTS case_scan_results (
    id                    TEXT PRIMARY KEY,
    scan_path             TEXT NOT NULL,
    folder_path           TEXT NOT NULL,
    suggested_name        TEXT NOT NULL,
    file_count            INTEGER DEFAULT 0,
    created_cases         TEXT DEFAULT '[]',
    timestamp             REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_path ON case_scan_results(scan_path);
"""


class CasesStore:
    """SQLite-backed store for case management features."""

    _instance: Optional[CasesStore] = None
    _lock = threading.Lock()

    def __init__(self, db_path: Path | str):
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        # Initialize schema
        conn = self._get_conn()
        conn.executescript(_SCHEMA)
        conn.commit()
        logger.info("CasesStore initialized at %s", self._db_path)

    @classmethod
    def get_instance(cls) -> "CasesStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    from ..constant import WORKING_DIR
                    db_path = Path(WORKING_DIR) / "cases" / "cases.db"
                    cls._instance = cls(db_path)
        return cls._instance

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn"):
            conn = sqlite3.connect(
                str(self._db_path),
                check_same_thread=False,
                isolation_level=None,  # autocommit
            )
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return self._local.conn

    # ── Structured Info ──────────────────────────────────────────────────────

    def get_structured_info(self, case_id: str) -> Optional[Dict[str, Any]]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM case_structured_info WHERE case_id = ?", (case_id,)
        ).fetchone()
        if not row:
            return None
        parties = conn.execute(
            "SELECT * FROM case_parties WHERE case_id = ? ORDER BY party_type, name",
            (case_id,),
        ).fetchall()
        result = dict(row)
        result["parties"] = [dict(p) for p in parties]
        result["custom_tags"] = json.loads(result.get("custom_tags") or "[]")
        # parties is already a list of dicts from DB, but stored as JSON in structured_info
        # Actually we store parties in a separate table, so override the JSON field
        result["parties"] = [
            {
                "party_id": p["party_id"],
                "party_type": p["party_type"],
                "name": p["name"],
                "legal_representative": p["legal_representative"],
                "contact": p["contact"],
                "address": p["address"],
                "counsel": p["counsel"],
            }
            for p in parties
        ]
        return result

    def upsert_structured_info(self, case_id: str, info: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._get_conn()
        now = time.time()
        # Check if exists
        existing = conn.execute(
            "SELECT created_at FROM case_structured_info WHERE case_id = ?", (case_id,)
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        conn.execute(
            """INSERT INTO case_structured_info
               (case_id, case_number, arbitration_institution, dispute_type,
                claim_amount, arbitration_procedure, arbitration_rules,
                filing_date, hearing_date, case_summary, parties,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(case_id) DO UPDATE SET
                 case_number = excluded.case_number,
                 arbitration_institution = excluded.arbitration_institution,
                 dispute_type = excluded.dispute_type,
                 claim_amount = excluded.claim_amount,
                 arbitration_procedure = excluded.arbitration_procedure,
                 arbitration_rules = excluded.arbitration_rules,
                 filing_date = excluded.filing_date,
                 hearing_date = excluded.hearing_date,
                 case_summary = excluded.case_summary,
                 parties = excluded.parties,
                 updated_at = excluded.updated_at
            """,
            (
                case_id,
                info.get("case_number", ""),
                info.get("arbitration_institution", ""),
                info.get("dispute_type", ""),
                info.get("claim_amount"),
                info.get("arbitration_procedure", "普通程序"),
                info.get("arbitration_rules", ""),
                info.get("filing_date", ""),
                info.get("hearing_date", ""),
                info.get("case_summary", ""),
                json.dumps(info.get("parties", []), ensure_ascii=False),
                created_at,
                now,
            ),
        )

        # Sync parties table
        conn.execute("DELETE FROM case_parties WHERE case_id = ?", (case_id,))
        for party in info.get("parties", []):
            party_id = party.get("party_id") or str(uuid.uuid4())
            conn.execute(
                """INSERT INTO case_parties
                   (party_id, case_id, party_type, name,
                    legal_representative, contact, address, counsel)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    party_id,
                    case_id,
                    party.get("party_type", "claimant"),
                    party.get("name", ""),
                    party.get("legal_representative", ""),
                    party.get("contact", ""),
                    party.get("address", ""),
                    party.get("counsel", ""),
                ),
            )

        return self.get_structured_info(case_id) or {}

    # ── File Tags ────────────────────────────────────────────────────────────

    def get_file_tags(self, case_id: str) -> List[Dict[str, Any]]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM case_file_tags WHERE case_id = ?", (case_id,)
        ).fetchall()
        return [
            {
                "tag_id": r["tag_id"],
                "case_id": r["case_id"],
                "file_path": r["file_path"],
                "zone": r["zone"],
                "category": r["category"],
                "custom_tags": json.loads(r["custom_tags"] or "[]"),
                "description": r["description"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]

    def get_file_tag(self, case_id: str, file_path: str) -> Optional[Dict[str, Any]]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM case_file_tags WHERE case_id = ? AND file_path = ?",
            (case_id, file_path),
        ).fetchone()
        if not row:
            return None
        return {
            "tag_id": row["tag_id"],
            "case_id": row["case_id"],
            "file_path": row["file_path"],
            "zone": row["zone"],
            "category": row["category"],
            "custom_tags": json.loads(row["custom_tags"] or "[]"),
            "description": row["description"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def upsert_file_tag(
        self, case_id: str, file_path: str, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        conn = self._get_conn()
        now = time.time()
        existing = conn.execute(
            "SELECT tag_id, created_at FROM case_file_tags WHERE case_id = ? AND file_path = ?",
            (case_id, file_path),
        ).fetchone()

        if existing:
            tag_id = existing["tag_id"]
            created_at = existing["created_at"]
            updates = []
            values = []
            for field in ("zone", "category", "description"):
                if field in params:
                    updates.append(f"{field} = ?")
                    values.append(params[field])
            if "custom_tags" in params:
                updates.append("custom_tags = ?")
                values.append(json.dumps(params["custom_tags"], ensure_ascii=False))
            updates.append("updated_at = ?")
            values.append(now)
            values.extend([case_id, file_path])
            conn.execute(
                f"UPDATE case_file_tags SET {', '.join(updates)} WHERE case_id = ? AND file_path = ?",
                values,
            )
        else:
            tag_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO case_file_tags
                   (tag_id, case_id, file_path, zone, category,
                    custom_tags, description, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    tag_id,
                    case_id,
                    file_path,
                    params.get("zone", "shared"),
                    params.get("category", ""),
                    json.dumps(params.get("custom_tags", []), ensure_ascii=False),
                    params.get("description", ""),
                    now,
                    now,
                ),
            )

        return self.get_file_tag(case_id, file_path) or {}

    def batch_upsert_file_tags(
        self, case_id: str, updates: List[Dict[str, Any]]
    ) -> int:
        count = 0
        for u in updates:
            self.upsert_file_tag(case_id, u["file_path"], u)
            count += 1
        return count

    # ── AI Organize Results ──────────────────────────────────────────────────

    def save_organize_result(
        self, case_id: str, result: Dict[str, Any]
    ) -> Dict[str, Any]:
        conn = self._get_conn()
        result_id = str(uuid.uuid4())
        now = time.time()
        conn.execute(
            """INSERT INTO case_ai_organize_results
               (id, case_id, backup_path, organized_files, summary, dry_run, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                result_id,
                case_id,
                result.get("backup_path", ""),
                json.dumps(result.get("organized_files", []), ensure_ascii=False),
                result.get("summary", ""),
                1 if result.get("dry_run") else 0,
                now,
            ),
        )
        result["id"] = result_id
        result["timestamp"] = now
        return result

    def get_latest_organize_result(self, case_id: str) -> Optional[Dict[str, Any]]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM case_ai_organize_results WHERE case_id = ? ORDER BY timestamp DESC LIMIT 1",
            (case_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "case_id": row["case_id"],
            "backup_path": row["backup_path"],
            "organized_files": json.loads(row["organized_files"] or "[]"),
            "summary": row["summary"],
            "dry_run": bool(row["dry_run"]),
            "timestamp": row["timestamp"],
        }

    # ── AI Chat History ──────────────────────────────────────────────────────

    def save_chat_message(
        self, case_id: str, role: str, content: str, documents: List[Dict] = None
    ) -> Dict[str, Any]:
        conn = self._get_conn()
        msg_id = str(uuid.uuid4())
        now = time.time()
        conn.execute(
            """INSERT INTO case_ai_chat_messages
               (id, case_id, role, content, documents, timestamp)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                msg_id,
                case_id,
                role,
                content,
                json.dumps(documents or [], ensure_ascii=False),
                now,
            ),
        )
        return {
            "id": msg_id,
            "case_id": case_id,
            "role": role,
            "content": content,
            "documents": documents or [],
            "timestamp": now,
        }

    def get_chat_history(self, case_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM case_ai_chat_messages WHERE case_id = ? ORDER BY timestamp ASC LIMIT ?",
            (case_id, limit),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "case_id": r["case_id"],
                "role": r["role"],
                "content": r["content"],
                "documents": json.loads(r["documents"] or "[]"),
                "timestamp": r["timestamp"],
            }
            for r in rows
        ]

    def clear_chat_history(self, case_id: str) -> int:
        conn = self._get_conn()
        cursor = conn.execute(
            "DELETE FROM case_ai_chat_messages WHERE case_id = ?", (case_id,)
        )
        return cursor.rowcount

    # ── Engine Config ────────────────────────────────────────────────────────

    def get_engine_config(self, key: str) -> Optional[str]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT value FROM engine_config WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None

    def set_engine_config(self, key: str, value: str) -> None:
        conn = self._get_conn()
        now = time.time()
        conn.execute(
            """INSERT INTO engine_config (key, value, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (key, value, now),
        )

    def get_all_engine_config(self) -> Dict[str, str]:
        conn = self._get_conn()
        rows = conn.execute("SELECT key, value FROM engine_config").fetchall()
        return {r["key"]: r["value"] for r in rows}

    # ── Processing History ───────────────────────────────────────────────────

    def add_processing_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._get_conn()
        record_id = record.get("id") or str(uuid.uuid4())
        now = time.time()
        conn.execute(
            """INSERT INTO processing_history
               (id, file_name, file_type, file_size, engine_used,
                status, duration, pages, has_images, has_tables,
                preview_content, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record_id,
                record.get("file_name", ""),
                record.get("file_type", ""),
                record.get("file_size", 0),
                record.get("engine_used", ""),
                record.get("status", "success"),
                record.get("duration", 0),
                record.get("pages"),
                1 if record.get("has_images") else 0,
                1 if record.get("has_tables") else 0,
                record.get("preview_content", ""),
                record.get("timestamp", now),
            ),
        )
        record["id"] = record_id
        return record

    def get_processing_history(self, limit: int = 20) -> List[Dict[str, Any]]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM processing_history ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "file_name": r["file_name"],
                "file_type": r["file_type"],
                "file_size": r["file_size"],
                "engine_used": r["engine_used"],
                "status": r["status"],
                "duration": r["duration"],
                "pages": r["pages"],
                "has_images": bool(r["has_images"]),
                "has_tables": bool(r["has_tables"]),
                "preview_content": r["preview_content"],
                "timestamp": r["timestamp"],
            }
            for r in rows
        ]

    # ── Scan Results ─────────────────────────────────────────────────────────

    def save_scan_result(
        self, scan_path: str, suggested_cases: List[Dict[str, Any]]
    ) -> str:
        conn = self._get_conn()
        scan_id = str(uuid.uuid4())
        now = time.time()
        for case in suggested_cases:
            conn.execute(
                """INSERT INTO case_scan_results
                   (id, scan_path, folder_path, suggested_name, file_count, created_cases, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()),
                    scan_path,
                    case.get("folder_path", ""),
                    case.get("suggested_name", ""),
                    case.get("file_count", 0),
                    json.dumps([], ensure_ascii=False),
                    now,
                ),
            )
        return scan_id
