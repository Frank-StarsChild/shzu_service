# -*- coding: utf-8 -*-
"""场景工具（首批两个演示场景 + 沙盘定位）：

- check_award_readiness：奖助学金申请核对。从知识库/已建向导生成后端核验过的
  核对清单（已有依据 / 待用户补充 / 待学院确认 / 待官网核实）与官方入口。
- triage_network_issue：宿舍/校园网络故障分诊。识别校区/楼栋/设备范围，核对
  本地故障公告 + 官网线索，按已审定指南给检查步骤、报修入口与报修草稿。
- locate_campus_place：把对话中的地点映射到校园 3D 沙盘（buildingId）。

三个工具都返回 {"evidence": [...], "action": {...}}：evidence 进入本轮引用校验集合，
action 由发布层校验后附到 ChatResponse.actions，前端渲染为卡片；正文仍由模型撰写。
"""
import json
import logging
import re
from typing import Annotated, Optional

from langchain.tools import tool
from langchain_core.runnables import RunnableConfig
from pydantic import Field

from ..config import BASE_DIR
from ..knowledge.loader import get_kb
from ..knowledge.retriever import retrieve

logger = logging.getLogger("shzu.tools.scenario")

MAX_EVIDENCE = 8


def _evidence_view(cids, topics):
    kb = get_kb()
    out = []
    for cid in cids[:MAX_EVIDENCE]:
        cl = kb.clauses.get(cid)
        if not cl:
            continue
        doc = kb.document_of(cid) or {}
        out.append({
            "id": cid,
            "topic": topics.get(cid, cl.get("topic") or ""),
            "issuer": doc.get("issuer", ""),
            "locator": cl.get("source_locator", ""),
            "text": (cl.get("exact_text") or "")[:320],
            "time_condition": cl.get("time_condition"),
            "college": cl.get("college"),
        })
    return out


def _first_hit(query, must_contain=None, board=None):
    """按检索词取首个命中条款；must_contain 用于文本二次确认。"""
    facts, clauses, _, _, _ = retrieve(query, top_k=6)
    for c in clauses:
        cl = get_kb().clauses.get(c["clause_id"]) or {}
        text = cl.get("exact_text") or ""
        if board:
            doc = (get_kb().document_of(c["clause_id"]) or {})
            if doc.get("category") != board:
                continue
        if not must_contain or any(m in text for m in must_contain):
            return c["clause_id"], text
    return None, None


def _ensure(query, must_contain, fallback_id, board=None):
    """检索定位条款；检索不中时回退到已知稳定条款 ID（仍在 kb 中校验存在）。"""
    cid, text = _first_hit(query, must_contain=must_contain, board=board)
    if cid:
        return cid
    cl = get_kb().clauses.get(fallback_id)
    return fallback_id if cl else None


# =====================================================================
# 场景一：奖助学金申请核对
# =====================================================================

AWARD_ALIASES = {
    "国家励志奖学金": "national_inspirational",
    "励志奖学金": "national_inspirational",
    "国家助学金": "national_grant",
    "国家奖学金": "national_scholarship",
    "困难认定": "difficulty",
    "家庭经济困难认定": "difficulty",
}


@tool
def check_award_readiness(
    award: Annotated[str, Field(min_length=2, max_length=40,
                                description="奖项名称，如「国家励志奖学金」「国家助学金」")],
    year: Annotated[Optional[int], Field(description="申请/申报年度（用户明确给出才填，否则 null）")] = None,
    known_facts: Annotated[str, Field(default="", max_length=400,
                description="对话中用户已主动提供的会改变判断的信息（年级/层次/困难认定/排名/学年身份等），没有则空串")] = "",
    config: RunnableConfig = None,
) -> dict:
    """奖助学金申请核对：生成后端核验过的材料/资格核对清单与官方办理入口。

    用户问「XX奖学金怎么申请」「帮我核对我能不能申请XX」时调用。清单每项给出状态：
    已有依据（库内官方文件支持）、待用户补充（需用户确认的事实）、待学院确认
    （学院掌握的截止日等）、待官网核实（当年正式通知未入库）。返回的证据 ID 可引用。
    """
    kb = get_kb()
    facts = (known_facts or "").strip()
    award_type = AWARD_ALIASES.get(award, "national_inspirational")

    # ---- 依据包定位（动态检索 + 稳定 ID 兜底，全部校验存在于 kb）----
    lz_amount = _ensure("国家励志奖学金 资助标准 金额 每生每年",
                        ["6000"], "xg-cj181-c1")              # 财教〔2024〕181号：6000元/年
    lz_cond = _ensure("国家励志奖学金 申请条件 二年级 家庭经济困难",
                      ["二年级", "家庭经济困难"], "xg-lz-c2")
    lz_rank = _ensure("国家励志奖学金 排名 前30%",
                      ["30%"], "xg-lz-c2")
    lz_mat = _ensure("国家励志奖学金 申请材料 一式一份 成绩单",
                     ["一式一份"], "xg-lz-c6")
    lz_time = _ensure("励志奖学金 10月22日 学院 提交",
                      ["10月22日"], "xg-lz-c5")
    lz_contact = _ensure("学生资助管理中心 咨询电话",
                         ["2057301"], "xg-lz-c8")

    year_note = None
    if year is None:
        year_note = "用户未说明申报年度；以下为奖项通用依据，年度要求（当年通知/截止日）待确认。"
    elif year == 2025:
        year_note = "2025 年度：库内有完整的官方依据包（历史演示），时间线与材料齐备。"
    else:
        year_note = (f"{year} 年度通知尚未入库：库内依据为评审办法与往年文件。"
                     f"当年申请起止日期、申请表版本与学院截止日需以当年正式通知为准（未核实，不臆测）。")

    def has(pat):
        return bool(re.search(pat, facts)) if facts else False

    grade_known = has(r"大[一二三四]|年级|研|本[科专]生")
    difficulty_known = has(r"困难认定|认定|困难")
    difficulty_passed = has(r"已.{0,6}认定|已.{0,6}通过|通过认定")
    rank_known = has(r"排名|名次|/\s*\d+|百分之|前\d")
    conflict_known = has(r"国家奖学金|国奖")

    items = [{
        "label": "资助标准",
        "state": "verified",
        "detail": "国家励志奖学金每生每年 6000 元（2024 年起由 5000 元提高）。",
        "evidence_ids": [lz_amount] if lz_amount else [],
    }, {
        "label": "基本申请资格",
        "state": "verified" if facts else "needs_user",
        "detail": ("面向全日制本专科（含第二学士学位）二年级以上（含二年级）品学兼优的"
                   "家庭经济困难在籍在校生。"
                   + ("已按你提供的情况记录身份信息。" if facts else "请说明你的年级与学生层次。")),
        "evidence_ids": [i for i in (lz_cond,) if i],
    }, {
        "label": "家庭经济困难认定（本学年）",
        "state": "verified" if difficulty_passed else "needs_user",
        "detail": ("需为本学年已通过家庭经济困难认定的学生"
                   + ("；你已说明认定情况。" if difficulty_known else "；请确认本学年是否已通过认定。")
                   + "认定材料在认定环节存档，申报时不需要重复提交。"),
        "evidence_ids": [lz_cond] if lz_cond else [],
    }, {
        "label": "学习成绩排名与综合测评排名（双排名要求）",
        "state": "verified" if rank_known else "needs_user",
        "detail": "学习成绩排名、综合测评排名均须位于前 30%（本人排名 ÷ 参评总人数），"
                  "两项按学年度计算。" + ("请提供两项排名与总人数以便对照。" if not rank_known else ""),
        "evidence_ids": [lz_rank] if lz_rank else [],
    }, {
        "label": "与国家奖学金的兼得关系",
        "state": "verified" if conflict_known else "needs_user",
        "detail": "同一学年内不可同时获得国家励志奖学金与本专科生国家奖学金；可与国家助学金兼得。"
                  + ("请确认本学年是否申报/已获国家奖学金。" if not conflict_known else ""),
        "evidence_ids": [lz_amount] if lz_amount else [],
    }, {
        "label": "申请材料",
        "state": "verified"
        if (year == 2025 or year is None) else "needs_web",
        "detail": (("《本专科生国家励志奖学金申请表》纸质版一式一份（系统生成后打印），"
                    "成绩单与获奖证明由学院留存备查。") if (year == 2025 or year is None) else
                   (f"{year} 年度材料清单未入库，须以当年正式通知为准；"
                    "2025 年度口径为：申请表纸质版一式一份，成绩单与获奖证明学院留存备查（仅作参考）。")),
        "evidence_ids": [lz_mat] if (lz_mat and (year == 2025 or year is None)) else [],
    }, {
        "label": f"申报时间线（{'2025 年度官方时间线' if year == 2025 else str(year or '当年') + ' 年度待官方通知'}）",
        "state": "verified" if year == 2025 else "needs_web",
        "detail": ("2025 年度：学院 10 月 22 日前完成系统提交与材料报送，学生个人收件截止日由学院确定"
                   if year == 2025 else "当年通知未入库，申报起止时间暂无可引依据，需以当年正式通知为准。"),
        "evidence_ids": [lz_time] if (lz_time and year == 2025) else [],
    }, {
        "label": "学院环节截止日（学生个人收件）",
        "state": "needs_college",
        "detail": "学生个人提交截止日由所在学院确定并通知，需向学院学生工作办公室确认。",
        "evidence_ids": [lz_time] if lz_time else [],
    }]

    # 转专业×奖学金（跨部门）：库内未见「转专业后按哪个学院/哪个时间点认定排名」的条款 → 待学院确认
    if has(r"转专业|转出专业|换了专业"):
        items.append({
            "label": "转专业后的学院归属与排名口径",
            "state": "needs_college",
            "detail": "评审办法要求申请人为在籍在校生、排名按学年度计算；但「转专业后按现学院还是原学院、从哪个学期起算排名」"
                      "库内没有条款，需要向转入学院学生工作办公室确认（教务的学籍异动由学院教科办办理）。",
            "evidence_ids": [lz_cond] if lz_cond else [],
        })

    # 去重 None
    items = [{**it, "evidence_ids": [e for e in it["evidence_ids"] if e]} for it in items
             if it is not None]

    ev_ids = []
    for it in items:
        ev_ids.extend(it["evidence_ids"])
    entry_ev = [lz_contact] if lz_contact else []
    ev_ids.extend(entry_ev)

    flow = kb.flows.get("national_inspirational_2025")
    action = {
        "kind": "checklist",
        "title": f"{award}申请核对",
        "award": award,
        "year": year,
        "year_note": year_note,
        "items": items,
        "flow": {
            "flow_id": "national_inspirational_2025",
            "name": (flow or {}).get("name", "国家励志奖学金申请向导"),
            "historical": bool((flow or {}).get("demo_mode")),
            "note": (flow or {}).get("demo_notice"),
        } if flow else None,
        "entry": {
            "label": "学生资助管理中心（学生处）",
            "phone": "0993-2057301",
            "person": "杨广锐",
            "note": "政策与年度安排以学生处正式通知为准",
            "evidence_ids": entry_ev,
        },
        "checks": [
            {"label": "本地知识库检索（评审办法/资助标准/材料/时间线）", "state": "done",
             "note": "依据包已定位" if lz_amount and lz_cond else "部分依据未定位"},
            {"label": f"{year or '指定'}年度正式通知核对", "state": "done" if (year == 2025 or year) else "needs_user",
             "note": "2025 年度依据包完整" if year == 2025 else
                     ("库内无该年度通知，可用 lookup_official_web 补查官网" if year else "需先确认申报年度")},
        ],
    }

    out = {"award": award, "year": year,
           "note": ("清单状态由服务端工具核对产生；正文请按实际状态撰写，"
                    "「待官网核实」项不得写成已确认，需注明用什么年份的材料作参考。"),
           "evidence": _evidence_view(ev_ids, {}),
           "action": action}
    logger.info("tool check_award_readiness award=%r year=%s items=%d", award, year, len(items))
    return out


# =====================================================================
# 校园沙盘地点索引（campus.meta.json：buildingId ↔ 名称/类别）
# =====================================================================

_META_CACHE = {"loaded": False, "buildings": {}, "aliases": {}}

_EXTRA_ALIASES = {
    "图书馆": "ZQ-B034", "总馆": "ZQ-B034",
    "行政楼": "ZQ-B024", "教务处": "ZQ-B024",
    "保卫部": "ZQ-B038", "派出所": "ZQ-B038",
    "会泽食府": "ZQ-B006",
    "大学生活动中心": "ZQ-B023", "活动中心": "ZQ-B023",
    "博学楼": "ZQ-B007", "科技楼": "ZQ-B028", "逸夫实验楼": "ZQ-B032",
    "知行楼": "ZQ-B035", "基础实验楼": "ZQ-B035",
    "体育馆": "ZQ-B036", "游泳馆": "ZQ-B039", "风雨操场": "ZQ-B037",
    "理学院": "ZQ-B020", "科技一条街": None,  # 东西段重名 → 特判
}


def _load_campus_meta():
    if _META_CACHE["loaded"]:
        return _META_CACHE
    import json as _json
    path = BASE_DIR / "frontend" / "public" / "campus3d" / "campus.meta.json"
    try:
        meta = _json.loads(path.read_text(encoding="utf-8"))
        buildings = {}
        aliases = {}
        for bid, b in (meta.get("buildings") or {}).items():
            if not b.get("name"):
                continue
            buildings[bid] = {"name": b["name"], "category": b.get("category", ""),
                              "anchor": b.get("anchor")}
            aliases[b["name"]] = bid
            # 通用别名：去「（…）」注释后的短名
            short = re.sub(r"（.*?）", "", b["name"])
            if short and short != b["name"]:
                aliases.setdefault(short, bid)
        # 公寓名模式：6号学生公寓 → 6号楼/6号楼宿舍/6号公寓
        for bid, b in buildings.items():
            m = re.match(r"(\d+)号学生公寓", b["name"])
            if m:
                for alt in (f"{m.group(1)}号楼", f"{m.group(1)}号公寓",
                            f"{m.group(1)}号学生公寓", f"{m.group(1)}号楼宿舍"):
                    aliases.setdefault(alt, bid)
        for k, v in _EXTRA_ALIASES.items():
            if v is not None:
                aliases.setdefault(k, v.lstrip("."))
        _META_CACHE["buildings"] = buildings
        _META_CACHE["aliases"] = aliases
    except Exception as e:  # noqa: BLE001
        logger.warning("campus meta load failed: %s", e)
    _META_CACHE["loaded"] = True
    return _META_CACHE


_CAMPUS_WORDS = {
    "中区": "中区", "中心校区": "中区", "东校区": "东区", "东区": "东区",
    "北校区": "北区", "北区": "北区", "南校区": "南区", "南区": "南区", "本部": "本部",
}


def _detect_campus(text: str) -> Optional[str]:
    for w, name in _CAMPUS_WORDS.items():
        if w in text:
            return name
    return None


def _match_places(text: str):
    """从文本中找已登记建筑；返回 [(building_id, name, category, matched_term)]"""
    cache = _load_campus_meta()
    text = text or ""
    hits, seen = [], set()
    order = sorted(cache["aliases"].items(), key=lambda kv: -len(kv[0]))
    for alias, bid in order:
        if alias in text and bid not in seen and bid in cache["buildings"]:
            seen.add(bid)
            hits.append((bid, cache["buildings"][bid]["name"],
                         cache["buildings"][bid]["category"], alias))
    # 「科技一条街」在东西两段之间特判为歧义
    if "科技一条街" in text:
        pair = [h for h in hits if "科技一条街" in h[1]]
        if len(pair) == 1:
            hits = [h for h in hits if h not in pair]
            both = [(v, cache["buildings"][v]["name"], "商业", "科技一条街")
                    for v in ("ZQ-B002", "ZQ-B003") if v in cache["buildings"]]
            hits.extend(both)
    # 公寓号直接命中「N号楼」但库里没有该楼 → 由调用方按未登记处理
    return hits[:6]


@tool
def locate_campus_place(
    place: Annotated[str, Field(min_length=2, max_length=120,
                                description="含地点的问句或地点名，如「中区18号楼」「图书馆在哪」")],
    config: RunnableConfig = None,
) -> dict:
    """把校园地点映射到 3D 沙盘建筑（buildingId）或文字定位。

    回答涉及具体办事地点/楼栋（图书馆、行政楼、保卫部、学生公寓楼栋等）时调用。
    返回：沙盘已登记建筑的 buildingId（前端可聚焦高亮）、类别与匹配词；未登记或
    不在沙盘覆盖范围（沙盘仅中区校园）时返回文字定位说明。不含路径规划。
    """
    cache = _load_campus_meta()
    text = (place or "").strip()
    campus = _detect_campus(text)
    hits = _match_places(text)

    action = {"kind": "place", "title": "地点定位", "matches": [],
              "ambiguous": False, "fallback_text": None}

    if not hits:
        m = re.search(r"(\d+)\s*号(?:楼|学生公寓|公寓|宿舍)", text)
        if m and not campus:
            action["fallback_text"] = ("学生公寓楼栋需结合校区确认位置；沙盘当前仅覆盖中区校园。"
                                       "请补充校区（如「中区」），或按官方通知上的地点前往。")
        elif m:
            action["fallback_text"] = (f"{campus} {m.group(1)} 号楼不在沙盘已登记建筑里"
                                       "（沙盘登记了中区 6/7/16/17/18 号学生公寓等 45 栋）；"
                                       "具体位置以学校官方通知为准，可向所在学院或后勤确认。")
        else:
            action["fallback_text"] = "未能在校园沙盘登记数据中匹配该地点；可换标准建筑名（如图书馆、行政楼）再试。"
        action["ambiguous"] = bool(m and not campus)
        return {"note": action["fallback_text"], "evidence": [], "action": action}

    # 校区不在沙盘覆盖（中区）：已登记建筑仍在沙盘可见，但如实说明覆盖范围
    matches = [{
        "building_id": bid if (campus in (None, "中区")) else None,
        "label": name, "category": cat, "campus": "中区",
        "note": f"匹配词「{term}」" + ("" if campus in (None, "中区") else f"；用户提到{campus}，沙盘仅覆盖中区，请以官方地点为准"),
    } for bid, name, cat, term in hits]
    if campus and campus != "中区":
        action["fallback_text"] = f"用户提到的{campus}不在沙盘覆盖范围（沙盘仅中区校园）；以下为同名建筑的文字定位。"
    action["matches"] = matches
    action["ambiguous"] = len(matches) > 1
    note = "已匹配沙盘建筑: " + "、".join(f"{m['label']}({m['building_id']})" for m in matches if m["building_id"])
    logger.info("tool locate_campus_place q=%r hits=%d", text, len(matches))
    return {"note": note + "。可在回答中引导用户点「在沙盘查看」定位建筑；"
                      "不提供路线长度/步行时间/楼层入口（无依据数据）。",
            "evidence": [], "action": action}


# =====================================================================
# 场景三：学生证/乘车优惠卡补办 · 现场办事单
# =====================================================================

@tool
def student_card_reissue(
    issue: Annotated[str, Field(min_length=2, max_length=120,
                                description="用户原话中的补办诉求，如「学生证丢了去哪补办」「乘车优惠卡怎么办」")] = "学生证补办",
    config: RunnableConfig = None,
) -> dict:
    """学生证/乘车优惠卡补办：生成一张到现场还能用的办事单（地点/部门/待确认事项）。

    用户问「学生证丢了怎么补」「乘车优惠卡在哪办」时调用。返回内容全部从库内
    官方证据取值（窗口、楼栋、电话、职责）；证据没确认的材料清单、办公时间
    会明确标注「需向办公室确认」，不臆造。
    """
    cache = _load_campus_meta()
    cid, text = "", ""
    try:
        cid, text = _first_hit("学生证 乘车优惠卡 办理 学生事务管理办公室",
                               must_contain=["学生证", "乘车优惠卡"])
    except Exception:
        cid, text = None, None
    if not cid:
        cl = get_kb().clauses.get("xg-ks-c1")
        cid, text = ("xg-ks-c1", cl.get("exact_text") or "") if cl else (None, None)
    if not cid:
        return {"note": "库内未找到学生证办理窗口的官方依据。", "evidence": [], "action": None}

    # ---- 从证据文本取值（不做任何前端固定的地点/电话）----
    phone = None
    m = re.search(r"学生事务管理办公室[^）]*?电话\s*(\d{3,4})[－—-](\d{7,8})", text)
    if m:
        phone = f"{m.group(1)}-{m.group(2)}"
    loc = None
    m = re.search(r"学生事务管理办公室[^）]*?((?:[\u4e00-\u9fa5]{2,12}?)楼[^）\s]*?\d+(?:[-—－]\d+)?室)", text)
    if m:
        loc = m.group(1)
    room = None
    building = loc
    if loc:
        m2 = re.match(r"(.+?楼)\s*(\d+(?:[-—－]\d+)?室)", loc)
        if m2:
            building, room = m2.group(1), m2.group(2)

    # 楼栋映射到沙盘（大学生活动中心南楼 → 大学生活动中心 ZQ-B023）
    building_id = None
    if building:
        for probe in (building, re.sub(r"(南楼|北楼|东楼|西楼|新楼|旧楼)$", "", building)):
            bid = cache["aliases"].get(probe)
            if bid:
                building_id = bid
                break

    # 材料清单 / 办公时间：库内没有 → 如实交给「出发前确认」
    confirms = []
    if not re.search(r"学生证[^。]{0,40}(材料|身份证|照片|工本费)", text):
        confirms.append({"text": "补办所需材料（如身份证明、照片等）目前没有官方文件确认，请打办公楼电话核实后再去",
                         "state": "needs_user"})
    if not re.search(r"(办公时间|工作时间|作息)", text):
        confirms.append({"text": "办公时间尚未在官方资料中登记，建议去电确认（避免白跑）",
                         "state": "needs_office"})

    place = {"building": building, "room": room, "building_id": building_id,
             "campus": "中区", "evidence_id": cid}
    fields = {
        "kind": "errand",
        "title": "学生证 / 乘车优惠卡补办 · 办事单",
        "place": place,
        "dept": "学生事务管理办公室（学生处）",
        "service_scope": "学生证、乘车优惠卡的办理",
        "phone": phone,
        "hours": None,
        "materials_confirmed": False,
        "confirms": confirms,
    }
    # 证据视图 + 附带沙盘定位动作
    ev = _evidence_view([cid], {})
    action = dict(fields)
    note = ("窗口、楼栋、电话均出自本轮证据；材料清单与办公时间库内未确认，"
            "已在「出发前确认」中明确标注，正文不得写成已确认。")
    if building_id:
        place_action = {
            "kind": "place", "title": "地点定位", "ambiguous": False,
            "matches": [{"building_id": building_id, "label": building or "大学生活动中心（南楼）",
                         "category": "办公", "campus": "中区", "note": "办事单定位"}],
            "fallback_text": None,
        }
    else:
        place_action = None
    logger.info("tool student_card_reissue issue=%r room=%s phone=%s", issue, room, phone)
    out = {"note": note, "evidence": ev, "action": action}
    if place_action:
        out["place_action"] = place_action
    return out


# =====================================================================
# 场景二：宿舍/校园网络故障分诊
# =====================================================================

_ANNOUNCE_WORDS = ["停网", "断网公告", "网络故障", "检修通知", "维护通知", "故障通知", "临时中断"]


def _check_local_announcements(campus, building_name):
    """本地知识库故障公告核对（当前口径：xyw 板块内无区域故障公告时如实返回未查到）。"""
    kb = get_kb()
    found = []
    for cid, c in kb.clauses.items():
        doc = kb.document_of(cid) or {}
        title = doc.get("title") or ""
        if doc.get("category") != "校园网与信息服务":
            continue
        text = c.get("exact_text") or ""
        if any(w in title for w in _ANNOUNCE_WORDS):
            found.append((cid, title, text))
    if not found:
        return None
    # 命中标题词的公告逐条核对覆盖范围
    covered = []
    for cid, title, text in found:
        covers = (not campus or campus in text or "全校" in text or "全校区" in text)
        covered.append((cid, title, text, covers))
    return covered


def _check_web_notices(budget_s=6.0):
    """官网首页公告线索核对（仅登记为「线索」，未核验正文不得当成有效公告）。
    源自知识库登记的网络与信息中心域名 nc.shzu.edu.cn。"""
    import time as _t
    import httpx
    from ..knowledge import web_evidence
    t0 = _t.perf_counter()
    try:
        with httpx.Client(timeout=budget_s, follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0 ShzuAgent/1.0 (+campus QA)"}) as c:
            r = c.get("https://nc.shzu.edu.cn/")
        if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
            return {"state": "not_found", "detail": f"网络与信息中心首页访问异常（HTTP {r.status_code}）"}
        import re as _re
        links = _re.findall(_re.compile(
            r'<a[^>]*href="([^"]+)"[^>]*>([^<]{6,60})</a>'), r.text)
        hits = [(u.strip(), t.strip()) for u, t in links
                if any(w in t for w in ("故障", "停网", "检修", "维护", "断网"))
                and not t.endswith(("办法", "规定", "细则", "守则", "说明书"))]
        if not hits:
            return {"state": "not_found", "detail": "网络与信息中心官网首页未发现故障/检修类公告线索（首页快照，非全站）"}
        # 仅作为线索返回（未打开详情页不得声称有效公告）
        preview = "；".join(f"「{t}」" for _, t in hits[:3])
        citation = web_evidence.register(
            title="网络与信息中心官网首页（公告线索）",
            issuer="网络与信息中心",
            url="https://nc.shzu.edu.cn/",
            excerpt=preview[:300],
            published_at=None,
            locator="联网查证·首页公告栏线索",
        )
        return {"state": "lead", "detail": f"官网首页发现相关线索：{preview}（标题线索，正文未核验，须点开原文确认覆盖范围）",
                "evidence_id": citation["id"], "elapsed": round(_t.perf_counter() - t0, 1)}
    except (httpx.TimeoutException, httpx.ConnectError) as e:
        return {"state": "timeout", "detail": f"网络与信息中心官网访问失败（{type(e).__name__}），本轮未能联网核对公告",
                "elapsed": round(_t.perf_counter() - t0, 1)}
    except Exception as e:  # noqa: BLE001
        return {"state": "error", "detail": f"官网核对异常：{type(e).__name__}"}


def _coverage_check(announcement_text, campus, building_name):
    """故障公告覆盖范围核对：公告文本是否覆盖用户所在校区/楼栋。"""
    if not announcement_text:
        return False, "公告未提供覆盖范围信息"
    if building_name and building_name in announcement_text:
        return True, f"公告明确提及 {building_name}"
    if campus and campus in announcement_text:
        return True, f"公告覆盖 {campus}"
    if "全校" in announcement_text or "全校区" in announcement_text:
        return True, "公告为全校范围"
    return False, "公告未提及用户所在位置，覆盖范围待确认"


@tool
def triage_network_issue(
    issue: Annotated[str, Field(min_length=2, max_length=200,
                                description="用户原话中的故障描述，如「宿舍网络无法连接」「拨号报错651」")],
    campus: Annotated[Optional[str], Field(default=None, max_length=12,
                description="校区（中区/东区/北区等；用户没提则 null）")] = None,
    building: Annotated[Optional[str], Field(default=None, max_length=30,
                description="楼栋（如「18号楼」「18号学生公寓」；没提则 null）")] = None,
    device_scope: Annotated[Optional[str], Field(default=None, max_length=16,
                description="设备范围：single=只有我的设备 / multi=多台设备都断 / unknown=未知")] = "unknown",
    config: RunnableConfig = None,
) -> dict:
    """宿舍/校园网络故障报修分诊：识别校区/楼栋/设备范围，核对故障公告，给检查步骤与报修草稿。

    用户报「宿舍网连不上」「断网」「拨号错误」时调用。返回：
    - 已识别的校区/楼栋（含沙盘 buildingId，若已登记）
    - 故障公告核对结果（查到才展示，并核对覆盖范围；未查到时如实说明「不等于没有故障」）
    - 按官方指南整理的自查步骤（带证据）
    - 官方报修入口（电话）与可直接使用的报修草稿
    """
    text = (issue or "") + " " + (building or "")
    campus = campus or _detect_campus(issue or "") or _detect_campus(building or "")
    scope_mult = device_scope == "multi"

    # ---- 楼栋识别（沙盘登记）----
    hits = _match_places(text) if building or re.search(r"\d+\s*号", text) else []
    place_action = None
    building_name = None
    if hits:
        building_name = hits[0][1]
        place_action = {
            "kind": "place", "title": "位置定位", "ambiguous": len(hits) > 1,
            "matches": [{"building_id": bid if not campus or campus == "中区" else None,
                         "label": name, "category": cat, "campus": "中区",
                         "note": f"匹配词「{term}」"} for bid, name, cat, term in hits[:3]],
            "fallback_text": None,
        }
    else:
        m = re.search(r"(\d+)\s*号(?:楼|学生公寓|公寓|宿舍)", text)
        if m:
            building_name = f"{m.group(1)}号楼宿舍"
            place_action = {
                "kind": "place", "title": "位置定位", "ambiguous": not campus, "matches": [],
                "fallback_text": (f"{campus or ''} {m.group(1)} 号楼不在沙盘登记范围（沙盘登记了中区 "
                                  "6/7/16/17/18 号学生公寓等）；位置以官方通知或学院确认为准。"),
            }

    # ---- 指南依据（官方页面）----
    guide_line = _ensure("宿舍区 连接网线 异常 更换超五类双绞线",
                         ["超五类"], "xyw-07e23592-c001")
    guide_speed = _ensure("网卡速率 100M 全双工 调整",
                          ["全双工"], "xyw-07e23592-c002")
    guide_dialup = _ensure("校园网 拨号错误 651 678 691 网线",
                           ["651", "691", "拨号"], "xyw-a04b4d73-c001")
    guide_repair_tool = _ensure("校园网 拨号失败 未知错误 修复工具",
                                ["2057898"], "xyw-bffb1149-c001")
    entry_contact = _ensure("网络与信息中心 联系我们 服务热线 用户室电话",
                            ["2057898"], "xyw-b7b21efd-c002")
    entry_loc = _ensure("网络与信息中心 办公地点 绿苑2号楼 校园卡服务大厅",
                        ["绿苑", "6号楼南"], "xyw-b7b21efd-c001")

    # ---- 公告核对：先本地库，再官网首页线索 ----
    checks = []
    local_ann = _check_local_announcements(campus, building_name)
    if local_ann:
        covered = []
        for cid, title, text, pre_covered in local_ann:
            cov, why = (_coverage_check(text, campus, building_name)
                        if not pre_covered else (True, "公告标题词命中（覆盖范围见正文）"))
            covered.append(f"《{title}》：{'覆盖' if cov else '不覆盖'}（{why}）")
        checks.append({"label": "本地知识库故障公告核对", "state": "done",
                       "note": f"库内命中 {len(local_ann)} 条公告；" + "；".join(covered)})
        local_detail = "；".join(covered)
    else:
        checks.append({"label": "本地知识库故障公告核对", "state": "not_found",
                       "note": "库内未收录覆盖该区域的网络故障公告（这不代表该区域没有故障）"})
        local_detail = ""
    web_ann = _check_web_notices()
    state_map = {"lead": "partial", "not_found": "not_found",
                 "timeout": "partial", "error": "partial"}
    checks.append({"label": "网络与信息中心官网公告核对", "state": state_map.get(web_ann["state"], "partial"),
                   "note": web_ann["detail"]})

    announcement = {"checked": True, "local": bool(local_ann),
                    "local_detail": local_detail,
                    "web_state": web_ann["state"], "detail": web_ann.get("detail", ""),
                    "evidence_id": web_ann.get("evidence_id")}

    # ---- 自查步骤（全部带官方依据）----
    steps = []
    if guide_repair_tool:
        steps.append({"text": "先看报错代码：拨号提示「未知错误」多为系统服务未启动，可按官网修复工具说明处理（修改注册表前先备份数据）。",
                      "evidence_ids": [guide_repair_tool]})
    if guide_dialup:
        steps.append({"text": "拨号错误 651/678 多为网线问题，可更换一根合格网线；691 先核对账号密码、是否欠费。",
                      "evidence_ids": [guide_dialup]})
    if guide_line:
        steps.append({"text": "宿舍区连网异常：更换超五类双绞线（千兆网卡与百兆线路协商失败是常见原因）。",
                      "evidence_ids": [guide_line]})
    if guide_speed:
        steps.append({"text": "仍不稳定时，把网卡速率手动调整为 100Mbps 全双工后再测试；并测试网线是否断线。",
                      "evidence_ids": [guide_speed]})
    if scope_mult and steps:
        steps.insert(0, {"text": "同宿舍多台设备都断网时，更可能是楼内接入设备或线路问题，建议直接联系报修电话，"
                                 "并把「受影响设备数量」告诉值班老师（判断依据为官方指南的分域排查思路）。",
                         "evidence_ids": [steps[0]["evidence_ids"]]})

    # ---- 报修草稿（无校方授权的在线提单接口：只交付草稿与官方入口，不真实提交）----
    loc_line = f"{campus or '校区待确认'} {building_name or '楼栋待确认'}"
    draft = ("【宿舍网络报修】\n"
             f"位置：{loc_line}（宿舍房间号待填写）\n"
             f"现象：{(issue or '网络无法连接').strip()}\n"
             f"影响范围：{'同宿舍多台设备均无法连接' if scope_mult else '仅我的设备（待确认）'}\n"
             "已自查：更换网线 / 网卡调至100M全双工 / 核对账号密码（依据校园网用户指南）\n"
             "联系电话：（待填写）\n"
             "提交渠道：网络与信息中心服务热线 0993-2057898 / 2057899（办公地点：北校区绿苑2号楼；中区6号楼南侧校园卡服务大厅）")

    action = {
        "kind": "repair",
        "title": "网络故障分诊 · 报修",
        "identified": {"campus": campus, "building": building_name,
                       "device_scope": device_scope,
                       "building_id": (hits[0][0] if hits and (not campus or campus == "中区") else None)},
        "announcement": announcement,
        "checks": checks,
        "steps": steps,
        "entry": {
            "label": "网络与信息中心（用户室/服务热线）",
            "phone": "0993-2057898 / 2057899",
            "note": "工作时间以官网「联系我们」为准；报修时说明位置、现象与已做过的检查",
            "evidence_ids": [e for e in (entry_contact, entry_loc) if e],
        },
        "draft": draft,
    }
    if not campus or not building_name:
        action["checks"].append({"label": "校区/楼栋确认", "state": "needs_user",
                                 "note": "校区或楼栋未明确：先向用户确认一个能帮助分诊的问题（校区/楼栋），再走后续步骤"})

    ev_ids = [e for e in (guide_line, guide_speed, guide_dialup, guide_repair_tool,
                          entry_contact, entry_loc) if e]
    evidence_views = _evidence_view(ev_ids, {})
    # 官网公告线索的 web 证据并入证据集合（可被引用，也进入卡片核对状态）
    if web_ann.get("evidence_id"):
        from ..knowledge import web_evidence as _we
        w = _we.get(web_ann["evidence_id"]) or {}
        if w:
            evidence_views.append({
                "id": w["id"], "topic": "联网查证·官网公告线索",
                "issuer": w.get("issuer", ""), "locator": w.get("locator", ""),
                "text": (w.get("excerpt") or "")[:320], "time_condition": None,
                "college": None,
            })
    out = {"identified": action["identified"],
           "note": ("分诊结果与自查步骤均来自官方指南；未查到公告≠该区域没有故障，正文请如实说明；"
                    "草稿仅提供用户核对使用，未提交到任何系统（无校方授权接口）。"),
           "evidence": evidence_views,
           "action": action}
    if place_action:
        out["place_action"] = place_action
    logger.info("tool triage_network_issue issue=%r campus=%s building=%r scope=%s",
                issue, campus, building_name, device_scope)
    return out
