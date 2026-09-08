#!/usr/bin/env python3
"""
第二轮修复：处理遗漏的误替换
- "人民法院" → "人民法院"
- "高级/中级/基层 + 人民法院" → "高级/中级/基层 + 人民法院"
- "最高人民法院" → "最高人民法院"
"""
from pathlib import Path

PROJECT_ROOT = Path("d:/Project/QwenPaw")

FIXES_ROUND2 = [
    ("最高人民法院", "最高人民法院"),
    ("最高人民法院", "最高人民法院"),
    ("高级人民法院", "高级人民法院"),
    ("中级人民法院", "中级人民法院"),
    ("基层人民法院", "基层人民法院"),
    ("区人民法院", "区人民法院"),
    ("县人民法院", "县人民法院"),
    ("市人民法院", "市人民法院"),
    ("省人民法院", "省人民法院"),
    ("人民法院", "人民法院"),
]

def fix_file(path: Path) -> int:
    try:
        content = path.read_text(encoding='utf-8')
    except:
        return 0
    original = content
    for old, new in FIXES_ROUND2:
        if old in content:
            content = content.replace(old, new)
    if content != original:
        path.write_text(content, encoding='utf-8')
        return 1
    return 0

fixed = 0
for ext in ['*.md', '*.py', '*.json']:
    for path in PROJECT_ROOT.rglob(ext):
        parts = path.parts
        skip = False
        for p in parts:
            if p.startswith('.') or p in ('node_modules', '__pycache__', '.git', 'venv', '.venv'):
                skip = True
                break
        if skip:
            continue
        result = fix_file(path)
        if result > 0:
            fixed += 1
            print(f"  ✅ {path.relative_to(PROJECT_ROOT)}")

print(f"第二轮修复: {fixed} 个文件")
