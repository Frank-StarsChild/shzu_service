# -*- coding: utf-8 -*-
"""A0 自检：依赖锁定、notes 字段跨节点传递、退化路径模型↔工具循环、历史过滤出错轮次。

不需要 API Key（模型用假模型替换）。用法：项目根目录 `python scripts/check_a0.py`，
全部断言通过时打印「A0 全部通过」。
"""
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

RESULTS = []


def check(name, cond, extra=""):
    RESULTS.append(bool(cond))
    print(("PASS" if cond else "FAIL"), name, ("- " + str(extra)) if extra else "")
    return bool(cond)


# ---------- 1. 依赖清单：venv 里跑得起来的东西必须能重装 ----------

def check_requirements():
    path = os.path.join(os.path.dirname(__file__), "..", "backend", "requirements.txt")
    with open(path, encoding="utf-8") as f:
        lines = [l.strip().lower() for l in f if l.strip()]
    for want in ("langchain-core==", "langchain-openai==", "langgraph==",
                 "openai==", "python-dotenv=="):
        hit = any(l.startswith(want) for l in lines)
        check(f"依赖含 {want}（带版本号）", hit)


check_requirements()


# ---------- 2. notes 字段能传到下一个节点 ----------

def check_notes():
    try:
        from langgraph.graph import END, START, StateGraph
    except Exception as e:  # langgraph 没装：退化路径本身就该跑通（第 3 条还在测）
        check("langgraph 可导入（notes 传递用）", False, e)
        return
    from datetime import datetime
    from backend.app.agent import graph
    from backend.app.knowledge.loader import get_kb

    captured = {}

    def capture(state):
        captured["notes"] = state.get("notes")
        return {}

    g = StateGraph(graph.ChatState)
    g.add_node("prepare", graph.node_prepare)
    g.add_node("capture", capture)
    g.add_edge(START, "prepare")
    g.add_edge("prepare", "capture")
    g.add_edge("capture", END)
    app = g.compile()

    init = {
        "session_id": "ses-a0-notes",
        "request_id": "req-a0-notes",
        "trace_id": "trace-a0-notes",
        "query": "2026年国家励志奖学金怎么申请",
        "business_date": datetime.now().strftime("%Y-%m-%d"),
        "entrypoint": "vue",
        "slots": {},
        "history": [],
        "knowledge_version": get_kb().kb_version,
    }
    app.invoke(dict(init))
    notes = captured.get("notes")
    check("notes 传到下一个节点（非空列表）", isinstance(notes, list) and len(notes) > 0,
          "" if isinstance(notes, list) else repr(notes))
    check("notes 有一条以「年度校验」开头",
          isinstance(notes, list) and any(str(n).startswith("年度校验") for n in notes))


check_notes()


# ---------- 3. 退化路径：模型↔工具循环（不带 langgraph 也能答对） ----------

def check_fallback_loop():
    from langchain_core.messages import AIMessage, ToolMessage
    from backend.app.agent import graph, deepseek_adapter

    calls = {"n": 0}

    class FakeModel:
        def bind_tools(self, tools, **kw):
            return self

        def invoke(self, msgs, **kw):
            calls["n"] += 1
            if calls["n"] == 1:
                return AIMessage(
                    content="",
                    tool_calls=[{
                        "name": "search_campus_knowledge",
                        "args": {"query": "图书馆 借书 数量"},
                        "id": "call-a0-1",
                        "type": "tool_call",
                    }],
                )
            # 第二次：从消息末尾的 ToolMessage 里取第一条真实证据，产出合法最终 JSON
            last = msgs[-1]
            evid = []
            if isinstance(last, ToolMessage):
                try:
                    payload = json.loads(last.content)
                    evid = [h["id"] for h in (payload.get("evidence") or [])]
                except Exception:
                    evid = []
            final_json = {
                "status": "answer",
                "reply": "本科生一次最多可借若干图书，具体以图书馆现行规定为准。",
                "evidence_ids": evid[:1],
                "clarify_choices": [],
                "flow_id": None,
            }
            return AIMessage(content=json.dumps(final_json, ensure_ascii=False))

    orig_compiled = getattr(graph, "_COMPILED", "missing")
    orig_create = deepseek_adapter.create_chat_model
    graph._COMPILED = None
    deepseek_adapter.create_chat_model = lambda *a, **kw: FakeModel()
    try:
        result = graph.run_turn("ses-a0-fallback", "req-a0-fallback",
                                "图书馆一次能借几本书", slots={}, history=[])
        final = result["final"]
        check("退化路径最终 status == answer", final.get("status") == "answer",
              final.get("status"))
        check("假模型恰好被调用 2 次（模型→工具→模型）", calls["n"] == 2, f"calls={calls['n']}")
        if final.get("status") == "answer":
            check("最终回答附真实证据", bool(final.get("citations")), "")
    finally:
        graph._COMPILED = orig_compiled if orig_compiled != "missing" else None
        deepseek_adapter.create_chat_model = orig_create


check_fallback_loop()


# ---------- 4. 历史：出错轮次不进模型上下文 ----------

def check_history():
    from backend.app.models import store
    from backend.app.agent import graph
    from backend.app.api import v1

    store.init_db()
    sid = store.new_session()
    store.add_turn(sid, "req-a0-h1", "user", "你好", status="done")
    store.add_turn(sid, "req-a0-h1", "assistant", "你好！", status="answer")
    store.add_turn(sid, "req-a0-h2", "user", "借书", status="done")
    store.add_turn(sid, "req-a0-h2", "assistant", graph.ERRORS["model_timeout"],
                   status="error")
    hist = v1._history_for(sid)
    timeout_text = graph.ERRORS["model_timeout"]
    check("历史里没有出错轮次的技术提示", all(h.get("text") != timeout_text for h in hist))
    check("正常回答「你好！」仍在历史里", any(h.get("text") == "你好！" for h in hist))
    check("用户消息仍在历史里", any(h.get("text") == "借书" for h in hist))


check_history()


def check_latency_routes():
    from copy import copy
    from time import perf_counter
    from unittest.mock import patch
    from backend.app.agent import graph
    from backend.app.knowledge.loader import get_kb

    kb = get_kb()
    state = {"session_id": "test", "request_id": "test", "trace_id": "test",
             "knowledge_version": kb.kb_version, "business_date": "2026-11-26",
             "timings": {"start": perf_counter()}}

    def reply(query):
        return graph._reviewed_reply({**state, "query": query}, kb)

    card = reply("请问，怎么补卡？")
    check("卡种不明直接追问，可选三种卡",
          card and [c["id"] for c in card["clarify"]["choices"]] == ["学生证", "校园卡", "银行卡"])
    check("明确卡种及复合问题保留正常问答",
          reply("怎么补办学生证？") is None and reply("怎么补办卡？校园网也连不上。") is None)
    alias = reply("“小绿”是什么意思？")
    check("未知别名按已登记资料澄清", alias and alias["status"] == "clarify" and "未核实" in alias["message"])
    award_question = "我是本科生，申请国家励志奖学金需要什么条件？"
    award = reply(award_question)
    check("单一奖学金条件问题直接引用正式通知",
          award and "2025 年度" in award["message"] and "前30%" in award["message"]
          and {c["id"] for c in award["citations"]} == {"xg-lz-c1", "xg-lz-c2"})
    check("指定申报年度保留正常核查", reply("2026年国家励志奖学金申请条件是什么？") is None)
    new_kb = copy(kb)
    new_kb.documents = {**kb.documents, "new-award": {"document_year": 2026, "title": "2026年国家励志奖学金评审通知"}}
    check("出现新版通知时历史条件不走直答", graph._reviewed_reply({**state, "query": award_question}, new_kb) is None)
    with patch.object(graph.deepseek_adapter, "is_configured", return_value=True):
        prepared = graph.node_prepare({**state, "query": "校外访客怎么进校？"})
    check("首轮预检索给模型带上已审定证据，仍允许补查",
          len(prepared["messages"]) == 1 and bool(prepared["evidence_ids"]) and not prepared["prepared_reply"]
          and prepared["evidence_ids"][0] in graph._system_message(prepared).content)


check_latency_routes()


print("=" * 30)
if all(RESULTS):
    print("A0 全部通过")
    sys.exit(0)
print("A0 存在未通过项")
sys.exit(1)
