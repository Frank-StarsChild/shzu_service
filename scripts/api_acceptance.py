# -*- coding: utf-8 -*-
"""实际接口验收：直接调用运行中的 /api/v1/chat（真实 DeepSeek + 全量迁移库）。

覆盖：生科院样例（简介→上下文追问专业→师资职称）、其他学院抽测、
各板块已采集未入库题、励志奖学金年度区分、身份问题、无资料问题、
技术回归（借书/学生证/向导）。

用法：
  .venv\\Scripts\\python.exe scripts\\api_acceptance.py           # 核心验收
  .venv\\Scripts\\python.exe scripts\\api_acceptance.py --colleges # 逐院简介
"""
import argparse
import json
import sys
import time
import uuid

import httpx

BASE = "http://127.0.0.1:8300/api/v1"


def new_session(client: httpx.Client) -> str:
    r = client.post(f"{BASE}/sessions")
    r.raise_for_status()
    return r.json()["session_id"]


def chat(client: httpx.Client, sid: str, text: str, timeout=40.0):
    t0 = time.perf_counter()
    r = client.post(f"{BASE}/chat", json={
        "session_id": sid, "request_id": "req-" + uuid.uuid4().hex[:12], "message": text},
        timeout=timeout)
    dt = (time.perf_counter() - t0) * 1000
    r.raise_for_status()
    return r.json(), dt


def show(tag: str, resp: dict, dt: float, evidence_check=True, client=None):
    print("=" * 78)
    print(f"[{tag}] status={resp.get('status')}  ({dt:.0f} ms)")
    msg = resp.get("message") or ""
    print(f"  reply: {msg[:220]}")
    citations = resp.get("citations") or []
    print(f"  citations: {len(citations)}")
    for c in citations[:4]:
        print(f"    [{c['id']}] {c['title'][:36]} · {c['issuer'][:20]} · {(c.get('locator') or '')[:20]}")
    if evidence_check and client and citations:
        # 验证每个证据 ID 都能打开（引用卡可用性）
        for c in citations[:2]:
            er = client.get(f"{BASE}/evidence/{c['id']}")
            ok = "OK" if er.status_code == 200 else f"HTTP{er.status_code}"
            print(f"    evidence API {c['id']}: {ok}")
    return resp


def core(client: httpx.Client):
    # ---- 1. 生科院样例：简介 → 上下文追问专业 ----
    sid = new_session(client)
    r, dt = chat(client, sid, "介绍一下生科院")
    show("1a 生科院简介", r, dt, client=client)
    assert r["status"] == "answer", f"期望 answer，得到 {r['status']}"
    assert any("生命科学" in (c["title"] + (c.get("excerpt") or "")) or
               "生科" in c["id"] or "xy-" in c["id"] for c in r.get("citations") or []), "应引用生科院资料"
    r, dt = chat(client, sid, "那他们有哪些本科专业")
    show("1b 上下文追问专业", r, dt, client=client)
    assert r["status"] == "answer", f"期望 answer，得到 {r['status']}"

    # ---- 2. 师资职称（只列有依据的） ----
    sid = new_session(client)
    r, dt = chat(client, sid, "生科院有哪些副教授")
    show("2a 生科院副教授", r, dt, client=client)
    sid = new_session(client)
    r, dt = chat(client, sid, "体育学院有哪些教授和导师")
    show("2b 体育学院师资抽测", r, dt, client=client)
    sid = new_session(client)
    r, dt = chat(client, sid, "农学院的张三老师是什么职称")  # 查无此人：应说明依据程度
    show("2c 无明确依据的职称", r, dt, client=client)

    # ---- 3. 已采集未入库的板块题 ----
    for tag, q in [
        ("3a 校园卡", "校园卡丢了怎么挂失？卡里钱怎么办"),
        ("3b 迎新交通", "新生报到学校有接站吗，交通方式有哪些"),
        ("3c 校历", "2026-2027学年校历第一学期什么时候放寒假"),
        ("3d 医保", "学生医保怎么参保，报销要什么材料"),
        ("3e 财务", "学生学费缴费方式有哪些"),
        ("3f 档案", "学生档案在哪里，怎么转递"),
        ("3g 就业", "学校就业信息网能干什么"),
        ("3h 心理", "学校心理咨询中心怎么预约"),
    ]:
        sid = new_session(client)
        try:
            r, dt = chat(client, sid, q)
            show(tag, r, dt, client=client)
        except Exception as e:
            print(f"[{tag}] 异常：{e}")

    # ---- 4. 励志奖学金年度区分 ----
    sid = new_session(client)
    r, dt = chat(client, sid, "今年国家励志奖学金什么时候申请")
    show("4 今年励志奖学金", r, dt, client=client)

    # ---- 5. 身份与能力（模型生成，无固定话术） ----
    sid = new_session(client)
    r, dt = chat(client, sid, "你是谁")
    show("5a 你是谁", r, dt, evidence_check=False)
    r, dt = chat(client, sid, "你能帮我干什么")
    show("5b 能干什么", r, dt, evidence_check=False)

    # ---- 6. 无资料问题（说明实际状态，不编造） ----
    sid = new_session(client)
    r, dt = chat(client, sid, "石河子市明天限号吗")
    show("6a 校外问题", r, dt, evidence_check=False)
    r, dt = chat(client, sid, "学校什么时候装空调到每间宿舍")
    show("6b 无资料问题", r, dt)

    # ---- 7. 回归：原有核心题与向导 ----
    sid = new_session(client)
    r, dt = chat(client, sid, "本科生一次能借几本书")
    show("7a 借书回归", r, dt, client=client)
    assert any("lib-" in c["id"] for c in r.get("citations") or []), "借书题应引用图书馆证据"
    sid = new_session(client)
    r, dt = chat(client, sid, "学生证丢了怎么补办")
    show("7b 学生证回归", r, dt, client=client)
    sid = new_session(client)
    r, dt = chat(client, sid, "我要申请2025年度国家励志奖学金，帮我看看怎么办理")
    show("7c 励志奖学金向导", r, dt, client=client)
    if r["status"] == "workflow":
        print(f"    flow_id={r['workflow']['flow_id']} historical={r['workflow']['historical']}")
    sid = new_session(client)
    r, dt = chat(client, sid, "宿舍水管坏了找谁报修")
    show("7d 后勤回归", r, dt, client=client)


def colleges(client: httpx.Client):
    """按官方教学机构目录逐院跑简介查询 + 抽测专业/机构/师资。"""
    from backend.app.knowledge.loader import get_kb
    kb = get_kb()  # 与服务同库（本地只读目录）
    names = [c["official"] for c in kb.colleges]
    print(f"逐院验收（{len(names)} 个学院单位）")
    miss = []
    for name in names:
        sid = new_session(client)
        try:
            r, dt = chat(client, sid, f"介绍一下{name}")
            cite = len(r.get("citations") or [])
            flag = "OK " if (r["status"] == "answer" and cite > 0) else "MISS"
            if flag == "MISS":
                miss.append((name, r["status"], cite))
            print(f"  [{flag}] {name}: status={r['status']} citations={cite} "
                  f"({dt:.0f} ms) {(r.get('message') or '')[:40].replace(chr(10), ' ')}")
        except Exception as e:
            miss.append((name, "exception", str(e)[:40]))
            print(f"  [ERR ] {name}: {e}")
    print(f"\n未通过：{len(miss)}")
    for m in miss:
        print("  ", m)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--colleges", action="store_true", help="逐院简介验收")
    args = ap.parse_args()
    sys.path.insert(0, ".")
    with httpx.Client(timeout=60.0) as client:
        if args.colleges:
            colleges(client)
        else:
            core(client)


if __name__ == "__main__":
    main()
