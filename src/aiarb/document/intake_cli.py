# -*- coding: utf-8 -*-
"""CLI entry point for the document intake pipeline.

Usage:
    python -m aiarb.document.intake_cli <file_path> [--output DIR]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .intake import intake_document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="AIArb 文档 Intake 管道 — 将原始文档解析为 LDIR + 4 份产物",
    )
    parser.add_argument(
        "file_path",
        type=str,
        help="要解析的文档路径 (PDF/DOCX/TXT/MD)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="输出目录（默认为源文件旁的 working/）",
    )
    args = parser.parse_args(argv)

    src = Path(args.file_path).resolve()
    if not src.exists():
        print(f"错误: 文件不存在 — {src}", file=sys.stderr)
        return 1

    output_dir = Path(args.output).resolve() if args.output else None

    print(f"正在解析: {src.name}")
    result = intake_document(src, output_dir)

    # Save all 4 artifacts
    result.save_all()
    work_dir = result.working_dir

    print(f"\n✅ 解析完成，产出 4 份文件 → {work_dir}/")
    print(f"   1. {result.ldir.doc_id}.md")
    print(f"   2. {result.ldir.doc_id}.ldir.json")
    print(f"   3. {result.ldir.doc_id}.semantic.json")
    print(f"   4. {result.ldir.doc_id}_intake_report.json")
    print(f"\n   文档类型: {result.ldir.doc_type}")
    print(f"   类型置信度: {result.report.doc_type_confidence:.0%}")
    print(f"   页数: {result.report.page_count}")
    print(f"   字符数: {result.report.char_count}")
    print(f"   OCR 引擎: {result.report.ocr_engine}")
    print(f"   OCR 置信度: {result.report.ocr_confidence:.0%}")
    print(f"   建议人工复核: {'是' if result.report.human_review_recommended else '否'}")

    if result.report.warnings:
        print(f"\n⚠️ 警告:")
        for w in result.report.warnings:
            print(f"   - {w}")

    if result.report.recommendations:
        print(f"\n💡 建议:")
        for r in result.report.recommendations:
            print(f"   - {r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
