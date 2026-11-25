"""Budget a chat turn independently of model and tool I/O."""
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import BoundedSemaphore

from pydantic import ValidationError

from ..config import CHAT_BUDGET_SECONDS, KB_VERSION
from ..contracts.models import ChatResponse
from ..knowledge.loader import get_kb
from ..platform import adapter
from . import graph

logger = logging.getLogger("shzu.chat")
_MAX_WORKERS = 8
_workers = ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="chat-turn")
_capacity = BoundedSemaphore(_MAX_WORKERS)


def run_chat(session_id: str, request_id: str, query: str, slots: dict, history: list, started: float) -> dict:
    deadline = time.monotonic() + CHAT_BUDGET_SECONDS - (time.perf_counter() - started)
    trace_id = "trace-" + uuid.uuid4().hex[:12]
    state = {"session_id": session_id, "request_id": request_id, "trace_id": trace_id,
             "knowledge_version": KB_VERSION, "timings": {"start": started}}
    progress = ([], [])

    def checkpoint(citations, tools_used):
        nonlocal progress
        progress = citations, tools_used

    def execute():
        kb = get_kb()
        state["knowledge_version"] = kb.kb_version
        if not adapter.platform_enabled():
            return graph.run_turn(session_id, request_id, query, slots=slots, history=history,
                                  deadline=deadline, started=started, trace_id=trace_id, on_progress=checkpoint)

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        run_id, result = adapter.run_workflow(
            {"session_id": session_id, "request_id": request_id, "query": query,
             "slots": slots, "history": history, "timeout_ms": int(remaining * 1000)}, timeout=remaining)
        logger.info("TeleAgent workflow run_id=%r request_id=%r trace_id=%s", run_id, request_id, trace_id)
        final = result.get("final")
        new_slots = result.get("slots", slots)
        if not isinstance(final, dict) or not isinstance(new_slots, dict):
            raise adapter.WorkflowError("platform_response")
        try:
            final = ChatResponse.model_validate({**final, "session_id": session_id, "request_id": request_id,
                                                "trace_id": trace_id, "workflow_run_id": run_id,
                                                "knowledge_version": state["knowledge_version"],
                                                "timing_ms": int((time.perf_counter() - started) * 1000)}).model_dump()
        except ValidationError as exc:
            raise adapter.WorkflowError("platform_response") from exc
        sources = [source for c in final["citations"] for source in graph._citations_for(kb, [c["id"]])]
        if len(sources) != len(final["citations"]):
            raise adapter.WorkflowError("platform_response")
        final["citations"] = sources
        return {"final": final, "slots": new_slots}

    if time.monotonic() >= deadline:
        return {"final": graph.deadline_response(state, []), "slots": slots}
    if not _capacity.acquire(blocking=False):
        final = graph._build(state, "error", reason_code="chat_busy", message="查询服务正忙，请稍后重试。")
        return {"final": final, "slots": slots}
    try:
        future = _workers.submit(execute)
    except BaseException:
        _capacity.release()
        raise
    future.add_done_callback(lambda _: _capacity.release())
    try:
        return future.result(timeout=max(0, deadline - time.monotonic()))
    except TimeoutError:
        future.cancel()
        citations, tools_used = progress
        final = graph.deadline_response({**state, "tools_used": tools_used}, citations)
        logger.info("chat deadline trace_id=%s evidence=%d", trace_id, len(citations))
    except adapter.WorkflowError as exc:
        message = "赛事 Workflow 尚未配置。" if exc.code == "platform_config" else "赛事 Workflow 暂未返回可用答复，请重试。"
        final = graph._build(state, "error", reason_code=exc.code, message=message)
    return {"final": final, "slots": slots}
