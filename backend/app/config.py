# -*- coding: utf-8 -*-
"""路径与应用配置。原始采集根目录通过配置读取，不进入代码仓库。"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]  # shzu-service-agent/

# 本地环境配置：优先读项目根 .env（密钥不入库），不覆盖已存在的环境变量
try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")
except ImportError:  # python-dotenv 缺失时静默跳过，仍可用系统环境变量
    pass

DATA_DIR = BASE_DIR / "data"
REVIEWED_DIR = DATA_DIR / "reviewed"
WORKFLOWS_DIR = DATA_DIR / "workflows"
ARTIFACTS_DIR = DATA_DIR / "artifacts"
DB_PATH = DATA_DIR / "app.sqlite3"

# 原始采集资料根目录（仅离线审定时使用，不直接公开为网站根目录）
SOURCE_ROOT = os.environ.get("SHZU_SOURCE_ROOT", r"E:\比赛\teleagent\学校资料")

APP_NAME = "石大智多星 · 校园一站式服务智能体"
KB_VERSION = "kb-2026-11-20-r13"

# 正式调度由部署配置开启，本地开发默认执行内置对话图。
PLATFORM_MODE = os.environ.get("SHZU_PLATFORM_MODE", "local-stub")
CHAT_BUDGET_SECONDS = min(4.5, max(0.1, float(os.environ.get("SHZU_CHAT_BUDGET_SECONDS", "4.2"))))

# 检索阈值：候选不足时进入“资料不足”分支（按开发样本校准）
RETRIEVE_TOP_K = 6
RETRIEVE_SCORE_MIN = 2.2

ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
