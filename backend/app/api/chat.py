# -*- coding: utf-8 -*-
"""POST /legacy/api/v1/chat：历史兼容入口（旧 React 原型）。

开发期保留：内部与 Vue 版共用同一对话图（模型优先 + 工具调用 + 校验发布），
把 ChatResponse 映射为旧结构的 summary/message/citations 等字段。
旧原型的 task 直创流程不再提供——向导统一经 workflow 状态进入。
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from ..agent import graph
from ..knowledge.loader import get_kb
from ..models import store

router = APIRouter()


class ChatRequest(dict):
    pass


@router.post("/api/v1/chat")
def chat(body: dict):
    message = (body.get("message") or "").strip()
    session_id = body.get("session_id")
    if not message:
        raise HTTPException(400, "message 不能为空")
    if not session_id:
        session_id = store.new_session()
    elif not store.get_session(session_id):
        session_id = store.new_session()

    store.update_session(session_id, last_query=message)
    result = graph.run_turn(session_id, "legacy-" + uuid.uuid4().hex[:8], message,
                            slots={}, entrypoint="legacy", history=[])
    final = result["final"]
    citations = [
        {"evidence_id": c["id"], "title": c["title"], "issuer": c["issuer"],
         "source_url": c.get("url"), "locator": c.get("locator"),
         "exact_text": c.get("excerpt"), "time_condition": c.get("time_condition")}
        for c in final.get("citations") or []
    ]
    clarify = final.get("clarify") or {}
    resp = {
        "status": final["status"],
        "summary": final.get("message") or "",
        "message": final.get("message") or "",
        "citations": citations,
        "facts": [],
        "scope": {},
        "next_actions": [],
        "kb_version": get_kb().kb_version,
        "session_id": session_id,
        "error_code": final.get("reason_code"),
    }
    if final["status"] == "clarify":
        resp["clarify"] = {
            "question": clarify.get("question"),
            "options": [c["label"] for c in clarify.get("choices") or []],
            "kind": "model",
        }
    if final["status"] == "workflow" and final.get("workflow"):
        wf = final["workflow"]
        resp["next_actions"] = [{"type": "start_flow", "label": "进入办理向导", "flow_id": wf["flow_id"]}]
    return resp
