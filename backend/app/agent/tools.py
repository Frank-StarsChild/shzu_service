# -*- coding: utf-8 -*-
"""LangChain 工具集（模型通过 LangChain 工具调用协议发起，LangGraph 执行）。

三个工具：
- search_campus_knowledge：BM25 检索审定条款/事实（机构范围过滤校验保留，防跨学院串答）
- list_campus_colleges：全校教学机构目录（colleges.json + 各学院已核验入库状态）
- find_service_workflow：办事向导适用性校验（历史演示年度 / 模板学院等硬边界）

工具结果返回给模型组织回复；发布层仅允许引用工具返回的证据 ID（校验集合由此产生）。
"""
import logging
import re
from typing import Annotated

from langchain.tools import tool
from langchain_core.runnables import RunnableConfig
from pydantic import Field

from ..knowledge.loader import get_kb
from ..knowledge.retriever import retrieve

logger = logging.getLogger("shzu.tools")

MAX_EVIDENCE_PER_SEARCH = 6


@tool
def search_campus_knowledge(
    query: Annotated[str, Field(min_length=1, max_length=160,
                                description="具体的中文检索词；多个关键词用空格分隔，如“宿舍漏水 报修 物业 电话”")],
    config: RunnableConfig,
) -> dict:
    """搜索石河子大学审定政策条款、部门办事指南与资料出处。

    返回带编号的证据（含发布机构、定位、原文摘录与适用时间条件）。涉及金额、日期、
    地点、电话、资格的结论必须以这些证据为准。问单个学院（专业/简介/位置）时，
    检索词带上学院名，系统会按机构严格过滤，防止串用其他学院资料。
    多个关键词用空格分隔（各段分别检索后合并，召回更稳）。
    """
    kb = get_kb()
    q = (query or "").strip()[:160]
    college = kb.college_of_text(q)
    # 机构范围过滤（防串答）仅用于学院信息类意图（简介/专业/师资/位置等）：
    # 办事类问法（请假/办理/流程等）的规则常为校级，学院不构成过滤条件，
    # 跨学院候选由模型结合 college 字段自行判断适用性。
    if college and re.search(
            r"简介|概况|介绍|专业|师资|位置|在哪|规模|学科|学位点|沿革|实力|院系设置|有多少(学生|老师|人)", q):
        scope = {"college": college}
    else:
        scope = None
    # 分段多路检索：模型可能把同义词拼进一个长词（如“四六级笔试考试时间 全国大学英语四六级”），
    # 按空格/顿号分段各自 BM25，RRF（每段 1/(60+rank) 求和）融合后合并：
    # 多段共同命中的条款排前，单段独占的无关条款自然降权
    segments = [s.strip() for s in re.split(r"[ 、,，;；/]+", q) if s.strip()] or [q]
    clause_score: dict = {}
    clause_pool: dict = {}
    fact_score: dict = {}
    fact_pool: dict = {}

    def _rrf(score_map, pool_map, items, key):
        for rank, item in enumerate(items):
            kid = item[key]
            pool_map.setdefault(kid, item)
            score_map[kid] = score_map.get(kid, 0.0) + 1.0 / (60 + rank + 1)

    for seg in segments[:3]:
        facts_seg, clauses_seg, _, _ = retrieve(seg, scope=scope, top_k=MAX_EVIDENCE_PER_SEARCH)
        _rrf(clause_score, clause_pool, clauses_seg, "clause_id")
        _rrf(fact_score, fact_pool, facts_seg, "fact_id")
    clauses = sorted(clause_pool.values(), key=lambda c: -clause_score.get(c["clause_id"], 0.0))
    facts = sorted(fact_pool.values(), key=lambda f: -fact_score.get(f["fact_id"], 0.0))
    # 候选匹配（关键词触发词规则）：BM25 分词不稳时（如“四六级笔试考试时间”整词
    # 切不出“考试/时间”），按主题触发词命中把该主题条款置顶并入候选
    topic_matched = []
    for t in kb.qa_topics:
        hits = [trig for trig in (t.get("triggers") or []) if trig and trig in q]
        if hits and not (scope and scope.get("college") and t.get("object_college") != scope["college"]):
            topic_matched.append((max(len(h) for h in hits), sum(len(h) for h in hits), t))
    topic_matched.sort(key=lambda x: (-x[0], -x[1]))
    topic_clauses = []
    have_clause = {c["clause_id"] for c in clauses}
    for _, _, t in topic_matched[:2]:
        for fid in t.get("fact_ids", []):
            f = kb.facts.get(fid)
            if not f:
                continue
            if fid not in fact_pool:
                fact_pool[fid] = {"fact_id": fid, **{k: f.get(k) for k in
                                      ("label", "subject", "predicate", "value", "unit",
                                       "conditions", "evidence_ids")}}
                facts.insert(0, fact_pool[fid])
            for cid in f.get("evidence_ids", []):
                if cid not in have_clause and cid in kb.clauses:
                    cl = kb.clauses[cid]
                    topic_clauses.append({"clause_id": cid, "topic": cl.get("topic") or t.get("topic"),
                                          "exact_text": cl.get("exact_text"),
                                          "evidence_ids": [cid]})
                    have_clause.add(cid)
    clauses = topic_clauses + clauses
    evidence = []
    for c in clauses[:MAX_EVIDENCE_PER_SEARCH]:
        cid = c["clause_id"]
        cl = kb.clauses.get(cid) or {}
        doc = kb.document_of(cid) or {}
        evidence.append({
            "id": cid,
            "topic": c.get("topic") or "",
            "issuer": doc.get("issuer", ""),
            "locator": cl.get("source_locator", ""),
            "text": (cl.get("exact_text") or "")[:320],
            "time_condition": cl.get("time_condition"),
            "college": cl.get("college"),
        })
    fact_view = []
    for f in facts[:MAX_EVIDENCE_PER_SEARCH]:
        fact_view.append({
            "label": f.get("label"),
            "value": "{}{}".format(f.get("value"), f.get("unit") or ""),
            "conditions": f.get("conditions") or None,
            "evidence_ids": f.get("evidence_ids", []),
        })
    out = {"college_scope": college, "evidence": evidence, "facts": fact_view}
    if not evidence and not fact_view:
        out["note"] = "没有匹配到审定条款；可换更具体或更常用的检索词再试一次。"
    logger.info("tool search_campus_knowledge q=%r scope=%s evidence=%d", q, college, len(evidence))
    return out


@tool
def list_campus_colleges() -> dict:
    """查询石河子大学全校教学机构目录（学院官方名称、别名与已核验资料状态）。

    用户问“学校有哪些学院”“列出教学机构/院系”等目录类问题时使用本工具。
    返回的名称与数量为已采集的学院官网清单口径，含“（筹）”筹建单位。
    """
    kb = get_kb()
    colleges = []
    for item in kb.colleges:
        official = item["official"]
        topics = kb.topics_of_college(official)
        ev_count = 0
        for t in topics:
            for fid in t.get("fact_ids", []):
                ev_count += len((kb.facts.get(fid) or {}).get("evidence_ids", []))
        colleges.append({
            "name": official,
            "aliases": [a for a in (item.get("aliases") or []) if a][:3],
            "intro_available": bool(topics),
            "evidence_count": ev_count,
        })
    out = {
        "count": len(colleges),
        "colleges": colleges,
        "note": ("目录来自学校各学院官网采集清单（共 {} 个学院单位，含以“（筹）”标注的筹建单位，"
                 "筹建单位尚未正式设立）。目录条目数为已采集清单数量，不代表学校官方宣称的院系总数；"
                 "除非另有官方来源支持，不要把条目数表述为“学校现有 N 个学院”。"
                 "询问某个具体学院的专业/简介/位置时，应检索该学院资料（search_campus_knowledge），"
                 "不要把全校目录当作单个学院的依据。").format(len(colleges)),
    }
    logger.info("tool list_campus_colleges count=%d", len(colleges))
    return out


@tool
def find_service_workflow(
    flow_id: Annotated[str, Field(min_length=1, max_length=64,
                                  description="向导 ID：national_inspirational_2025 | leave_request | venue_borrow")],
    config: RunnableConfig,
) -> dict:
    """查询办事向导是否适用于当前用户（进入向导前必须先调用本工具确认）。

    可用向导：
    - national_inspirational_2025：国家励志奖学金申请（2025 年度历史演示，需用户明确选择该年度）
    - leave_request：课程请假（生命科学学院模板，仅适用该学院）
    - venue_borrow：教学场所临时借用（教室等教学场所）
    """
    kb = get_kb()
    flow = kb.flows.get(flow_id)
    if not flow:
        return {"available": False, "reason": "未找到该向导；可用向导见工具说明。"}
    context = ((config.get("configurable") or {}).get("query_context") or "") if isinstance(config, dict) else ""
    if flow_id == "national_inspirational_2025":
        year_ok = ("2025" in context) or ("历史演示" in context)
        if not year_ok:
            return {"available": False, "reason":
                    "该向导为 2025 年度历史演示（依据包已审定）；用户未明确选择 2025 年度时不能进入，"
                    "需先确认用户想了解哪个申报年度（当前年度通知尚未入库）。"}
        return {"available": True, "id": flow_id, "name": flow.get("name", flow_id),
                "historical": True,
                "note": "历史演示向导：内容基于 2025 年度官方文件，不代表当前年度申报要求。"}
    if flow_id == "leave_request":
        if not any(alias in context for alias in ("生命科学学院", "生科院")):
            return {"available": False, "reason":
                    "请假条向导目前仅有生命科学学院模板（库内唯一已审定模板）；"
                    "需先确认用户所在学院是生命科学学院才可进入。"}
        return {"available": True, "id": flow_id, "name": flow.get("name", flow_id),
                "note": "生命科学学院课程请假模板。"}
    if flow_id == "venue_borrow":
        if not any(k in context for k in ("教室", "教学场所", "场地", "借用", "借用教室")):
            return {"available": False, "reason":
                    "该向导用于教室等教学场所的临时借用；会务场地等非教学场所请检索后勤官方资料。"}
        return {"available": True, "id": flow_id, "name": flow.get("name", flow_id)}
    return {"available": True, "id": flow_id, "name": flow.get("name", flow_id)}


TOOLS = {t.name: t for t in (search_campus_knowledge, list_campus_colleges, find_service_workflow)}
TOOL_LIST = [search_campus_knowledge, list_campus_colleges, find_service_workflow]
