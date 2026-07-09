# -*- coding: utf-8 -*-
"""MootStore — SQLite-backed persistence for arbitration practice cases.

Storage: single-file SQLite (~/.aiarb/moot/moot.db), global singleton.
- All CRUD operations are synchronous and protected by a threading.Lock.
- When called from async context, use asyncio.to_thread() to avoid blocking.
- WAL mode for concurrent read/write with SSE subscribers.
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

from .models import (
    CaseEvent,
    CaseStage,
    CollaborationMode,
    EventType,
    FileBlob,
    FileVisibility,
    MootCase,
    MootCaseFile,
    MootMessage,
    Participant,
    RoleCategory,
)

logger = logging.getLogger(__name__)

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS moot_cases (
    case_id           TEXT PRIMARY KEY,
    case_name         TEXT NOT NULL DEFAULT '仲裁模拟案',
    case_description  TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'draft',
    current_stage     TEXT NOT NULL DEFAULT 'draft',
    rules             TEXT NOT NULL DEFAULT '[]',
    controller_participant_id TEXT,
    current_speaker   TEXT,
    created_at        REAL NOT NULL,
    updated_at        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS moot_participants (
    participant_id    TEXT PRIMARY KEY,
    case_id           TEXT NOT NULL,
    agent_id          TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    role              TEXT NOT NULL,
    role_detail       TEXT NOT NULL DEFAULT '',
    collaboration_mode TEXT NOT NULL DEFAULT 'ai_lead',
    joined_at         REAL NOT NULL,
    active            INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (case_id) REFERENCES moot_cases(case_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS moot_messages (
    id                TEXT PRIMARY KEY,
    case_id           TEXT NOT NULL,
    participant_id    TEXT NOT NULL,
    agent_id          TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    role              TEXT NOT NULL,
    content           TEXT NOT NULL DEFAULT '',
    stage             TEXT NOT NULL,
    timestamp         REAL NOT NULL,
    is_system         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (case_id) REFERENCES moot_cases(case_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS moot_events (
    event_id              TEXT PRIMARY KEY,
    case_id               TEXT NOT NULL,
    event_type            TEXT NOT NULL,
    description           TEXT NOT NULL DEFAULT '',
    data                  TEXT NOT NULL DEFAULT '{}',
    timestamp             REAL NOT NULL,
    actor_participant_id  TEXT,
    FOREIGN KEY (case_id) REFERENCES moot_cases(case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_participants_case ON moot_participants(case_id);
CREATE INDEX IF NOT EXISTS idx_messages_case ON moot_messages(case_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_case ON moot_events(case_id, timestamp);

CREATE TABLE IF NOT EXISTS moot_file_blobs (
    blob_id   TEXT PRIMARY KEY,
    content   BLOB NOT NULL,
    size      INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    ref_count INTEGER DEFAULT 1,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS moot_case_files (
    file_id                TEXT PRIMARY KEY,
    case_id                TEXT NOT NULL,
    blob_id                TEXT NOT NULL,
    filename               TEXT NOT NULL,
    original_filename      TEXT NOT NULL,
    description            TEXT DEFAULT '',
    owner_participant_id   TEXT NOT NULL,
    visibility             TEXT DEFAULT 'private',
    allowed_participants   TEXT DEFAULT '[]',
    category               TEXT DEFAULT '',
    tags                   TEXT DEFAULT '[]',
    version                INTEGER DEFAULT 1,
    parent_file_id         TEXT,
    uploaded_at            REAL NOT NULL,
    updated_at             REAL NOT NULL,
    FOREIGN KEY (case_id) REFERENCES moot_cases(case_id) ON DELETE CASCADE,
    FOREIGN KEY (blob_id) REFERENCES moot_file_blobs(blob_id)
);

CREATE INDEX IF NOT EXISTS idx_case_files_case ON moot_case_files(case_id);
CREATE INDEX IF NOT EXISTS idx_case_files_owner ON moot_case_files(owner_participant_id);
CREATE INDEX IF NOT EXISTS idx_case_files_blob ON moot_case_files(blob_id);
"""


class MootStore:
    _instance: Optional[MootStore] = None

    @classmethod
    def get_instance(cls, db_dir: Optional[Path] = None) -> MootStore:
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
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()
        self._lock = threading.Lock()

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except Exception:
                pass

    # ── Case CRUD ──────────────────────────────────────────────────────────

    def create_case(self, case: MootCase) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO moot_cases (case_id, case_name, case_description, status, current_stage, rules, controller_participant_id, current_speaker, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    case.case_id,
                    case.case_name,
                    case.case_description,
                    case.status,
                    case.current_stage.value,
                    json.dumps(case.rules, ensure_ascii=False),
                    case.controller_participant_id,
                    case.current_speaker,
                    case.created_at,
                    case.updated_at,
                ),
            )
            self._conn.commit()

    def get_case(self, case_id: str) -> Optional[MootCase]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM moot_cases WHERE case_id = ?", (case_id,)
            ).fetchone()
        if not row:
            return None
        return self._row_to_case(row)

    def list_cases(self) -> List[MootCase]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM moot_cases ORDER BY updated_at DESC"
            ).fetchall()
        return [self._row_to_case(r) for r in rows]

    _UNSET = object()

    def update_case(
        self,
        case_id: str,
        *,
        case_name: Optional[str] = None,
        case_description: Optional[str] = None,
        status: Optional[str] = None,
        current_stage: Optional[CaseStage] = None,
        rules: Optional[List[str]] = None,
        controller_participant_id: Any = _UNSET,
        current_speaker: Any = _UNSET,
        updated_at: Optional[float] = None,
    ) -> None:
        parts: List[str] = []
        values: List[Any] = []
        if case_name is not None:
            parts.append("case_name = ?")
            values.append(case_name)
        if case_description is not None:
            parts.append("case_description = ?")
            values.append(case_description)
        if status is not None:
            parts.append("status = ?")
            values.append(status)
        if current_stage is not None:
            parts.append("current_stage = ?")
            values.append(current_stage.value)
        if rules is not None:
            parts.append("rules = ?")
            values.append(json.dumps(rules, ensure_ascii=False))
        if controller_participant_id is not MootStore._UNSET:
            parts.append("controller_participant_id = ?")
            values.append(controller_participant_id)
        if current_speaker is not MootStore._UNSET:
            parts.append("current_speaker = ?")
            values.append(current_speaker)
        if updated_at is not None:
            parts.append("updated_at = ?")
            values.append(updated_at)
        if not parts:
            return
        values.append(case_id)
        with self._lock:
            self._conn.execute(
                f"UPDATE moot_cases SET {', '.join(parts)} WHERE case_id = ?",
                values,
            )
            self._conn.commit()

    def delete_case(self, case_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM moot_events WHERE case_id = ?", (case_id,))
            self._conn.execute("DELETE FROM moot_messages WHERE case_id = ?", (case_id,))
            self._conn.execute("DELETE FROM moot_participants WHERE case_id = ?", (case_id,))
            self._conn.execute("DELETE FROM moot_cases WHERE case_id = ?", (case_id,))
            self._conn.commit()

    # ── Participant CRUD ───────────────────────────────────────────────────

    def add_participant(self, participant: Participant, case_id: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO moot_participants (participant_id, case_id, agent_id, display_name, role, role_detail, collaboration_mode, joined_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    participant.participant_id,
                    case_id,
                    participant.agent_id,
                    participant.display_name,
                    participant.role.value,
                    participant.role_detail,
                    participant.collaboration_mode.value,
                    participant.joined_at,
                    1 if participant.active else 0,
                ),
            )
            self._conn.commit()

    def update_participant(
        self,
        participant_id: str,
        *,
        collaboration_mode: Optional[CollaborationMode] = None,
        role_detail: Optional[str] = None,
        active: Optional[bool] = None,
    ) -> None:
        parts: List[str] = []
        values: List[Any] = []
        if collaboration_mode is not None:
            parts.append("collaboration_mode = ?")
            values.append(collaboration_mode.value)
        if role_detail is not None:
            parts.append("role_detail = ?")
            values.append(role_detail)
        if active is not None:
            parts.append("active = ?")
            values.append(1 if active else 0)
        if not parts:
            return
        values.append(participant_id)
        with self._lock:
            self._conn.execute(
                f"UPDATE moot_participants SET {', '.join(parts)} WHERE participant_id = ?",
                values,
            )
            self._conn.commit()

    # ── Message CRUD ───────────────────────────────────────────────────────

    def add_message(self, msg: MootMessage) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO moot_messages (id, case_id, participant_id, agent_id, display_name, role, content, stage, timestamp, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    msg.id,
                    msg.case_id,
                    msg.participant_id,
                    msg.agent_id,
                    msg.display_name,
                    msg.role.value,
                    msg.content,
                    msg.stage.value,
                    msg.timestamp,
                    1 if msg.is_system else 0,
                ),
            )
            self._conn.commit()

    def get_messages(self, case_id: str) -> List[MootMessage]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM moot_messages WHERE case_id = ? ORDER BY timestamp ASC",
                (case_id,),
            ).fetchall()
        return [self._row_to_message(r) for r in rows]

    # ── Event CRUD ─────────────────────────────────────────────────────────

    def add_event(self, event: CaseEvent, case_id: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO moot_events (event_id, case_id, event_type, description, data, timestamp, actor_participant_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    event.event_id,
                    case_id,
                    event.event_type.value,
                    event.description,
                    json.dumps(event.data, ensure_ascii=False),
                    event.timestamp,
                    event.actor_participant_id,
                ),
            )
            self._conn.commit()

    def get_events(self, case_id: str) -> List[CaseEvent]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM moot_events WHERE case_id = ? ORDER BY timestamp ASC",
                (case_id,),
            ).fetchall()
        return [self._row_to_event(r) for r in rows]

    # ── Row → Model mappers ────────────────────────────────────────────────

    def _row_to_case(self, row: sqlite3.Row) -> MootCase:
        case_id = row["case_id"]
        participants = self._get_participants(case_id)
        messages = self._get_messages_internal(case_id)
        events = self._get_events_internal(case_id)
        return MootCase(
            case_id=case_id,
            case_name=row["case_name"],
            case_description=row["case_description"],
            status=row["status"],
            current_stage=CaseStage(row["current_stage"]),
            rules=json.loads(row["rules"]),
            controller_participant_id=row["controller_participant_id"],
            participants=participants,
            events=events,
            messages=messages,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            current_speaker=row["current_speaker"],
        )

    def _get_participants(self, case_id: str) -> List[Participant]:
        rows = self._conn.execute(
            "SELECT * FROM moot_participants WHERE case_id = ? ORDER BY joined_at ASC",
            (case_id,),
        ).fetchall()
        return [self._row_to_participant(r) for r in rows]

    def _get_messages_internal(self, case_id: str) -> List[MootMessage]:
        rows = self._conn.execute(
            "SELECT * FROM moot_messages WHERE case_id = ? ORDER BY timestamp ASC",
            (case_id,),
        ).fetchall()
        return [self._row_to_message(r) for r in rows]

    def _get_events_internal(self, case_id: str) -> List[CaseEvent]:
        rows = self._conn.execute(
            "SELECT * FROM moot_events WHERE case_id = ? ORDER BY timestamp ASC",
            (case_id,),
        ).fetchall()
        return [self._row_to_event(r) for r in rows]

    @staticmethod
    def _row_to_participant(row: sqlite3.Row) -> Participant:
        return Participant(
            participant_id=row["participant_id"],
            agent_id=row["agent_id"],
            display_name=row["display_name"],
            role=RoleCategory(row["role"]),
            role_detail=row["role_detail"],
            collaboration_mode=CollaborationMode(row["collaboration_mode"]),
            joined_at=row["joined_at"],
            active=bool(row["active"]),
        )

    @staticmethod
    def _row_to_message(row: sqlite3.Row) -> MootMessage:
        return MootMessage(
            id=row["id"],
            case_id=row["case_id"],
            participant_id=row["participant_id"],
            agent_id=row["agent_id"],
            display_name=row["display_name"],
            role=RoleCategory(row["role"]),
            content=row["content"],
            stage=CaseStage(row["stage"]),
            timestamp=row["timestamp"],
            is_system=bool(row["is_system"]),
        )

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> CaseEvent:
        return CaseEvent(
            event_id=row["event_id"],
            event_type=EventType(row["event_type"]),
            description=row["description"],
            data=json.loads(row["data"]),
            timestamp=row["timestamp"],
            actor_participant_id=row["actor_participant_id"],
        )

    # ── File CRUD ──────────────────────────────────────────────────────────

    def upload_file(
        self,
        content: bytes,
        case_id: str,
        filename: str,
        original_filename: str,
        owner_participant_id: str,
        mime_type: str = "application/octet-stream",
        visibility: FileVisibility = FileVisibility.PRIVATE,
        allowed_participant_ids: Optional[List[str]] = None,
        category: str = "",
        tags: Optional[List[str]] = None,
        description: str = "",
        parent_file_id: Optional[str] = None,
        version: int = 1,
    ) -> MootCaseFile:
        blob_id = FileBlob.compute_blob_id(content)
        now = time.time()
        allowed = allowed_participant_ids or []
        tag_list = tags or []

        with self._lock:
            existing = self._conn.execute(
                "SELECT blob_id, ref_count FROM moot_file_blobs WHERE blob_id = ?",
                (blob_id,),
            ).fetchone()

            if existing:
                self._conn.execute(
                    "UPDATE moot_file_blobs SET ref_count = ref_count + 1 WHERE blob_id = ?",
                    (blob_id,),
                )
            else:
                self._conn.execute(
                    "INSERT INTO moot_file_blobs (blob_id, content, size, mime_type, ref_count, created_at) VALUES (?, ?, ?, ?, 1, ?)",
                    (blob_id, content, len(content), mime_type, now),
                )

            file_id = uuid.uuid4().hex[:12]
            self._conn.execute(
                "INSERT INTO moot_case_files (file_id, case_id, blob_id, filename, original_filename, description, owner_participant_id, visibility, allowed_participants, category, tags, version, parent_file_id, uploaded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    file_id,
                    case_id,
                    blob_id,
                    filename,
                    original_filename,
                    description,
                    owner_participant_id,
                    visibility.value,
                    json.dumps(allowed, ensure_ascii=False),
                    category,
                    json.dumps(tag_list, ensure_ascii=False),
                    version,
                    parent_file_id,
                    now,
                    now,
                ),
            )
            self._conn.commit()

        return MootCaseFile(
            file_id=file_id,
            case_id=case_id,
            blob_id=blob_id,
            filename=filename,
            original_filename=original_filename,
            description=description,
            owner_participant_id=owner_participant_id,
            visibility=visibility,
            allowed_participant_ids=allowed,
            category=category,
            tags=tag_list,
            version=version,
            parent_file_id=parent_file_id,
            uploaded_at=now,
            updated_at=now,
        )

    def get_case_files(self, case_id: str) -> List[MootCaseFile]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM moot_case_files WHERE case_id = ? ORDER BY uploaded_at ASC",
                (case_id,),
            ).fetchall()
        return [self._row_to_case_file(r) for r in rows]

    def get_visible_files(self, case_id: str, participant_id: str) -> List[MootCaseFile]:
        all_files = self.get_case_files(case_id)
        visible: List[MootCaseFile] = []
        for f in all_files:
            if f.visibility == FileVisibility.PRIVATE and f.owner_participant_id == participant_id:
                visible.append(f)
            elif f.visibility == FileVisibility.SHARED:
                visible.append(f)
            elif f.visibility == FileVisibility.DIRECTED and participant_id in f.allowed_participant_ids:
                visible.append(f)
        return visible

    def get_file(self, file_id: str) -> Optional[MootCaseFile]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM moot_case_files WHERE file_id = ?",
                (file_id,),
            ).fetchone()
        if not row:
            return None
        return self._row_to_case_file(row)

    def get_file_content(self, blob_id: str) -> Optional[bytes]:
        with self._lock:
            row = self._conn.execute(
                "SELECT content FROM moot_file_blobs WHERE blob_id = ?",
                (blob_id,),
            ).fetchone()
        if not row:
            return None
        return bytes(row["content"])

    def get_file_blob(self, blob_id: str) -> Optional[FileBlob]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM moot_file_blobs WHERE blob_id = ?",
                (blob_id,),
            ).fetchone()
        if not row:
            return None
        return FileBlob(
            blob_id=row["blob_id"],
            size=row["size"],
            mime_type=row["mime_type"],
            ref_count=row["ref_count"],
            created_at=row["created_at"],
        )

    def update_file_visibility(
        self,
        file_id: str,
        visibility: FileVisibility,
        allowed_participant_ids: Optional[List[str]] = None,
    ) -> Optional[MootCaseFile]:
        with self._lock:
            existing = self._conn.execute(
                "SELECT * FROM moot_case_files WHERE file_id = ?",
                (file_id,),
            ).fetchone()
            if not existing:
                return None

            parts = ["visibility = ?", "updated_at = ?"]
            values: List[Any] = [visibility.value, time.time()]

            if allowed_participant_ids is not None:
                parts.append("allowed_participants = ?")
                values.append(json.dumps(allowed_participant_ids, ensure_ascii=False))

            values.append(file_id)
            self._conn.execute(
                f"UPDATE moot_case_files SET {', '.join(parts)} WHERE file_id = ?",
                values,
            )
            self._conn.commit()

        return self.get_file(file_id)

    def delete_file(self, file_id: str) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT blob_id FROM moot_case_files WHERE file_id = ?",
                (file_id,),
            ).fetchone()
            if not row:
                return False

            blob_id = row["blob_id"]
            self._conn.execute(
                "DELETE FROM moot_case_files WHERE file_id = ?",
                (file_id,),
            )

            self._conn.execute(
                "UPDATE moot_file_blobs SET ref_count = ref_count - 1 WHERE blob_id = ?",
                (blob_id,),
            )
            blob_row = self._conn.execute(
                "SELECT ref_count FROM moot_file_blobs WHERE blob_id = ?",
                (blob_id,),
            ).fetchone()
            if blob_row and blob_row["ref_count"] <= 0:
                self._conn.execute(
                    "DELETE FROM moot_file_blobs WHERE blob_id = ?",
                    (blob_id,),
                )

            self._conn.commit()
        return True

    def get_file_versions(self, file_id: str) -> List[MootCaseFile]:
        with self._lock:
            row = self._conn.execute(
                "SELECT case_id, parent_file_id FROM moot_case_files WHERE file_id = ?",
                (file_id,),
            ).fetchone()
            if not row:
                return []

            chain: List[MootCaseFile] = []
            current = self._conn.execute(
                "SELECT * FROM moot_case_files WHERE file_id = ?",
                (file_id,),
            ).fetchone()
            if current:
                chain.append(self._row_to_case_file(current))

            visited = {file_id}
            pid = row["parent_file_id"]
            while pid and pid not in visited:
                visited.add(pid)
                parent = self._conn.execute(
                    "SELECT * FROM moot_case_files WHERE file_id = ?",
                    (pid,),
                ).fetchone()
                if not parent:
                    break
                chain.append(self._row_to_case_file(parent))
                pid = parent["parent_file_id"]

            chain.reverse()
            return chain

    @staticmethod
    def _row_to_case_file(row: sqlite3.Row) -> MootCaseFile:
        return MootCaseFile(
            file_id=row["file_id"],
            case_id=row["case_id"],
            blob_id=row["blob_id"],
            filename=row["filename"],
            original_filename=row["original_filename"],
            description=row["description"],
            owner_participant_id=row["owner_participant_id"],
            visibility=FileVisibility(row["visibility"]),
            allowed_participant_ids=json.loads(row["allowed_participants"]),
            category=row["category"],
            tags=json.loads(row["tags"]),
            version=row["version"],
            parent_file_id=row["parent_file_id"],
            uploaded_at=row["uploaded_at"],
            updated_at=row["updated_at"],
        )