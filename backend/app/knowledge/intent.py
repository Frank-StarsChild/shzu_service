# -*- coding: utf-8 -*-
"""查询规范化与校验提示（规则层新角色）。

对话不再由关键词规则做终点判断（out_of_scope / 不足拦截 / 固定分流已删除）：
每轮一律交给模型理解。本模块只保留两类能力，供对话图 prepare 节点使用：
1. 查询规范化：别名归一（官方名替换）、身份词识别、歧义别名检测；
2. 校验提示：临时时间安排的适用期核验、相对年度（"今年"）推算，
   产出注入模型上下文的事实提示（回复须与之相符），不提前结束对话。
"""
import re

from .loader import get_kb

IDENTITY_WORDS = {
    "本科生": "undergraduate", "本科": "undergraduate", "专科生": "associate", "专科": "associate",
    "硕士生": "graduate_master", "硕士": "graduate_master", "研究生": "graduate_master",
    "博士生": "graduate_doctor", "博士": "graduate_doctor",
    "教师": "teacher", "老师": "teacher",
    "教职工": "teacher",
}


def normalize_query(q):
    """查询规范化：歧义别名不替换（交给模型澄清），已核验别名归一到官方全称。
    返回 (text, alias_hit, identity)。"""
    kb = get_kb()
    text = (q or "").strip()
    alias_hit = None
    for a in kb.aliases["aliases"]:
        if a["alias"] and a["alias"] in text:
            if a.get("target") and a.get("status") == "verified":
                text = text.replace(a["alias"], a["target"])
            alias_hit = a
            break
    identity = None
    for word, key in IDENTITY_WORDS.items():
        if word in (q or ""):
            identity = {"key": key, "label": word}
            break
    return text, alias_hit, identity


def year_window_note(query, today):
    """临时时间安排的适用期核验（校验提示，注入模型上下文；返回 None 表示不涉及）。
    口径与原 check_time_condition 一致，仅改为提示文本：
    - timed_apply：今天落在某临时安排期内
    - timed_expired：问题指向的临时安排不含今天（引用其内容须注明不适用）
    - timed_none：今天不在任何临时安排期内且常规开馆时间文件未入库
    """
    text = query or ""
    if not re.search(r"开馆|闭馆|关门|开放时间|几点关|几点开|开门", text):
        return None
    timed = {
        "lib-newyear2026": ("2026-01-01", "2026-01-03"),
        "lib-summer2026": ("2026-07-07", "2026-08-25"),
        # 延长开馆：通知写明"至考试周结束"，按 2026 年考试周期（5-6 月）估计适用窗口
        "lib-extended-hours": ("2026-05-18", "2026-06-30"),
    }
    applies = [d for d, (s, e) in timed.items() if s <= today <= e]
    pointed = None
    for kw, doc_id in [("元旦", "lib-newyear2026"), ("暑期", "lib-summer2026"), ("暑假", "lib-summer2026"),
                       ("延长", "lib-extended-hours")]:
        if kw in text:
            pointed = doc_id
            break
    if pointed:
        s, e = timed[pointed]
        if s <= today <= e:
            return f"今天（{today}）处于该临时安排的适用期内（{s} 至 {e}）。"
        return (f"该临时安排的适用期为 {s} 至 {e}；今天（{today}）不在期间内，"
                f"其内容不能作为当前日期的依据。")
    if applies:
        return f"今天（{today}）处于临时安排 {('、'.join(applies))} 的适用期内；常规时间仍以官方常规安排为准。"
    return ("今天不在库内任何临时开馆安排的适用期间内；常规开馆时间的官方文件尚未入库，"
            "不能推断今天几点关门。")
