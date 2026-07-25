# -*- coding: utf-8 -*-
"""Award review API routes — review checklist, comparison, annotations.

Prefix: ``/review``
Provides a structured review workbench for arbitration awards:
- Review templates (checklist items grouped by category)
- Review sessions (per-case review tracking)
- Annotations (per-item comments)
- Knowledge base sidebar integration
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from ...knowledge import kb_tools


def _review_dir() -> Path:
    """Return the review storage directory."""
    from aiarb.config import config as _cfg
    working_dir = Path(_cfg.working_dir).expanduser()
    d = working_dir / "reviews"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _review_path(review_id: str) -> Path:
    return _review_dir() / f"{review_id}.json"


def _load_review(review_id: str) -> dict[str, Any] | None:
    p = _review_path(review_id)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_review(data: dict[str, Any]) -> None:
    p = _review_path(data["id"])
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Default review template
# ---------------------------------------------------------------------------

DEFAULT_TEMPLATE: dict[str, Any] = {
    "id": "default-arbitration",
    "name": "仲裁裁决核阅清单",
    "categories": [
        {
            "id": "info-verify",
            "name": "信息核验",
            "items": [
                {"id": "1.1", "title": "当事人信息", "desc": "申请人与被申请人名称、地址、联系方式准确无误"},
                {"id": "1.2", "title": "仲裁庭组成", "desc": "仲裁员人数、选任程序符合规则"},
                {"id": "1.3", "title": "管辖权", "desc": "仲裁协议有效，仲裁机构有管辖权"},
                {"id": "1.4", "title": "案件编号", "desc": "案件编号、受理日期准确"},
            ],
        },
        {
            "id": "procedure",
            "name": "程序核验",
            "items": [
                {"id": "2.1", "title": "送达程序", "desc": "仲裁申请书、答辩通知等已依法送达"},
                {"id": "2.2", "title": "答辩权利", "desc": "被申请人答辩权利得到保障"},
                {"id": "2.3", "title": "开庭通知", "desc": "开庭时间、地点已提前通知各方"},
                {"id": "2.4", "title": "回避程序", "desc": "回避申请已依法处理"},
                {"id": "2.5", "title": "质证程序", "desc": "证据已当庭出示并质证"},
            ],
        },
        {
            "id": "substance",
            "name": "实体核验",
            "items": [
                {"id": "3.1", "title": "请求审查", "desc": "仲裁请求明确、具体、可执行"},
                {"id": "3.2", "title": "事实认定", "desc": "事实认定有证据支持，逻辑清晰"},
                {"id": "3.3", "title": "法律适用", "desc": "适用法律正确，引用法条准确"},
                {"id": "3.4", "title": "裁决主文", "desc": "裁决主文明确、完整、可执行"},
                {"id": "3.5", "title": "计算核验", "desc": "金额计算（利息、费用等）准确无误"},
            ],
        },
        {
            "id": "format",
            "name": "格式核验",
            "items": [
                {"id": "4.1", "title": "签署", "desc": "仲裁员签名、日期、印章齐全"},
                {"id": "4.2", "title": "文书格式", "desc": "符合仲裁文书格式规范"},
                {"id": "4.3", "title": "语言文字", "desc": "用语规范，无错别字、语法错误"},
            ],
        },
    ],
}


def build_router() -> APIRouter:
    router = APIRouter(prefix="/review", tags=["award-review"])

    # ── Templates ─────────────────────────────────────────────────

    @router.get("/templates")
    def list_templates():
        """List available review templates."""
        return {"ok": True, "templates": [DEFAULT_TEMPLATE]}

    @router.get("/templates/{template_id}")
    def get_template(template_id: str):
        """Get a specific review template."""
        if template_id == DEFAULT_TEMPLATE["id"]:
            return {"ok": True, "template": DEFAULT_TEMPLATE}
        raise HTTPException(status_code=404, detail="template not found")

    # ── Review sessions ───────────────────────────────────────────

    class ReviewDocumentItem(BaseModel):
        """A document attached to a review session."""
        name: str = ""
        path: str = ""
        type: str = ""

    class CreateReviewRequest(BaseModel):
        model_config = ConfigDict(extra="ignore")
        case_name: str
        case_id: str | None = None
        template_id: str = "default-arbitration"
        documents: list[ReviewDocumentItem] | None = None

    @router.post("/create")
    def create_review(payload: CreateReviewRequest):
        """Create a new review session from a template."""
        template = DEFAULT_TEMPLATE if payload.template_id == DEFAULT_TEMPLATE["id"] else None
        if not template:
            raise HTTPException(status_code=404, detail="template not found")

        review_id = f"review-{uuid.uuid4().hex[:12]}"
        now = datetime.utcnow().isoformat() + "Z"

        # Initialize items with default status
        items: list[dict[str, Any]] = []
        for cat in template["categories"]:
            for item in cat["items"]:
                items.append({
                    "id": item["id"],
                    "category_id": cat["id"],
                    "category_name": cat["name"],
                    "title": item["title"],
                    "desc": item["desc"],
                    "status": "pending",  # pending / pass / need_fix / fail
                    "annotation": "",
                    "updated_at": now,
                })

        review = {
            "id": review_id,
            "case_name": payload.case_name,
            "case_id": payload.case_id,
            "template_id": template["id"],
            "documents": [d.model_dump() if hasattr(d, "model_dump") else d for d in (payload.documents or [])],
            "items": items,
            "status": "in_progress",  # in_progress / completed / archived
            "created_at": now,
            "updated_at": now,
            "summary": {
                "total": len(items),
                "passed": 0,
                "failed": 0,
                "pending": len(items),
            },
        }
        _save_review(review)
        return {"ok": True, "review": review}

    @router.get("/list")
    def list_reviews():
        """List all review sessions."""
        reviews = []
        for p in sorted(_review_dir().glob("*.json"), reverse=True):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                reviews.append({
                    "id": data["id"],
                    "case_name": data.get("case_name", ""),
                    "case_id": data.get("case_id"),
                    "status": data.get("status", "in_progress"),
                    "created_at": data.get("created_at", ""),
                    "updated_at": data.get("updated_at", ""),
                    "summary": data.get("summary", {}),
                })
            except Exception:
                continue
        return {"ok": True, "reviews": reviews}

    @router.get("/{review_id}")
    def get_review(review_id: str):
        """Get a full review session."""
        review = _load_review(review_id)
        if not review:
            raise HTTPException(status_code=404, detail="review not found")
        return {"ok": True, "review": review}

    @router.delete("/{review_id}")
    def delete_review(review_id: str):
        """Delete a review session."""
        p = _review_path(review_id)
        if not p.is_file():
            raise HTTPException(status_code=404, detail="review not found")
        p.unlink()
        return {"ok": True}

    class UpdateItemRequest(BaseModel):
        model_config = ConfigDict(extra="ignore")
        item_id: str
        status: str  # pending / pass / need_fix / fail
        annotation: str | None = None

    @router.put("/{review_id}/item")
    def update_item(review_id: str, payload: UpdateItemRequest):
        """Update a single review item's status and annotation."""
        review = _load_review(review_id)
        if not review:
            raise HTTPException(status_code=404, detail="review not found")

        if payload.status not in ("pending", "pass", "need_fix", "fail"):
            raise HTTPException(status_code=400, detail="invalid status")

        now = datetime.utcnow().isoformat() + "Z"
        updated = False
        for item in review["items"]:
            if item["id"] == payload.item_id:
                item["status"] = payload.status
                if payload.annotation is not None:
                    item["annotation"] = payload.annotation
                item["updated_at"] = now
                updated = True
                break

        if not updated:
            raise HTTPException(status_code=404, detail="item not found")

        # Recompute summary
        passed = sum(1 for i in review["items"] if i["status"] == "pass")
        failed = sum(1 for i in review["items"] if i["status"] in ("fail", "need_fix"))
        pending = sum(1 for i in review["items"] if i["status"] == "pending")
        review["summary"] = {
            "total": len(review["items"]),
            "passed": passed,
            "failed": failed,
            "pending": pending,
        }
        review["updated_at"] = now

        if pending == 0 and failed == 0:
            review["status"] = "completed"
        elif pending == 0:
            review["status"] = "completed"

        _save_review(review)
        return {"ok": True, "review": review}

    class AddAnnotationRequest(BaseModel):
        model_config = ConfigDict(extra="ignore")
        item_id: str
        annotation: str

    @router.post("/{review_id}/annotation")
    def add_annotation(review_id: str, payload: AddAnnotationRequest):
        """Add an annotation to a review item."""
        review = _load_review(review_id)
        if not review:
            raise HTTPException(status_code=404, detail="review not found")

        now = datetime.utcnow().isoformat() + "Z"
        for item in review["items"]:
            if item["id"] == payload.item_id:
                if item["annotation"]:
                    item["annotation"] += f"\n\n[{now}]\n{payload.annotation}"
                else:
                    item["annotation"] = f"[{now}]\n{payload.annotation}"
                item["updated_at"] = now
                _save_review(review)
                return {"ok": True, "item": item}

        raise HTTPException(status_code=404, detail="item not found")

    # ── Knowledge sidebar ─────────────────────────────────────────

    @router.get("/{review_id}/knowledge")
    def get_review_knowledge(review_id: str, q: str = ""):
        """Get relevant knowledge base entries for a review session.

        Performs a full-text search and returns matching entries for
        the knowledge sidebar.
        """
        review = _load_review(review_id)
        if not review:
            raise HTTPException(status_code=404, detail="review not found")

        # Search by case name if no query
        query = q.strip() or review.get("case_name", "")

        results: list[dict[str, Any]] = []
        if query:
            results = kb_tools.full_text_search(query)

        # Also search by item titles for relevant law
        law_keywords: list[str] = []
        for item in review["items"]:
            if item["status"] == "pending":
                law_keywords.append(item["title"])

        related: list[dict[str, Any]] = []
        for kw in law_keywords[:5]:
            r = kb_tools.full_text_search(kw)
            for entry in r[:2]:
                if entry["path"] not in {x["path"] for x in related}:
                    related.append(entry)

        return {
            "ok": True,
            "query": query,
            "results": results[:20],
            "related": related[:10],
            "tags": kb_tools.all_tags(),
        }

    # ── Export ────────────────────────────────────────────────────

    @router.get("/{review_id}/export")
    def export_review(review_id: str):
        """Export a review session as a Markdown report."""
        review = _load_review(review_id)
        if not review:
            raise HTTPException(status_code=404, detail="review not found")

        lines = [
            f"# 仲裁裁决核阅报告",
            f"",
            f"**案件名称**: {review.get('case_name', '')}",
            f"**案件编号**: {review.get('case_id', 'N/A')}",
            f"**核阅日期**: {review.get('updated_at', '')}",
            f"**核阅状态**: {review.get('status', '')}",
            f"",
            f"## 核阅概要",
            f"",
            f"- 总项数: {review['summary']['total']}",
            f"- 通过: {review['summary']['passed']}",
            f"- 需修改/不通过: {review['summary']['failed']}",
            f"- 待核验: {review['summary']['pending']}",
            f"",
        ]

        # Group by category
        cats: dict[str, list[dict]] = {}
        for item in review["items"]:
            cat = item.get("category_name", "其他")
            cats.setdefault(cat, []).append(item)

        for cat_name, items in cats.items():
            lines.append(f"## {cat_name}")
            lines.append("")
            for item in items:
                status_icon = {"pass": "✅", "fail": "❌", "need_fix": "⚠️", "pending": "⬜"}.get(item["status"], "⬜")
                lines.append(f"### {status_icon} {item['id']} {item['title']}")
                lines.append(f"{item['desc']}")
                if item.get("annotation"):
                    lines.append(f"\n> **批注**: {item['annotation']}")
                lines.append("")

        md = "\n".join(lines)
        return {"ok": True, "markdown": md, "filename": f"review_{review_id}.md"}

    return router
