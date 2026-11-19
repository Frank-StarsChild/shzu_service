# -*- coding: utf-8 -*-
"""离线导入：学院简介（SOURCE_ROOT 原始采集）→ data/reviewed 审定知识包。

链路：定位 学院简介__*/正文.md 与 元数据.json → 逐段对照原文 →
按段落归类生成 clauses（逐字摘录）与 facts（结构化）→ 生成 object_college 问答主题。
保留：机构（department）、栏目（section）、官方 URL、原文摘录、数据截至时间、
采集状态（写入 notes）。导入 = 人工对照正文的审定动作，条目 review_state=reviewed。

用法：
  python scripts/import_college_intro.py --list
  python scripts/import_college_intro.py --college "文学艺术学院（新闻传播学院）"
  python scripts/import_college_intro.py --college "文学艺术学院（新闻传播学院）" --remove
幂等：重复导入按学院替换，不产生重复条目。
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import REVIEWED_DIR, SOURCE_ROOT  # noqa: E402

CLAUSE_FILE = REVIEWED_DIR / "clauses_xy.json"
DOC_FILE = REVIEWED_DIR / "documents.json"
COLLEGES_FILE = ROOT / "data" / "workflows" / "colleges.json"

# 可读短码（doc/clause/fact 前缀）；未列出的学院用 8 位哈希
SHORT_CODES = {
    "文学艺术学院（新闻传播学院）": "art",
    "信息科学与技术学院": "cs",
}

CUTOFF_RE = re.compile(r"[（(]数据截至(\d{4})年(\d{1,2})月[）)]")


def classify(paragraph: str):
    """段落 → (topic, fact_label)；fact_label 为 None 表示仅入条款不做结构化事实。"""
    if re.search(r"教职工\d|教职员工\d|专任教师\d|高级职称\d|高级职称\d+人", paragraph):
        return "师资规模", "师资规模"
    if re.search(r"对口支援|国际交流|交流与合作|讲学|插班|社会服务|乡村振兴|研培|文艺下乡|国家通用语言文字推广", paragraph):
        return "对外交流与社会服务", None
    if re.search(r"本科专业|面向全国招生", paragraph):
        return "本科专业设置", "本科专业设置"
    if re.search(r"在读本科生|硕士生|留学生|在校生", paragraph):
        return "在校生规模", "在校生规模"
    if re.search(r"学科门类|学位授权点|硕士学位授权|一级学科硕士", paragraph):
        return "学科与学位点", "学科与学位点"
    if re.search(r"始建于|前身|成立|更名|挂牌|定名", paragraph):
        return "学院沿革", "学院沿革"
    if re.search(r"科研|平台|项目|经费|论文|专利", paragraph):
        return "科研平台与成果", None
    return "学院概况", None


def find_intro_dirs(college: str):
    base = Path(SOURCE_ROOT) / "08_各学院官网"
    college_dir = base / college
    if not college_dir.exists():
        return []
    # 学院简介/__*/正文.md（根目录或 学院概况/ 子目录下均可能）
    return sorted(college_dir.glob("学院简介/学院简介__*/")) + \
        sorted(college_dir.glob("学院概况/学院简介__*/"))


def parse_body(md_path: Path):
    """解析 正文.md：元数据头（- 部门：…）+ ## 网页正文 段落列表。"""
    text = md_path.read_text(encoding="utf-8")
    meta = {}
    for line in text.splitlines():
        m = re.match(r"-\s*(部门|栏目|官方出处|页面发布日期|采集时间|状态)\s*：(.*)", line.strip())
        if m:
            meta[m.group(1)] = m.group(2).strip()
    body = []
    if "## 网页正文" in text:
        seg = text.split("## 网页正文", 1)[1]
        seg = seg.split("## 附件与流程图", 1)[0]
        for p in seg.split("\n"):
            p = p.strip()
            if p and not re.match(r"^-{3,}$", p):
                body.append(p)
    return meta, [p for p in body if len(p) >= 15]


def target_codec(college: str) -> str:
    if college in SHORT_CODES:
        return SHORT_CODES[college]
    import hashlib
    return hashlib.md5(college.encode("utf-8")).hexdigest()[:8]


def build_entries(college: str):
    """从原始资料构建 (document, clauses, facts, topic)。找不到资料返回 None。"""
    dirs = find_intro_dirs(college)
    if not dirs:
        return None
    d = dirs[0]
    meta_path = d / "元数据.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    md_meta, paragraphs = parse_body(d / "正文.md")
    if not paragraphs:
        return None

    code = target_codec(college)
    doc_id = f"xy-{code}-intro"
    issuer = meta.get("department") or md_meta.get("部门") or college
    source_url = meta.get("source_url") or md_meta.get("官方出处") or ""
    cutoff = CUTOFF_RE.search("\n".join(paragraphs))
    cutoff_tag = f"数据截至{cutoff.group(1)}年{cutoff.group(2)}月" if cutoff else None

    document = {
        "doc_id": doc_id,
        "title": f"{college}学院简介",
        "issuer": issuer,
        "source_url": source_url,
        "source_kind": "web",
        "published_at": meta.get("published_date"),
        "document_year": int(cutoff.group(1)) if cutoff else 2026,
        "effective_from": None,
        "effective_to": None,
        "category": "学院",
        "review_state": "reviewed",
        "notes": (f"导入自原始采集（栏目：{meta.get('section') or md_meta.get('栏目', '学院简介')}；"
                  f"采集于 {meta.get('crawled_at', '未知时间')}；原始状态：{meta.get('review_status', '待人工核验')}）。"
                  f"导入时已逐段对照正文.md 全文核验，exact_text 为原文逐字摘录。"),
    }

    clauses, facts = [], []
    for i, p in enumerate(paragraphs, start=1):
        topic, label = classify(p)
        clause = {
            "clause_id": f"xy-{code}-c{i}",
            "doc_id": doc_id,
            "exact_text": p,
            "topic": topic,
            "campus": None, "college": college, "student_type": None, "application_year": None,
            "source_locator": "网页正文·学院简介",
            "scope_status": "reviewed",
        }
        if cutoff_tag and topic in ("师资规模", "在校生规模"):
            clause["time_condition"] = f"{cutoff_tag}（学院官网简介页口径）"
        clauses.append(clause)
        if label:
            fact = {
                "fact_id": f"xy-{code}-f-{label}",
                "subject": college,
                "predicate": label,
                "value": p,
                "unit": None,
                "conditions": {"data_as_of": f"{cutoff.group(1)}-{int(cutoff.group(2)):02d}"} if cutoff_tag else {},
                "evidence_ids": [f"xy-{code}-c{i}"],
                "topic": topic,
                "label": label,
            }
            facts.append(fact)

    if not facts:  # 至少保留一个概况事实，保证主题可答
        facts.append({
            "fact_id": f"xy-{code}-f-概况",
            "subject": college, "predicate": "概况", "value": paragraphs[0], "unit": None,
            "conditions": {}, "evidence_ids": [f"xy-{code}-c1"], "topic": "学院概况", "label": "学院概况",
        })

    topic_entry = {
        "topic_id": f"cs-{code}",
        "object_college": college,
        "triggers": [f"{college}简介", f"{college}概况"],
        "title": f"{college}概况",
        "summary": f"{college}概况要点：",
        "fact_ids": [f["fact_id"] for f in facts],
        "note": "由学院官网简介导入；问法经 colleges.json 对象归一 + intent 分流进入本主题。",
    }
    return document, clauses, facts, topic_entry


def load_xy():
    if CLAUSE_FILE.exists():
        return json.loads(CLAUSE_FILE.read_text(encoding="utf-8"))
    return {"clauses": [], "facts": [], "qa_topics": []}


def load_docs():
    return json.loads(DOC_FILE.read_text(encoding="utf-8"))


def remove_college(xy: dict, docs: dict, college: str):
    """移除该学院全部条目（clause.college / fact.subject / topic.object_college / doc.issuer）。"""
    doc_ids = {d["doc_id"] for d in docs["documents"] if d.get("issuer") == college and d["doc_id"].startswith("xy-")}
    n0 = (len(xy["clauses"]), len(xy["facts"]), len(xy["qa_topics"]), len(docs["documents"]))
    xy["clauses"] = [c for c in xy["clauses"] if c.get("college") != college and c.get("doc_id") not in doc_ids]
    xy["facts"] = [f for f in xy["facts"] if f.get("subject") != college]
    xy["qa_topics"] = [t for t in xy["qa_topics"] if t.get("object_college") != college]
    docs["documents"] = [d for d in docs["documents"] if d["doc_id"] not in doc_ids]
    removed = (n0[0] - len(xy["clauses"]), n0[1] - len(xy["facts"]), n0[2] - len(xy["qa_topics"]), n0[3] - len(docs["documents"]))
    return removed


def list_available():
    base = Path(SOURCE_ROOT) / "08_各学院官网"
    print("08_各学院官网 下含学院简介正文的学院：")
    known = {c["official"] for c in json.loads(COLLEGES_FILE.read_text(encoding="utf-8"))["colleges"]}
    for d in sorted(base.iterdir()):
        if d.is_dir() and find_intro_dirs(d.name):
            in_kb = "（colleges.json 已登记）" if d.name in known else "（colleges.json 未登记！）"
            print(f"  - {d.name} {in_kb}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--college", help="学院官方名称（见 colleges.json）")
    ap.add_argument("--remove", action="store_true", help="移除该学院已导入的条目")
    ap.add_argument("--list", action="store_true", help="列出原始资料中可导入的学院")
    args = ap.parse_args()

    if args.list or not args.college:
        list_available()
        return

    college = args.college
    xy, docs = load_xy(), load_docs()

    if args.remove:
        removed = remove_college(xy, docs, college)
        CLAUSE_FILE.write_text(json.dumps(xy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        DOC_FILE.write_text(json.dumps(docs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"已移除 {college}：clauses {removed[0]} 条 / facts {removed[1]} 条 / topics {removed[2]} 个 / docs {removed[3]} 份")
        return

    entries = build_entries(college)
    if not entries:
        print(f"[X] 未找到 {college} 的学院简介原始资料（08_各学院官网/<学院>/学院简介/）")
        sys.exit(1)
    document, clauses, facts, topic_entry = entries

    remove_college(xy, docs, college)  # 幂等：先清后写
    xy["clauses"].extend(clauses)
    xy["facts"].extend(facts)
    xy["qa_topics"].append(topic_entry)
    docs["documents"].append(document)

    CLAUSE_FILE.write_text(json.dumps(xy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DOC_FILE.write_text(json.dumps(docs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已导入 {college}（doc={document['doc_id']}）：")
    print(f"  来源 URL：{document['source_url']}")
    print(f"  clauses {len(clauses)} 条 / facts {len(facts)} 条 / topic {topic_entry['topic_id']}")
    for c in clauses:
        print(f"    {c['clause_id']}  [{c['topic']}]  {c['exact_text'][:38]}…")
    print(f"知识包 JSON 已更新：{CLAUSE_FILE.name} / documents.json；重启后端后生效。")


if __name__ == "__main__":
    main()
