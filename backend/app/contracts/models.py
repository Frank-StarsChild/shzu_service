# -*- coding: utf-8 -*-
"""契约层：请求、响应与错误模型（方案 5.2/5.3）。
有判别字段的联合类型：answer / clarify / insufficient / out_of_scope / workflow。"""
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

# ---------- 通用 ----------

class ErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool = False
    trace_id: Optional[str] = None
    field_errors: Optional[dict] = None


# ---------- 聊天请求 ----------

class ChatRequest(BaseModel):
    session_id: str
    request_id: str
    message: Optional[str] = Field(default=None, max_length=800)
    choice_id: Optional[str] = None


# ---------- 聊天响应 ----------

class CitationRef(BaseModel):
    id: str
    title: str
    issuer: str
    url: str
    published_at: Optional[str] = None
    locator: Optional[str] = None
    excerpt: Optional[str] = None
    time_condition: Optional[str] = None


class AnswerBlock(BaseModel):
    kind: str = "fact"          # fact / office / step / material / note
    text: str
    citation_ids: List[str] = []


class AnswerBody(BaseModel):
    blocks: List[AnswerBlock]
    unknown_fields: List[str] = []


class ClarifyChoice(BaseModel):
    id: str
    label: str


class ClarifyBody(BaseModel):
    question: str
    choices: List[ClarifyChoice] = []
    input_hint: Optional[str] = None


class WorkflowRefBody(BaseModel):
    flow_id: str
    flow_version: str
    scope: dict = {}
    historical: bool = False
    name: str = ""
    summary: str = ""


# 联合响应（判别字段 status）
# error：技术错误状态（模型不可用/超时/输出未通过校验），前端展示失败与重试入口，
# 不冒充智能体回答；message 为系统级技术说明，不是模型正文。
# model_unavailable：历史版本技术状态，仅为兼容旧会话记录保留。
class ChatResponse(BaseModel):
    status: Literal["answer", "clarify", "insufficient", "out_of_scope", "workflow",
                    "error", "model_unavailable"]
    session_id: str
    request_id: str
    trace_id: str
    knowledge_version: str
    answer: Optional[AnswerBody] = None
    clarify: Optional[ClarifyBody] = None
    reason_code: Optional[str] = None
    unknown_fields: List[str] = []
    message: Optional[str] = None
    workflow: Optional[WorkflowRefBody] = None
    citations: List[CitationRef] = []
    timing_ms: Optional[int] = None


# ---------- 服务目录 ----------

class ServiceEntry(BaseModel):
    service_id: str
    name: str
    board: str
    summary: str
    student_types: List[str] = []
    evidence_ids: List[str] = []
    flow_id: Optional[str] = None
    data_status: str = "published"
    sample_questions: List[str] = []


class ServicesResponse(BaseModel):
    services: List[ServiceEntry]
    knowledge_version: str


# ---------- 证据 ----------

class EvidenceResponse(BaseModel):
    id: str
    title: str
    issuer: str
    url: str
    published_at: Optional[str] = None
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    locator: Optional[str] = None
    excerpt: str
    time_condition: Optional[str] = None
    review_state: Optional[str] = None
    doc_id: str
    knowledge_version: str


# ---------- 向导 ----------

class WorkflowSummary(BaseModel):
    flow_id: str
    name: str
    version: str
    historical: bool = False
    scope: dict = {}
    boards: List[str] = []
    steps: List[str] = []
    export_types: List[str] = ["docx"]


class WorkflowsResponse(BaseModel):
    workflows: List[WorkflowSummary]


class SlotSpec(BaseModel):
    key: str
    label: str
    type: Literal["text", "textarea", "choice", "number", "date", "time", "tel"]
    options: List[str] = []
    required: bool = False
    personal: bool = False
    note: Optional[str] = None


class WorkflowStep(BaseModel):
    key: str
    name: str
    desc: str = ""
    slot_keys: List[str] = []
    evidence_ids: List[str] = []


class RuleResultView(BaseModel):
    rule_id: str
    name: str
    state: Literal["pass", "fail", "unknown"]
    explain: str = ""
    evidence_ids: List[str] = []


class MaterialView(BaseModel):
    name: str
    status: str
    submit_or_keep: str = ""
    evidence_ids: List[str] = []


class WorkflowDetail(BaseModel):
    flow_id: str
    name: str
    version: str
    historical: bool = False
    demo_notice: Optional[str] = None
    scope: dict = {}
    steps: List[WorkflowStep]
    slots: List[SlotSpec]
    rule_results: List[RuleResultView] = []
    materials: List[MaterialView] = []
    timeline: List[dict] = []
    contact: Optional[dict] = None
    evidence_ids: List[str] = []


class PreviewRequest(BaseModel):
    flow_version: str
    inputs: dict = {}
    historical_confirmed: bool = False


class FieldError(BaseModel):
    slot_key: str
    message: str


class PreviewResponse(BaseModel):
    preview_token: str
    flow_id: str
    flow_version: str
    field_errors: List[FieldError] = []
    rule_results: List[RuleResultView] = []
    materials: List[MaterialView] = []
    missing_personal_fields: List[str] = []
    document_kinds: List[str] = []
    evidence_ids: List[str] = []
    generated: bool = False


class ExportRequest(BaseModel):
    flow_version: str
    inputs: dict = {}
    historical_confirmed: bool = False
    preview_token: str


# ---------- 会话 ----------

class SessionCreated(BaseModel):
    session_id: str
    expires_at: str


class TurnMessage(BaseModel):
    request_id: str
    seq: int
    role: Literal["user", "assistant"]
    status: str = "done"
    text: str = ""
    response: Optional[ChatResponse] = None


# ---------- 健康 ----------

class LiveResponse(BaseModel):
    status: str = "ok"


class ReadyResponse(BaseModel):
    status: str = "ok"
    knowledge_version: str
    knowledge_sources: int
    knowledge_evidence: int
    model_provider: str
    model_configured: bool
