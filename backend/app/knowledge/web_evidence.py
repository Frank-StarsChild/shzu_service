# -*- coding: utf-8 -*-
"""当轮网页证据注册表：lookup_official_web 工具取到的官网正文。

- 注册的证据以 web-<sha8> 为 ID，进入当轮 citations；前端点引用走
  /api/v1/evidence/{id}，本模块提供 fallback 查询（kb.citation 找不到时）。
- 仅用于当前问答（对话图发布层引用校验集合包含这些 ID）；要进长期库须走
  离线审定发布（import_campus_corpus → data/reviewed），不在运行时写入。
- 进程内 TTL 清理，避免长期运行内存增长。
"""
import re
import time
from typing import Dict, Optional

REGISTRY: Dict[str, dict] = {}
_TTL_SECONDS = 6 * 3600
_last_gc = 0.0


def register(title: str, issuer: str, url: str, excerpt: str,
             published_at: Optional[str] = None, locator: Optional[str] = None,
             accessed_at: Optional[str] = None, note: Optional[str] = None) -> dict:
    """注册一条当轮网页证据，返回完整 citation dict（含生成的 evidence_id）。"""
    import hashlib
    eid = "web-" + hashlib.sha256(
        (url + "|" + excerpt[:200]).encode("utf-8")).hexdigest()[:10]
    citation = {
        "id": eid, "title": title, "issuer": issuer, "url": url,
        "published_at": published_at, "locator": locator or "官网原文",
        "excerpt": excerpt[:600], "time_condition": None,
        "review_state": "web_verified_current_turn",
        "accessed_at": accessed_at or time.strftime("%Y-%m-%d %H:%M"),
        "note": note or "本轮联网查证取得；未入长期审定库，仅限本次问答引用。",
        "_ts": time.time(),
    }
    citation_out = {k: v for k, v in citation.items() if not k.startswith("_")}
    REGISTRY[eid] = citation
    _gc()
    return citation_out


def get(evidence_id: str) -> Optional[dict]:
    _gc()
    return REGISTRY.get(evidence_id)


def _gc():
    global _last_gc
    now = time.time()
    if now - _last_gc < 300:
        return
    _last_gc = now
    for eid, c in list(REGISTRY.items()):
        if now - float(c.get("_ts", now)) > _TTL_SECONDS:
            REGISTRY.pop(eid, None)


def sanitize_query_for_web(query: str) -> str:
    """隐私清洗：学号、电话、住址、成绩、表单内容不出本地（不进任何外部请求）。
    去除长数字串与含身份信息的短语，保留检索关键词。"""
    q = query or ""
    q = re.sub(r"\d{5,}", "", q)          # 学号/电话/证件号等长数字串
    q = re.sub(r"(学号|电话|手机号|身份证|成绩|绩点|住址|宿舍号|门牌号)\s*[:：]?\s*[\w\-#]*", "", q)
    return q.strip()
