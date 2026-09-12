#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""更新 pool manifest (skill.json) 中的 tags 字段。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import frontmatter


def main() -> int:
    pool_dir = Path.home() / ".aiarb" / "skill_pool"
    manifest_path = pool_dir / "skill.json"

    if not manifest_path.exists():
        print(f"[ERROR] Manifest not found: {manifest_path}")
        return 1

    data = json.loads(manifest_path.read_text("utf-8"))
    skills = data.get("skills", {})
    print(f"Total skills: {len(skills)}")

    updated = 0
    for skill_name, entry in skills.items():
        skill_md = pool_dir / skill_name / "SKILL.md"
        if not skill_md.exists():
            continue

        try:
            content = skill_md.read_text("utf-8")
            post = frontmatter.loads(content)
            tags = post.get("tags")
            if isinstance(tags, list):
                entry["tags"] = [str(t) for t in tags]
                updated += 1
        except Exception as e:
            print(f"  [ERROR] {skill_name}: {e}")

    manifest_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), "utf-8"
    )
    print(f"Updated {updated} entries in manifest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
