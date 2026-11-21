# -*- coding: utf-8 -*-
"""加载审定知识包：documents / clauses / facts / flows / rules / aliases

clauses 文件按 REVIEWED_DIR 下 clauses_*.json 全量加载（新增板块由批量导入器
scripts/import_campus_corpus.py 产出 clauses_imp_<板块>.json，本加载器自动纳入）。
"""
import json
from functools import lru_cache
from pathlib import Path

from ..config import REVIEWED_DIR, WORKFLOWS_DIR, KB_VERSION


def _read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _clause_files():
    """全部 clauses_*.json（手工审定的 5 份 + 批量导入的各板块文件），排序保证稳定。"""
    return sorted(p.name for p in Path(REVIEWED_DIR).glob("clauses_*.json") if p.is_file())


@lru_cache(maxsize=1)
def load_documents():
    return _read(REVIEWED_DIR / "documents.json")


@lru_cache(maxsize=1)
def load_clauses():
    items = []
    for name in _clause_files():
        data = _read(REVIEWED_DIR / name)
        items.extend(data.get("clauses", []))
    return items


@lru_cache(maxsize=1)
def load_facts():
    items = []
    for name in _clause_files():
        data = _read(REVIEWED_DIR / name)
        items.extend(data.get("facts", []))
    return items


@lru_cache(maxsize=1)
def load_qa_topics():
    items = []
    for name in _clause_files():
        data = _read(REVIEWED_DIR / name)
        items.extend(data.get("qa_topics", []))
    return items


@lru_cache(maxsize=1)
def load_flows():
    return _read(WORKFLOWS_DIR / "flows.json")


@lru_cache(maxsize=1)
def load_rules():
    return _read(WORKFLOWS_DIR / "rules.json")


@lru_cache(maxsize=1)
def load_aliases():
    return _read(WORKFLOWS_DIR / "aliases.json")


@lru_cache(maxsize=1)
def load_colleges():
    """学院机构目录：官方名称 + 常用别名（源自采集目录 08_各学院官网）。"""
    return _read(WORKFLOWS_DIR / "colleges.json")


class KnowledgeBase:
    """统一知识视图：clause_id -> clause；doc_id -> document；fact 索引。"""

    def __init__(self):
        docs = load_documents()
        self.kb_version = docs.get("kb_version", KB_VERSION)
        self.documents = {d["doc_id"]: d for d in docs["documents"]}
        self.clauses = {c["clause_id"]: c for c in load_clauses()}
        self.facts = {f["fact_id"]: f for f in load_facts()}
        self.qa_topics = load_qa_topics()
        self.flows = {f["flow_id"]: f for f in load_flows()["flows"]}
        self.rules = {r["rule_id"]: r for r in load_rules()["rules"]}
        self.aliases = load_aliases()
        self.colleges = load_colleges().get("colleges", [])

    def college_of_text(self, text: str):
        """从问题文本归一识别学院：返回官方名称（含则匹配；长度优先，非内容子串）。
        返回 None 表示未提及任何已知学院。"""
        best = None
        for item in self.colleges:
            names = [item["official"]] + list(item.get("aliases") or [])
            for n in names:
                if n and n in text:
                    if best is None or len(n) > len(best[1]):
                        best = (item["official"], n)
        return best[0] if best else None

    def topics_of_college(self, official: str):
        """该学院已入库的主题列表（object_college 匹配）。"""
        return [t for t in self.qa_topics if t.get("object_college") == official]

    def document_of(self, clause_id):
        clause = self.clauses.get(clause_id)
        if not clause:
            return None
        return self.documents.get(clause["doc_id"])

    def citation(self, clause_id):
        """来源卡：由服务端来源表生成，模型不生成 URL、页码或文件名称。"""
        clause = self.clauses.get(clause_id)
        doc = self.document_of(clause_id)
        if not clause or not doc:
            return None
        return {
            "evidence_id": clause_id,
            "doc_id": doc["doc_id"],
            "title": doc["title"],
            "issuer": doc["issuer"],
            "source_url": doc["source_url"],
            "published_at": doc.get("published_at"),
            "effective_from": doc.get("effective_from"),
            "effective_to": doc.get("effective_to"),
            "review_state": doc.get("review_state"),
            "locator": clause.get("source_locator"),
            "exact_text": clause.get("exact_text"),
            "time_condition": clause.get("time_condition"),
        }

    def citations_for(self, clause_ids):
        out, seen = [], set()
        for cid in clause_ids:
            if cid in seen:
                continue
            c = self.citation(cid)
            if c:
                out.append(c)
                seen.add(cid)
        return out


@lru_cache(maxsize=1)
def get_kb():
    return KnowledgeBase()
