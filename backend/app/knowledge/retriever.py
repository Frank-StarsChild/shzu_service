# -*- coding: utf-8 -*-
"""混合检索：jieba 中文分词 + BM25（先确定范围，再在范围内召回）+ 可选向量通道。

范围（scope）优先顺序（按迁移要求修正：原来是「全校 Top K → 再过滤」，
当其他学院的高频词把目标学院候选挤出 Top K 时会漏召回）：
- scope={"college": 官方名}：只对隶属于该学院的条款/事实打分召回；
  范围内无候选即无证据（insufficient），绝不拿其他学院资料当答案。
- scope={"year": 2026}：优先限定 document_year 精确匹配的候选；范围空则回退全库
  （返回 year_fallback 标记，供上层如实说明）。
- 无范围 → 全校召回。

向量通道（可选）：data/artifacts/vector_index.npz 由 scripts/build_vector_index.py
离线构建（默认 BGE-M3，可 SHZU_EMBED_MODEL 换更小模型，如 BAAI/bge-small-zh-v1.5；
npz 内记录实际模型名，加载时按其加载）。加载失败或未构建时自动退回纯 BM25，
不影响服务。SHZU_VECTOR=off/0 可整体关闭。
RRF 融合：BM25(fact) / BM25(clause) / 向量(clause) 各自成排，按名次融合。
"""
import heapq
import math
import re
from collections import Counter
from functools import lru_cache

import jieba

from .loader import get_kb

YEAR_RE = re.compile(r"(20\d{2})\s*年?度?|20\d{2}-20\d{2}\s*学年")


@lru_cache(maxsize=1)
def _jieba_ready():
    jieba.setLogLevel(60)
    # 校内专有词（高词频防止被内置词典的路径权重挤掉，如「迎新报到」被切成「迎/新报/到」）
    for w in ["励志奖学金", "国家奖学金", "国家助学金", "困难认定", "借阅规定", "讨论间",
              "教学场所", "临时借用", "成绩单", "学位证明书", "保留学籍", "补退选",
              "校历", "考试周", "校园卡", "一卡通", "电动自行车", "通行牌", "视频监控",
              "励志", "请假条", "转专业", "休学", "复学", "留级", "缓考", "选课",
              "生科院", "信科院", "医学院", "农学院", "体育学院", "药学院",
              "迎新", "报到", "辅导员", "校医院", "心理", "资助", "名册", "导师",
              "外聘", "职称", "副教授", "教授", "研究员", "学科", "学位点",
              "校园网", "一站式服务平台", "办事大厅", "报修", "水电"]:
        jieba.add_word(w, freq=10**7)
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


# 域内泛词：对查询区分度为零，检索时从查询词中剔除
DOMAIN_QUERY_STOPWORDS = {"图书馆", "学校", "大学", "石河子大学", "石河子", "校园", "学生", "老师",
                          "规定", "办法", "通知", "石大"}


def query_tokens(text):
    toks = tokenize(text)
    return [t for t in toks if t not in DOMAIN_QUERY_STOPWORDS] or toks


class BM25Index:
    """在范围内对命中查询词的行打分，再取 Top K。"""

    def __init__(self, docs_tokens, k1=1.5, b=0.75):
        self.k1 = k1
        document_count = len(docs_tokens)
        avg_length = sum(len(doc) for doc in docs_tokens) / max(document_count, 1)
        self.postings = {}
        self.length_penalties = []
        for row, doc in enumerate(docs_tokens):
            self.length_penalties.append(k1 * (1 - b + b * len(doc) / avg_length) if avg_length else 0.0)
            for token, frequency in Counter(doc).items():
                self.postings.setdefault(token, {})[row] = frequency
        self.idf = {
            token: math.log(1 + (document_count - len(rows) + 0.5) / (len(rows) + 0.5))
            for token, rows in self.postings.items()
        }

    def search(self, query_tokens, top_k=6, only_rows=None):
        """only_rows：范围行集合（先范围后召回）；None 为全校。"""
        scope = set(only_rows) if only_rows is not None else None
        scores = {}
        for token in query_tokens:
            postings = self.postings.get(token)
            if not postings:
                continue
            idf = self.idf[token]
            for row, frequency in postings.items():
                if scope is not None and row not in scope:
                    continue
                score = idf * (frequency * self.k1 + 1) / (frequency + self.length_penalties[row])
                scores[row] = scores.get(row, 0.0) + score
        return heapq.nlargest(top_k, ((score, row) for row, score in scores.items()))


# ---------- 索引构建（含范围元数据） ----------

@lru_cache(maxsize=1)
def get_indexes():
    kb = get_kb()
    fact_ids = list(kb.facts.keys())
    clause_ids = list(kb.clauses.keys())

    # 分词结果磁盘缓存（jieba 分词 1 万条款约 30s；命中缓存约 1s）
    cache_ok = False
    cache_path = None
    try:
        import pickle
        from ..config import ARTIFACTS_DIR
        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = ARTIFACTS_DIR / "token_cache.pkl"
        if cache_path.is_file():
            with open(cache_path, "rb") as f:
                cached = pickle.load(f)
            if (cached.get("kb_version") == kb.kb_version
                    and cached.get("clause_ids") == clause_ids
                    and cached.get("fact_ids") == fact_ids):
                fact_docs = cached["fact_tokens"]
                clause_docs = cached["clause_tokens"]
                cache_ok = True
    except Exception:  # noqa: BLE001 —— 缓存任何失败都回退现算
        cache_ok = False

    if not cache_ok:
        fact_docs = []
        for fid in fact_ids:
            f = kb.facts[fid]
            text = " ".join([f.get("topic", ""), f.get("label", ""), f["subject"], f["predicate"],
                             str(f.get("value", "")), f.get("unit") or ""])
            fact_docs.append(tokenize(text))
        clause_docs = []
        for cid in clause_ids:
            c = kb.clauses[cid]
            doc = kb.document_of(cid) or {}
            # 拼接文档标题（板块/学院/事项词进入索引：细粒度条款靠标题词兜住板块类查询）
            clause_docs.append(tokenize(" ".join([doc.get("title") or "", c.get("topic", ""),
                                                   c["exact_text"]])))
        try:
            import pickle
            if cache_path is not None:
                with open(cache_path, "wb") as f:
                    pickle.dump({"kb_version": kb.kb_version, "clause_ids": clause_ids,
                                 "fact_ids": fact_ids, "fact_tokens": fact_docs,
                                 "clause_tokens": clause_docs}, f, protocol=4)
        except Exception:
            pass

    # 范围元数据：college（归一到官方名）、year（文档年份）
    clause_college = {cid: norm_college(kb.clauses[cid].get("college")) for cid in clause_ids}
    clause_year = {}
    for cid in clause_ids:
        doc = kb.document_of(cid) or {}
        clause_year[cid] = doc.get("document_year")
    fact_college = {}
    for fid in fact_ids:
        f = kb.facts[fid]
        evs = [e for e in (f.get("evidence_ids") or []) if e in kb.clauses]
        if norm_college(f.get("subject")) in _college_names():
            fact_college[fid] = norm_college(f.get("subject"))
        elif evs:
            colleges = {norm_college(kb.clauses[e].get("college")) for e in evs}
            fact_college[fid] = colleges.pop() if len(colleges) == 1 else None
        else:
            fact_college[fid] = None

    clause_rows_of_college = {}
    for i, cid in enumerate(clause_ids):
        col = clause_college[cid]
        if col:
            clause_rows_of_college.setdefault(col, []).append(i)
    fact_rows_of_college = {}
    for i, fid in enumerate(fact_ids):
        col = fact_college[fid]
        if col:
            fact_rows_of_college.setdefault(col, []).append(i)

    clause_rows_of_year = {}
    for i, cid in enumerate(clause_ids):
        y = clause_year[cid]
        if y:
            clause_rows_of_year.setdefault(y, []).append(i)
    fact_rows_of_year = {}
    for i, fid in enumerate(fact_ids):
        y = None
        for e in (kb.facts[fid].get("evidence_ids") or []):
            if e in clause_year and clause_year[e]:
                y = clause_year[e]
                break
        if y:
            fact_rows_of_year.setdefault(y, []).append(i)

    return {
        "fact_ids": fact_ids,
        "clause_ids": clause_ids,
        "fact_index": BM25Index(fact_docs),
        "clause_index": BM25Index(clause_docs),
        "clause_rows_of_college": clause_rows_of_college,
        "fact_rows_of_college": fact_rows_of_college,
        "clause_rows_of_year": clause_rows_of_year,
        "fact_rows_of_year": fact_rows_of_year,
    }


@lru_cache(maxsize=1)
def _college_names():
    return {c["official"] for c in get_kb().colleges}


def norm_college(name):
    """学院名归一：官方名 / 「官方名（括号后缀）」变体 → 官方名；未知返回原值。
    例：「信息科学与技术学院（网络空间安全学院）」→「信息科学与技术学院」；
    「文学艺术学院（新闻传播学院）」本身是官方名，保持不变。"""
    if not name:
        return None
    if name in _college_names():
        return name
    for official in _college_names():
        if name.startswith(official):
            return official
    return name


# ---------- 向量通道（可选；失败自动退回 BM25） ----------

_VECTOR = {"loaded": False, "ok": False, "model": None, "ids": None, "vectors": None}


def get_vector_channel():
    """加载离线向量索引（clauses）。未构建/加载失败返回 None → 纯 BM25。"""
    if _VECTOR["loaded"]:
        return _VECTOR if _VECTOR["ok"] else None
    _VECTOR["loaded"] = True
    try:
        import os
        if os.environ.get("SHZU_VECTOR", "auto") in ("0", "off", "false"):
            return None
        import numpy as np
        from ..config import ARTIFACTS_DIR
        path = ARTIFACTS_DIR / "vector_index.npz"
        if not path.is_file():
            return None
        # npz 由本地 scripts/build_vector_index.py 生成（ids/model/kb_version 为 object 数组），可信，需 allow_pickle
        data = np.load(path, allow_pickle=True)
        ids = [str(x) for x in data["ids"].tolist()]
        vectors = data["vectors"].astype("float32")
        from sentence_transformers import SentenceTransformer
        model_name = str(data["model"]) if "model" in data.files else "BAAI/bge-m3"
        model = SentenceTransformer(model_name, local_files_only=True)
        _VECTOR.update(ok=True, model=model, ids=ids, vectors=vectors)
        return _VECTOR
    except Exception as e:  # noqa: BLE001 —— 任何失败都退回 BM25
        import logging
        logging.getLogger("shzu.retriever").warning("vector channel unavailable: %s", e)
        _VECTOR["ok"] = False
        return None


def vector_query(query: str, top_k: int = 6):
    """向量通道检索：返回 [(clause_id, similarity)]；不可用时返回 []。"""
    # 向量通道由启动阶段或离线脚本预载，问答线程可以先走 BM25。
    ch = _VECTOR
    if not ch["ok"]:
        return []
    try:
        import numpy as np
        qv = ch["model"].encode([query], normalize_embeddings=True, show_progress_bar=False)[0].astype("float32")
        sims = ch["vectors"] @ qv
        idx = {cid: i for i, cid in enumerate(ch["ids"])}
        clause_ids = get_indexes()["clause_ids"]
        rows = [(sims[idx[cid]], cid) for cid in clause_ids if cid in idx]
        rows.sort(reverse=True)
        return [(cid, float(s)) for s, cid in rows[:top_k]]
    except Exception:
        return []


def retrieve(query, scope=None, top_k=6):
    """返回 (facts, clauses, fact_hits, clause_hits, meta)。
    meta = {"year_fallback": bool}（学年范围空时回退全库的标记）。
    scope={"college": 官方名} 或 {"year": int}：先确定范围再召回。"""
    kb = get_kb()
    idx = get_indexes()
    q = query_tokens(query)
    meta = {"year_fallback": False}

    clause_rows = fact_rows = None  # None = 全校
    if scope and scope.get("college"):
        college = norm_college(scope["college"])
        clause_rows = idx["clause_rows_of_college"].get(college, [])
        fact_rows = idx["fact_rows_of_college"].get(college, [])
    if scope and scope.get("year"):
        year = scope["year"]
        cy = idx["clause_rows_of_year"].get(year, [])
        fy = idx["fact_rows_of_year"].get(year, [])
        if clause_rows is not None:
            year_clauses, year_facts = set(cy), set(fy)
            clause_rows = [r for r in clause_rows if r in year_clauses] or clause_rows
            fact_rows = [r for r in (fact_rows or []) if r in year_facts] or fact_rows
        elif cy:
            clause_rows, fact_rows = cy, fy
        else:
            meta["year_fallback"] = True  # 该学年无候选：回退全库（上层如实说明年份缺口）

    fact_hits = idx["fact_index"].search(q, top_k=top_k, only_rows=fact_rows)
    clause_hits = idx["clause_index"].search(q, top_k=top_k, only_rows=clause_rows)

    # RRF 融合：BM25(fact) / BM25(clause) / 向量(clause，可选通道)
    def rrf(rank_lists, k=60):
        agg = {}
        for ranks in rank_lists:
            for rank, item_id in enumerate(ranks):
                agg.setdefault(item_id, 0.0)
                agg[item_id] += 1.0 / (k + rank + 1)
        return sorted(agg.items(), key=lambda x: -x[1])

    fact_rank = [idx["fact_ids"][i] for _, i in fact_hits]
    clause_rank = [idx["clause_ids"][i] for _, i in clause_hits]
    vec_rank = []
    if clause_rows is None:  # 全校检索才用向量通道；范围检索按范围元数据为准
        vec_rank = [cid for cid, _ in vector_query(query, top_k=top_k)]

    facts_scores = rrf([fact_rank])[:top_k]
    clause_scores = rrf([clause_rank, vec_rank])[:top_k]

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
    return facts, clauses, fact_hits, clause_hits, meta


def detect_year(query):
    m = YEAR_RE.search(query)
    return int(m.group(1)) if m else None
