#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""为缺少 tags 的 pool 技能添加 tags。"""
from __future__ import annotations

import re
from pathlib import Path

# Skill name -> tags mapping
TAGS_MAP = {
    "arbitration-award-drafting": ["仲裁核心", "文书起草"],
    "arbitration-award-review": ["仲裁核心"],
    "arbitration-moot-simulation": ["仲裁核心", "案件分析"],
    "browser_cdp": ["系统工具"],
    "browser_visible": ["系统工具"],
    "himalaya": ["系统工具"],
    "local-drive": ["系统工具"],
    "news": ["系统工具"],
    "self-improvement": ["系统工具"],
}

pool_dir = Path.home() / ".aiarb" / "skill_pool"

for skill_name, tags in TAGS_MAP.items():
    skill_md = pool_dir / skill_name / "SKILL.md"
    if not skill_md.exists():
        print(f"[SKIP] {skill_name}: SKILL.md not found")
        continue

    content = skill_md.read_text("utf-8")

    # Check if tags already exist
    if re.search(r"^tags:", content, re.MULTILINE):
        print(f"[SKIP] {skill_name}: tags already exist")
        continue

    # Add tags before the closing ---
    tags_line = f"tags: {tags}\n"
    # Find the closing --- (second one)
    parts = content.split("---", 2)
    if len(parts) >= 3:
        # Insert tags before the closing ---
        frontmatter_content = parts[1]
        # Add tags at the end of frontmatter
        new_frontmatter = frontmatter_content.rstrip() + "\n" + tags_line
        new_content = "---" + new_frontmatter + "---" + parts[2]
        skill_md.write_text(new_content, "utf-8")
        print(f"[OK] {skill_name}: tags={tags}")
    else:
        print(f"[ERROR] {skill_name}: could not parse frontmatter")
