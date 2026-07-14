# -*- coding: utf-8 -*-
"""Cases module — SQLite-backed case management with structured info, file tags, and AI features.

Features:
- Case structured info (case_number, parties, claim_amount, etc.)
- File tagging with material zone permissions (shared, party-specific, arbitrator-specific, secretary-specific)
- AI-powered file organization with backup
- Internal AI chat (omniscient perspective) for Q&A and document generation
- Local folder scanning for batch case creation
- SQLite persistence via CasesStore
"""

from .models import CaseRef, CaseFile
from .store import CasesStore

__all__ = ["CaseRef", "CaseFile", "CasesStore"]