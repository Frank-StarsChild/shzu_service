# -*- coding: utf-8 -*-
"""三态规则引擎：pass / fail / unknown。unknown 不能默认为通过（方案 7.3）。"""
from ..knowledge.loader import get_kb

GRADE_INDEX = {"一年级": 1, "二年级": 2, "三年级": 3, "四年级": 4, "五年级": 5}


def _ratio(rank, total):
    try:
        rank, total = int(rank), int(total)
        if total <= 0 or rank <= 0:
            return None
        return rank / total
    except (TypeError, ValueError):
        return None


def derive_slots(slots):
    """由原始槽位派生规则所需事实。"""
    d = dict(slots or {})
    d["grade_index"] = GRADE_INDEX.get(slots.get("grade"))
    d["study_rank_ratio"] = _ratio(slots.get("study_rank"), slots.get("study_total"))
    d["zongce_rank_ratio"] = _ratio(slots.get("zongce_rank"), slots.get("zongce_total"))
    going_home = slots.get("going_home")
    if going_home == "是" or str(slots.get("days_or_sections", "")).strip() not in ("", None):
        # 回家或超 3 天需要住址；简化：回家=是 或 天数>3 视为必须
        need_addr = (going_home == "是")
        try:
            if not need_addr and slots.get("days_or_sections"):
                import re
                nums = re.findall(r"\d+", str(slots.get("days_or_sections")))
                if nums and max(int(n) for n in nums) > 3:
                    need_addr = True
        except Exception:
            pass
        if not need_addr:
            d["home_address_required"] = "provided"  # 不需要住址，视为满足
        else:
            addr = (slots.get("home_address") or "").strip()
            d["home_address_required"] = "provided" if addr else "missing"
    return d


def evaluate_rules(flow_id, slots):
    kb = get_kb()
    derived = derive_slots(slots)
    # 2025 历史演示流程：申报年度由流程版本决定，不依赖表单填写
    flow = kb.flows.get(flow_id, {})
    if flow.get("demo_mode") and flow.get("applicable_scope", {}).get("application_year"):
        if not derived.get("application_year"):
            derived["application_year"] = flow["applicable_scope"]["application_year"]
    results = []
    for rule_id, rule in kb.rules.items():
        if rule.get("flow_id") != flow_id:
            continue
        fact_key = rule["required_fact"]
        value = derived.get(fact_key)
        op = rule["operator"]
        expected = rule.get("expected_value")
        state, explain = "unknown", ""

        if value is None or value == "":
            state = "unknown"
            explain = rule.get("on_unknown") or "该信息未填写，条件结果为未知，不默认通过。"
        elif op == "eq":
            state = "pass" if str(value) == str(expected) else "fail"
        elif op == "gte":
            try:
                state = "pass" if float(value) >= float(expected) else "fail"
            except (TypeError, ValueError):
                state = "unknown"
        elif op == "lte":
            try:
                state = "pass" if float(value) <= float(expected) else "fail"
            except (TypeError, ValueError):
                state = "unknown"
        elif op == "between":
            try:
                lo, hi = expected
                state = "pass" if lo <= float(value) <= hi else "fail"
            except (TypeError, ValueError):
                state = "unknown"
        elif op == "derived":
            state = "pass"
            explain = expected.get(value, "")
        elif op == "const":
            state = "pass"
            explain = str(expected)
        else:
            state = "unknown"

        if state == "fail":
            explain = rule.get("on_fail") or explain
        results.append({
            "rule_id": rule_id, "name": rule.get("name"), "state": state,
            "explain": explain, "evidence_ids": rule.get("evidence_ids", []),
            "fact_key": fact_key, "value": value if not isinstance(value, float) else round(value, 4),
        })
    return results, derived
