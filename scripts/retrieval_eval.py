# -*- coding: utf-8 -*-
"""检索评测：BM25 基线（可选对照 BM25+向量）。

指标：
- hit@6：正确证据进入 Top 6 条款的比例（期望约束 = 文本标记 + 学院/板块约束）
- cross-college：学院限定问题上 Top 6 中出现其他学院条款的条数
- latency：单次 retrieve() 平均毫秒（含/不含首次建索引）

用法：
  .venv\\Scripts\\python.exe scripts\\retrieval_eval.py            # BM25 基线
  .venv\\Scripts\\python.exe scripts\\retrieval_eval.py --vector   # 对照（需先 build_vector_index）
"""
import argparse
import sys
import time

sys.path.insert(0, ".")

from backend.app.knowledge.retriever import norm_college  # noqa: E402
from backend.app.knowledge.retriever import retrieve  # noqa: E402

# 期望约束：text_any（命中任一标记即算对）、college（条款归属学院）、
# category（所属文档板块）、fact_subject（事实通道中出现该主体）
CASES = [
    {"q": "介绍一下生命科学学院", "text_any": ["1959", "生理生化教研室", "生物科学系"], "college": "生命科学学院"},
    {"q": "生科院有哪些本科专业", "text_any": ["本科专业", "生物科学", "生物技术"], "college": "生命科学学院"},
    {"q": "生命科学学院有哪些副教授", "text_any": ["副教授"], "college": "生命科学学院", "fact_subject_any": True},
    {"q": "孙桂香 是什么职称", "text_any": ["孙桂香"], "fact_any": ["副教授"]},
    {"q": "王立昌 是什么职称", "text_any": ["王立昌"], "fact_any": ["教授"]},
    {"q": "介绍一下信科院", "text_any": ["信息科学与技术学院", "网络空间安全"], "college": "信息科学与技术学院（网络空间安全学院）"},
    {"q": "本科生一次能借几本书", "text_any": ["借阅", "借书", "册"]},
    {"q": "校园卡怎么发放", "text_any": ["校园卡", "发放"]},
    {"q": "2026-2027学年校历", "text_any": ["校历", "2026"]},
    {"q": "学生证丢了怎么补办", "text_any": ["学生证", "补办"]},
    {"q": "电动自行车怎么办通行牌", "text_any": ["电动自行车", "通行牌"]},
    {"q": "财教〔2021〕310号 学生资助资金管理办法", "text_any": ["310", "资助资金管理办法"]},
    {"q": "体育学院导师名单", "text_any": ["职称", "导师", "研究方向", "研究生"], "college": "体育学院"},
    {"q": "农学院有哪些专业", "text_any": ["专业"], "college": "农学院"},
    {"q": "研究生复试安排", "text_any": ["复试", "研究生"]},
    {"q": "心理咨询服务在哪", "text_any": ["心理"]},
    {"q": "财务报销流程", "text_any": ["报销"]},
    {"q": "校园网账号怎么办", "text_any": ["校园网", "网络", "账号"]},
    {"q": "学校有几个校区 学校概况", "text_any": ["校区", "概况", "学校"]},
    {"q": "迎新报到时间", "text_any": ["迎新", "报到"]},
    {"q": "宿舍水电维修报修", "text_any": ["报修", "维修", "水电"]},
    {"q": "图书馆讨论间预约", "text_any": ["讨论间", "研修间"]},
]


def run(tag: str):
    """走真实检索工具链路（含范围判定、意图注入、多段融合）。"""
    from backend.app.knowledge.loader import get_kb
    from backend.app.agent.tools import search_campus_knowledge
    kb = get_kb()
    hits, cross, latencies, fails = 0, 0, [], []
    for case in CASES:
        t0 = time.perf_counter()
        result = search_campus_knowledge.invoke(
            {"query": case["q"]}, config={"configurable": {"query_context": case["q"]}})
        latencies.append((time.perf_counter() - t0) * 1000)
        evidence = result.get("evidence") or []
        facts = result.get("facts") or []
        top = evidence[:6]
        ok = False
        for c in top:
            cl = kb.clauses.get(c["id"]) or {}
            text_ok = any(m in (cl.get("exact_text") or "") for m in case.get("text_any", [])) \
                if case.get("text_any") else True
            col_ok = (norm_college(cl.get("college")) == norm_college(case["college"])) \
                if case.get("college") else True
            if text_ok and col_ok:
                ok = True
                break
        if case.get("fact_any"):
            ok = ok or any(any(m in str(f.get("value") or "") or m in str(f.get("label") or "")
                            for m in case["fact_any"]) for f in facts[:6])
        if case.get("fact_subject_any"):
            ok = ok or any(norm_college(f.get("subject")) == norm_college(case["college"])
                           for f in facts[:6])
        hits += 1 if ok else 0
        if not ok:
            fails.append(case["q"])
        if case.get("college"):
            cross += sum(1 for c in top
                         if norm_college((kb.clauses.get(c["id"]) or {}).get("college"))
                         and norm_college((kb.clauses.get(c["id"]) or {}).get("college"))
                         != norm_college(case["college"]))
    print(f"[{tag}] hit@6 = {hits}/{len(CASES)}"
          f"（{(hits / len(CASES) * 100):.0f}%）；跨学院误召回 = {cross} 条；"
          f"平均延迟 = {sum(latencies) / len(latencies):.1f} ms（含分词与融合）")
    if fails:
        print(f"[{tag}] 未命中：{fails}")
    return hits, cross, sum(latencies) / len(latencies)


def _scope_of(case, kb):
    scope = {}
    if case.get("college"):
        scope["college"] = case["college"]
    return scope or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vector", action="store_true", help="跑 BM25+向量对照（需先构建向量索引）")
    args = ap.parse_args()

    t0 = time.perf_counter()
    from backend.app.knowledge.retriever import get_indexes  # noqa: F401
    get_indexes()
    print(f"索引构建耗时（首次，含分词）= {(time.perf_counter() - t0) * 1000:.0f} ms")

    if args.vector:
        from backend.app.knowledge.retriever import get_vector_channel
        ch = get_vector_channel()
        if not ch:
            print("[vector] 向量通道不可用（未构建或加载失败）——只跑 BM25")
            run("BM25")
            return
        run("BM25+向量")
    else:
        run("BM25")


if __name__ == "__main__":
    main()
