# -*- coding: utf-8 -*-
"""v1 契约烟测：graph 运行、会话轮次、向导预览 token。"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.agent import graph, deepseek_adapter
from backend.app.knowledge.loader import get_kb

print("provider:", deepseek_adapter.describe_config()["configured"],
      "=> provider:", deepseek_adapter.describe_config()["provider"])

kb = get_kb()
print("kb:", kb.kb_version, "flows:", list(kb.flows.keys()))

cases = [
    "本科生一次能借几本书",
    "我要申请国家励志奖学金",
    "补办卡",
    "今天图书馆几点关门",
    "2026年励志奖学金怎么申请",
    "石河子大学校长的偶像是谁",
    "缓考要什么材料",
    "电动自行车怎么办理校园通行牌",
]
for q in cases:
    r = graph.run_turn("ses-smoke", "req-" + q[:6], q, slots={})
    f = r["final"]
    print("-" * 60)
    print("Q:", q)
    print("  status:", f["status"], "| timing:", f.get("timing_ms"), "ms")
    if f["status"] == "answer":
        for b in f["answer"]["blocks"][:3]:
            print("   block:", b["text"][:70], "→", b["citation_ids"])
    elif f["status"] == "clarify":
        print("   clarify:", f["clarify"]["question"], [c["label"] for c in f["clarify"]["choices"]])
    elif f["status"] == "workflow":
        print("   workflow:", f["workflow"]["flow_id"], f["workflow"]["flow_version"],
              "historical:", f["workflow"]["historical"])
    else:
        print("   message:", (f.get("message") or "")[:80])

# 选择候选项 → 槽位继承（补卡→学生证 → 学生证补办答案）
r1 = graph.run_turn("ses-smoke2", "req-c1", "怎么补办卡", slots={})
slots = graph.apply_choice({}, "学生证")
r2 = graph.run_turn("ses-smoke2", "req-c2", "学生证", slots=slots)
print("-" * 60)
print("补办卡 → 学生证：")
print("  r1:", r1["final"]["status"], "|", (r1["final"].get("clarify") or {}).get("question"))
print("  r2:", r2["final"]["status"])
if r2["final"]["answer"]:
    for b in r2["final"]["answer"]["blocks"][:3]:
        print("   block:", b["text"][:70])
print("SMOKE v1 OK")
