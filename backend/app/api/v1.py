# -*- coding: utf-8 -*-
"""v1 API：会话、对话、服务目录、证据、向导预览与导出（方案 5.2）。"""
import hashlib
import json
import os
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Response
from fastapi.responses import FileResponse

from ..contracts import models as M
from ..agent import deepseek_adapter, graph
from ..agent.seed_slots import extract_student_facts, filter_for_flow
from ..knowledge.loader import get_kb
from ..knowledge import web_evidence
from ..knowledge.retriever import retrieve
from ..rules.engine import evaluate_rules
from ..documents import renderer as doc_renderer
from ..models import store

router = APIRouter(prefix="/api/v1")


def _err(status: int, code: str, message: str, retryable=False, trace_id=None, field_errors=None):
    raise HTTPException(status, detail=M.ErrorBody(
        code=code, message=message, retryable=retryable, trace_id=trace_id,
        field_errors=field_errors).model_dump())


def _load_session(session_id: str):
    row = store.get_session(session_id)
    if not row:
        _err(404, "session_not_found", "会话不存在或已清除")
    if store.session_expired(row):
        _err(410, "session_expired", "会话已过期，请新建会话")
    return row


# ---------- 健康 ----------

@router.get("/health/live", response_model=M.LiveResponse)
def live():
    return M.LiveResponse()


@router.get("/health/ready", response_model=M.ReadyResponse)
def ready():
    kb = get_kb()
    cfg = deepseek_adapter.describe_config()
    return M.ReadyResponse(knowledge_version=kb.kb_version,
                           knowledge_sources=len(kb.documents),
                           knowledge_evidence=len(kb.clauses),
                           model_provider=cfg["provider"] or "local-rules",
                           model_configured=cfg["configured"])


# ---------- 会话 ----------

@router.post("/sessions", response_model=M.SessionCreated, status_code=201)
def create_session():
    sid = store.new_session()
    row = store.get_session(sid)
    return M.SessionCreated(session_id=sid,
                            expires_at=datetime.fromtimestamp(row["expires_at"]).isoformat())


@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: str):
    _load_session(session_id)
    rows = store.list_messages(session_id)
    return {"messages": [
        {"request_id": r["request_id"], "seq": r["seq"], "role": r["role"],
         "status": r["status"], "text": r["text"], "response": r["response"]}
        for r in rows]}


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str):
    _load_session(session_id)
    store.delete_session(session_id)
    return Response(status_code=204)


# ---------- 对话 ----------

@router.post("/chat", response_model=M.ChatResponse)
def chat(req: M.ChatRequest):
    row = _load_session(req.session_id)

    if not req.message and not req.choice_id:
        _err(422, "invalid_request", "message 与 choice_id 必须二选一")
    if req.message and req.choice_id:
        _err(422, "invalid_request", "message 与 choice_id 只能选一个")

    # 幂等：相同 request_id 复用已完成结果；内容不同则 409。
    # 技术错误轮（error）不复用——删除旧记录重新执行，使前端"重试"真正重跑。
    existing = store.find_turn(req.session_id, req.request_id)
    if existing:
        user_turn = next((t for t in existing if t["role"] == "user"), None)
        if user_turn and (user_turn["text"] or "") != (req.message or req.choice_id or ""):
            _err(409, "request_id_conflict", "该 request_id 已用于不同内容", retryable=True)
        assistant = next((t for t in existing if t["role"] == "assistant"), None)
        if assistant and assistant.get("response") \
                and assistant["response"].get("status") not in ("error", "model_unavailable"):
            return M.ChatResponse(**assistant["response"])
        store.delete_turn(req.session_id, req.request_id)

    slots = {}
    try:
        slots = dict(json.loads(row["slots"])) if row["slots"] else {}
    except (ValueError, TypeError):
        slots = {}

    # ---- 澄清选项处理（核心：选完选项后回放到原始问题，不再以选项词单独路由）----
    def _last_clarify():
        """返回最近一次澄清的 clarify 对象（含 choices）；无待处理澄清则返回 {}。"""
        try:
            msgs = store.list_messages(req.session_id)
        except Exception:
            return {}
        for m in reversed(msgs):
            if m["role"] == "assistant":
                resp = m["response"] or {}
                return resp.get("clarify") or {} if resp.get("status") == "clarify" else {}
        return {}

    effective_choice = None
    if req.choice_id:
        effective_choice = req.choice_id
    elif req.message:
        # 用户手输的短文本恰好等于候选项（id 或 label，忽略大小写）→ 视为选择
        pend = _last_clarify() or {}
        text = (req.message or "").strip().lower()
        for o in pend.get("choices") or []:
            if text and text in (str(o.get("id", "")).lower(), str(o.get("label", "")).lower()):
                effective_choice = str(o.get("id") or o.get("label"))
                break

    if effective_choice:
        slots = graph.apply_choice(slots, effective_choice)
        label = effective_choice
        pend = _last_clarify() or {}
        for o in pend.get("choices") or []:
            if str(o.get("id")) == effective_choice:
                label = o.get("label") or effective_choice
                break
        # 回放：原始问题 + 选项标签（如“国家励志奖学金要什么条件？ 本科生”），
        # 使路由同时具有问题上下文与身份/卡片类型信息
        replay = (row.get("last_query") or "").strip()
        query = (replay + " " + label).strip() if replay else label
        text_hint = req.message if req.message else effective_choice  # 幂等比对用
        keep_query = (row.get("last_query") or "")
    else:
        query = req.message or ""
        text_hint = req.message
        keep_query = (req.message or "")

    # 最近对话（供模型理解上下文：会话追问、混合问法、多轮语境）
    history = []
    try:
        for m in store.list_messages(req.session_id)[-6:]:
            history.append({"role": m["role"], "text": m["text"] or ""})
    except Exception:
        history = []

    result = graph.run_turn(req.session_id, req.request_id, query or "",
                            slots=slots, entrypoint="vue", history=history)
    final = result["final"]
    new_slots = result["slots"]

    # 办事体验改造：进入向导的响应上附带「会话里学生自述过的身份事实」
    # （本科/二年级）。仅取学生自己说过的第一人称事实，后说的覆盖先说的；
    # 旧会话/普通回答不受影响（字段只附在 workflow 与 checklist 的 flow 引用上）。
    _attach_preset(final, req.session_id)

    store.add_turn(req.session_id, req.request_id, "user", text_hint or "", status="done")
    store.add_turn(req.session_id, req.request_id, "assistant", final.get("message") or "",
                   response=final, slots=new_slots, status=final["status"])
    with store._conn() as c:
        c.execute("UPDATE sessions SET slots=?, last_query=? WHERE session_id=?",
                  (json.dumps(new_slots, ensure_ascii=False), keep_query, req.session_id))
    return M.ChatResponse(**final)


MAX_PRESET_TURNS = 12


def _attach_preset(final: dict, session_id: str):
    """把会话中用户自述的身份事实附到向导入口（workflow 响应 / checklist 卡的 flow）。

    只在响应里真的出现了向导入口时才抽；抽取规则见 agent.seed_slots。"
    flows = get_kb().flows
    targets = []  # [(flow_id, holder)]
    if final.get("status") == "workflow" and final.get("workflow"):
        targets.append((final["workflow"].get("flow_id"), final["workflow"]))
    for act in final.get("actions") or []:
        if isinstance(act, dict) and isinstance(act.get("flow"), dict):
            targets.append((act["flow"].get("flow_id"), act["flow"]))
    if not targets:
        return
    try:
        user_texts = [m["text"] for m in store.list_messages(session_id)
                      if m["role"] == "user"][-MAX_PRESET_TURNS:]
        # 本轮用户输入在 add_turn 之前还不在库里，补在末尾
        last_user = next((m for m in reversed(store.list_messages(session_id))
                          if m["role"] == "user"), None)
    except Exception:
        user_texts, last_user = [], None
    facts = extract_student_facts(user_texts)
    if not facts:
        return
    excerpt = facts.get("source_excerpt") or ""
    for flow_id, holder in targets:
        flow = flows.get(flow_id) or {}
        preset = filter_for_flow(facts, flow.get("required_slots") or [])
        if not preset:
            continue
        holder["preset_slots"] = preset
        holder["preset_note"] = excerpt


# ---------- 服务目录 ----------

_BOARD_TITLES = {
    "lz-overview": ("国家励志奖学金政策", "学工"),
    "lz-condition": ("国家励志奖学金资格条件", "学工"),
    "lz-materials": ("国家励志奖学金办理与材料", "学工"),
    "zhu-overview": ("国家助学金", "学工"),
    "gj-overview": ("国家奖学金", "学工"),
    "rd-overview": ("家庭经济困难认定", "学工"),
    "xsz-banli": ("学生证与乘车优惠卡补办", "学工"),
    "venue-flow": ("教学场所临时借用", "教务"),
    "huankao": ("缓考申请", "教务"),
    "chengjidan": ("中英文成绩单打印", "教务"),
    "xuewei": ("学位证明书补办", "教务"),
    "xiuxue": ("休学（保留学籍）", "教务"),
    "fuxue": ("复学", "教务"),
    "zhuanzye": ("转专业", "教务"),
    "xuanke": ("选课与补退选", "教务"),
    "qingjia": ("课程请假", "教务"),
    "xiaoli": ("校历与考试周", "教务"),
    "weixiu": ("宿舍与水电报修", "后勤"),
    "canteen": ("学生餐厅", "后勤"),
    "huiwu": ("会务场地使用", "后勤"),
    "gate": ("校门出入", "保卫"),
    "jiaotong": ("校园交通与电动自行车", "保卫"),
    "dianhua": ("保卫值班与咨询电话", "保卫"),
    "lib-loan": ("图书借阅数量与期限", "图书馆"),
    "lib-renew": ("图书续借与归还", "图书馆"),
    "lib-overdue": ("逾期与遗失赔偿", "图书馆"),
    "lib-disc": ("讨论间使用", "图书馆"),
    "lib-entry": ("入馆须知", "图书馆"),
    "lib-fee": ("查新查引与打印收费", "图书馆"),
    "lib-offcampus": ("校外访问电子资源", "图书馆"),
    "lib-visitor": ("校外人员参观", "图书馆"),
    "cs-intro": ("信息科学与技术学院概况", "学院"),
}

_BOARD_SAMPLES = {
    "学工": ["国家励志奖学金有多少钱", "我是本科生，申请励志奖学金要什么条件"],
    "教务": ["借教室要提前几天申请", "缓考要什么材料"],
    "后勤": ["宿舍水管坏了找谁报修", "学校有哪些学生餐厅"],
    "保卫": ["电动自行车怎么办校园通行牌", "校内报警电话是多少"],
    "图书馆": ["本科生一次能借几本书", "图书丢了怎么赔偿"],
    "学院": ["介绍一下信科院", "信科院有哪些专业"],
}

_FLOW_OF_TOPIC = {
    "lz-overview": "national_inspirational_2025", "lz-condition": "national_inspirational_2025",
    "lz-materials": "national_inspirational_2025", "qingjia": "leave_request",
    "venue-flow": "venue_borrow",
}

_EVIDENCE_OF_TOPIC = {
    "lib-loan": ["lib-loan-c2", "lib-loan-c1"],
    "lib-disc": ["lib-disc-c1"],
    "venue-flow": ["jw-venue-c1", "jw-venue-c2"],
    "qingjia": ["sk-leave-c1"],
    "lz-overview": ["xg-lz-c1", "xg-cj181-c1"],
    "lz-condition": ["xg-lz-c2"],
    "weixiu": ["hq-sd-c1", "hq-wx-c1"],
    "jiaotong": ["bw-eb-c1", "bw-tr-c1"],
    "dianhua": ["bw-ph-c1"],
    "gate": ["bw-gate-c1", "bw-gate-c2"],
    "cs-intro": ["xy-cs-c1", "xy-cs-c2", "xy-cs-c3", "xy-cs-c4", "xy-cs-c5"],
}


@router.get("/services", response_model=M.ServicesResponse)
def services(board: Optional[str] = None, q: Optional[str] = None):
    kb = get_kb()
    items = []
    for topic in kb.qa_topics:
        title_info = _BOARD_TITLES.get(topic["topic_id"])
        if title_info:
            name, topic_board = title_info
            evidence_ids = _EVIDENCE_OF_TOPIC.get(topic["topic_id"], [])
            flow_id = _FLOW_OF_TOPIC.get(topic["topic_id"])
        elif topic.get("object_college"):
            # 导入式学院主题（import_college_intro）：入口与证据按主题事实自动生成
            name, topic_board = f"{topic['object_college']}概况", "学院"
            evidence_ids = []
            for fid in topic.get("fact_ids", []):
                evidence_ids.extend((kb.facts.get(fid) or {}).get("evidence_ids", []))
            evidence_ids = evidence_ids[:4]
            flow_id = None
        else:
            continue
        if board and board != topic_board:
            continue
        if q and q not in name and not any(q in t for t in topic.get("triggers", [])):
            continue
        items.append(M.ServiceEntry(
            service_id=topic["topic_id"], name=name, board=topic_board,
            summary=topic.get("title", ""),
            evidence_ids=evidence_ids,
            flow_id=flow_id,
            sample_questions=_BOARD_SAMPLES.get(topic_board, [])[:2]))
    return M.ServicesResponse(services=items, knowledge_version=kb.kb_version)


# ---------- 证据 ----------

@router.get("/evidence/{evidence_id}", response_model=M.EvidenceResponse)
def evidence(evidence_id: str):
    kb = get_kb()
    c = kb.citation(evidence_id)
    if not c:
        # 本轮联网查证注册的官网证据（web- 前缀）：可打开实际官网原文
        w = web_evidence.get(evidence_id)
        if w:
            return M.EvidenceResponse(
                id=w["id"], title=w["title"], issuer=w["issuer"], url=w["url"],
                published_at=w.get("published_at"), effective_from=None, effective_to=None,
                locator=w.get("locator"), excerpt=w.get("excerpt") or "",
                time_condition=None, review_state=w.get("review_state"),
                doc_id=f"web:{evidence_id}", knowledge_version=kb.kb_version)
        _err(404, "evidence_not_found", "证据不存在或未发布")
    return M.EvidenceResponse(
        id=c["evidence_id"], title=c["title"], issuer=c["issuer"], url=c["source_url"],
        published_at=c.get("published_at"), effective_from=c.get("effective_from"),
        effective_to=c.get("effective_to"), locator=c.get("locator"),
        excerpt=c.get("exact_text") or "", time_condition=c.get("time_condition"),
        review_state=c.get("review_state"), doc_id=c["doc_id"],
        knowledge_version=kb.kb_version)


# ---------- 向导 ----------

BOARD_OF_FLOW = {"national_inspirational_2025": "学工", "leave_request": "教务", "venue_borrow": "教务"}


@router.get("/workflows", response_model=M.WorkflowsResponse)
def workflows(board: Optional[str] = None):
    kb = get_kb()
    items = []
    for fid, f in kb.flows.items():
        if board and board not in BOARD_OF_FLOW.get(fid, ""):
            continue
        items.append(M.WorkflowSummary(
            flow_id=fid, name=f.get("name", ""), version=f.get("version", ""),
            historical=bool(f.get("demo_mode")), scope=f.get("applicable_scope", {}),
            boards=[BOARD_OF_FLOW.get(fid, "")],
            steps=[s["name"] for s in f.get("steps", [])]))
    return M.WorkflowsResponse(workflows=items)


def _flow_detail(fid: str) -> tuple:
    kb = get_kb()
    flow = kb.flows.get(fid)
    if not flow:
        _err(404, "workflow_not_found", "向导不存在")
    steps = [M.WorkflowStep(key=s["key"], name=s["name"], desc=s.get("desc", ""),
                            slot_keys=s.get("slot_keys", []),
                            evidence_ids=s.get("evidence_ids", [])) for s in flow.get("steps", [])]
    slots = [M.SlotSpec(**s) for s in flow.get("required_slots", [])]
    materials = [M.MaterialView(**m) for m in flow.get("materials", [])]
    rules_hint = []
    for rid in flow.get("rule_ids", []):
        r = kb.rules.get(rid)
        if r:
            rules_hint.append(M.RuleResultView(rule_id=rid, name=r.get("name", "核对项"),
                                               state="unknown", evidence_ids=r.get("evidence_ids", [])))
    all_ev = sorted({cid for s in steps for cid in s.evidence_ids})
    return flow, M.WorkflowDetail(
        flow_id=fid, name=flow.get("name", ""), version=flow.get("version", ""),
        historical=bool(flow.get("demo_mode")), demo_notice=flow.get("demo_notice"),
        scope=flow.get("applicable_scope", {}), steps=steps, slots=slots,
        rule_results=rules_hint, materials=materials,
        timeline=flow.get("timeline", []), contact=flow.get("contact"), evidence_ids=all_ev)


@router.get("/workflows/{flow_id}", response_model=M.WorkflowDetail)
def workflow_detail(flow_id: str):
    _, detail = _flow_detail(flow_id)
    return detail


def _validate_inputs(flow, inputs: dict):
    errors = []
    for spec in flow.get("required_slots", []):
        key, label = spec["key"], spec["label"]
        v = inputs.get(key)
        if spec.get("required") and (v is None or str(v).strip() == ""):
            errors.append(M.FieldError(slot_key=key, message=f"请填写「{label}」"))
        if v in (None, ""):
            continue
        if spec["type"] == "number":
            try:
                float(v)
            except (TypeError, ValueError):
                errors.append(M.FieldError(slot_key=key, message=f"「{label}」需为数字"))
        if spec["type"] == "date" and not str(v).count("-") == 2:
            errors.append(M.FieldError(slot_key=key, message=f"「{label}」需为日期（YYYY-MM-DD）"))
    return errors


def _preview_token(flow_id: str, flow_version: str, kb_version: str, inputs: dict) -> str:
    canon = json.dumps({"f": flow_id, "v": flow_version, "kb": kb_version,
                        "i": inputs}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:24]


@router.post("/workflows/{flow_id}/preview", response_model=M.PreviewResponse)
def preview(flow_id: str, req: M.PreviewRequest):
    kb = get_kb()
    flow, detail = _flow_detail(flow_id)
    if req.flow_version != flow.get("version", ""):
        _err(409, "version_conflict", "向导版本已变化，请刷新后再试", retryable=True)
    field_errors = _validate_inputs(flow, req.inputs)
    rule_results, _derived = evaluate_rules(flow_id, req.inputs)
    if flow.get("demo_mode") and not req.historical_confirmed:
        field_errors.append(M.FieldError(slot_key="_historical", message="请先确认历史演示提示"))

    personal_missing = [s["label"] for s in flow.get("required_slots", [])
                        if s.get("personal") and not str(req.inputs.get(s["key"], "")).strip()]

    token = _preview_token(flow_id, flow["version"], kb.kb_version, req.inputs)
    return M.PreviewResponse(
        preview_token=token, flow_id=flow_id, flow_version=flow["version"],
        field_errors=field_errors,
        rule_results=[M.RuleResultView(**r) for r in rule_results],
        materials=detail.materials, missing_personal_fields=personal_missing,
        document_kinds=["docx"],
        evidence_ids=detail.evidence_ids,
        generated=not field_errors)


@router.post("/workflows/{flow_id}/export")
def export(flow_id: str, req: M.ExportRequest):
    kb = get_kb()
    flow, detail = _flow_detail(flow_id)
    if req.flow_version != flow.get("version", ""):
        _err(409, "version_conflict", "向导版本已变化，请刷新预览后再导出", retryable=True)
    expect_token = _preview_token(flow_id, flow["version"], kb.kb_version, req.inputs)
    if req.preview_token != expect_token:
        _err(409, "preview_stale", "表单内容已变化，请重新预览后再导出", retryable=True)
    field_errors = _validate_inputs(flow, req.inputs)
    rule_results, _ = evaluate_rules(flow_id, req.inputs)
    if any(fe.slot_key == "_historical" for fe in field_errors) or \
            (flow.get("demo_mode") and not req.historical_confirmed):
        _err(422, "historical_confirm_required", "导出历史演示文档前需要确认提示",
             field_errors={"_historical": "请先勾选历史演示确认"})
    if field_errors:
        _err(422, "field_errors", "字段校验未通过",
             field_errors={fe.slot_key: fe.message for fe in field_errors})

    task_like = {"task_id": "wx-" + req.preview_token[:10], "slots": dict(req.inputs),
                 "historical": bool(flow.get("demo_mode"))}
    result = doc_renderer.render_document(flow_id, flow.get("template_id"), task_like, rule_results)

    main = result["main"]
    filename = _download_name(flow, result, req.inputs)
    return FileResponse(
        main["path"], filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Cache-Control": "no-store"})


def _download_name(flow, result, inputs: dict) -> str:
    base = os.path.splitext(os.path.basename(result["main"]["filename"]))[0]
    name = str(inputs.get("name", "")).strip()
    # 中文文件名去非法字符并限长（方案 8.4：中文可读文件名）
    safe = "".join(ch for ch in name if ch not in '\\/:*?"<>|')[:12]
    stamp = datetime.now().strftime("%m%d%H%M")
    if safe:
        return f"{base}_{safe}_{stamp}.docx".strip("_")
    return f"{base}_{stamp}.docx"
