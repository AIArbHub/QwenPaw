#!/usr/bin/env python3
"""
修复仲裁化改造中的误替换：
1. "人民法院" → "人民法院"
2. "最高人民法院" → "最高人民法院"  
3. "高级人民法院" → "高级人民法院"
4. "中级人民法院" → "中级人民法院"
5. "基层人民法院" → "基层人民法院"
6. 其他误替换的法院专有名词
"""
import re
from pathlib import Path

PROJECT_ROOT = Path("d:/Project/QwenPaw")

# 修复规则（按长度降序排列，避免短词先匹配）
FIXES = [
    # 法院层级专有名词修复
    ("最高人民法院", "最高人民法院"),
    ("最高人民法院", "最高人民法院"),
    ("高级人民法院", "高级人民法院"),
    ("中级人民法院", "中级人民法院"),
    ("基层人民法院", "基层人民法院"),
    ("地方各级人民法院", "地方各级人民法院"),
    # 通用修复：把错误替换的"仲裁机构"改回"法院"（在特定上下文中）
    ("人民法院", "人民法院"),
    ("区人民法院", "区人民法院"),
    ("县人民法院", "县人民法院"),
    ("市人民法院", "市人民法院"),
    ("省人民法院", "省人民法院"),
    # 案号中的民初/民终等不应变（但这个可能没被改）
]

def fix_file(path: Path) -> int:
    """修复一个文件"""
    try:
        content = path.read_text(encoding='utf-8')
    except:
        return 0
    
    original = content
    
    for old, new in FIXES:
        if old in content:
            content = content.replace(old, new)
    
    if content != original:
        path.write_text(content, encoding='utf-8')
        return 1
    return 0

def main():
    fixed = 0
    scanned = 0
    
    # 扫描所有 .md/.py/.json 文件
    for ext in ['*.md', '*.py', '*.json']:
        for path in PROJECT_ROOT.rglob(ext):
            # 排除 node_modules、__pycache__、.git 等
            parts = path.parts
            skip = False
            for p in parts:
                if p.startswith('.') or p in ('node_modules', '__pycache__', '.git', 'venv', '.venv'):
                    skip = True
                    break
            if skip:
                continue
            
            scanned += 1
            result = fix_file(path)
            if result > 0:
                fixed += 1
                rel = path.relative_to(PROJECT_ROOT)
                print(f"  ✅ 已修复: {rel}")
    
    print(f"\n扫描: {scanned} 个文件")
    print(f"修复: {fixed} 个文件")

if __name__ == "__main__":
    main()
