# -*- coding: utf-8 -*-
"""办理路线组装：把本轮已核验的结构化结果整理成可展示的步骤图（process）。

原则：
- 只使用本轮工具已经产出的结果（动作卡 / 向导步骤 / 已引用证据），不新增模型调用。
- 任何一步校验不通过就整体放弃（返回 None），不影响正文、引用与动作卡。
- 节点状态只用四种：ready / needs_user / needs_check / upcoming。
  「可查看」只表示有内容可看或有动作可做，个人资格结论仍以核对卡为准。
"""
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger("shzu.agent.process")

MAX_NODES = 6
MIN_NODES = 3
MAX_CITE = 10          # 路线自身引用上限（与正文引用上限分开，避免撑爆 citations）


def _node(nid: str, title: str, detail: str, state: str, cites: List[str]) -> Dict[str, Any]:
    return {"id": nid, "title": title[:60], "detail": (detail or "")[:400],
            "state": state, "citation_ids": list(dict.fromkeys(cites))[:MAX_CITE]}


def _pick_focus(nodes: List[Dict[str, Any]]) -> Optional[str]:
    """第一个待补充，其次待核实，最后首节点。"""
    for st in ("needs_user", "needs_check"):
        for n in nodes:
            if n.get("state") == st:
                return n["id"]
    return nodes[0]["id"] if nodes else None


def _chain(nodes: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    return [{"from_id": nodes[i]["id"], "to_id": nodes[i + 1]["id"]}
            for i in range(len(nodes) - 1)]


# ---------- 校验 ----------

def _validate(proc: Optional[Dict[str, Any]], cited: set, allowed_flows: set) -> Optional[Dict[str, Any]]:
    """最终校验：节点数/ID 唯一/引用存在/边只向后/入口可用。任一不满足返回 None。"""
    if not isinstance(proc, dict):
        return None
    nodes = proc.get("nodes")
    if not isinstance(nodes, list) or not (MIN_NODES <= len(nodes) <= MAX_NODES):
        return None
    ids: List[str] = []
    for n in nodes:
        if not isinstance(n, dict):
            return None
        nid = str(n.get("id") or "").strip()
        if not nid or nid in ids:
            return None
        if not str(n.get("title") or "").strip():
            return None
        if n.get("state") not in ("ready", "needs_user", "needs_check", "upcoming"):
            return None
        if any(c not in cited for c in (n.get("citation_ids") or [])):
            return None
        ids.append(nid)
    pos = {nid: i for i, nid in enumerate(ids)}
    for e in proc.get("edges") or []:
        if not isinstance(e, dict):
            return None
        a, b = e.get("from_id"), e.get("to_id")
        if a not in pos or b not in pos or pos[a] >= pos[b]:
            return None
    focus = proc.get("focus_id")
    if focus is not None and focus not in pos:
        return None
    we = proc.get("workflow_entry")
    if we is not None:
        if not isinstance(we, dict):
            return None
        if we.get("node_id") not in pos or we.get("flow_id") not in allowed_flows:
            return None
    if focus is None:
        proc = {**proc, "focus_id": _pick_focus(nodes)}
    return proc


# ---------- 奖助核对路线 ----------

def _award_route(kb, final, card, cited) -> Optional[Dict[str, Any]]:
    items = {it.get("key"): it for it in (card.get("items") or []) if it.get("key")}
    if not items:
        return None
    year = card.get("year")
    year_note = (card.get("year_note") or "").strip()

    # 1) 申报年度
    tl = items.get("timeline") or {}
    if year is None:
        y_state = "needs_user"
        y_detail = year_note or "请补充申报年度（例如 2025 年度），以便对照当年通知与学院截止日。"
        y_cite: List[str] = []
    elif year == 2025:
        y_state = "ready"
        y_detail = (tl.get("detail") or year_note or
                    "2025 年度：学院 10 月 22 日前完成系统提交与材料报送（历史演示）。")
        y_cite = [e for e in (tl.get("evidence_ids") or []) if e in cited]
    else:
        y_state = "needs_check"
        y_detail = (tl.get("detail") or year_note or
                    f"{year} 年度通知未入库，需以当年正式通知为准。")
        y_cite = [e for e in (tl.get("evidence_ids") or []) if e in cited]

    # 2) 申请资格（资格/认定/排名/兼得/转专业口径合并到同一环节）
    elig_keys = ("eligibility", "difficulty", "rank", "conflict", "transfer_major")
    chosen = [items[k] for k in elig_keys if k in items]
    states = [it.get("state") for it in chosen]
    if any(s == "needs_user" for s in states):
        e_state = "needs_user"      # 既缺个人信息又缺学院口径时也归为待补充，展开里两类缺项都写明
    elif any(s in ("needs_college", "needs_web") for s in states):
        e_state = "needs_check"
    elif chosen:
        e_state = "ready"
    else:
        e_state = "needs_check"
    # 按缺项优先级排序并压缩成「条目标签（状态）：关键句」，保证转专业等学院口径
    # 在同一个环节里也看得见（不被前面条目的长说明挤掉）。
    order = {"needs_user": 0, "needs_college": 1, "needs_web": 2, "verified": 3}
    words = {"verified": "已有依据", "needs_user": "待你补充",
             "needs_college": "待学院确认", "needs_web": "待官方核实"}
    parts = []
    for it in sorted(chosen, key=lambda x: order.get(x.get("state"), 4)):
        label = it.get("label") or ""
        word = words.get(it.get("state"), "")
        d = (it.get("detail") or "").strip()
        extra = ""
        if d and it.get("state") == "needs_college":
            # 学院口径要露出「向谁确认」这一句，不能只截开头
            idx = min([i for i in (d.find("需要向"), d.find("需向")) if i >= 0], default=-1)
            extra = "：" + (d[idx:idx + 40] if idx >= 0 else d[:44])
        elif d and it.get("state") == "needs_user":
            extra = "：" + d[:30]
        parts.append(f"{label}（{word}）{extra}")
    e_detail = "；".join(parts) or "请先补充年级、困难认定与排名情况。"
    e_cite = [e for it in chosen for e in (it.get("evidence_ids") or []) if e in cited]

    # 3) 材料（只有明确 2025 年度才是当年可用口径；其余年份/未给年度按待核实，往年内容仅作参考）
    mat = items.get("materials") or {}
    if mat:
        if year == 2025 and mat.get("state") == "verified":
            m_state = "ready"
            m_detail = mat.get("detail") or ""
        else:
            m_state = "needs_check"
            m_detail = (mat.get("detail")
                        or "当年申请表版本与材料清单需以正式通知为准，往年内容仅作参考。")
            if year != 2025 and "参考" not in m_detail:
                m_detail += "（往年口径，仅作参考）"
        m_cite = [e for e in (mat.get("evidence_ids") or []) if e in cited]
    else:
        m_state = "needs_check"
        m_detail = "库内未定位到材料清单，需以当年官方通知或学院要求为准。"
        m_cite = []

    nodes = [
        _node("year", "核实申报年度", y_detail, y_state, y_cite),
        _node("eligibility", "核对申请资格", e_detail, e_state, e_cite),
        _node("materials", "查看材料", m_detail, m_state, m_cite),
    ]

    # 4) 仅在明确 2025 年度（历史演示）时挂已有向导入口
    entry = None
    flow_ref = card.get("flow") or {}
    flow_id = flow_ref.get("flow_id")
    allowed = {flow_id} if flow_id and flow_id in kb.flows else set()
    if flow_id in allowed and year == 2025:
        entry = {"node_id": "materials", "flow_id": flow_id,
                 "historical": bool(flow_ref.get("historical"))}
        flow = kb.flows.get(flow_id) or {}
        ev: List[str] = []
        for st in flow.get("steps") or []:
            if st.get("key") in ("document", "export"):
                ev.extend(st.get("evidence_ids") or [])
        exp_cite = _ensure_cites(final, ev, cited)
        nodes.append(_node("export", "填写并导出材料",
                           "进入向导填写演示数据，按原校验预览后导出可编辑 Word。", "upcoming", exp_cite))

    return {"title": (card.get("title") or "办理路线")[:60], "nodes": nodes,
            "edges": _chain(nodes), "focus_id": _pick_focus(nodes), "workflow_entry": entry}


# ---------- 网络报修分支路线 ----------

def _plain_net(text: str) -> str:
    """把联网核对失败时的异常类名（如 ConnectError）换成可读说法。"""
    return re.sub(r"（[A-Za-z]*Error[^）]*）", "（本轮联网核对未完成）", text)


def _repair_route(kb, final, card, cited) -> Optional[Dict[str, Any]]:
    ident = card.get("identified") or {}
    campus, building = ident.get("campus"), ident.get("building")
    scope_txt = {"multi": "同宿舍多台设备都断", "single": "仅我的设备",
                 "unknown": "影响范围待确认"}.get(ident.get("device_scope") or "unknown",
                                                  "影响范围待确认")
    if campus and building:
        s_state = "ready"
        s_detail = f"已识别：{campus} {building}；{scope_txt}。"
    else:
        missing = "、".join([x for x in ([("校区" if not campus else None),
                                        ("楼栋" if not building else None)]) if x])
        s_state = "needs_user"
        s_detail = f"请补充{missing}，以便定位对应的接入设备与故障公告。"

    steps = card.get("steps") or []
    ann = card.get("announcement") or {}
    has_ann = bool(ann.get("local")) or ann.get("web_state") == "lead"
    a_state = "ready" if has_ann else "needs_check"
    a_parts: List[str] = []
    if ann.get("detail"):
        # 公告核对的技术异常类名不直接展示给用户
        a_parts.append(_plain_net(str(ann["detail"]))[:160])
    if ann.get("local_detail"):
        a_parts.append(str(ann["local_detail"])[:160])
    if steps:
        a_parts.append(f"官方自查步骤 {len(steps)} 条（见下方核对卡）")
    if not has_ann:
        a_parts.append("未查到覆盖本区域的故障公告，这不等于该区域没有故障")
    a_detail = "；".join(a_parts) or "暂无公告与自查步骤，可先按官方指南排查。"
    a_cite = [e for st in steps for e in (st.get("evidence_ids") or []) if e in cited]
    if ann.get("evidence_id") in cited:
        a_cite.append(ann["evidence_id"])

    nodes = [
        _node("scope", "确认楼栋与影响范围", s_detail, s_state, []),
        _node("announce", "查看公告和自查", a_detail, a_state, a_cite),
        _node("judge", "判断是否恢复",
              "按自查步骤逐项排查后，已恢复正常即可结束；仍无法连接说明可能为楼内接入设备或线路问题，走官方报修。",
              "upcoming", []),
    ]

    step_cite = [e for st in steps for e in (st.get("evidence_ids") or []) if e in cited]
    if step_cite:
        nodes.append(_node("resolved", "结束自查",
                           "网络恢复后无需报修；记录故障时间，如同一楼栋反复出现可反馈给网络与信息中心。",
                           "ready", []))

    entry = card.get("entry") or {}
    entry_cite = [e for e in (entry.get("evidence_ids") or []) if e in cited]
    if entry_cite:
        detail = "；".join([x for x in [entry.get("label"), entry.get("phone"),
                                        entry.get("note")] if x])
        nodes.append(_node("repair", "查看官方报修入口", detail, "ready", entry_cite))

    ids = {n["id"] for n in nodes}
    edges = [{"from_id": "scope", "to_id": "announce"},
             {"from_id": "announce", "to_id": "judge"}]
    if "resolved" in ids:
        edges.append({"from_id": "judge", "to_id": "resolved", "label": "已恢复"})
    if "repair" in ids:
        edges.append({"from_id": "judge", "to_id": "repair", "label": "仍无法连接"})
    return {"title": (card.get("title") or "网络故障处理")[:60], "nodes": nodes,
            "edges": edges, "focus_id": _pick_focus(nodes), "workflow_entry": None}


# ---------- 向导步骤路线 ----------

def _ensure_cites(final, ids: List[str], cited: set, citations_for=None) -> List[str]:
    """把向导步骤证据解析进本轮 citations（仅本地已发布/本轮联网证据），返回可用 ID。"""
    out: List[str] = []
    for cid in ids:
        if not cid:
            continue
        if cid in cited:
            out.append(cid)
            continue
        if citations_for is None or len(final.get("citations") or []) >= MAX_CITE:
            continue
        got = citations_for([cid])
        if got:
            final.setdefault("citations", []).extend(got)
            cited.add(cid)
            out.append(cid)
    return list(dict.fromkeys(out))


def _workflow_route(kb, final, cited, citations_for=None) -> Optional[Dict[str, Any]]:
    wf = final.get("workflow") or {}
    flow_id = wf.get("flow_id")
    flow = kb.flows.get(flow_id) or {}
    steps = flow.get("steps") or []
    if not (MIN_NODES <= len(steps) <= MAX_NODES):
        return None
    up_keys = ("apply",)
    ready_keys = ("materials", "print", "document")
    nodes = []
    for st in steps:
        key, name = st.get("key"), st.get("name")
        if not key or not name:
            return None
        ev = _ensure_cites(final, list(st.get("evidence_ids") or []), cited, citations_for)
        if key in ready_keys:
            state = "ready"
        elif key in up_keys or "申请" in name or "导出" in name or "送达" in name:
            state = "upcoming"
        else:
            state = "upcoming"
        nodes.append(_node(key, name, st.get("desc") or "", state, ev))
    node_ids = {n["id"] for n in nodes}
    entry = None
    for key in ("print", "document"):
        if key in node_ids:
            entry = {"node_id": key, "flow_id": flow_id,
                     "historical": bool(wf.get("historical"))}
            break
    return {"title": (flow.get("name") or "办事向导")[:60], "nodes": nodes,
            "edges": _chain(nodes), "focus_id": _pick_focus(nodes), "workflow_entry": entry}


# ---------- 模型建议路线（窄入口） ----------

def _candidate_route(candidate, cited) -> Optional[Dict[str, Any]]:
    if not isinstance(candidate, dict):
        return None
    steps = candidate.get("steps")
    if not isinstance(steps, list) or not (MIN_NODES <= len(steps) <= MAX_NODES):
        return None
    nodes = []
    for i, st in enumerate(steps):
        if not isinstance(st, dict):
            return None
        title = str(st.get("title") or "").strip()
        ev = st.get("evidence_ids")
        if not title or not isinstance(ev, list) or not ev:
            return None
        ev = [str(e) for e in ev]
        if any(e not in cited for e in ev):   # 任一步缺本轮直接依据 → 整张图放弃
            return None
        nodes.append(_node(f"step{i + 1}", title, str(st.get("detail") or ""),
                           "ready" if i == 0 else "upcoming", ev))
    return {"title": str(candidate.get("title") or "办理步骤")[:60], "nodes": nodes,
            "edges": _chain(nodes), "focus_id": nodes[0]["id"], "workflow_entry": None}


# ---------- 入口 ----------

def build_process(state, kb, final, candidate=None, citations_for=None) -> Optional[Dict[str, Any]]:
    """按优先级组装办理路线；任何问题都返回 None（不影响本轮正文）。"""
    try:
        cited = {c["id"] for c in (final.get("citations") or []) if c.get("id")}
        cards = final.get("actions") or []
        allowed_flows = set(state.get("workflows") or [])
        wf = final.get("workflow") or {}
        if wf.get("flow_id"):
            allowed_flows.add(wf["flow_id"])
        for c in cards:
            fl = c.get("flow") or {}
            if fl.get("flow_id"):
                allowed_flows.add(fl["flow_id"])

        proc = None
        checklist = next((c for c in cards if c.get("kind") == "checklist"), None)
        repair = next((c for c in cards if c.get("kind") == "repair"), None)
        if checklist:
            proc = _award_route(kb, final, checklist, cited)
        if proc is None and repair:
            proc = _repair_route(kb, final, repair, cited)
        if proc is None and final.get("status") == "workflow":
            proc = _workflow_route(kb, final, cited, citations_for)
        if proc is None and candidate is not None:
            proc = _candidate_route(candidate, cited)

        proc = _validate(proc, cited, allowed_flows)
        if proc is None:
            return None
        return proc
    except Exception:   # 路线是增强展示，任何异常都退回无图
        logger.warning("build_process failed", exc_info=True)
        return None
