#!/usr/bin/env python3
"""Sync arbitration knowledge-base scaffold files into the local global KB.

STATUS: development-only helper (2026-09-08)
--------------------------------------------
The runtime now handles this automatically. ``aiarb.knowledge.
ensure_global_knowledge_base`` performs a *content-hash tracked* sync on every
app startup and on ``aiarb init``: newly shipped files reach the user, updated
packaged files are refreshed when the user has not edited them, and user edits
or user-owned data are never overwritten.

**End users never need to run this script.** It remains for developers who
change files under ``src/aiarb/knowledge_base`` and want to push them into
their own ``~/.aiarb/knowledge_base`` immediately, without restarting the app.

Usage
-----
    python scripts/sync_kb_scaffold.py            # sync
    python scripts/sync_kb_scaffold.py --dry-run  # show what would change

Set ``AIARB_WORKING_DIR`` to target a non-default working directory.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

# Scaffold files that are always safe to overwrite: they are maintained in
# the repo (specs plus per-category collection checklists) and hold no user data.
SCAFFOLD_FILES: tuple[str, ...] = (
    "SCHEMA.md",
    "SOURCES.md",
    "CITATION.md",
    "INDEX.md",
    "laws/README.md",
    "rules/README.md",
    "cases/README.md",
    "templates/README.md",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def packaged_kb_dir() -> Path:
    return repo_root() / "src" / "aiarb" / "knowledge_base"


def global_kb_dir() -> Path:
    env = os.environ.get("AIARB_WORKING_DIR")
    base = Path(env).expanduser().resolve() if env else Path("~/.aiarb").expanduser().resolve()
    return base / "knowledge_base"


def sync(dry_run: bool = False) -> int:
    src_root = packaged_kb_dir()
    dst_root = global_kb_dir()

    if not src_root.is_dir():
        print(f"[error] packaged knowledge base not found: {src_root}")
        return 1

    print(f"source : {src_root}")
    print(f"target : {dst_root}")
    print(f"mode   : {'dry-run' if dry_run else 'sync'}")
    print("-" * 60)

    changed = 0
    seen: set[str] = set()

    # 1) Scaffold files: always overwrite (they carry no user data).
    for rel in SCAFFOLD_FILES:
        seen.add(rel)
        src = src_root / rel
        dst = dst_root / rel
        if not src.is_file():
            print(f"[skip ] {rel} (not in repo)")
            continue

        if dst.is_file() and dst.read_bytes() == src.read_bytes():
            print(f"[same ] {rel}")
            continue

        verb = "[would]" if dry_run else "[write]"
        print(f"{verb} {rel}")
        changed += 1
        if not dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    # 2) Content files: copy only when missing, mirroring the runtime's
    #    "never overwrite user files" rule.
    for src in sorted(src_root.rglob("*.md")):
        rel = src.relative_to(src_root).as_posix()
        if rel in seen:
            continue
        seen.add(rel)
        dst = dst_root / rel
        if dst.exists():
            print(f"[keep ] {rel} (user file preserved)")
            continue
        print(f"{'[would]' if dry_run else '[add  ]'} {rel}")
        changed += 1
        if not dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    print("-" * 60)
    print(f"{changed} file(s) {'would be updated' if dry_run else 'updated'}.")
    print("Existing user files were not overwritten.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show what would change without writing anything",
    )
    args = parser.parse_args()
    return sync(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
