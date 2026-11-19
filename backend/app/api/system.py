# -*- coding: utf-8 -*-
"""系统信息、流程配置与测试题接口。"""
import json
from pathlib import Path

from fastapi import APIRouter

from ..config import APP_NAME, BASE_DIR
from ..knowledge.loader import get_kb
from ..platform.adapter import platform_adapter_status

router = APIRouter()


@router.get("/api/v1/kb/info")
def kb_info():
    kb = get_kb()
    return {
        "app_name": APP_NAME,
        "kb_version": kb.kb_version,
        "document_count": len(kb.documents),
        "clause_count": len(kb.clauses),
        "fact_count": len(kb.facts),
        "flow_count": len(kb.flows),
        "rule_count": len(kb.rules),
        "categories": ["学工", "教务", "后勤", "保卫", "图书馆"],
        "disclaimer": "本系统仅基于已审定的官方资料回答；关键事实由结构化数据直接渲染，缺依据时明确说明，不编造。",
    }


@router.get("/api/v1/platform/status")
def platform_status():
    return platform_adapter_status()


@router.get("/api/v1/flows")
def list_flows():
    kb = get_kb()
    out = []
    for fid, f in kb.flows.items():
        out.append({"flow_id": fid, "name": f.get("name"), "version": f.get("version"),
                    "demo_notice": f.get("demo_notice"),
                    "applicable_scope": f.get("applicable_scope"),
                    "template_id": f.get("template_id")})
    return {"flows": out}


@router.get("/api/v1/flows/{flow_id}")
def get_flow(flow_id: str):
    kb = get_kb()
    flow = kb.flows.get(flow_id)
    if not flow:
        return {"error": "flow not found"}
    return {"flow_id": flow_id, **flow}


@router.get("/api/v1/test/questions")
def test_questions():
    p = BASE_DIR / "evaluation" / "questions.json"
    with open(p, encoding="utf-8") as f:
        return json.load(f)


@router.get("/api/v1/faq/examples")
def faq_examples():
    """首页示例问题（覆盖五板块）"""
    return {"examples": [
        {"board": "图书馆", "q": "本科生一次能借几本书？能借多少天？"},
        {"board": "图书馆", "q": "讨论间怎么预约？能带什么电器？"},
        {"board": "学工", "q": "国家励志奖学金有多少钱？"},
        {"board": "学工", "q": "申请国家励志奖学金要什么条件？"},
        {"board": "教务", "q": "借教室要提前几天申请？"},
        {"board": "教务", "q": "缓考必须在什么时间申请？"},
        {"board": "后勤", "q": "宿舍水管坏了找谁报修？"},
        {"board": "保卫", "q": "电动自行车怎么办校园通行牌？"},
        {"board": "保卫", "q": "校内报警电话是多少？"},
    ]}
