# -*- coding: utf-8 -*-
"""75 题正式评测脚本（v1 契约版）：逐题独立会话，带 request_id 调用 /api/v1/chat。
用法：先启动后端（uvicorn 8300），再运行本脚本。输出 CSV 报告到 evaluation/results/。
契约映射：answer.blocks[].text / unknown_fields / citations[].id|excerpt|title|locator。
"""
import csv
import json
import os
import statistics
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get("SHZU_API", "http://127.0.0.1:8300")
# 验收按完整答复耗时判定；HTTP 读取时限仍允许收集较慢的实际结果。
EVAL_TIMEOUT_MS = int(os.environ.get("SHZU_EVAL_TIMEOUT_MS", "5000"))

# 旧题集口径 → v1 枚举
STATUS_MAP = {"answered": "answer"}


def http(path, payload=None, method=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(API + path, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else {}


def create_session():
    r = http("/api/v1/sessions", {})
    return r["session_id"]


def haystack(resp):
    """v1 响应文本拼接：message + 块文本 + 澄清问题/选项 + 缺口标注 + 引用全文。"""
    parts = [resp.get("message") or ""]
    ans = resp.get("answer") or {}
    for b in ans.get("blocks", []):
        parts.append(str(b.get("text", "")))
    cl = resp.get("clarify") or {}
    if cl:
        parts.append(str(cl.get("question", "")))
        parts.extend(str(c.get("label", "")) for c in cl.get("choices") or [])
    parts.extend(str(u) for u in resp.get("unknown_fields") or [])
    parts.extend(str(u) for u in (ans.get("unknown_fields") or []))
    for c in resp.get("citations", []):
        parts.append(" ".join(str(c.get(k, "")) for k in ("excerpt", "title", "issuer", "locator", "time_condition")))
    return " ".join(parts)


def run_one(item, session_id):
    q = item["q"]
    request_id = "eval-{}-{}".format(item["id"], int(time.time() * 1000))
    t0 = time.perf_counter()
    resp = http("/api/v1/chat", {"session_id": session_id, "request_id": request_id, "message": q})
    elapsed_ms = (time.perf_counter() - t0) * 1000
    text = haystack(resp)
    compact = text.replace(" ", "").replace("\u00a0", "")  # 关键词匹配去除空格（模型数字两侧常加空格）

    status = resp.get("status")
    reason_code = resp.get("reason_code") or ""
    expect_raw = item.get("expect_status")
    if isinstance(expect_raw, list):
        expect = [STATUS_MAP.get(e, e) for e in expect_raw]
        expect_show = "|".join(expect)
        expect_ok = status in expect
    else:
        expect = STATUS_MAP.get(expect_raw, expect_raw)
        expect_show = expect
        expect_ok = status == expect
    if status == "clarify":
        expect_ok = expect_ok and bool(((resp.get("clarify") or {}).get("question") or "").strip())
    kws = item.get("must_keywords", [])
    missing = [k for k in kws if k.replace(" ", "") not in compact]

    evidence_ok = True
    ev = item.get("any_evidence") or []
    if ev:
        cited = {c.get("id") for c in resp.get("citations", [])}
        evidence_ok = any(e in cited for e in ev)

    forbidden = [k for k in item.get("forbidden_keywords", []) if k.replace(" ", "") in compact]
    passed = (reason_code not in {"turn_deadline", "model_connection"} and expect_ok and not missing
              and evidence_ok and not forbidden and elapsed_ms <= EVAL_TIMEOUT_MS)
    return {
        "id": item["id"], "board": item.get("board") or item.get("type"), "q": q,
        "expect": expect_show, "status": status, "reason_code": reason_code,
        "knowledge_version": resp.get("knowledge_version") or "",
        "workflow_run_id": resp.get("workflow_run_id") or "",
        "keywords_ok": "Y" if not missing else "N", "missing_keywords": " ".join(missing),
        "evidence_ok": "Y" if evidence_ok else "N",
        "forbidden": " ".join(forbidden),
        "elapsed_ms": round(elapsed_ms, 1), "pass": "Y" if passed else "N",
        "citations": " ".join(c.get("id") or "" for c in resp.get("citations", [])),
        "summary": (resp.get("message") or "").replace("\n", " ")[:120],
    }


def main():
    with open(os.path.join(BASE, "questions.json"), encoding="utf-8") as f:
        data = json.load(f)
    ready = http("/api/v1/health/ready")
    version = ready.get("knowledge_version")
    if version != data["meta"]["kb_version"]:
        raise SystemExit(f"题集需要 {data['meta']['kb_version']}，服务端实际为 {version}。")
    rows = []
    for item in data["core"] + data["boundary"]:
        # 每题新会话：隔离历史噪声（多轮连问的历史会改变模型检索词与侧重）
        try:
            rows.append(run_one(item, create_session()))
        except Exception as e:
            rows.append({"id": item["id"], "board": item.get("board") or item.get("type"), "q": item["q"],
                         "expect": item.get("expect_status"), "status": "ERROR", "reason_code": "",
                         "knowledge_version": version, "workflow_run_id": "", "keywords_ok": "N",
                         "missing_keywords": str(e), "evidence_ok": "N", "forbidden": "",
                         "elapsed_ms": -1, "pass": "N", "citations": "", "summary": ""})
    outdir = os.path.join(BASE, "results")
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, "eval_report_{}.csv".format(time.strftime("%Y%m%d_%H%M%S")))
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    core_rows = rows[:len(data["core"])]
    b_rows = rows[len(data["core"]):]
    lat = [r["elapsed_ms"] for r in rows if r["elapsed_ms"] >= 0]

    def pct(vals, p):
        vals = sorted(vals)
        if not vals:
            return 0
        idx = max(0, min(len(vals) - 1, int(-(-len(vals) * p // 100)) - 1))
        return vals[idx]

    print("=" * 70)
    print(f"评测模式：每题独立会话 · 知识版本 {version} · 对话服务 {ready.get('model_provider')}")
    print("核心题：{}/{} 通过".format(sum(1 for r in core_rows if r["pass"] == "Y"), len(core_rows)))
    print("边界题：{}/{} 通过".format(sum(1 for r in b_rows if r["pass"] == "Y"), len(b_rows)))
    print("时延：平均 {:.0f}ms，P95 {:.0f}ms，P99 {:.0f}ms，最大 {:.0f}ms，超时(>{}ms) {}".format(
        statistics.mean(lat) if lat else -1, pct(lat, 95), pct(lat, 99), max(lat) if lat else -1,
        EVAL_TIMEOUT_MS,
        sum(1 for v in lat if v > EVAL_TIMEOUT_MS)))
    print("时限降级：{} 题".format(sum(r["reason_code"] == "turn_deadline" for r in rows)))
    print("模型连接异常：{} 题，其中 {} 题附官方资料".format(
        sum(r["reason_code"] == "model_connection" for r in rows),
        sum(r["reason_code"] == "model_connection" and bool(r["citations"]) for r in rows)))
    for r in rows:
        if r["pass"] != "Y":
            print("FAIL", r["id"], "expect=" + str(r["expect"]), "got=" + str(r["status"]),
                  r["missing_keywords"], r["citations"], "|", r["summary"][:60])
    print("报告：", out)


if __name__ == "__main__":
    main()
