#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""将5个非内置技能在 manifest 中标记为 builtin。"""
import json
import pathlib

p = pathlib.Path.home() / ".aiarb" / "skill_pool" / "skill.json"
data = json.loads(p.read_text("utf-8"))
skills = data.get("skills", {})

MAPPING = {
    "local-drive": "local-drive-zh",
    "self-improvement": "self-improvement-zh",
    "arbitration-award-drafting": "arbitration-award-drafting-zh",
    "arbitration-award-review": "arbitration-award-review-zh",
    "arbitration-moot-simulation": "arbitration-moot-simulation-zh",
}

for skill_name, source_name in MAPPING.items():
    if skill_name not in skills:
        print(f"[SKIP] {skill_name}: not in manifest")
        continue
    entry = skills[skill_name]
    entry["source"] = "builtin"
    entry["builtin_source_name"] = source_name
    entry["builtin_language"] = "zh"
    print(f"[OK] {skill_name} -> builtin, source={source_name}")

p.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")
print(f"\nUpdated {len(MAPPING)} entries")
