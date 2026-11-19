# -*- coding: utf-8 -*-
"""平台适配层：赛事账号确认前使用本地占位（方案 4.2 D0 待确认项）。
接入真实平台后，由本模块转发 Workflow 调用并保留真实运行记录。"""
import time

from ..config import PLATFORM_MODE


def platform_adapter_status():
    return {
        "mode": PLATFORM_MODE,
        "registered": False,
        "note": "本地占位：意图路由、检索、规则与文档工具在本服务内执行；"
                "接入赛事认可的 TeleAgent 编排环境后，chat 请求将经平台 Workflow 调度并记录真实 run id。",
        "d0_checklist": [
            "赛事认可的产品、账号及编排入口",
            "发布 Web/H5（平台链接、二维码）",
            "调用自建检索与文档工具",
            "会话、结构化输出、API/流式能力",
            "自定义页面或网页小应用的承载方式",
        ],
    }


def new_workflow_run_id(prefix="local"):
    return f"{prefix}-run-{int(time.time() * 1000)}"
