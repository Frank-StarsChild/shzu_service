# -*- coding: utf-8 -*-
"""全校资料批量导入：资料目录迁移候选 → data/reviewed 审定知识包。

数据来源（SOURCE_ROOT，相对路径均相对该目录）：
- 99_索引与报告/全校知识迁移候选.jsonl   主清单（~2012 条，19 个板块）
- 99_索引与报告/校园服务补采候选.jsonl   服务定向补采（URL 重叠则跳过）
- 22_学院与师资专项/院系与师资候选.jsonl 为主清单子集（人员元数据已在主清单内）

处理规则（按迁移要求）：
1. 去重：规范化 URL + source_sha256 双键。已在运行库的来源（existing_reviewed_doc_id
   或 URL 与现有 document.source_url 相同）保留原文档与条款 ID，不重复导入正文；
   其已提取文本的附件作为补充条款挂到原文档下。
2. 分段：规章条款/办事步骤/专业小节/教师档案按段落；PDF 附件按「[PDF 第 N 页]」页标记
   分段并保留页码；超长段按句号边界切分（金额、期限、姓名职称留在同段）。
3. 师资：faculty_profile 建教师档案条款；页面明确写「教授/副教授」才填职称 fact，
   导师身份、名册、外聘分别记录；共用站点（site_colleges 多值）归属未定不绑学院。
4. 幂等：重复执行按确定性 ID（来源哈希派生）重建批量文件，不产生重复记录；
   原有 5 份手工审定 clauses 文件与 45 份来源保持不动。
5. 报告：data/manifests/corpus_import_report.json + 全校资料导入报告.md（逐板块、
   逐学院、逐条候选处理结果与缺口原因）。

用法（项目根目录）：
  .venv\\Scripts\\python.exe scripts\\import_campus_corpus.py            # 全量导入
  .venv\\Scripts\\python.exe scripts\\import_campus_corpus.py --dry-run   # 只统计不写
  .venv\\Scripts\\python.exe scripts\\import_campus_corpus.py --stats      # 当前运行库统计
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import REVIEWED_DIR, SOURCE_ROOT, KB_VERSION  # noqa: E402

SRC = Path(SOURCE_ROOT)
CANDIDATE_FILES = [
    SRC / "99_索引与报告" / "全校知识迁移候选.jsonl",
    SRC / "99_索引与报告" / "校园服务补采候选.jsonl",
]
MANIFEST_DIR = ROOT / "data" / "manifests"
DOC_FILE = REVIEWED_DIR / "documents.json"

# 板块 → 子库代码（clauses_imp_<code>.json 与 ID 前缀）
BOARD_CODES = {
    "01_学工与奖助学金": "xg",
    "02_教务与学籍": "jw",
    "03_后勤与生活服务": "hq",
    "04_保卫与校园安全": "bw",
    "05_图书馆": "lib",
    "06_校园网与信息服务": "xyw",
    "07_学校概况与校园认识": "gk",
    "08_各学院官网": "xy",
    "09_招生与新生入学": "zs",
    "10_研究生教育": "yjs",
    "11_医疗医保与心理健康": "yb",
    "12_团委社团与文体": "tww",
    "13_财务收费与报销": "cw",
    "14_科研实验与创新实践": "ky",
    "15_档案校史与文化": "da",
    "16_其他党政与公共服务": "qt",
    "17_就业与职业发展": "jy",
    "18_本地新生手册参考_非官方": "ref",   # 非官方：不入正库（仅别名参考）
    "19_科研院所与研究中心": "kz",
    "21_其他公开专题与站点": "zt",
}

BOARD_NAMES = {
    "xg": "学工与奖助学金", "jw": "教务与学籍", "hq": "后勤与生活服务", "bw": "保卫与校园安全",
    "lib": "图书馆", "xyw": "校园网与信息服务", "gk": "学校概况", "xy": "各学院",
    "zs": "招生与新生入学", "yjs": "研究生教育", "yb": "医疗医保与心理健康",
    "tww": "团委社团与文体", "cw": "财务收费与报销", "ky": "科研实验与创新实践",
    "da": "档案校史与文化", "qt": "其他党政与公共服务", "jy": "就业与职业发展",
    "kz": "科研院所与研究中心", "zt": "其他公开专题与站点",
}

SEG_MAX = 1200          # 单段 exact_text 上限（句号边界内切分）
PAGE_MARK = re.compile(r"^\[PDF 第 (\d+) 页\]\s*$")
TITLE_RE = re.compile(r"职称[：:]\s*(教授|副教授|讲师|助教|高级实验师|正高级实验师|实验师|研究员|副研究员)")
MENTOR_RE = re.compile(r"硕士生导师|博士生导师|研究生导师|获.{0,6}导师招生资格|博士研究生导师")
PROF_ONLY = ("教授", "副教授")   # 仅这两类填入职称 fact（要求：页面明确写了才填）

# 学院简介段落归类（沿用 import_college_intro 的口径并扩展）


def classify_overview(paragraph: str):
    if re.search(r"教职工\d|教职员工\d|专任教师\d|高级职称\d", paragraph):
        return "师资规模", "师资规模"
    if re.search(r"本科专业|面向全国招生|现有.{0,6}个本科专业", paragraph):
        return "本科专业设置", "本科专业设置"
    if re.search(r"在读本科生|硕士生|留学生|在校生", paragraph):
        return "在校生规模", "在校生规模"
    if re.search(r"学科门类|学位授权点|硕士学位授权|一级学科硕士|博士点", paragraph):
        return "学科与学位点", "学科与学位点"
    if re.search(r"始建于|前身|成立|更名|挂牌|定名|沿革", paragraph):
        return "学院沿革", None
    if re.search(r"科研|平台|项目|经费|论文|专利", paragraph):
        return "科研平台与成果", None
    if re.search(r"对口支援|国际交流|交流与合作|社会服务", paragraph):
        return "对外交流与社会服务", None
    return "学院概况", "学院概况"


def classify_general(seg: str):
    """通用段落主题归类（规章条款/办事步骤/专业/师资/机构/新闻动态等）。"""
    if re.search(r"第[一二三四五六七八九十百\d]+条|本办法|本规定|本细则|本通知自|本方案", seg):
        return "规章条款"
    if re.search(r"第[一二三四五1-5]步|办理流程|办理时间|申请材料|受理|审批|提交|登录.{0,10}系统|携带材料|所需材料", seg):
        return "办事步骤"
    if re.search(r"本科专业|专业（|专业设置|硕士学位授权点|专业方向|招生专业", seg):
        return "专业设置"
    if re.search(r"教授|副教授|导师|专任教师|职称|师资|教师队伍|名册|外聘", seg):
        return "师资队伍"
    if re.search(r"下设|设有|系、|研究所|研究中心|重点实验室|实验室|行政机构|科室", seg):
        return "机构设置"
    if re.search(r"奖学金|助学金|资助|贷款|困难认定", seg):
        return "奖助资助"
    if re.search(r"考试|成绩|学分|选课|补退选|缓考|校历|作息", seg):
        return "教学事务"
    if re.search(r"宿舍|食堂|水电|维修|物业|班车|交通", seg):
        return "后勤生活"
    if re.search(r"图书馆|借阅|开馆|闭馆|讨论间|研修间", seg):
        return "图书馆服务"
    if re.search(r"校园卡|一卡通|网络|上网|信息系统|账号", seg):
        return "信息服务"
    if re.search(r"招生|迎新|新生|报到|录取", seg):
        return "招生迎新"
    if re.search(r"就业|招聘|实习|职业", seg):
        return "就业指导"
    if re.search(r"医院|医保|心理|卫生|体检", seg):
        return "医疗心理"
    if re.search(r"报销|收费|缴费|费用标准|学费|住宿费", seg):
        return "财务收费"
    if re.search(r"通知|发布|活动|动态|新闻|报道|举行了|开展", seg):
        return "通知动态"
    return "机构概况"


def norm_url(u: str) -> str:
    u = (u or "").strip().lower()
    if not u:
        return ""
    u = re.sub(r"[#?]$", "", u)
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"/+$", "", u)
    return u


def sha8(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:8]


def content_sha(text: str) -> str:
    return hashlib.sha256(re.sub(r"\s+", "", text).encode("utf-8")).hexdigest()[:10]


SECTION_MARK = re.compile(
    r"^[一二三四五六七八九十百]+\s*[、.．:：]\s*\S"    # 一、历史沿革
    r"|[（(][一二三四五六七八九十\d]+[)）]\s*\S"        # （一）标题
    r"|^\d{1,2}\s*[、.．]\s*\S"                         # 1. 标题
    r"|^第[一二三四五六七八九十\d]+\s*[部分章节单元]",  # 第一部分
    re.M)


def split_segments(text: str, max_len=SEG_MAX):
    """正文 → 段列表：中文序号标题（一、/（一）/1./第一部分）与空行都是段边界；
    长段按句末（。！？；）聚合切块（金额/期限/称谓等留在同段）。"""
    text = (text or "").strip()
    if not text:
        return []
    # 先按中文序号标题行切块（机构简介/规章常用结构；标题保留在段首）
    marks = list(SECTION_MARK.finditer(text))
    parts = []
    if marks:
        head = text[: marks[0].start()]
        if head.strip():
            parts.append(head)
        for i, m in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            parts.append(text[m.start():end])
    else:
        parts = [text]
    blocks = []
    for part in parts:
        if not (part or "").strip():
            continue
        cur = []
        for line in part.splitlines():
            if line.strip():
                cur.append(line.rstrip())
            elif cur:
                blocks.append("\n".join(cur))
                cur = []
        if cur:
            blocks.append("\n".join(cur))
    out = []
    for b in blocks:
        b = b.strip()
        if not b:
            continue
        if len(b) <= max_len:
            out.append(b)
            continue
        # 长块按句切分聚合（金额/期限/称谓等通常在同句，保持完整）
        buf, sentences = "", []
        for sent in re.split(r"(?<=[。！？；])", b):
            if not sent:
                continue
            if len(buf) + len(sent) > max_len and buf:
                sentences.append(buf)
                buf = sent
            else:
                buf += sent
        if buf:
            sentences.append(buf)
        out.extend(s.strip() for s in sentences if s.strip())
    # 短段（列表行、单行小标题）并回前段：避免碎块稀释 BM25 词频信号
    merged = []
    for seg in out:
        if merged and (len(seg) < 60 or len(merged[-1]) < 60):
            merged[-1] = merged[-1] + "\n" + seg
        else:
            merged.append(seg)
    return merged


def split_pdf_pages(text: str):
    """PDF 提取文本 → [(页码或 None, 段落)]，按「[PDF 第 N 页]」标记分段。"""
    text = (text or "").strip()
    if not text:
        return []
    pages = []
    page_no, buf = None, []
    for line in text.splitlines():
        m = PAGE_MARK.match(line.strip())
        if m:
            if buf:
                pages.append((page_no, "\n".join(buf)))
                buf = []
            page_no = int(m.group(1))
        elif line.strip():
            buf.append(line.rstrip())
    if buf:
        pages.append((page_no, "\n".join(buf)))
    out = []
    for no, p in pages:
        for seg in split_segments(p):
            out.append((no, seg))
    return out


def read_text_if_exists(rel: str):
    if not rel:
        return None
    p = SRC / rel
    if not p.is_file():
        return None
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def parse_year(candidate: dict):
    """仅在有真实日期信号时返回年份；无信号返回 None（供学年范围过滤用，避免默认值污染）。"""
    for key in ("published_at", "url_date_hint"):
        v = candidate.get(key)
        if v:
            m = re.search(r"(20\d{2})", str(v))
            if m:
                return int(m.group(1))
    m = re.search(r"(20\d{2})", candidate.get("title") or "")
    if m:
        y = int(m.group(1))
        if 2000 <= y <= 2030:
            return y
    m = re.search(r"[（(]数据截至(20\d{2})年", candidate.get("text") or "")
    if m:
        return int(m.group(1))
    return None


def person_title(text: str, title_evidence) -> str:
    """页面明确写了教授/副教授才返回对应职称；其余返回空（fact 不填）。
    title_evidence 为 [{title, evidence}]（采集器从页面原文提取的职称证据）。"""
    for e in (title_evidence or []):
        if isinstance(e, dict) and e.get("title") in PROF_ONLY:
            return e["title"]
        if isinstance(e, str) and e in PROF_ONLY:
            return e
    m = TITLE_RE.search(text or "")
    if m:
        t = m.group(1)
        return t if t in PROF_ONLY else ""
    return ""


def person_mentor(text: str) -> bool:
    return bool(MENTOR_RE.search(text or ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args()

    if args.stats:
        print_stats()
        return

    # ---- 读取候选（主清单 + 服务补采合并，URL/哈希去重）----
    candidates, seen_key = [], set()
    merged_from_extra = 0
    for cf in CANDIDATE_FILES:
        if not cf.is_file():
            print(f"[!] 缺少候选文件：{cf}")
            continue
        for line in cf.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            c = json.loads(line)
            key = (norm_url(c.get("source_url")), c.get("source_sha256") or "")
            if key in seen_key:
                continue
            seen_key.add(key)
            candidates.append(c)
            if cf.name == "校园服务补采候选.jsonl":
                merged_from_extra += 1
    print(f"候选合计 {len(candidates)} 条（服务补采新增 {merged_from_extra} 条）")

    docs = json.loads(DOC_FILE.read_text(encoding="utf-8"))
    # 幂等基线：只把「手工审定」的原始来源当作不可覆盖的存量；
    # 上一轮 bulk 导入的文档确定性重建（同 ID 同内容），不参与去重。
    existing_docs = {d["doc_id"]: d for d in docs["documents"] if d.get("imported_by") != "bulk_import"}
    existing_urls = {norm_url(d.get("source_url") or "") for d in existing_docs.values()}

    # ---- 逐条处理 ----
    report = {"rows": [], "by_board": defaultdict(lambda: defaultdict(int)),
              "by_college": defaultdict(lambda: defaultdict(int))}
    new_docs, new_clauses, new_facts, new_topics = [], [], [], []
    imported_doc_ids = set()
    seen_attachment_shas = set()   # 同附件（sha 相同）全局只导入一次
    seen_content_hashes = set()    # 内容级去重：同文本（哈希相同）不同 URL 的采集入口只留一份
    colleges_json = json.loads((ROOT / "data" / "workflows" / "colleges.json").read_text(encoding="utf-8"))
    known_colleges = {c["official"] for c in colleges_json["colleges"]}
    college_topic_done = set()
    # 已有学院主题（手工审定的 5 份 clauses 文件里 object_college 主题）：不重复建；
    # 上一轮 bulk 文件（clauses_imp_*）会整体重建，不作为已存在依据
    for name in sorted(p.name for p in REVIEWED_DIR.glob("clauses_*.json")
                       if p.is_file() and "imp_" not in p.name):
        try:
            data = json.loads((REVIEWED_DIR / name).read_text(encoding="utf-8"))
            for t in data.get("qa_topics") or []:
                if t.get("object_college"):
                    college_topic_done.add(t["object_college"])
        except (OSError, ValueError):
            pass

    for cand in candidates:
        cat = cand.get("category") or ""
        row = {"id": cand.get("id"), "title": (cand.get("title") or "")[:60],
               "category": cat, "url": cand.get("source_url"),
               "result": "", "docs": 0, "clauses": 0, "facts": 0}
        if cat == "18_本地新生手册参考_非官方":
            row["result"] = "skip_nonofficial_reference"
            _tally(report, cat, "skip_nonofficial")
            report["rows"].append(row)
            continue
        if cat not in BOARD_CODES:
            row["result"] = f"skip_unknown_category:{cat}"
            report["rows"].append(row)
            continue
        code = BOARD_CODES[cat]

        # 学院归属：明确 college 优先；共用站点归属规则：
        # - 单一 site_colleges → 绑定该学院（注明 shared_site_single）
        # - 多学院合署（如师范学院/兵团教育学院共用 sfxy 域名、两块牌子一套班子）→
        #   条款复制到每个成员学院（检索任一院名都能命中），备注注明合署
        college = cand.get("college")
        college_extra = []          # 合署共享的其他学院
        attribution = "explicit"
        if not college:
            sites = cand.get("site_colleges") or []
            if len(sites) == 1:
                college = sites[0]
                attribution = "shared_site_single"
            elif len(sites) > 1:
                college = sites[0]
                college_extra = [s for s in sites[1:] if s in known_colleges]
                attribution = "shared_site_joint"
        if college and college not in known_colleges:
            # 未在官方目录登记的学院名：保留原值但注明
            attribution += "_unregistered"

        # 内容级去重：同一正文的不同采集入口（同文本不同 URL）只保留第一份；
        # 文本有实际差异的历年版本（哈希不同）仍然保留
        body_sha = content_sha(cand.get("text") or "")
        content_key = (cat, college or "", body_sha)
        if body_sha and content_key in seen_content_hashes:
            row["result"] = "skip_duplicate_content_same_text"
            _tally(report, cat, "skip_dup_text")
            report["rows"].append(row)
            continue
        if body_sha:
            seen_content_hashes.add(content_key)

        sha = cand.get("source_sha256") or content_sha(cand.get("text") or cand.get("source_url") or "")
        url_key = norm_url(cand.get("source_url"))
        matched_doc = cand.get("existing_reviewed_doc_id")
        # existing_reviewed_doc_id 必须真实存在于手工审定存盘中才有效
        if matched_doc and matched_doc not in existing_docs:
            matched_doc = None
        existing_by_url = None
        for d in existing_docs.values():
            if norm_url(d.get("source_url") or "") and norm_url(d.get("source_url") or "") == url_key:
                existing_by_url = d["doc_id"]
                break
        target_doc_id = matched_doc or existing_by_url
        if target_doc_id and target_doc_id in existing_docs:
            doc = existing_docs[target_doc_id]
            doc_id = doc["doc_id"]
            attach = _import_attachments(cand, doc_id, code, college, report, new_clauses,
                                          seen_attachment_shas)
            row.update({"result": "kept_existing_doc", "docs": 0,
                        "clauses": attach, "facts": 0})
            _tally(report, cat, "existing_doc_kept")
            report["rows"].append(row)
            continue

        if url_key and url_key in existing_urls:
            row["result"] = "skip_url_already_in_kb"
            _tally(report, cat, "skip_url_dup")
            report["rows"].append(row)
            continue

        # ---- 新文档 ----
        doc_id = f"{code}-{sha[:8]}"
        if doc_id in imported_doc_ids or doc_id in existing_docs:
            row["result"] = "skip_duplicate_content"
            _tally(report, cat, "skip_dup")
            report["rows"].append(row)
            continue
        imported_doc_ids.add(doc_id)

        year = parse_year(cand)
        topic_kind = cand.get("topic") or "general"
        doc = {
            "doc_id": doc_id,
            "title": (cand.get("title") or "").strip()[:160],
            "issuer": (cand.get("department") or (college if cat == "08_各学院官网" else "") or "").strip()[:80],
            "source_url": cand.get("source_url") or "",
            "source_kind": "web",
            "published_at": cand.get("published_at"),
            "document_year": year,
            "effective_from": None, "effective_to": None,
            "category": BOARD_NAMES.get(code, cat),
            "review_state": "reviewed",
            "imported_by": "bulk_import",
            "notes": (f"批量导入自原始采集（板块 {cat}；采集于 {cand.get('retrieved_at', '未知')}；"
                      f"来源哈希 {sha[:12]}；归属 {attribution}"
                      + (f"；学院 {college}" if college else "")
                      + "）。exact_text 为原文逐字分段，附件优先复用已提取文本。"),
        }
        attach_meta = []
        for a in cand.get("attachments") or []:
            attach_meta.append({
                "title": a.get("title"), "url": a.get("url"),
                "sha256": a.get("sha256"), "source_local_path": a.get("source_local_path"),
                "has_extracted_text": bool(a.get("text_local_path")),
                "extraction_status": a.get("extraction_status"),
            })
        if attach_meta:
            doc["attachments"] = attach_meta

        clauses, facts = [], []
        segments = split_segments(cand.get("text") or "")
        main_locator = f"网页正文·{cand.get('section') or cand.get('topic') or '正文'}"
        if topic_kind == "faculty_profile":
            main_locator = "网页正文·教师档案"
        # 合署共享（如 sfxy 域名同时是师范学院与兵团教育学院官网）：条款复制到每个成员学院
        college_variants = [college] if college else [None]
        if college and college_extra and topic_kind in ("overview", "organization", "major"):
            college_variants = [college] + college_extra
        for variant in college_variants:
            for i, seg in enumerate(segments, start=1):
                cid = f"{code}-{sha[:8]}-c{i:03d}" if variant == college else f"{code}-{sha[:8]}-x{i:03d}"
                if topic_kind == "faculty_profile":
                    top = "教师档案"
                elif topic_kind == "overview":
                    top, _ = classify_overview(seg)
                elif topic_kind == "faculty":
                    top = "师资名册"
                elif topic_kind == "major":
                    top = "专业设置"
                elif topic_kind == "organization":
                    top = "机构设置"
                else:
                    top = classify_general(seg)
                clauses.append({
                    "clause_id": cid, "doc_id": doc_id, "exact_text": seg, "topic": top,
                    "campus": None, "college": variant, "student_type": None,
                    "application_year": year if re.search(r"20\d{2}学年|年度|年", seg) else None,
                    "source_locator": main_locator, "scope_status": "reviewed",
                })

        # 教师档案：明确写了教授/副教授才填职称 fact；导师身份单独记录
        if topic_kind == "faculty_profile" and cand.get("person_name"):
            pname = cand["person_name"]
            t = person_title(cand.get("text") or "", cand.get("title_evidence"))
            n_clauses = len(clauses)
            if t:
                facts.append({
                    "fact_id": f"{code}-{sha[:8]}-f-title", "subject": pname,
                    "predicate": "职称", "value": t, "unit": None,
                    "conditions": {"college": college} if college else {},
                    "evidence_ids": [clauses[0]["clause_id"]] if clauses else [],
                    "topic": "教师档案", "label": f"{pname}（{'职称'}）",
                })
            if person_mentor(cand.get("text") or ""):
                facts.append({
                    "fact_id": f"{code}-{sha[:8]}-f-mentor", "subject": pname,
                    "predicate": "导师身份", "value": "硕士生导师（页面原文表述）", "unit": None,
                    "conditions": {"college": college} if college else {},
                    "evidence_ids": [clauses[-1]["clause_id"]] if clauses else [],
                    "topic": "教师档案", "label": f"{pname}（导师）",
                })
            _tally(report, cat, "faculty_profiles")

        # 学院简介：结构化事实（概况/师资规模/本科专业/在校生/学位点）
        # 学院简介主题（合署共享时为每个成员学院各建主题；evidence 指向各自学院的条款副本）
        if topic_kind == "overview" and college and college in known_colleges:
            for member in ([college] + college_extra):
                if member not in known_colleges or member in college_topic_done:
                    continue
                member_clauses = [cl for cl in clauses if cl.get("college") == member] or clauses
                ov_facts = []
                for cl in member_clauses:
                    top, label = classify_overview(cl["exact_text"])
                    if label and top != "学院概况":
                        fid = f"{code}-{sha[:8]}-f-{member[:2]}{content_sha(cl['exact_text'])[:6]}"
                        ov_facts.append({
                            "fact_id": fid, "subject": member, "predicate": label,
                            "value": cl["exact_text"][:400], "unit": None,
                            "conditions": {}, "evidence_ids": [cl["clause_id"]],
                            "topic": top, "label": f"{member}·{label}",
                        })
                if not ov_facts and member_clauses:
                    ov_facts.append({
                        "fact_id": f"{code}-{sha[:8]}-f-{member[:2]}ov", "subject": member,
                        "predicate": "概况", "value": member_clauses[0]["exact_text"][:400],
                        "unit": None, "conditions": {}, "evidence_ids": [member_clauses[0]["clause_id"]],
                        "topic": "学院概况", "label": f"{member}·概况",
                    })
                facts.extend(ov_facts)
                if ov_facts:
                    college_topic_done.add(member)
                    mcode = "" if member == college else "-" + member[:3]
                    new_topics.append({
                        "topic_id": f"cs-{sha[:8]}{mcode}",
                        "object_college": member,
                        "triggers": [f"{member}简介", f"{member}概况", f"介绍一下{member}"],
                        "title": f"{member}概况",
                        "summary": f"{member}概况要点：",
                        "fact_ids": [f["fact_id"] for f in ov_facts],
                        "note": "批量导入自学院官网简介（合署站点共享，已绑定成员学院）；"
                                "问法经 colleges.json 对象归一进入本主题。",
                    })

        # 附件（优先复用已提取文本；PDF 保留页码；同附件全局只导入一次）
        _import_attachments(cand, doc_id, code, college, report, clauses, seen_attachment_shas)

        new_docs.append(doc)
        new_clauses.extend(clauses)
        new_facts.extend(facts)
        row.update({"result": "imported", "docs": 1, "clauses": len(clauses),
                    "facts": len(facts)})
        _tally(report, cat, "imported_docs")
        if college:
            report["by_college"][college]["docs"] += 1
            report["by_college"][college]["clauses"] += len(clauses)
        report["rows"].append(row)

    # ---- 写盘（幂等：批量文件整体重写；documents 移除旧 bulk 后并入新）----
    by_file = defaultdict(lambda: {"clauses": [], "facts": [], "qa_topics": []})
    for cl in new_clauses:
        code = cl["clause_id"].split("-")[0]
        by_file[code]["clauses"].append(cl)
    for f in new_facts:
        code = f["fact_id"].split("-")[0]
        by_file[code]["facts"].append(f)
    for t in new_topics:
        by_file["xy"]["qa_topics"].append(t)

    if not args.dry_run:
        docs["documents"] = [d for d in docs["documents"] if d.get("imported_by") != "bulk_import"]
        docs["documents"].extend(new_docs)
        docs["kb_version"] = bump_kb_version(docs.get("kb_version"))
        # 删除上一轮批量文件再写新
        for p in REVIEWED_DIR.glob("clauses_imp_*.json"):
            p.unlink()
        for code, payload in by_file.items():
            if not (payload["clauses"] or payload["facts"] or payload["qa_topics"]):
                continue
            out = REVIEWED_DIR / f"clauses_imp_{code}.json"
            out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        DOC_FILE.write_text(json.dumps(docs, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
        write_report(report, docs, by_file, candidates)
    else:
        write_report(report, docs, by_file, candidates, dry=True)

    # ---- 汇总 ----
    print(f"\n导入结果：新增来源 {len(new_docs)} 份 / 条款 {len(new_clauses)} 条 / "
          f"事实 {len(new_facts)} 条 / 学院主题 {len(new_topics)} 个")
    print("各板块新增来源：")
    for cat, cc in sorted(report["by_board"].items()):
        print(f"  {cat}: 入库来源 {cc['imported_docs']} / 保留原库 {cc['existing_doc_kept']} / "
              f"跳过 {cc.get('skip_url_dup', 0) + cc.get('skip_dup', 0)} / 教师档案 {cc.get('faculty_profiles', 0)}")
    print("各学院新增：")
    for col, cc in sorted(report["by_college"].items(), key=lambda x: -x[1]["docs"]):
        print(f"  {col}: 来源 {cc['docs']} / 条款 {cc['clauses']}")
    if not args.dry_run:
        print(f"\n运行库现状：{len(docs['documents'])} 份来源 / kb_version={docs['kb_version']}")
        print("重启后端后生效（uvicorn backend.app.main:app --port 8300）。")


def _import_attachments(cand, doc_id, code, college, report, target, seen_shas):
    """附件文本 → 条款（PDF 分页保留页码；无提取文本记待提取）。
    挂到 doc_id（已有文档或新文档）；同一附件（sha 相同）全局只导入一次。"""
    n = 0
    for a in cand.get("attachments") or []:
        akey = a.get("sha256") or a.get("url") or a.get("title") or ""
        if akey and akey in seen_shas:
            _tally(report, cand.get("category") or "?", "attachments_shared_skipped")
            continue
        rel = a.get("text_local_path")
        text = read_text_if_exists(rel) if rel else None
        if not text or not text.strip():
            report["by_board"][cand.get("category") or "?"]["attachments_pending"] += 1
            continue
        if akey:
            seen_shas.add(akey)
        title = a.get("title") or "附件"
        att_key = sha8(str(a.get("sha256") or a.get("url") or title))
        pages = split_pdf_pages(text)
        if pages and pages[0][0] is not None:
            for no, seg in pages:
                n += 1
                cid = f"{code}-att{att_key}-{n:03d}"
                target.append({
                    "clause_id": cid, "doc_id": doc_id, "exact_text": seg,
                    "topic": "附件正文", "campus": None, "college": college,
                    "student_type": None, "application_year": None,
                    "source_locator": f"附件《{title}》·第{no}页", "scope_status": "reviewed",
                })
        else:
            for seg in split_segments(text):
                n += 1
                cid = f"{code}-att{att_key}-{n:03d}"
                target.append({
                    "clause_id": cid, "doc_id": doc_id, "exact_text": seg,
                    "topic": "附件正文", "campus": None, "college": college,
                    "student_type": None, "application_year": None,
                    "source_locator": f"附件《{title}》", "scope_status": "reviewed",
                })
    return n


def _tally(report, cat, key):
    report["by_board"][cat or "?"][key] += 1


def _clause_files_static():
    return sorted(p.name for p in REVIEWED_DIR.glob("clauses_*.json") if p.is_file())


def bump_kb_version(v: str) -> str:
    today = "2026-11-20"
    m = re.search(r"kb-(\d{4}-\d{2}-\d{2})-r(\d+)", v or "")
    if m and m.group(1) == today:
        return f"kb-{today}-r{int(m.group(2)) + 1}"
    return f"kb-{today}-r1"


def write_report(report, docs, by_file, candidates, dry=False):
    total_kb_clauses = 0
    for name in _clause_files_static():
        try:
            data = json.loads((REVIEWED_DIR / name).read_text(encoding="utf-8"))
            total_kb_clauses += len(data.get("clauses") or [])
        except (OSError, ValueError):
            pass
    payload = {
        "dry_run": dry,
        "candidate_count": len(candidates),
        "runtime_docs_after": len(docs["documents"]),
        "runtime_clauses_after": (total_kb_clauses + sum(len(p["clauses"]) for p in by_file.values())
                                  if dry else _count_clauses_now()),
        "by_board": {k: dict(v) for k, v in report["by_board"].items()},
        "by_college": {k: dict(v) for k, v in report["by_college"].items()},
        "rows": report["rows"],
    }
    (MANIFEST_DIR / "corpus_import_report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _count_clauses_now():
    n = 0
    for name in _clause_files_static():
        try:
            data = json.loads((REVIEWED_DIR / name).read_text(encoding="utf-8"))
            n += len(data.get("clauses") or [])
        except (OSError, ValueError):
            pass
    return n


def print_stats():
    docs = json.loads(DOC_FILE.read_text(encoding="utf-8"))
    print(f"运行库：{len(docs['documents'])} 份来源 / kb_version={docs.get('kb_version')}")
    total_c = total_f = total_t = 0
    per_board = Counter()
    per_college = Counter()
    for name in _clause_files_static():
        data = json.loads((REVIEWED_DIR / name).read_text(encoding="utf-8"))
        cs = data.get("clauses") or []
        total_c += len(cs)
        total_f += len(data.get("facts") or [])
        total_t += len(data.get("qa_topics") or [])
        for c in cs:
            per_board[(REVIEWED_DIR / name).stem.replace("clauses_", "").replace("imp_", "")] += 1
            if c.get("college"):
                per_college[c["college"]] += 1
    print(f"条款 {total_c} / 事实 {total_f} / 问答主题 {total_t}")
    print("分库条款：", dict(per_board))
    print("学院条款 Top：", dict(per_college.most_common(10)))


if __name__ == "__main__":
    main()
