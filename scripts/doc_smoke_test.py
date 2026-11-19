# -*- coding: utf-8 -*-
"""文档生成链路测试"""
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.documents.renderer import render_document, TEMPLATES

lizhi_task = {"task_id": "test-lizhi", "slots": {
    "name": "张三（演示虚构）", "student_type": "本科", "grade": "二年级", "college": "生命科学学院",
    "major_class": "生物科学2024级1班", "difficulty_confirmed": "是",
    "study_rank": 25, "study_total": 100, "zongce_rank": 30, "zongce_total": 100,
    "national_scholarship_this_year": "否", "reason": "（示例）本学年学习刻苦，成绩位于前列，积极参加班级工作。",
    "personal_phone": ""}}
leave_task = {"task_id": "test-leave", "slots": {
    "college": "生命科学学院", "major": "生物科学", "grade": "2024", "cls": "1", "name": "李四（演示虚构）",
    "reason": "回家办理个人事务", "days_or_sections": "3", "start_date": "2026-11-20", "start_time": "08:00",
    "end_date": "2026-11-22", "end_time": "18:00", "going_home": "是", "home_address": "（演示虚构地址）",
    "parent_phone": "", "personal_phone": ""}}
venue_task = {"task_id": "test-venue", "slots": {
    "applicant_type": "学生", "venue_type": "多媒体教室",
    "activity_type": "非教学活动（班会、党团活动等）", "use_date": "2026-11-25", "use_time": "14:00-16:00"}}

results = []
results.append(render_document("national_inspirational_2025", "tpl-lizhi-2025", lizhi_task, []))
results.append(render_document("leave_request", "tpl-leave-skxy", leave_task, []))
results.append(render_document("venue_borrow", "tpl-venue-checklist", venue_task, []))

for r in results:
    for k in ("main", "basis"):
        p = r[k]["path"]
        ok = os.path.exists(p) and os.path.getsize(p) > 5000
        print(("OK " if ok else "FAIL "), k, r[k]["filename"], os.path.getsize(p) if os.path.exists(p) else 0)
print("DOC SMOKE", "PASS" if all(os.path.exists(r[k]["path"]) for r in results for k in ("main", "basis")) else "FAIL")
