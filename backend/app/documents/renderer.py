# -*- coding: utf-8 -*-
"""文档生成：基于核验模板填充 DOCX（python-docx）。
规则：正式表格保持原有栏目；缺失字段保留可见填写项；签字盖章栏留白；
出处与办理说明放在独立的“填写依据与办理提示”文件（方案 8.4 / 9）。"""
import os
import re
from datetime import datetime

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from ..config import ARTIFACTS_DIR
from ..knowledge.loader import get_kb

FONT = "宋体"


def _set_font(run, size=10.5, bold=False):
    run.font.name = "Times New Roman"
    run.font.size = Pt(size)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)


def _cell_text(cell, text, size=10.5, bold=False, center=True):
    cell.text = ""
    p = cell.paragraphs[0]
    if center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(str(text) if text is not None else "")
    _set_font(run, size=size, bold=bold)


def _title(doc, text, size=16):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    _set_font(run, size=size, bold=True)


def _para(doc, text, size=12, bold=False, align=None, indent=False):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    if indent:
        p.paragraph_format.first_line_indent = Cm(0.74)
    run = p.add_run(text)
    _set_font(run, size=size, bold=bold)
    return p


def _blank(cell_lines=1):
    return "\u3000" * 2  # 可见留白


def gen_lizhi_form(task):
    """本专科生国家励志奖学金申请表（2025 年学校通知附件2 结构）。
    官方表格栏目不增删；未确认字段留空；签名/审核栏留白。"""
    slots = task["slots"]
    doc = Document()
    sec = doc.sections[0]
    sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(2.0)
    sec.left_margin, sec.right_margin = Cm(2.2), Cm(2.2)

    _title(doc, "本专科生国家励志奖学金申请表", size=16)
    _para(doc, "（模板依据：石河子大学 2025 年本专科生国家励志奖学金评审通知附件2；"
               "本文件为按官方表格栏目生成的可编辑版本，来源与原文以“填写依据与办理提示”文件为准）",
          size=9, align=WD_ALIGN_PARAGRAPH.CENTER)

    def row_of(table, r, cells):
        for i, v in enumerate(cells):
            _cell_text(table.rows[r].cells[i], v)

    # 本人情况
    t1 = doc.add_table(rows=6, cols=6)
    t1.style = "Table Grid"
    t1.alignment = WD_TABLE_ALIGNMENT.CENTER
    row_of(t1, 0, ["姓  名", slots.get("name") or _blank(), "性别", "", "出生年月", ""])
    row_of(t1, 1, ["民  族", "", "政治面貌", "", "入学时间", ""])
    row_of(t1, 2, ["学  号", "", "所在年级", slots.get("grade") or "", "联系电话", slots.get("personal_phone") or ""])
    row_of(t1, 3, ["身份证号码", "", "电子照片", "（贴照片处）", "", ""])
    row_of(t1, 4, ["院（系）", slots.get("college") or "", "专业", slots.get("major_class") or "", "班", ""])
    _cell_text(t1.rows[5].cells[0], "曾获何种奖励")
    t1.rows[5].cells[1].merge(t1.rows[5].cells[5])
    _cell_text(t1.rows[5].cells[1], "")

    _para(doc, "家庭经济情况", size=11, bold=True)
    t2 = doc.add_table(rows=4, cols=4)
    t2.style = "Table Grid"
    row_of(t2, 0, ["家庭人口总数", "", "家庭月总收入", ""])
    row_of(t2, 1, ["人均月收入", "", "收入来源", ""])
    row_of(t2, 2, ["家庭住址", "", "邮政编码", ""])
    _cell_text(t2.rows[3].cells[0], "困难认定情况")
    _cell_text(t2.rows[3].cells[1], slots.get("difficulty_confirmed") or "（本学年是否已认定：待填）")
    t2.rows[3].cells[2].merge(t2.rows[3].cells[3])
    _cell_text(t2.rows[3].cells[2], "")

    _para(doc, "学习成绩", size=11, bold=True)
    t3 = doc.add_table(rows=3, cols=2)
    t3.style = "Table Grid"
    study_rank = slots.get("study_rank") or ""
    study_total = slots.get("study_total") or ""
    zc_rank = slots.get("zongce_rank") or ""
    zc_total = slots.get("zongce_total") or ""
    row_of(t3, 0, ["成绩排名：{} / {}（名次/总人数）".format(study_rank, study_total),
                   "实行综合考评排名：是☑；否□" if zc_rank else "实行综合考评排名：是□；否□"])
    row_of(t3, 1, ["必修课    门，其中及格以上    门", "如是，排名：{} / {}（名次/总人数）".format(zc_rank, zc_total)])
    _cell_text(t3.rows[2].cells[0], "申请理由")
    t3.rows[2].cells[1].merge(t3.rows[2].cells[1])
    _cell_text(t3.rows[2].cells[1], (slots.get("reason") or "").strip() or _blank())

    _para(doc, "")
    _para(doc, "申请人签名：\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000年\u3000\u3000月\u3000\u3000日",
          size=11, align=WD_ALIGN_PARAGRAPH.RIGHT)
    _para(doc, "")
    t4 = doc.add_table(rows=2, cols=1)
    t4.style = "Table Grid"
    _cell_text(t4.rows[0].cells[0], "院系审核意见：", bold=True, center=False)
    _para(doc, "", size=8)
    _para(doc, "（公章）\u3000\u3000\u3000\u3000年\u3000\u3000月\u3000\u3000日", size=10, align=WD_ALIGN_PARAGRAPH.RIGHT)
    _cell_text(t4.rows[1].cells[0], "学校审核意见：", bold=True, center=False)
    _para(doc, "", size=8)
    _para(doc, "（公章）\u3000\u3000\u3000\u3000年\u3000\u3000月\u3000\u3000日", size=10, align=WD_ALIGN_PARAGRAPH.RIGHT)

    return doc


def gen_leave_form(task):
    """生命科学学院学生请假条（页面完整版）+ 存根联。意见栏与签章区留白。"""
    s = task["slots"]
    doc = Document()
    sec = doc.sections[0]
    sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(2.0)
    sec.left_margin, sec.right_margin = Cm(2.4), Cm(2.4)

    _title(doc, "生命科学学院学生请假条", size=15)
    _para(doc, "尊敬的老师：", size=12)
    reason = s.get("reason") or "\u3000" * 10
    college_text = s.get("college") or "（学院）"
    body = ("我是{}的{}专业{}级{}班学生，因{}需请假{}天（节），自{}月{}日{}时至{}月{}日{}时，"
            "请假期间，安全责任由本人负责。").format(
        college_text,
        s.get("major") or "\u3000" * 4, s.get("grade") or "\u3000" * 2, s.get("cls") or "\u3000" * 2,
        reason, s.get("days_or_sections") or "\u3000" * 2,
        _md(s.get("start_date")) or "\u3000" * 2, _dd(s.get("start_date")) or "\u3000",
        s.get("start_time") or "\u3000" * 3,
        _md(s.get("end_date")) or "\u3000" * 2, _dd(s.get("end_date")) or "\u3000",
        s.get("end_time") or "\u3000" * 3)
    _para(doc, body, size=12, indent=True)
    if (s.get("going_home") == "是") or (s.get("home_address") or "").strip():
        _para(doc, "请假回家，需填家庭住址：" + (s.get("home_address") or "\u3000" * 20), size=12, indent=True)
    _para(doc, "家 长 电话：{}\u3000\u3000个 人 电话：{}".format(
        s.get("parent_phone") or "\u3000" * 10, s.get("personal_phone") or "\u3000" * 10), size=12, indent=True)
    _para(doc, "班主任意见：\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000，辅导员意见：\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000", size=12, indent=True)
    _para(doc, "学办（盖章）：\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000，院领导意见：\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000", size=12, indent=True)
    _para(doc, "请假人签字：{}\u3000\u3000\u3000\u3000时间：年\u3000月\u3000日\u3000时".format(
        s.get("name") or "\u3000" * 6), size=12, indent=True)

    doc.add_page_break()
    _title(doc, "生命科学学院请假条存根", size=14)
    stub = ("{}专业{}级{}班学生，因{}请假{}天（节），自{}月{}日{}时至{}月{}日{}时。").format(
        s.get("major") or "\u3000" * 4, s.get("grade") or "\u3000", s.get("cls") or "\u3000",
        reason, s.get("days_or_sections") or "\u3000" * 2,
        _md(s.get("start_date")) or "\u3000" * 2, _dd(s.get("start_date")) or "\u3000",
        s.get("start_time") or "\u3000" * 3,
        _md(s.get("end_date")) or "\u3000" * 2, _dd(s.get("end_date")) or "\u3000",
        s.get("end_time") or "\u3000" * 3)
    _para(doc, stub, size=12, indent=True)
    for line in ["家长电话：" + "\u3000" * 14,
                 "个人电话：" + "\u3000" * 14,
                 "批 假 人：" + "\u3000" * 14,
                 "请 假 人：" + "\u3000" * 14,
                 "时间：年\u3000月\u3000日\u3000时",
                 "销假签字：" + "\u3000" * 14,
                 "销假：年\u3000月\u3000日\u3000时"]:
        _para(doc, line, size=12, indent=True)
    return doc


def _md(d):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(d or ""))
    return m.group(2) if m else None


def _dd(d):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(d or ""))
    return m.group(3) if m else None


def gen_venue_checklist(task):
    """教学场所临时借用办理清单：步骤+材料+出处，不含官方申请表（借用单由教务系统打印）。"""
    s = task["slots"]
    kb = get_kb()
    doc = Document()
    _title(doc, "教学场所临时借用·办理清单", size=15)
    _para(doc, "（依据：教务处《石河子大学教学场所临时借用流程图》；本清单为办理提示，正式借用单在教务系统打印）",
          size=9, align=WD_ALIGN_PARAGRAPH.CENTER)
    flow = kb.flows["venue_borrow"]
    _para(doc, "一、我的申请信息", size=12, bold=True)
    for key, label in [("applicant_type", "申请身份"), ("venue_type", "场地类型"),
                       ("activity_type", "活动性质"), ("use_date", "使用日期"), ("use_time", "使用时间段")]:
        _para(doc, "· {}：{}".format(label, s.get(key) or "（待填）"), size=11)
    _para(doc, "", size=6)
    _para(doc, "二、办理步骤（按流程图）", size=12, bold=True)
    stamp = ("学院使用部门（团委、学办等）审核盖章" if "非教学" in str(s.get("activity_type", ""))
             else "学院教科办审核盖章" if s.get("activity_type") else "（按活动性质确定：非教学活动→团委/学办等；课表外教学活动→教科办）")
    steps = [
        "1. 提前 1-2 天登录教务管理系统：教学服务 → 我的课表 → 教室借用申请。",
        "2. 打印教室借用单，并办理盖章：{}".format(stamp),
        "3. 将审批单送达博学楼 C238 中控室（电话：2057552）。",
        "4. 如需确认场地归口（室内体育馆/机房/多媒体教室）：实验设备处、体育学院场馆中心、教务处教务科（电话：2058577）。",
    ]
    for line in steps:
        _para(doc, line, size=11, indent=True)
    _para(doc, "", size=6)
    _para(doc, "三、注意事项", size=12, bold=True)
    _para(doc, "· 学生借用教室可通过班主任、辅导员在教务系统进行借用；适用于全校在校生及教职工。", size=11, indent=True)
    _para(doc, "· 原流程图包含场地类型与活动性质两类分支，审批部门按分支确定；以原图为准。", size=11, indent=True)
    return doc


def gen_basis_doc(flow_id, rule_results, task):
    """“填写依据与办理提示”独立文件：来源清单 + 条件对照 + 办理提示（方案 9）。"""
    kb = get_kb()
    doc = Document()
    _title(doc, "填写依据与办理提示", size=15)
    _para(doc, "（本文件不属于正式申请表，仅用于核对填写内容与官方出处；生成时间 {}）".format(
        datetime.now().strftime("%Y-%m-%d %H:%M")), size=9, align=WD_ALIGN_PARAGRAPH.CENTER)

    flow = kb.flows.get(flow_id)
    if flow:
        if flow.get("demo_notice"):
            _para(doc, "重要：" + flow["demo_notice"], size=11, bold=True)
        _para(doc, "一、适用范围与依据文件", size=12, bold=True)
        doc_ids = set()
        for st in flow.get("steps", []):
            for cid in st.get("evidence_ids", []):
                clause = kb.clauses.get(cid)
                if clause:
                    doc_ids.add(clause["doc_id"])
        for did in sorted(doc_ids):
            d = kb.documents.get(did, {})
            _para(doc, "· 《{}》 —— {}（{}）".format(d.get("title"), d.get("issuer"), d.get("published_at") or "日期未标注"), size=10.5)
            _para(doc, "  出处：{}".format(d.get("source_url")), size=8.5)

        if flow_id == "national_inspirational_2025" and rule_results:
            _para(doc, "", size=6)
            _para(doc, "二、条件对照结果（三态：pass/fail/unknown）", size=12, bold=True)
            for r in rule_results:
                mark = {"pass": "√ 通过", "fail": "× 不匹配", "unknown": "? 待确认"}[r["state"]]
                _para(doc, "· 【{}】{}：{}".format(mark, r["name"], r.get("explain") or ""), size=11)
            _para(doc, "以上为系统按已审定规则计算的条件匹配情况，学校评审结果不由本系统产生。", size=10)

        if flow.get("timeline"):
            _para(doc, "", size=6)
            _para(doc, "三、办理时间线", size=12, bold=True)
            for t in flow["timeline"]:
                _para(doc, "· 【{}】{}".format(t["owner"], t["action"]), size=11)

        if flow.get("contact"):
            c = flow["contact"]
            _para(doc, "", size=6)
            _para(doc, "四、咨询渠道：{} {} {}".format(c.get("person"), c.get("phone"), c.get("email")), size=11, bold=True)

        _para(doc, "", size=6)
        _para(doc, "五、提示", size=12, bold=True)
        _para(doc, "· 签字、盖章、审批均由真实办理主体完成；本系统不产生审批结论。", size=11)
        _para(doc, "· 演示使用虚构信息；正式使用时敏感字段可留空，下载后线下填写。", size=11)
        _para(doc, "· 知识版本：{}；模板版本：{}".format(kb.kb_version, flow.get("template_id")), size=10)
    return doc


RENDERERS = {
    "tpl-lizhi-2025": gen_lizhi_form,
    "tpl-leave-skxy": gen_leave_form,
    "tpl-venue-checklist": gen_venue_checklist,
}

TEMPLATES = {
    "tpl-lizhi-2025": {"name": "本专科生国家励志奖学金申请表", "version": "2025-附件2-结构版",
                       "scope": "2025年度历史演示（本专科生）"},
    "tpl-leave-skxy": {"name": "生命科学学院学生请假条（含存根）", "version": "skxy-v1",
                       "scope": "生命科学学院"},
    "tpl-venue-checklist": {"name": "教学场所临时借用办理清单", "version": "jwc-v1",
                            "scope": "全校在校生及教职工"},
}


def render_document(flow_id, template_id, task, rule_results):
    kb = get_kb()
    flow = kb.flows.get(flow_id, {})
    renderer = RENDERERS[template_id]
    doc = renderer(task)
    fname = "{}_{}.docx".format(template_id, task["task_id"])
    path = ARTIFACTS_DIR / fname
    doc.save(str(path))

    # 独立的“填写依据与办理提示”文件
    basis = gen_basis_doc(flow_id, rule_results, task)
    bfname = "basis_{}.docx".format(task["task_id"])
    bpath = ARTIFACTS_DIR / bfname
    basis.save(str(bpath))

    manifest = []
    for st in flow.get("steps", []):
        manifest.extend(st.get("evidence_ids", []))
    return {
        "main": {"path": str(path), "filename": fname},
        "basis": {"path": str(bpath), "filename": bfname},
        "template_version": TEMPLATES[template_id]["version"],
        "evidence_manifest": sorted(set(manifest)),
    }
