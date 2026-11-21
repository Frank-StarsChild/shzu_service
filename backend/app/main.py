# -*- coding: utf-8 -*-
"""TeleAgent 石大智多星后端服务（Vue3 + FastAPI 版）。
启动：uvicorn backend.app.main:app --port 8300（工作目录为 shzu-service-agent/）"""
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_NAME, BASE_DIR
from .models import store
from .api import chat, tasks, sources, system
from .api import v1

logging.basicConfig(level=logging.INFO)

store.init_db()

app = FastAPI(title=APP_NAME, version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本地开发与平台演示；上线时按发布域名收紧
    allow_methods=["*"],
    allow_headers=["*"],
)

# v1 契约（Vue 3 客户端）
app.include_router(v1.router)
# 历史接口（React 原型与评测脚本兼容，开发期保留）
app.include_router(chat.router, prefix="/legacy")
app.include_router(tasks.router)
app.include_router(sources.router)
app.include_router(system.router)


@app.on_event("startup")
def _warm_indexes():
    """启动即构建检索索引（万级条款 jieba 分词约 30s；命中磁盘缓存约 2s），
    并预载向量通道（bge 编码模型约 6-10s；懒加载会拖慢首次全校检索 ~15-20s，
    有触发工具超时的风险）。后台线程执行，向量加载失败自动退回纯 BM25，不阻塞服务。"""
    import threading

    from .knowledge.retriever import get_indexes, get_vector_channel

    def _warm():
        get_indexes()
        get_vector_channel()

    threading.Thread(target=_warm, daemon=True, name="index-warmup").start()


@app.exception_handler(store.sqlite3.Error)
async def _db_error(request: Request, exc):
    return JSONResponse(status_code=500, content={
        "error": {"code": "storage_error", "message": "数据存储异常", "retryable": True}})


DIST = BASE_DIR / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets"), html=False), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """SPA 回退：API 未命中的路径服务 index.html（Vue Router history 模式）。"""
        if full_path.startswith(("api/", "tools/", "health/", "legacy/", "docs", "openapi.json")):
            return JSONResponse(status_code=404, content={
                "error": {"code": "not_found", "message": f"/{full_path} 不存在"}})
        candidate = (DIST / full_path).resolve()
        if full_path and candidate.is_file() and str(candidate).startswith(str(DIST)):
            return FileResponse(str(candidate))
        return FileResponse(str(DIST / "index.html"))
