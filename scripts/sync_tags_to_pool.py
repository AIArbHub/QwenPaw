#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""将源目录 SKILL.md 中的 tags 同步到 pool 目录中的 SKILL.md。

pool 目录中的技能副本可能是在添加 tags 功能之前拷贝的，
需要从源目录（src/aiarb/agents/skills/）中把 tags 字段同步过来。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import frontmatter


def main() -> int:
    pool_manifest = Path.home() / ".aiarb" / "skill_pool" / "skill.json"
    if not pool_manifest.exists():
        print(f"[ERROR] Pool manifest not found: {pool_manifest}")
        return 1

    data = json.loads(pool_manifest.read_text("utf-8"))
    skills = data.get("skills", {})
    print(f"Total skills in manifest: {len(skills)}")

    # Source skills directory
    src_skills_dir = Path("src/aiarb/agents/skills")
    if not src_skills_dir.exists():
        print(f"[ERROR] Source skills directory not found: {src_skills_dir}")
        return 1

    updated = 0
    skipped = 0
    errors = 0

    for skill_name, entry in skills.items():
        builtin_source_name = entry.get("builtin_source_name", "")
        if not builtin_source_name:
            # Not a builtin skill, skip
            skipped += 1
            continue

        # Source SKILL.md path
        src_skill_md = src_skills_dir / builtin_source_name / "SKILL.md"
        if not src_skill_md.exists():
            # Try without language suffix
            for suffix in ["-zh", "-en"]:
                alt = src_skills_dir / f"{skill_name}{suffix}" / "SKILL.md"
                if alt.exists():
                    src_skill_md = alt
                    break
            else:
                print(f"  [SKIP] {skill_name}: source SKILL.md not found")
                skipped += 1
                continue

        # Pool SKILL.md path
        pool_skill_md = Path.home() / ".aiarb" / "skill_pool" / skill_name / "SKILL.md"
        if not pool_skill_md.exists():
            print(f"  [SKIP] {skill_name}: pool SKILL.md not found")
            skipped += 1
            continue

        # Read source tags
        try:
            src_content = src_skill_md.read_text("utf-8")
            src_post = frontmatter.loads(src_content)
            src_tags = src_post.get("tags")
            if not isinstance(src_tags, list):
                print(f"  [SKIP] {skill_name}: no tags in source")
                skipped += 1
                continue
        except Exception as e:
            print(f"  [ERROR] {skill_name}: failed to read source: {e}")
            errors += 1
            continue

        # Read pool SKILL.md
        try:
            pool_content = pool_skill_md.read_text("utf-8")
            pool_post = frontmatter.loads(pool_content)
            pool_tags = pool_post.get("tags")
        except Exception as e:
            print(f"  [ERROR] {skill_name}: failed to read pool: {e}")
            errors += 1
            continue

        # Check if tags already match
        if pool_tags == src_tags:
            skipped += 1
            continue

        # Update tags in pool SKILL.md
        pool_post["tags"] = src_tags
        new_content = frontmatter.dumps(pool_post)

        # Ensure proper --- delimiters
        if not new_content.startswith("---"):
            new_content = "---\n" + new_content

        pool_skill_md.write_text(new_content, "utf-8")
        print(f"  [OK] {skill_name}: tags={src_tags}")
        updated += 1

    print(f"\nSummary: updated={updated}, skipped={skipped}, errors={errors}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
