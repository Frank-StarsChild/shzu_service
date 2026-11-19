# -*- coding: utf-8 -*-
"""后端冒烟测试（离线，不依赖模型）：知识库加载 + 三个 LangChain 工具 + 规则引擎。
用法：python scripts/smoke_test.py（工作目录为 shzu-service-agent/）
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.knowledge.loader import get_kb
from backend.app.agent.tools import TOOLS
from backend.app.rules.engine import evaluate_rules

kb = get_kb()
print("KB:", kb.kb_version, "docs:", len(kb.documents), "clauses:", len(kb.clauses),
      "facts:", len(kb.facts), "flows:", list(kb.flows.keys()))

cfg = {"configurable": {"query_context": "宿舍漏水怎么报修"}}

r1 = TOOLS["search_campus_knowledge"].invoke({"query": "宿舍漏水 报修 物业 电话"}, config=cfg)
print("-" * 50)
print("search_campus_knowledge: evidence =", [e["id"] for e in r1["evidence"]][:4])
print("  first:", (r1["evidence"][0]["text"][:60] + "…") if r1["evidence"] else "(无)")

r2 = TOOLS["search_campus_knowledge"].invoke(
    {"query": "信息科学与技术学院 简介 专业"}, config={"configurable": {"query_context": "信科院介绍"}})
print("search(scoped): college_scope =", r2["college_scope"], "evidence =",
      [e["id"] for e in r2["evidence"]][:3], "| all same college:",
      all(e["college"] == "信息科学与技术学院" for e in r2["evidence"]))

r3 = TOOLS["list_campus_colleges"].invoke({}, config=cfg)
print("list_campus_colleges: count =", r3["count"],
      "| 筹建单位:", [c["name"] for c in r3["colleges"] if "（筹）" in c["name"]])
print("  intro available:", [c["name"] for c in r3["colleges"] if c["intro_available"]])

r4 = TOOLS["find_service_workflow"].invoke(
    {"flow_id": "national_inspirational_2025"},
    config={"configurable": {"query_context": "我要申请国家励志奖学金"}})
print("find_service_workflow(no year):", r4)
r5 = TOOLS["find_service_workflow"].invoke(
    {"flow_id": "national_inspirational_2025"},
    config={"configurable": {"query_context": "用 2025 年历史演示流程了解国家励志奖学金申请"}})
print("find_service_workflow(2025 demo):", r5.get("available"), r5.get("id"))

# 规则引擎测试（不变）
slots = {"grade": "二年级", "difficulty_confirmed": "是", "study_rank": 40, "study_total": 100,
         "zongce_rank": 80, "zongce_total": 100, "national_scholarship_this_year": "否",
         "application_year": 2025}
results, derived = evaluate_rules("national_inspirational_2025", slots)
print("-" * 50)
for r in results:
    print("RULE:", r["rule_id"], r["state"], r.get("value"))

slots2 = dict(slots, difficulty_confirmed="不确定", study_rank=95, study_total=100)
results2, _ = evaluate_rules("national_inspirational_2025", slots2)
print("unknown count:", sum(1 for r in results2 if r["state"] == "unknown"),
      "fail count:", sum(1 for r in results2 if r["state"] == "fail"))
print("SMOKE OK")
