# -*- coding: utf-8 -*-
"""任务接口：建立/更新/导出/下载。每次更改递增 task_revision；导出前核对版本一致性。"""
import json
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..knowledge.loader import get_kb
from ..models import store
from ..rules.engine import evaluate_rules
from ..documents.renderer import render_document, TEMPLATES

router = APIRouter()


@router.post("/api/v1/tasks")
def create_task(body: dict):
    kb = get_kb()
    flow_id = body.get("flow_id")
    if flow_id not in kb.flows:
        raise HTTPException(400, "未知 flow_id")
    session_id = body.get("session_id") or store.new_session()
    slots = body.get("slots") or {}
    rule_results, _ = evaluate_rules(flow_id, slots)
    task_id = store.create_task(session_id, flow_id, slots, rule_results, kb.kb_version)
    return {"task_id": task_id, "session_id": session_id, "revision": 1,
            "rule_results": rule_results, "kb_version": kb.kb_version}


@router.get("/api/v1/tasks/{task_id}")
def get_task(task_id: str):
    row = store.get_task(task_id)
    if not row:
        raise HTTPException(404, "任务不存在")
    kb = get_kb()
    flow = kb.flows.get(row["flow_id"], {})
    return {
        "task_id": row["task_id"], "session_id": row["session_id"], "flow_id": row["flow_id"],
        "flow_name": flow.get("name"), "demo_notice": flow.get("demo_notice"),
        "revision": row["revision"], "current_step": row["current_step"], "slots": row["slots"],
        "required_slots": flow.get("required_slots", []), "steps": flow.get("steps", []),
        "materials": flow.get("materials", []), "timeline": flow.get("timeline", []),
        "rule_results": row["rule_results"], "kb_version": row["kb_version"],
        "artifacts": store.list_artifacts(task_id),
        "contact": flow.get("contact"),
    }


@router.patch("/api/v1/tasks/{task_id}")
def update_task(task_id: str, body: dict):
    kb = get_kb()
    row = store.get_task(task_id)
    if not row:
        raise HTTPException(404, "任务不存在")
    flow_id = row["flow_id"]
    slots = body.get("slots")
    bump = bool(body.get("bump_revision", True)) and slots is not None
    rule_results = None
    if slots is not None:
        rule_results, _ = evaluate_rules(flow_id, slots)
    updated = store.update_task(task_id, slots=slots, rule_results=rule_results,
                                current_step=body.get("current_step"), bump_revision=bump)
    flow = kb.flows[flow_id]
    return {
        "task_id": task_id, "revision": updated["revision"], "current_step": updated["current_step"],
        "slots": updated["slots"], "rule_results": updated["rule_results"],
        "kb_version": updated["kb_version"],
        "required_slots": flow.get("required_slots", []),
        "steps": flow.get("steps", []), "materials": flow.get("materials", []),
        "flow_name": flow.get("name"), "demo_notice": flow.get("demo_notice"),
        "timeline": flow.get("timeline", []),
    }


@router.delete("/api/v1/tasks/{task_id}")
def delete_task(task_id: str):
    row = store.get_task(task_id)
    if not row:
        raise HTTPException(404, "任务不存在")
    store.delete_task(task_id)
    return {"deleted": task_id}


@router.post("/api/v1/tasks/{task_id}/exports")
def export_task(task_id: str, body: dict = None):
    """导出前检查：任务版本、规则版本和模板版本一致（方案 7.5）。"""
    kb = get_kb()
    row = store.get_task(task_id)
    if not row:
        raise HTTPException(404, "任务不存在")
    flow = kb.flows.get(row["flow_id"])
    if not flow:
        raise HTTPException(400, "流程配置缺失")
    template_id = (body or {}).get("template_id") or flow.get("template_id")
    if template_id not in TEMPLATES:
        raise HTTPException(400, "未知模板")

    # 版本一致性检查
    if row["kb_version"] != kb.kb_version:
        return {"status": "version_mismatch",
                "summary": "知识版本已更新，请先在预览中重新核对相关步骤再导出。",
                "task_kb_version": row["kb_version"], "current_kb_version": kb.kb_version}

    fmt = (body or {}).get("format", "docx")
    rule_results = json.loads(row["rule_results"]) if isinstance(row["rule_results"], str) else row["rule_results"]
    result = render_document(row["flow_id"], template_id, row, rule_results)

    arts = []
    for key in ("main", "basis"):
        info = result[key]
        artifact_id = store.save_artifact(
            task_id, row["revision"], result["template_version"], "docx",
            info["path"], info["filename"], result["evidence_manifest"])
        arts.append({"artifact_id": artifact_id, "kind": key, "filename": info["filename"],
                     "template_version": result["template_version"]})
    return {"status": "exported", "artifacts": arts,
            "task_revision": row["revision"], "kb_version": kb.kb_version}


@router.get("/api/v1/artifacts/{artifact_id}")
def download_artifact(artifact_id: str):
    art = store.get_artifact(artifact_id)
    if not art:
        raise HTTPException(404, "文件不存在或已过期")
    p = Path(art["path"])
    if not p.exists():
        raise HTTPException(410, "文件已失效")
    return FileResponse(str(p), filename=art["filename"],
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@router.get("/api/v1/tasks")
def list_tasks(session_id: str):
    rows = store.list_tasks(session_id)
    out = []
    for row in rows:
        flow = get_kb().flows.get(row["flow_id"], {})
        out.append({"task_id": row["task_id"], "flow_id": row["flow_id"], "flow_name": flow.get("name"),
                    "revision": row["revision"], "current_step": row["current_step"],
                    "updated_at": row["updated_at"]})
    return {"tasks": out}
