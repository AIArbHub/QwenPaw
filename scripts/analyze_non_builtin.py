#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""分析 pool manifest 中的非内置技能。"""
import json
import pathlib

p = pathlib.Path.home() / ".aiarb" / "skill_pool" / "skill.json"
data = json.loads(p.read_text("utf-8"))
skills = data.get("skills", {})

non_builtin = [(k, v) for k, v in skills.items() if v.get("source") != "builtin"]
builtin = [(k, v) for k, v in skills.items() if v.get("source") == "builtin"]

print(f"Total skills: {len(skills)}")
print(f"Builtin: {len(builtin)}")
print(f"Non-builtin: {len(non_builtin)}")
print()
print("--- Non-builtin skills ---")
for k, v in non_builtin:
    src = v.get("source", "?")
    tags = v.get("tags", [])
    ext = v.get("external", False)
    ext_path = v.get("external_path", "")
    print(f"  {k} | source={src} | external={ext} | tags={tags}")
    if ext_path:
        print(f"    path: {ext_path}")
