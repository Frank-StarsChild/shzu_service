# -*- coding: utf-8 -*-
"""LangChain 工具集（模型通过 LangChain 工具调用协议发起，LangGraph 执行）。

基础工具（四个）：
- search_campus_knowledge：BM25 检索审定条款/事实（机构范围过滤校验保留，防跨学院串答）
- list_campus_colleges：全校教学机构目录（colleges.json + 各学院已核验入库状态）
- find_service_workflow：办事向导适用性校验（历史演示年度 / 模板学院等硬边界）
- lookup_official_web：联网补查官网（本地不足时）

场景工具（四个，见 scenario_tools.py）：
- check_award_readiness：奖助学金申请核对（清单状态 + 官方入口）
- triage_network_issue：宿舍/校园网络故障分诊（公告核对 + 自查步骤 + 报修草稿）
- locate_campus_place：地点定位到 3D 沙盘（buildingId）
- student_card_reissue：学生证/乘车优惠卡补办办事单（窗口/电话/待确认事项）

工具结果返回给模型组织回复；发布层仅允许引用工具返回的证据 ID（校验集合由此产生）。
场景工具返回的 action 由发布层校验后附到 ChatResponse.actions，前端渲染卡片。
"""
import logging
import os
import re
from typing import Annotated

from langchain.tools import tool
from langchain_core.runnables import RunnableConfig
from pydantic import Field

from ..knowledge.loader import get_kb
from ..knowledge.retriever import retrieve, detect_year
from .scenario_tools import (check_award_readiness, triage_network_issue,
                             locate_campus_place, student_card_reissue)

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
    # 机构范围（防串答）仅用于学院信息类意图（简介/专业/师资/位置等）：
    # 办事类问法（请假/办理/流程等）的规则常为校级，学院不构成过滤条件。
    scope = None
    if college and re.search(
            r"简介|概况|介绍|专业|师资|位置|在哪|规模|学科|学位点|沿革|实力|院系设置|有多少(学生|老师|人)|副教授|教授|导师|职称|名单|名册", q):
        scope = {"college": college}
    year = detect_year(q)
    if year:
        scope = {**(scope or {}), "year": year}
    # 分段多路检索：模型可能把同义词拼进一个长词（如“四六级笔试考试时间 全国大学英语四六级”），
    # 按空格/顿号分段各自 BM25，RRF（每段 1/(60+rank) 求和）融合后合并：
    # 多段共同命中的条款排前，单段独占的无关条款自然降权
    segments = [s.strip() for s in re.split(r"[ 、,，;；/]+", q) if s.strip()] or [q]
    clause_score: dict = {}
    clause_pool: dict = {}
    fact_score: dict = {}
    fact_pool: dict = {}
    year_fallback = False

    def _rrf(score_map, pool_map, items, key):
        for rank, item in enumerate(items):
            kid = item[key]
            pool_map.setdefault(kid, item)
            score_map[kid] = score_map.get(kid, 0.0) + 1.0 / (60 + rank + 1)

    for seg in segments[:3]:
        facts_seg, clauses_seg, _, _, seg_meta = retrieve(seg, scope=scope, top_k=MAX_EVIDENCE_PER_SEARCH)
        if seg_meta.get("year_fallback"):
            year_fallback = True
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
    # 学院简介意图：问「介绍一下某学院」时，该学院概况主题（简介/沿革/师资规模/
    # 专业/学位点）置顶并入候选——防止教师档案等高频词把简介条款挤出 Top K
    if scope and scope.get("college") and re.search(
            r"简介|概况|介绍|是什么学院|实力|怎么样", q):
        for t in kb.qa_topics:
            if t.get("object_college") == scope["college"]:
                topic_matched.append((999, 999, t))
                break
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
    out = {"college_scope": college, "year_scope": year, "evidence": evidence, "facts": fact_view}
    if year_fallback:
        out["note"] = (f"检索年份 {year}：库内该学年无直接候选，以下为其他年份的已审定材料，"
                        f"回答时须注明所引材料的年份与适用范围。")
    if not evidence and not fact_view:
        out["note"] = "没有匹配到审定条款；可换更具体或更常用的检索词再试一次。"
    logger.info("tool search_campus_knowledge q=%r scope=%s year=%s evidence=%d", q, college, year, len(evidence))
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


# ---------- 官方网页补查（联网查证） ----------

WEB_MAX_FETCHES = 3            # 单次工具调用最多抓取页数
WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ShzuAgent/1.0 (+campus QA)"


def _strip_html(html: str) -> str:
    """HTML → 正文文本：去脚本样式导航页脚，再剥标签压缩空白；
    剔除模板/配置噪声（JSON 配置、浏览器兼容提示、导航面包屑）。"""
    import re as _re
    html = _re.sub(r"(?is)<(script|style|noscript|svg|iframe)[^>]*>.*?</\1>", " ", html)
    html = _re.sub(r"(?is)<(nav|header|footer|aside)[^>]*>.*?</\1>", " ", html)
    html = _re.sub(r"(?s)<!--.*?-->", " ", html)
    text = _re.sub(r"(?s)<[^>]+>", "\n", html)
    noise = _re.compile(
        r"(?i)(^\s*[{\[]\[\"\w\-:]*[}\]]|检测到您当前使用浏览器|请您使用电脑里的其他浏览器|"
        r"^\s*(var|let|const|function|window\.|document\.)|版权所有|ICP备|技术支持|"
        r"访问统计|分享到|二维码|微信号|上一篇|下一篇|返回顶部|无标题|"
        r"备案号|北四路|邮政编码|00:00&nbsp)")
    lines = []
    for ln in text.splitlines():
        # 行内噪声剔除：内联 JSON 配置、JS 模板插值、模板提示与栏目列表尾巴
        ln = _re.sub(r"\{[\w\-\s:,.()\[\]'\"]*?\}", " ", ln.strip())
        ln = _re.sub(r"\{\{.*?\}\}", " ", ln)
        ln = _re.sub(r"(?i)(\|\s*)?下载\s*\w+.*$", "", ln)
        ln = _re.sub(r"一站式服务大厅\s*\|\s*", "", ln)
        ln = ln.strip()
        if len(ln) < 8 or noise.search(ln):
            continue
        lines.append(ln)
    # 散文行：含句号且中文密度正常（模板/导航/版权行通常无句号）
    prose = [ln for ln in lines if ("。" in ln or "；" in ln)
             and not _re.search(r"[{}@]|http://|https://", ln)]
    if prose:
        return "\n".join(prose[:40])[:4000]
    return "\n".join(lines)[:4000]


def _html_title(html: str) -> str:
    import re as _re
    m = _re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    return m.group(1).strip()[:120] if m else ""


def _pick_official_urls(query: str, limit: int = WEB_MAX_FETCHES) -> list:
    """从知识库登记的官方来源里发现候选 URL（学校/学院/部门官网与官方附件链接）。
    查询含学院名 → 该学院官网域名下的已登记 URL；含部门关键词 → 对应板块来源。"""
    kb = get_kb()
    from urllib.parse import urlparse
    q = (query or "").strip()
    college = kb.college_of_text(q)
    dept_hits = []
    DEPT_BOARD = {"图书馆": "图书馆", "保卫": "保卫与校园安全", "后勤": "后勤与生活服务",
                  "教务": "教务与学籍", "学工": "学工与奖助学金", "资助": "学工与奖助学金",
                  "奖学金": "学工与奖助学金", "助学金": "学工与奖助学金", "困难认定": "学工与奖助学金",
                  "招生": "招生与新生入学", "迎新": "招生与新生入学", "新生": "招生与新生入学",
                  "研究生": "研究生教育", "导师": "研究生教育", "医院": "医疗医保与心理健康",
                  "医保": "医疗医保与心理健康", "心理": "医疗医保与心理健康",
                  "财务": "财务收费与报销", "报销": "财务收费与报销", "缴费": "财务收费与报销",
                  "就业": "就业与职业发展", "招聘": "就业与职业发展", "档案": "档案校史与文化",
                  "团委": "团委社团与文体", "社团": "团委社团与文体",
                  "校历": "教务与学籍", "选课": "教务与学籍", "考试": "教务与学籍",
                  "校园网": "校园网与信息服务", "校园卡": "招生与新生入学"}
    board = None
    for word, b in DEPT_BOARD.items():
        if word in q:
            board = b
            break
    scored = []
    for d in kb.documents.values():
        url = d.get("source_url") or ""
        if not url:
            continue
        issuer = (d.get("issuer") or "")[:40]
        is_college_doc = d.get("category") == "学院"
        doc_college = None
        for cl in kb.colleges:
            if cl["official"] in issuer:
                doc_college = cl["official"]
                break
        score = 0
        if college and doc_college == college:
            score += 4
        if board and d.get("category") == board:
            score += 2
        if q[:4] and q[:4] in (d.get("title") or ""):
            score += 3
        if score > 0:
            scored.append((score, d.get("document_year") or 0, url, d))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    # 优先用最近年份的官方来源
    seen_host_path = set()
    out = []
    for score, _y, url, _d in scored:
        key = (urlparse(url).netloc, urlparse(url).path)
        if key in seen_host_path:
            continue
        seen_host_path.add(key)
        out.append((url, _d))
        if len(out) >= limit:
            break
    return out


@tool
def lookup_official_web(
    query: Annotated[str, Field(min_length=2, max_length=120,
                                description="要查证的官方信息关键词（不含个人隐私数据），如「2026年国家励志奖学金申请通知」")],
    config: RunnableConfig,
) -> dict:
    """联网补查学校/学院/部门官网的最新信息（在本地检索不足时使用）。

    适用：本地资料不足、已过期、用户问最新情况、答案缺少明确年份或适用范围。
    先检索本地（search_campus_knowledge），确实不够再调用本工具。
    返回：官方页面正文摘录与出处（含发布方、日期、原文 URL、访问时间），或如实的
    失败状态（登录/超时/无正文/未找到当年正式文件）。工具取到的证据带 web- 前缀 ID，
    可与其他证据一样在回复中引用。学号、电话、住址、成绩等个人信息不会被发送。
    """
    from ..knowledge import web_evidence

    safe_q = web_evidence.sanitize_query_for_web(query)
    out: dict = {"query": safe_q, "evidence": [], "status": ""}

    # 1) 搜索服务（可选）：SHZU_WEB_SEARCH_API 配置时用外部搜索发现官方页面
    search_api = (os.environ.get("SHZU_WEB_SEARCH_API") or "").strip()
    candidates = _pick_official_urls(safe_q)
    if search_api:
        # 已配置搜索服务：委托发现（保留接口，未配置时不走该路径）
        out["search_provider"] = "configured"
    else:
        out["search_provider"] = "not_configured"

    if not candidates:
        out["status"] = ("知识库尚未登记与该查询对应的官方来源入口（无可用官网链接），"
                         "且搜索服务未配置（SHZU_WEB_SEARCH_API）。本轮未能联网查证。")
        out["note"] = "工具没有成功取到正文时不要声称已查证。"
        return out

    responses = web_evidence.fetch_pages([url for url, _ in candidates], config, WEB_UA)
    for url, doc in candidates:
        response = responses[url]
        if isinstance(response, Exception):
            out.setdefault("failures", []).append(
                {"url": url, "error": f"访问失败（{type(response).__name__}）"})
            continue
        content_type = response.headers.get("content-type", "")
        if response.status_code != 200 or not ("text/html" in content_type or "text/plain" in content_type):
            continue
        html = response.text
        body = _strip_html(html)
        if len(body.strip()) < 60:
            continue
        citation = web_evidence.register(
            title=_html_title(html) or doc.get("title") or "官方页面",
            issuer=doc.get("issuer") or _issuer_of_host(url),
            url=str(response.url),
            excerpt=body[:600],
            published_at=doc.get("published_at"),
            locator="联网查证·官网原文",
        )
        out["evidence"].append({
            "id": citation["id"], "topic": "联网查证",
            "issuer": citation["issuer"], "locator": citation["locator"],
            "text": body[:320], "time_condition": None,
            "url": citation["url"], "accessed_at": citation["accessed_at"],
        })

    if out["evidence"]:
        out["status"] = (f"已从官网取到 {len(out['evidence'])} 页正文（访问时间见 accessed_at）。"
                         "本地材料与网页冲突时，须分别注明各自年份与适用范围。")
    else:
        out["status"] = ("候选官方页面未能取到可用正文（超时/需登录/前端应用或无正文，"
                         "见 failures）。本地已有的可靠证据仍然有效，可继续使用。")
        out["note"] = "工具没有成功取到正文时不要声称已查证。"
    logger.info("tool lookup_official_web q=%r evidence=%d failures=%d",
                safe_q, len(out.get("evidence") or []), len(out.get("failures") or []))
    return out


def _issuer_of_host(url: str) -> str:
    from urllib.parse import urlparse
    host = urlparse(url).netloc
    return host


TOOLS = {t.name: t for t in (search_campus_knowledge, list_campus_colleges,
                              find_service_workflow, lookup_official_web,
                              check_award_readiness, triage_network_issue,
                              locate_campus_place, student_card_reissue)}
TOOL_LIST = [search_campus_knowledge, list_campus_colleges, find_service_workflow,
             lookup_official_web, check_award_readiness, triage_network_issue,
             locate_campus_place, student_card_reissue]
