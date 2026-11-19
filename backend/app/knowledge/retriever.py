# -*- coding: utf-8 -*-
"""混合检索：jieba 中文分词 + BM25 + 关键词触发，RRF 融合结构预留向量接口。"""
import math
import re
from functools import lru_cache

import jieba

from .loader import get_kb

YEAR_RE = re.compile(r"(20\d{2})\s*年?度?|20\d{2}-20\d{2}\s*学年")


@lru_cache(maxsize=1)
def _jieba_ready():
    jieba.setLogLevel(60)
    # 校内专有词，避免被切开
    for w in ["励志奖学金", "国家奖学金", "国家助学金", "困难认定", "借阅规定", "讨论间",
              "教学场所", "临时借用", "成绩单", "学位证明书", "保留学籍", "补退选",
              "校历", "考试周", "校园卡", "一卡通", "电动自行车", "通行牌", "视频监控",
              "励志", "请假条", "转专业", "休学", "复学", "留级", "缓考", "选课"]:
        jieba.add_word(w)
    return True


STOPWORDS = {"的", "了", "是", "在", "我", "你", "他", "她", "它", "和", "与", "及", "或", "要", "有", "没", "无",
             "吗", "呢", "啊", "吧", "谁", "什么", "怎么", "怎样", "多少", "几", "几天", "可以", "能", "会",
             "请", "帮", "帮我", "一下", "还有", "以及", "关于", "请问", "一下下", "这", "那", "个", "中",
             "对", "对于", "如何", "为何", "为什么", "时候", "时间"}


def tokenize(text):
    _jieba_ready()
    text = re.sub(r"[^\u4e00-\u9fa5a-zA-Z0-9]+", " ", text)
    out = []
    for t in jieba.lcut(text):
        t = t.strip().lower()
        if not t:
            continue
        if t in STOPWORDS:
            continue
        if len(t) == 1 and not re.match(r"[a-z0-9]", t):
            continue
        out.append(t)
    return out


# 域内泛词：在知识库中几乎每篇都出现，对查询区分度为零，检索时从查询词中剔除
DOMAIN_QUERY_STOPWORDS = {"图书馆", "学校", "大学", "石河子大学", "石河子", "校园", "学生", "老师",
                          "规定", "办法", "通知", "石大"}


def query_tokens(text):
    toks = tokenize(text)
    return [t for t in toks if t not in DOMAIN_QUERY_STOPWORDS] or toks


class BM25Index:
    """小型 BM25：知识库规模小（约百级条款/事实），无需独立向量服务。"""

    def __init__(self, docs_tokens, k1=1.5, b=0.75):
        self.k1, self.b = k1, b
        self.docs = docs_tokens
        self.N = len(docs_tokens)
        self.avgdl = sum(len(d) for d in docs_tokens) / max(self.N, 1)
        self.df = {}
        self.tf = []
        for d in docs_tokens:
            tf = {}
            for t in d:
                tf[t] = tf.get(t, 0) + 1
            self.tf.append(tf)
            for t in tf:
                self.df[t] = self.df.get(t, 0) + 1

    def score(self, query_tokens, idx):
        s = 0.0
        dl = len(self.docs[idx])
        tf = self.tf[idx]
        for t in query_tokens:
            if t not in tf:
                continue
            idf = math.log(1 + (self.N - self.df.get(t, 0) + 0.5) / (self.df.get(t, 0) + 0.5))
            s += idf * (tf[t] * (self.k1 + 1)) / (tf[t] + self.k1 * (1 - self.b + self.b * dl / self.avgdl))
        return s

    def search(self, query_tokens, top_k=6):
        scores = [(self.score(query_tokens, i), i) for i in range(self.N)]
        scores = [x for x in scores if x[0] > 0]
        scores.sort(reverse=True)
        return scores[:top_k]


@lru_cache(maxsize=1)
def get_indexes():
    kb = get_kb()
    fact_ids = list(kb.facts.keys())
    clause_ids = list(kb.clauses.keys())
    fact_docs = []
    for fid in fact_ids:
        f = kb.facts[fid]
        text = " ".join([f.get("topic", ""), f.get("label", ""), f["subject"], f["predicate"],
                         str(f.get("value", "")), f.get("unit") or ""])
        fact_docs.append(tokenize(text))
    clause_docs = []
    for cid in clause_ids:
        c = kb.clauses[cid]
        clause_docs.append(tokenize(" ".join([c.get("topic", ""), c["exact_text"]])))
    return {
        "fact_ids": fact_ids,
        "clause_ids": clause_ids,
        "fact_index": BM25Index(fact_docs),
        "clause_index": BM25Index(clause_docs),
    }


def retrieve(query, scope=None, top_k=6):
    """返回 (facts, clauses)：BM25 各取候选后融合，同源去重。
    scope={"college": 官方名} 时做严格机构过滤：只保留条款/事实隶属于该学院的候选；
    过滤后为空即视为无证据（走 insufficient），绝不把其他学院的资料当答案。"""
    kb = get_kb()
    idx = get_indexes()
    q = query_tokens(query)

    fact_hits = idx["fact_index"].search(q, top_k=top_k)
    clause_hits = idx["clause_index"].search(q, top_k=top_k)

    # RRF 融合（rank-based），同源（同一 clause）去重
    def rrf(rank_lists, k=60):
        agg = {}
        for ranks in rank_lists:
            for rank, (item_id) in enumerate(ranks):
                agg.setdefault(item_id, 0.0)
                agg[item_id] += 1.0 / (k + rank + 1)
        return sorted(agg.items(), key=lambda x: -x[1])

    fact_rank = [idx["fact_ids"][i] for _, i in fact_hits]
    clause_rank = [idx["clause_ids"][i] for _, i in clause_hits]

    # 机构范围过滤：已明确问某学院时，跨学院候选全部剔除（防串答）
    if scope and scope.get("college"):
        college = scope["college"]

        def _fact_ok(fid):
            evs = [e for e in (kb.facts[fid].get("evidence_ids") or []) if e in kb.clauses]
            return bool(evs) and all(kb.clauses[e].get("college") == college for e in evs)

        fact_rank = [f for f in fact_rank if _fact_ok(f)]
        clause_rank = [c for c in clause_rank if kb.clauses[c].get("college") == college]

    facts_scores = rrf([fact_rank])[:top_k]
    clause_scores = rrf([clause_rank])[:top_k]

    facts = []
    for fid, s in facts_scores:
        f = kb.facts[fid]
        facts.append({"fact_id": fid, "rrf": round(s, 4), **{k: f.get(k) for k in
                      ("label", "subject", "predicate", "value", "unit", "conditions", "evidence_ids", "topic")}})
    clauses = []
    for cid, s in clause_scores:
        c = kb.clauses[cid]
        clauses.append({"clause_id": cid, "rrf": round(s, 4), "topic": c.get("topic"),
                        "exact_text": c.get("exact_text"), "evidence_ids": [cid]})
    return facts, clauses, fact_hits, clause_hits


def detect_year(query):
    m = YEAR_RE.search(query)
    return int(m.group(1)) if m else None
