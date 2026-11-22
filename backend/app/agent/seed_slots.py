# -*- coding: utf-8 -*-
"""从会话中的用户发言中抽取「学生自己说过的身份事实」，作为向导的预备值（preset）。

只抽取两类事实（与 2025 励志奖学金向导的表单选项口径一致）：
- student_type：本科 / 专科（来自「本科生 / 本科 / 专科生 / 专科」）
- grade：一年级…四年级（来自「大一…大四 / 一年级…四年级」）

三条边界（方案「办事体验改造」第二节）：
1) 只是提问不算事实：「大二能申请吗？」不含第一人称自述 → 不抽取；
2) 替别人问不算本人事实：「我替大二的同学问问 / 帮室友问」→ 该句不抽取；
3) 学生没说过的（排名、学院、困难认定等）一律不碰，留给表单填写。

纯函数：输入用户发言列表（时间顺序），输出 {slot: value} 与引用的原句，
供 /api/v1/chat 在进入向导的响应上附加 preset_slots（旧响应无此字段自然兼容）。
"""
import re
from typing import Dict, List, Optional

GRADE_WORDS = {
    "大一": "一年级", "大二": "二年级", "大三": "三年级", "大四": "四年级",
    "一年级": "一年级", "二年级": "二年级", "三年级": "三年级", "四年级": "四年级",
}
TYPE_WORDS = {"本科生": "本科", "本科": "本科", "专科生": "专科",
              "专科": "专科", "大专": "专科"}

# 第一人称自述需要出现的词（「本人」多为正式表述）
_SELF_WORDS = ("我", "本人")

# 代问标记：句内出现即认为该句谈论的是别人的情况
_PROXY_PATTERNS = (
    re.compile(r"[我他她它].{0,4}(替|帮|给|代).{0,6}(同学|室友|朋友|家长|老师|别人|人家)"),
    re.compile(r"(替|帮|给|代|让).{0,6}(问|查|咨询|问问|打听)"),
    re.compile(r"(室友|同学|朋友|家长|别人)(.{0,10})(是|读|在)"),
    re.compile(r"(他|她)是"),
)

# 研究生等表述不能映射到本科/专科选项
_EXCLUDE_TYPE = re.compile(r"研究生|第二学士|专升本套读")

_SENT_SPLIT = re.compile(r"[。！？!?；;\n]+")


def _sentence_ok_for_self(sentence: str) -> bool:
    """句子是否是第一人称自述（含「我/本人」），且没有代问/替问痕迹。"""
    if not any(w in sentence for w in _SELF_WORDS):
        return False
    for pat in _PROXY_PATTERNS:
        if pat.search(sentence):
            return False
    return True


def _first_person_assertion(sentence: str, word: str) -> bool:
    """词出现在以「我/本人」为主语的自述里（如「我是大二本科生」「本人专科，大一」）。

    规则：句子整体是第一人称自述（含我/本人，无代问痕迹）；词在含「我」的小句里，
    或在自述小句之后的后续小句里（「本人专科，大一」的大一）。代问/替问已被
    _sentence_ok_for_self 的模式挡掉；纯疑问句（无我）根本进不到这里。
    """
    if not _sentence_ok_for_self(sentence):
        return False
    clauses = re.split(r"[，,、：:（）()]", sentence)
    self_seen = False
    for cl in clauses:
        if any(w in cl for w in _SELF_WORDS):
            self_seen = True
            if word in cl:
                return True
        elif self_seen and word in cl:
            # 自述小句之后的价值片段（如「，大一」「，今年研究生阶段前为本科」）
            return True
    return False


def extract_student_facts(user_texts: List[str]) -> Dict[str, str]:
    """按时间顺序扫一遍用户发言，抽取学生自述的身份事实。

    返回 {"student_type": "本科", "grade": "二年级", "source_excerpt": "我是大二本科生…"}；
    没有可确认事实时返回 {}。多次自述时，后说的覆盖先说的（与表单「手动修改优先」一致）。
    """
    facts: Dict[str, str] = {}
    excerpt: Optional[str] = None
    for raw in user_texts or []:
        text = str(raw or "")
        if not text:
            continue
        for sent in _SENT_SPLIT.split(text):
            sent = sent.strip()
            if not sent:
                continue
            # 年级：先长词后短词（「二年级」要先于「一年级」里的「年级」类误配——这里词表本身无包含关系）
            for word, value in GRADE_WORDS.items():
                if word in sent and _first_person_assertion(sent, word):
                    facts["grade"] = value
                    excerpt = _clip(sent, word)
                    break
            # 学生层次
            if _EXCLUDE_TYPE.search(sent):
                continue
            for word, value in TYPE_WORDS.items():
                if word in sent and _first_person_assertion(sent, word):
                    facts["student_type"] = value
                    if excerpt is None:
                        excerpt = _clip(sent, word)
                    break
    if not facts:
        return {}
    out = dict(facts)
    if excerpt:
        out["source_excerpt"] = excerpt
    return out


def _clip(sentence: str, word: str, limit: int = 48) -> str:
    """截取词所在位置附近的片段，作为「你刚才提到…」的引用。"""
    idx = sentence.find(word)
    start = max(0, idx - 20)
    frag = sentence[start:start + limit].strip("，。、；：")
    return frag + ("…" if start + limit < len(sentence) else "")


def filter_for_flow(facts: Dict[str, str], flow_slots: List[dict]) -> Dict[str, str]:
    """只保留目标向导表单里真实存在的槽位键（其它流程没有 student_type/grade 时不误带）。"""
    keys = set()
    for spec in flow_slots or []:
        if isinstance(spec, dict) and spec.get("key"):
            keys.add(spec["key"])
    return {k: v for k, v in facts.items() if k in keys and k != "source_excerpt"}
