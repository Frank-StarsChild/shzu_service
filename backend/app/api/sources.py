# -*- coding: utf-8 -*-
"""来源中心接口与内部工具接口。来源卡由服务端来源表生成。"""
from fastapi import APIRouter, HTTPException

from ..knowledge.loader import get_kb
from ..knowledge.retriever import retrieve
from ..rules.engine import evaluate_rules

router = APIRouter()


@router.get("/api/v1/sources")
def list_sources(category: str = None):
    kb = get_kb()
    docs = []
    for d in kb.documents.values():
        if category and d.get("category") != category:
            continue
        clause_ids = [c["clause_id"] for c in kb.clauses.values() if c["doc_id"] == d["doc_id"]]
        docs.append({k: d.get(k) for k in ("doc_id", "title", "issuer", "source_url", "source_kind",
                                           "published_at", "document_year", "effective_from",
                                           "effective_to", "category", "review_state", "notes")})
        docs[-1]["clause_count"] = len(clause_ids)
    categories = sorted({d.get("category") for d in kb.documents.values() if d.get("category")})
    return {"documents": docs, "categories": categories, "kb_version": kb.kb_version}


@router.get("/api/v1/sources/{doc_id}")
def get_source(doc_id: str):
    kb = get_kb()
    doc = kb.documents.get(doc_id)
    if not doc:
        raise HTTPException(404, "来源不存在")
    clauses = [c for c in kb.clauses.values() if c["doc_id"] == doc_id]
    return {"document": doc, "clauses": clauses, "kb_version": kb.kb_version}


# ---------- 内部工具接口（平台 Workflow 节点按此调用） ----------

@router.post("/tools/retrieve-evidence")
def tool_retrieve(body: dict):
    query = body.get("query") or ""
    scope = body.get("scope") or {}
    top_k = int(body.get("top_k") or 6)
    facts, clauses, fh, ch = retrieve(query, scope=scope, top_k=top_k)
    kb = get_kb()
    return {
        "facts": facts, "clauses": clauses,
        "citations": kb.citations_for([c["clause_id"] for c in clauses]),
        "best_score": max([s for s, _ in fh] + [s for s, _ in ch], default=0.0),
        "kb_version": kb.kb_version,
    }


@router.post("/tools/evaluate-rules")
def tool_evaluate(body: dict):
    flow_id = body.get("flow_id")
    slots = body.get("slots") or {}
    if not flow_id:
        return {"error": "flow_id required"}
    results, derived = evaluate_rules(flow_id, slots)
    return {"flow_id": flow_id, "rule_results": results, "derived_slots": derived,
            "summary": {
                "pass": sum(1 for r in results if r["state"] == "pass"),
                "fail": sum(1 for r in results if r["state"] == "fail"),
                "unknown": sum(1 for r in results if r["state"] == "unknown"),
            }}


@router.post("/tools/render-document")
def tool_render(body: dict):
    """直接渲染工具（不经任务）：用于平台 Workflow 演示调用。"""
    from ..documents.renderer import render_document, TEMPLATES
    template_id = body.get("template_id")
    if template_id not in TEMPLATES:
        return {"error": "template_id required, one of: " + ", ".join(TEMPLATES)}
    task = {"task_id": body.get("task_id") or "tool-direct", "slots": body.get("slots") or {}}
    result = render_document(body.get("flow_id") or "venue_borrow", template_id, task, body.get("rule_results") or [])
    return {"status": "rendered", "files": [result["main"]["filename"], result["basis"]["filename"]],
            "template_version": result["template_version"], "evidence_manifest": result["evidence_manifest"]}
