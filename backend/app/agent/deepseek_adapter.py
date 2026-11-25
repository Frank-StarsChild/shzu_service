# -*- coding: utf-8 -*-
"""DeepSeek LangChain 适配器（对话图 6 章）。

- 模型客户端：langchain_openai.ChatOpenAI（DeepSeek OpenAI 兼容接口），
  由 graph.py 通过 bind_tools 以 LangChain 工具调用协议驱动。
- 密钥与模型由环境变量配置：DEEPSEEK_API_KEY / DEEPSEEK_MODEL / DEEPSEEK_BASE_URL / DEEPSEEK_TIMEOUT
- 未配置密钥时返回 None，对话图直接发布 model_config 技术错误（不再回退固定话术）
- 错误分类（openai 异常 → code）：model_timeout / model_connection / model_auth /
  model_balance / model_rate / model_response；模型输出未通过校验 → model_output
"""
import json
import logging
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, List, Optional

logger = logging.getLogger("shzu.deepseek")

DEFAULT_BASE_URL = "https://api.deepseek.com"
# 单次请求超时：DeepSeek 工具调用响应含长目录/多轮检索时可能超过 8s，默认 12s
REQUEST_TIMEOUT = float(os.environ.get("DEEPSEEK_TIMEOUT", "12.0"))
# 单轮总预算（含 openai SDK 内部重试）；每轮模型调用次数上限见 graph.py
TURN_BUDGET = float(os.environ.get("SHZU_TURN_BUDGET", "24.0"))


def _cfg():
    return {
        "api_key": os.environ.get("DEEPSEEK_API_KEY", "").strip(),
        "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat",
        "base_url": os.environ.get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
    }


def is_configured() -> bool:
    return bool(_cfg()["api_key"])


@dataclass
class ProviderError(Exception):
    category: str
    message: str

    def __str__(self):
        return f"[{self.category}] {self.message}"


def _extract_json(text: str) -> dict:
    """容忍 markdown 包裹的 JSON 提取；失败抛 ProviderError(invalid_output)。
    max_tokens 截断的尾巴（status/reply/evidence_ids 多已产出）按「闭合到最里层完整值」
    降级解析：截断在 reply 字符串内时保留已产出正文。"""
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        return json.loads(raw)
    except ValueError:
        pass
    s, e = raw.find("{"), raw.rfind("}")
    if s >= 0 and e > s:
        try:
            return json.loads(raw[s:e + 1])
        except ValueError:
            pass
    # 截断容错：从最里层可见的完整字段回退（找最后一个 `,"key":` 前的闭合位置）
    m = re.search(r',\s*"\w+"\s*:\s*$', raw)
    if m:
        trimmed = raw[:m.start()] + "}"
        try:
            obj = json.loads(trimmed[s:] if s >= 0 else trimmed)
            if isinstance(obj, dict) and obj.get("reply"):
                return obj
        except ValueError:
            pass
    # reply 被截在字符串中：闭合 reply 字符串再补 }
    m2 = re.search(r'"reply"\s*:\s*"((?:[^"\\]|\\.)*)$', raw, re.S)
    if m2 and s >= 0:
        trimmed = raw[:m2.end()] + '"}'
        try:
            obj = json.loads(trimmed[s:])
            if isinstance(obj, dict) and obj.get("reply"):
                return obj
        except ValueError:
            pass
    raise ProviderError("invalid_output", "模型输出不是合法 JSON")


def error_code(exc: Exception) -> str:
    """openai SDK 异常 → 技术错误 code（发布层据此生成技术错误状态）。"""
    try:
        from openai import APIConnectionError, APIStatusError, APITimeoutError
    except ImportError:  # pragma: no cover - openai 为 langchain_openai 依赖
        return "model_connection"
    if isinstance(exc, APITimeoutError):
        return "model_timeout"
    if isinstance(exc, APIConnectionError):
        return "model_connection"
    if isinstance(exc, APIStatusError):
        if exc.status_code in (401, 403):
            return "model_auth"
        if exc.status_code == 402:
            return "model_balance"
        if exc.status_code == 429:
            return "model_rate"
    return "model_response"


def create_chat_model():
    """构造（并缓存）LangChain ChatOpenAI；未配置密钥时返回 None。

    绑定工具由 graph.py 通过 model.bind_tools(...) 完成（LangChain 工具调用协议）。
    单次请求超时默认 REQUEST_TIMEOUT；对话图按本轮剩余预算以 invoke(timeout=...) 覆盖。
    """
    cfg = _cfg()
    if not cfg["api_key"]:
        return None
    return _create_chat_model(**cfg)


@lru_cache(maxsize=1)
def _create_chat_model(api_key: str, model: str, base_url: str):
    from langchain_openai import ChatOpenAI

    client = ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.2,
        # 资料丰富的回答（多工具结果 + 6 证据 + 900 字 reply）总输出可达 2k token；
        # 1100 会把最终 JSON 截成非法尾（model_response 失败的主因）
        max_tokens=2400,
        timeout=REQUEST_TIMEOUT,
        max_retries=0,   # 在这轮的剩余时间内只发一次，重试由用户或调用方触发
    )
    logger.info("deepseek chat model ready (%s @ %s)", model, base_url)
    return client


def describe_config() -> Dict[str, Any]:
    cfg = _cfg()
    return {
        "provider": "deepseek",
        "configured": bool(cfg["api_key"]),
        "model": cfg["model"] if cfg["api_key"] else None,
        "note": "每轮先由 DeepSeek 理解消息并通过 LangChain 调用工具，再生成回复；"
                "未配置 DEEPSEEK_API_KEY 时对话返回技术错误状态。",
    }
