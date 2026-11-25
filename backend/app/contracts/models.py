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
    # 办事体验改造：会话里学生自述过的身份事实（本科/二年级等），进入向导时带入
    # 待确认；旧响应无这两个字段自然兼容。preset_note 为引用原句。
    preset_slots: Optional[dict] = None
    preset_note: Optional[str] = None


# ---------- 场景动作卡片（可选字段：由后端工具产生的已核实结构化数据，
#             模型正文之外的展示组件；旧消息无该字段仍可正常渲染） ----------

class ActionCheck(BaseModel):
    """分诊/核对过程的状态行（做过什么、结论如何）"""
    label: str
    state: Literal["done", "not_found", "partial", "needs_user"] = "done"
    note: str = ""


class ChecklistItem(BaseModel):
    """核对清单单项：已有依据 / 待用户补充 / 待学院确认 / 待官网核实"""
    label: str
    state: Literal["verified", "needs_user", "needs_college", "needs_web"] = "verified"
    detail: str = ""
    evidence_ids: List[str] = []
    # 稳定条目 key（如 eligibility / materials）：供办理流程把核对项映到节点，
    # 不改变 label 展示；旧响应无此字段仍正常显示。
    key: Optional[str] = None


class ActionEntry(BaseModel):
    """官方办理入口（电话/地点/链接），均带证据"""
    label: str = ""
    phone: Optional[str] = None
    url: Optional[str] = None
    person: Optional[str] = None
    note: Optional[str] = None
    evidence_ids: List[str] = []


class ActionFlowRef(BaseModel):
    flow_id: str
    name: str = ""
    historical: bool = False
    note: Optional[str] = None
    preset_slots: Optional[dict] = None   # 会话里学生自述过的身份事实（同 WorkflowRefBody）
    preset_note: Optional[str] = None


class RepairStep(BaseModel):
    text: str
    evidence_ids: List[str] = []


class ErrandConfirm(BaseModel):
    """办事单「出发前确认」条目：待学生/办公室核实的具体事项"""
    text: str
    state: Literal["needs_user", "needs_office", "needs_college"] = "needs_user"


class PlaceMatch(BaseModel):
    building_id: Optional[str] = None   # 已登记到沙盘的楼（可为空=仅文字定位）
    label: str
    category: str = ""
    campus: str = "中区"
    note: str = ""
    evidence_id: Optional[str] = None


class ActionCard(BaseModel):
    """联合动作卡片（kind 判别）。四种：材料核对 / 网络报修分诊 / 办事单 / 沙盘定位"""
    kind: Literal["checklist", "repair", "place", "errand"]
    title: str = ""
    # checklist
    award: Optional[str] = None
    year: Optional[int] = None
    year_note: Optional[str] = None
    items: List[ChecklistItem] = []
    flow: Optional[ActionFlowRef] = None
    entry: Optional[ActionEntry] = None
    # repair
    identified: dict = {}              # 识别出的校区/楼栋/设备范围
    announcement: dict = {}            # 公告核对（matched/checked/detail）
    checks: List[ActionCheck] = []
    steps: List[RepairStep] = []
    draft: Optional[str] = None        # 报修草稿（无校方正式接口，不真实提交）
    # place
    ambiguous: bool = False
    matches: List[PlaceMatch] = []
    fallback_text: Optional[str] = None
    # errand（办事单）：现场可用的一页纸结论，全部取自本次回答关联的证据
    place: Optional[dict] = None        # {building, room, building_id, campus, evidence_id}
    dept: Optional[str] = None          # 负责部门（如 学生事务管理办公室）
    service_scope: Optional[str] = None # 窗口职责（如 学生证、乘车优惠卡办理）
    phone: Optional[str] = None
    hours: Optional[str] = None
    materials_confirmed: bool = False   # 证据是否确认了材料清单
    confirms: List[ErrandConfirm] = []  # 出发前需要确认的事项


# ---------- 办理路线（可选字段：随回复一起发布的办事步骤图，旧响应无该字段） ----------

class ProcessNode(BaseModel):
    """办理路线的一个环节。state 只用四种：
    ready=有内容可看/可做；needs_user=待你补充；needs_check=待核实；upcoming=后续步骤。"""
    id: str
    title: str
    detail: str = ""
    state: Literal["ready", "needs_user", "needs_check", "upcoming"] = "upcoming"
    citation_ids: List[str] = []


class ProcessEdge(BaseModel):
    """节点连边；label 用于分支条件（如「已恢复」「仍无法连接」）"""
    from_id: str
    to_id: str
    label: Optional[str] = None


class ProcessWorkflowEntry(BaseModel):
    """材料环节对应的既有向导入口（只引用本轮已有的向导）"""
    node_id: str
    flow_id: str
    historical: bool = False


class ProcessBody(BaseModel):
    title: str
    nodes: List[ProcessNode]
    edges: List[ProcessEdge] = []
    focus_id: Optional[str] = None
    workflow_entry: Optional[ProcessWorkflowEntry] = None


class ChatResponse(BaseModel):
    status: Literal["answer", "clarify", "insufficient", "out_of_scope", "workflow",
                    "error", "model_unavailable"]
    session_id: str
    request_id: str
    trace_id: str
    workflow_run_id: Optional[str] = None
    knowledge_version: str
    answer: Optional[AnswerBody] = None
    clarify: Optional[ClarifyBody] = None
    reason_code: Optional[str] = None
    unknown_fields: List[str] = []
    message: Optional[str] = None
    workflow: Optional[WorkflowRefBody] = None
    citations: List[CitationRef] = []
    actions: List[ActionCard] = []     # 可选：场景动作卡片（旧消息缺省为空）
    process: Optional[ProcessBody] = None   # 可选：办理路线（旧消息缺省为空）
    tools_used: List[str] = []         # 可选：本轮实际执行的工具（步骤可见）
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
    group: Optional[str] = None        # 表单分组（如 两种排名各自的「名次/总人数」归属）


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
