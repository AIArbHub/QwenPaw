#!/usr/bin/env python3
"""Fetch arbitration knowledge-base sources from official URLs.

Design notes
------------
* Sources live in ``scripts/kb_sources.json``. An entry with an empty
  ``url`` is skipped and reported as a TODO — **never guess a URL**.
* Downloads are plain HTTP GETs with a browser UA. Most arbitration
  institution sites are JS-rendered SPAs, so this works with *direct*
  links (PDF / static HTML) rather than listing pages.
* PDF is converted with ``markitdown`` when available, falling back to
  ``pypdf``. HTML is converted with ``html2text``.
* Every written file gets a SCHEMA-compliant YAML frontmatter.

Usage
-----
    python scripts/fetch_kb_sources.py --list
    python scripts/fetch_kb_sources.py --set-url 仲裁法-2026 <url>
    python scripts/fetch_kb_sources.py --category laws --dry-run
    python scripts/fetch_kb_sources.py --category rules
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES_JSON = ROOT / "scripts" / "kb_sources.json"
KB_DIR = ROOT / "src" / "aiarb" / "knowledge_base"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TIMEOUT = 45


def load_sources() -> dict:
    return json.loads(SOURCES_JSON.read_text(encoding="utf-8"))


def save_sources(data: dict) -> None:
    SOURCES_JSON.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        dest.write_bytes(resp.read())


def to_markdown(src: Path) -> str:
    suffix = src.suffix.lower()
    if suffix == ".pdf":
        return _pdf_to_text(src)
    if suffix in {".html", ".htm"}:
        return _html_to_text(src)
    return src.read_text(encoding="utf-8", errors="replace")


def _pdf_to_text(src: Path) -> str:
    try:
        from markitdown import MarkItDown

        return MarkItDown().convert(str(src)).text_content
    except Exception:
        pass
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(src))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:
        raise RuntimeError(
            "PDF conversion needs `markitdown` or `pypdf`; install one of them.",
        ) from exc


def _html_to_text(src: Path) -> str:
    raw = src.read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"(?is)<(script|style).*?</\1>", "", raw)
    try:
        import html2text

        return html2text.HTML2Text(bodywidth=0).handle(raw)
    except Exception:
        raw = re.sub(r"(?s)<[^>]+>", "\n", raw)
        return re.sub(r"\n{3,}", "\n\n", raw).strip()


def _yaml_escape(value: str) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_frontmatter(fields: dict[str, str], tags: list[str]) -> str:
    lines = ["---"]
    for key, value in fields.items():
        lines.append(f"{key}: {_yaml_escape(value)}")
    lines.append(f"tags: [{', '.join(tags)}]")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def write_entry(
    category: str,
    filename: str,
    body: str,
    fields: dict[str, str],
    tags: list[str],
) -> Path:
    target_dir = KB_DIR / category
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / filename
    target.write_text(
        build_frontmatter(fields, tags) + body.strip() + "\n",
        encoding="utf-8",
    )
    return target


def safe_name(text: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", text).strip("-")


def run_fetch(category: str, dry_run: bool) -> int:
    data = load_sources()
    entries = data.get(category, [])
    if not entries:
        print(f"[warn] no entries for category: {category}")
        return 1

    today = date.today().isoformat()
    todo, done, failed = [], [], []

    for item in entries:
        url = (item.get("url") or "").strip()
        label = item.get("id") or item.get("title") or "?"
        if not url:
            todo.append(label)
            continue

        print(f"[fetch] {label} <- {url}")
        if dry_run:
            done.append(label)
            continue

        tmp = Path(sys.argv[0]).parent / f"._dl_{safe_name(label)}"
        try:
            try:
                download(url, tmp)
                body = to_markdown(tmp)
            finally:
                if tmp.exists():
                    tmp.unlink()

            if not body.strip():
                raise RuntimeError("converted content is empty")

            if category == "laws":
                filename = f"{safe_name(item['title'])}-{safe_name(item.get('version') or '现行')}.md"
                fields = {
                    "title": item["title"],
                    "category": "laws",
                    "law_level": item.get("level", "法律"),
                    "institution": item.get("institution", ""),
                    "version": item.get("version", ""),
                    "effective_date": item.get("effective_date", ""),
                    "jurisdiction": item.get("jurisdiction", "中国大陆"),
                    "source": url,
                    "source_type": "official",
                    "retrieved": today,
                    "copyright": "法律法规不受著作权保护",
                    "confidence": "draft",
                }
                tags = [item.get("level", "法律"), item.get("institution", "")]
            else:
                filename = f"{item['id']}-仲裁规则-{safe_name(item.get('version') or '现行')}.md"
                fields = {
                    "title": f"{item['institution']}仲裁规则",
                    "category": "rules",
                    "institution": item.get("institution", ""),
                    "institution_abbr": item.get("id", ""),
                    "rule_type": "仲裁规则",
                    "version": item.get("version", ""),
                    "effective_date": item.get("effective_date", ""),
                    "jurisdiction": item.get("jurisdiction", "中国大陆"),
                    "source": url,
                    "source_type": "official",
                    "retrieved": today,
                    "copyright": "机构公开文本",
                    "confidence": "draft",
                }
                tags = [item.get("id", ""), "仲裁规则"]

            path = write_entry(category, filename, body, fields, [t for t in tags if t])
            print(f"[ok   ] {path.relative_to(ROOT)} ({len(body)} chars)")
            done.append(label)
        except Exception as exc:
            print(f"[fail ] {label}: {exc}")
            failed.append(label)

    print("-" * 60)
    print(f"done={len(done)} failed={len(failed)} todo(no url)={len(todo)}")
    if todo:
        print("待补官方直链：" + "、".join(todo))
    print("提示：confidence 默认 draft，请与原文核对后改为 verified。")
    return 0


def run_list() -> int:
    data = load_sources()
    for category in ("rules", "laws"):
        print(f"### {category}")
        for item in data.get(category, []):
            label = item.get("id") or item.get("title")
            url = (item.get("url") or "").strip()
            state = "待补直链" if not url else "已配置"
            detail = ""
            if category == "rules":
                detail = " / ".join(item.get("rules", []))
            print(f"  [{state}] {label}  {detail}")
        print()
    return 0


def run_set_url(target_id: str, url: str) -> int:
    data = load_sources()
    for category in ("rules", "laws"):
        for item in data.get(category, []):
            if item.get("id") == target_id:
                item["url"] = url
                save_sources(data)
                print(f"已设置 {target_id} -> {url}")
                return 0
    print(f"[error] 未找到 id: {target_id}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="list sources and status")
    parser.add_argument("--category", choices=["rules", "laws"], help="fetch one category")
    parser.add_argument("--set-url", nargs=2, metavar=("ID", "URL"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.list:
        return run_list()
    if args.set_url:
        return run_set_url(*args.set_url)
    if args.category:
        return run_fetch(args.category, dry_run=args.dry_run)
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
