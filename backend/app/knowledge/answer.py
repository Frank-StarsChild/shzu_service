# -*- coding: utf-8 -*-
"""答案组装：关键事实直接渲染 + 原文摘录；模型不生成 URL、页码或文件名称。
输出结构对齐方案第 11 节回答示例。"""
from .loader import get_kb

SCOPE_LABELS = {"undergraduate": "本科生", "associate": "专科生", "graduate_master": "硕士生",
                "graduate_doctor": "博士生", "teacher": "教师"}


def _scope(identity):
    if not identity:
        return {}
    return {"student_type": identity["key"], "student_type_label": identity.get("label") or SCOPE_LABELS.get(identity["key"], "")}


def build_answer(topic=None, facts=None, clauses=None, doc_filter=None, identity=None,
                 summary=None, next_actions=None, kb_version=None, workflow_run_id="local"):
    kb = get_kb()
    used_fact_ids, used_clause_ids = [], []

    if topic:
        used_fact_ids = list(topic.get("fact_ids", []))
    if doc_filter:
        # 按文档过滤事实/条款
        fids = [fid for fid, f in kb.facts.items() if any(cid in doc_filter for cid in f.get("evidence_ids", []))]
        cids = [cid for cid, c in kb.clauses.items() if c["doc_id"] in doc_filter]
        used_fact_ids = fids
        if not used_fact_ids:
            used_fact_ids = []
        used_clause_ids = cids[:3]
    if facts is not None:
        used_fact_ids = [f["fact_id"] for f in facts]
        used_clause_ids = [c["clause_id"] for c in (clauses or [])]

    # 事实卡：evidence_ids → clause 定位
    fact_cards = []
    all_clause_ids = []
    for fid in used_fact_ids:
        f = kb.facts.get(fid)
        if not f:
            continue
        ev = f.get("evidence_ids", [])
        all_clause_ids.extend(ev)
        value = f.get("value")
        unit = f.get("unit")
        value_text = f"{value}{unit}" if (unit and isinstance(value, (int, float))) else str(value)
        cond = f.get("conditions") or {}
        cond_text = "；".join(f"{k}:{v}" for k, v in cond.items())
        fact_cards.append({
            "fact_id": fid, "label": f.get("label") or f.get("predicate"),
            "value": value_text, "conditions": cond_text, "evidence_ids": ev, "topic": f.get("topic"),
        })
    if not used_clause_ids:
        used_clause_ids = list(dict.fromkeys(all_clause_ids))
    else:
        used_clause_ids = list(dict.fromkeys(used_clause_ids + all_clause_ids))[:8]

    citations = kb.citations_for(used_clause_ids[:8])
    if summary is None and topic:
        summary = topic.get("summary")
    if summary is None:
        labels = [c["label"] for c in fact_cards[:3]]
        summary = "以下是已审定资料中的对应要点：" + "；".join(labels) + "。" if labels else "已检索到相关条款。"

    resp = {
        "status": "answered",
        "summary": summary,
        "scope": _scope(identity),
        "facts": fact_cards,
        "citations": citations,
        "next_actions": next_actions or [{"type": "show_source", "label": "查看原文出处"}],
        "kb_version": kb_version or kb.kb_version,
        "workflow_run_id": workflow_run_id,
    }
    return resp


def build_clarify(question, options=None, identity=None, kind="identity", topic=None):
    return {
        "status": "clarify",
        "summary": question,
        "clarify": {"kind": kind, "question": question, "options": options or []},
        "scope": _scope(identity),
        "facts": [], "citations": [],
        "next_actions": [],
        "kb_version": get_kb().kb_version,
        "workflow_run_id": "local",
    }


def build_insufficient(reason, note=None, identity=None, suggestions=None):
    kb = get_kb()
    summary = {
        "time_window": "当前日期没有适用的临时开馆安排；常规开馆时间的官方文件尚未入库，不能推断今天几点关门。",
        "no_evidence": "当前审定资料中未找到可支持该问题的条款；为避免编造，暂不回答。",
    }.get(reason, "当前审定资料不足以回答该问题。")
    extra = note or ""
    citations = []
    if reason == "time_window":
        # 提供官方查询入口（服务端来源表）
        citations = [{
            "evidence_id": "official-entry", "doc_id": "lib-official-site",
            "title": "石河子大学图书馆官网（官方查询入口）",
            "issuer": "石河子大学图书馆", "source_url": "https://lib.shzu.edu.cn/",
            "published_at": None, "locator": "首页·开放时间", "exact_text": "建议以图书馆官网公布的开放时间为准。",
            "effective_from": None, "effective_to": None, "review_state": "official_entry", "time_condition": None,
        }]
    return {
        "status": "insufficient",
        "summary": summary + (("\n" + extra) if extra else ""),
        "scope": _scope(identity),
        "facts": [], "citations": citations,
        "missing_information": [reason],
        "next_actions": suggestions or [{"type": "goto_source_center", "label": "到来源中心查看已收录资料"}],
        "kb_version": kb.kb_version,
        "workflow_run_id": "local",
    }


def build_out_of_scope(identity=None):
    kb = get_kb()
    return {
        "status": "out_of_scope",
        "summary": "该问题不在学工、教务、后勤、保卫、图书馆五大板块的官方资料范围内，我不能编造答案。您可以问我：奖助学金、请假、教室/场地借用、校门与交通、图书馆借阅等校园办事问题。",
        "scope": _scope(identity),
        "facts": [], "citations": [],
        "next_actions": [{"type": "show_board_entries", "label": "查看五大板块示例问题"}],
        "kb_version": kb.kb_version,
        "workflow_run_id": "local",
    }


def build_year_gap(year, unknown_fields, identity=None):
    kb = get_kb()
    uf = "、".join(unknown_fields) if unknown_fields else "当年通知与模板"
    return {
        "status": "insufficient",
        "summary": f"目前库内只有 2025 年度国家励志奖学金的完整正式依据包（已建为历史演示版本）；{year} 年的{uf}尚未入库，系统不会自动套用 2025 年的资格结果、截止日期或模板。取得并审定 {year} 年文件后将升级为当前年度流程。",
        "scope": _scope(identity),
        "facts": [],
        "citations": kb.citations_for(["xg-lz-c1", "xg-lz-c5"]),
        "missing_information": [f"{year}年度通知正文", f"{year}年模板确认", f"{year}年学院学生个人收件截止日"],
        "next_actions": [
            {"type": "start_flow", "label": "查看 2025 年度历史演示流程", "flow_id": "national_inspirational_2025"},
            {"type": "contact", "label": "咨询学生资助管理中心 0993-2057301"},
        ],
        "kb_version": kb.kb_version,
        "workflow_run_id": "local",
    }
