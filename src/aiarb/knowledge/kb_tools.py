# -*- coding: utf-8 -*-
"""Knowledge base tools — frontmatter parsing, wikilink extraction, DSL queries.

This module provides the property / backlink / DSL query layer for the
AIArb knowledge base. It operates on Markdown files with YAML frontmatter
stored under ``<working_dir>/knowledge/``.

Usage as a CLI::

    python kb_tools.py tag 仲裁法
    python kb_tools.py dsl tag:仲裁法 status:已核阅
    python kb_tools.py backlinks 仲裁法第16条
    python kb_tools.py graph

Usage as a Python module::

    from aiarb.knowledge.kb_tools import by_tag, backlinks, query_dsl
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import yaml


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

def _knowledge_dir() -> Path:
    """Resolve the knowledge base directory under the current working dir."""
    from aiarb.config import config as _cfg
    working_dir = Path(_cfg.working_dir).expanduser()
    return working_dir / "knowledge"


def _iter_markdown(kb_dir: Path | None = None) -> list[Path]:
    """Yield all .md files under the knowledge directory, sorted."""
    base = kb_dir or _knowledge_dir()
    if not base.is_dir():
        return []
    return sorted(base.rglob("*.md"))


# ---------------------------------------------------------------------------
# Frontmatter & wikilink parsing
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Split a Markdown file into (frontmatter_dict, body_text).

    Returns ``({}, content)`` if no frontmatter is present.
    """
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return {}, content
    yaml_str = match.group(1)
    body = content[match.end():]
    try:
        meta = yaml.safe_load(yaml_str) or {}
        if not isinstance(meta, dict):
            meta = {}
    except yaml.YAMLError:
        meta = {}
    return meta, body


def extract_wikilinks(content: str) -> list[str]:
    """Extract all ``[[wikilink]]`` targets from text."""
    return _WIKILINK_RE.findall(content)


def _read_md(path: Path) -> dict[str, Any]:
    """Read a single Markdown file and return a structured record."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return {}
    meta, body = parse_frontmatter(text)
    links = extract_wikilinks(body)
    title = meta.get("title") or path.stem
    return {
        "path": str(path.relative_to(_knowledge_dir())).replace("\\", "/"),
        "file_name": path.name,
        "title": title,
        "tags": meta.get("tags", []) if isinstance(meta.get("tags"), list) else ([meta.get("tags")] if meta.get("tags") else []),
        "status": meta.get("status", ""),
        "aliases": meta.get("aliases", []) if isinstance(meta.get("aliases"), list) else [],
        "summary": meta.get("summary", ""),
        "date": meta.get("date", ""),
        "frontmatter": meta,
        "body": body,
        "wikilinks": links,
        "size": path.stat().st_size if path.exists() else 0,
    }


# ---------------------------------------------------------------------------
# Query functions
# ---------------------------------------------------------------------------

def all_entries() -> list[dict[str, Any]]:
    """Return all knowledge base entries (metadata only, no body)."""
    out = []
    for p in _iter_markdown():
        rec = _read_md(p)
        if rec:
            out.append({k: v for k, v in rec.items() if k != "body"})
    return out


def by_tag(tag: str) -> list[dict[str, Any]]:
    """Find all entries that have the given tag."""
    tag_lower = tag.lower().strip()
    return [
        e for e in all_entries()
        if any(t.lower() == tag_lower for t in e.get("tags", []))
    ]


def by_status(status: str) -> list[dict[str, Any]]:
    """Find all entries with the given status."""
    return [
        e for e in all_entries()
        if e.get("status", "").lower() == status.lower().strip()
    ]


def backlinks(target: str) -> list[dict[str, Any]]:
    """Find all entries that link TO the given target via [[wikilink]].

    Matching is case-insensitive and also checks aliases.
    """
    target_lower = target.lower().strip()
    results = []
    for p in _iter_markdown():
        rec = _read_md(p)
        if not rec:
            continue
        # Check if any wikilink matches the target
        matched = False
        for link in rec.get("wikilinks", []):
            if link.lower().strip() == target_lower:
                matched = True
                break
        if matched:
            results.append({k: v for k, v in rec.items() if k != "body"})
    return results


def forward_links(path: str) -> list[str]:
    """Return all wikilink targets that the given file links to."""
    kb_dir = _knowledge_dir()
    full = kb_dir / path
    if not full.is_file():
        return []
    rec = _read_md(full)
    return rec.get("wikilinks", [])


def search_attributes(**kwargs) -> list[dict[str, Any]]:
    """Filter entries by arbitrary frontmatter attributes.

    Example: search_attributes(status="已核阅", author="张三")
    """
    results = []
    for e in all_entries():
        fm = e.get("frontmatter", {})
        if all(str(fm.get(k, "")).lower() == str(v).lower() for k, v in kwargs.items()):
            results.append(e)
    return results


def all_tags() -> dict[str, int]:
    """Return a {tag: count} mapping of all tags across the knowledge base."""
    counter: Counter = Counter()
    for e in all_entries():
        for t in e.get("tags", []):
            counter[t] += 1
    return dict(counter.most_common())


def full_text_search(query: str) -> list[dict[str, Any]]:
    """Simple full-text search across all Markdown files.

    Returns entries whose body or title contains the query string.
    """
    query_lower = query.lower().strip()
    if not query_lower:
        return []
    results = []
    for p in _iter_markdown():
        rec = _read_md(p)
        if not rec:
            continue
        body_lower = rec.get("body", "").lower()
        title_lower = rec.get("title", "").lower()
        if query_lower in body_lower or query_lower in title_lower:
            # Find snippet around first match
            idx = body_lower.find(query_lower)
            snippet = ""
            if idx >= 0:
                start = max(0, idx - 40)
                end = min(len(rec["body"]), idx + len(query_lower) + 80)
                snippet = ("..." if start > 0 else "") + rec["body"][start:end] + ("..." if end < len(rec["body"]) else "")
            results.append({
                **{k: v for k, v in rec.items() if k != "body"},
                "snippet": snippet,
                "match_count": body_lower.count(query_lower),
            })
    return results


def build_graph() -> dict[str, Any]:
    """Build a knowledge graph: nodes (entries) + edges (wikilinks).

    Returns ``{"nodes": [...], "edges": [...], "tags": {...}}``.
    """
    entries = all_entries()
    nodes = []
    edges = []
    title_to_path: dict[str, str] = {}

    # Build title index
    for e in entries:
        title_to_path[e["title"].lower()] = e["path"]
        for alias in e.get("aliases", []):
            title_to_path[alias.lower()] = e["path"]

    # Build nodes
    for e in entries:
        nodes.append({
            "id": e["path"],
            "title": e["title"],
            "tags": e.get("tags", []),
            "status": e.get("status", ""),
            "path": e["path"],
        })

    # Build edges from wikilinks
    seen_edges: set[tuple[str, str]] = set()
    for e in entries:
        source = e["path"]
        for link in e.get("wikilinks", []):
            target_path = title_to_path.get(link.lower().strip())
            if target_path and target_path != source:
                edge_key = (source, target_path)
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    edges.append({
                        "source": source,
                        "target": target_path,
                        "label": link,
                    })

    return {
        "nodes": nodes,
        "edges": edges,
        "tags": all_tags(),
        "stats": {
            "total_files": len(entries),
            "total_links": len(edges),
            "total_tags": len(all_tags()),
        },
    }


def query_dsl(dsl: str) -> list[dict[str, Any]]:
    """Execute a simple DSL query.

    Supported filters (space-separated, AND logic):
        tag:仲裁法          — filter by tag
        status:已核阅        — filter by status
        backlinks:仲裁法第16条 — entries that link to this target
        links:北仲规则       — entries that this one links to (forward)
        title:仲裁           — title contains text
        text:仲裁协议        — full-text search

    Example: ``tag:仲裁法 status:已核阅 text:管辖``
    """
    parts = dsl.strip().split()
    if not parts:
        return []

    # Parse each filter
    tag_filters: list[str] = []
    status_filters: list[str] = []
    backlink_filters: list[str] = []
    forward_filters: list[str] = []
    title_filters: list[str] = []
    text_filters: list[str] = []

    for part in parts:
        if ":" not in part:
            text_filters.append(part)
            continue
        key, _, val = part.partition(":")
        key = key.lower().strip()
        val = val.strip()
        if not val:
            continue
        if key == "tag":
            tag_filters.append(val)
        elif key == "status":
            status_filters.append(val)
        elif key == "backlinks":
            backlink_filters.append(val)
        elif key in ("links", "forward"):
            forward_filters.append(val)
        elif key == "title":
            title_filters.append(val)
        elif key in ("text", "q", "search"):
            text_filters.append(val)

    # Start with all entries
    results = all_entries()

    # Apply tag filters
    for tag in tag_filters:
        tag_lower = tag.lower()
        results = [e for e in results if any(t.lower() == tag_lower for t in e.get("tags", []))]

    # Apply status filters
    for status in status_filters:
        results = [e for e in results if e.get("status", "").lower() == status.lower()]

    # Apply title filters
    for title_q in title_filters:
        results = [e for e in results if title_q.lower() in e.get("title", "").lower()]

    # Apply backlink filters (entries that link to target)
    for target in backlink_filters:
        bl_results = {e["path"] for e in backlinks(target)}
        results = [e for e in results if e["path"] in bl_results]

    # Apply forward link filters (entries that link from target)
    for target in forward_filters:
        fl_results = {e["path"] for e in backlinks(target)}  # Simplified
        results = [e for e in results if e["path"] in fl_results]

    # Apply text filters
    for text_q in text_filters:
        fts_results = {e["path"] for e in full_text_search(text_q)}
        results = [e for e in results if e["path"] in fts_results]

    return results


def get_file_content(path: str) -> dict[str, Any] | None:
    """Read a single file by relative path and return full content."""
    kb_dir = _knowledge_dir()
    full = kb_dir / path
    if not full.is_file():
        return None
    rec = _read_md(full)
    if not rec:
        return None
    # Enrich with backlinks
    rec["backlinks"] = backlinks(rec["title"])
    return rec


def file_tree() -> list[dict[str, Any]]:
    """Return a tree structure of the knowledge directory."""
    kb_dir = _knowledge_dir()
    if not kb_dir.is_dir():
        return []

    tree: list[dict[str, Any]] = []

    def _build(node: Path, tree_node: list[dict[str, Any]]) -> None:
        for child in sorted(node.iterdir()):
            if child.name.startswith(".") or child.name.startswith("_"):
                continue
            rel = str(child.relative_to(kb_dir)).replace("\\", "/")
            entry: dict[str, Any] = {
                "name": child.name,
                "path": rel,
                "is_dir": child.is_dir(),
            }
            if child.is_dir():
                entry["children"] = []
                _build(child, entry["children"])
            else:
                entry["size"] = child.stat().st_size
            tree_node.append(entry)

    _build(kb_dir, tree)
    return tree


def statistics() -> dict[str, Any]:
    """Return overall knowledge base statistics."""
    entries = all_entries()
    tags = all_tags()
    statuses = Counter(e.get("status", "") for e in entries)

    total_links = sum(len(e.get("wikilinks", [])) for e in entries)
    return {
        "total_files": len(entries),
        "total_tags": len(tags),
        "total_links": total_links,
        "tags": tags,
        "statuses": dict(statuses.most_common()),
        "recent_files": sorted(
            entries,
            key=lambda e: e.get("date", ""),
            reverse=True,
        )[:10],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cli() -> int:
    if len(sys.argv) < 2:
        print("Usage: python kb_tools.py <command> [args]")
        print("Commands: tag, status, backlinks, forward, tags, search, dsl, graph, file, tree, stats")
        return 1

    cmd = sys.argv[1]
    if cmd == "tag" and len(sys.argv) > 2:
        print(json.dumps(by_tag(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "status" and len(sys.argv) > 2:
        print(json.dumps(by_status(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "backlinks" and len(sys.argv) > 2:
        print(json.dumps(backlinks(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "forward" and len(sys.argv) > 2:
        print(json.dumps(forward_links(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "tags":
        print(json.dumps(all_tags(), ensure_ascii=False, indent=2))
    elif cmd == "search" and len(sys.argv) > 2:
        print(json.dumps(full_text_search(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "dsl" and len(sys.argv) > 2:
        print(json.dumps(query_dsl(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "graph":
        print(json.dumps(build_graph(), ensure_ascii=False, indent=2))
    elif cmd == "file" and len(sys.argv) > 2:
        print(json.dumps(get_file_content(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "tree":
        print(json.dumps(file_tree(), ensure_ascii=False, indent=2))
    elif cmd == "stats":
        print(json.dumps(statistics(), ensure_ascii=False, indent=2))
    else:
        print(f"Unknown command: {cmd}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
